import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beginSummary, summaryStep, changeSummary, summaryStatus, failSummary, summaryCostBound } from "../src/lib/server/document-summary.ts";
import { SUMMARY_MODEL } from "../src/lib/document-summary.ts";
import { newDocumentUpload, saveLocalUpload, saveChunks, getChunks, getDocument, updateDocument, readDocumentBytes, documentDownload, publicDocument, setDocumentRemoved, listDocuments } from "../src/lib/server/document-store.ts";
import { handleChat } from "../src/lib/server/chat-handler.ts";
import { mediaSession } from "../src/lib/server/media-session.ts";
import { snapshotMessages } from "../src/lib/chat-history.ts";
import { conversationSchema } from "../src/lib/chat-schema.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "numbase-completion-"));
process.env.NODE_ENV = "test";
process.env.NUMBASE_DOCUMENT_DIRECTORY = root;
process.env.NUMBASE_DOCUMENTS_ENABLED = "true";
process.env.NUMBASE_SESSION_SECRET = "synthetic-session-secret-at-least-32-characters";
process.env.OPENROUTER_API_KEY = "synthetic-not-a-credential";
delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => assert.fail("No real network requests allowed");
after(async () => { globalThis.fetch = originalFetch; assert.ok(root.startsWith(path.join(os.tmpdir(), "numbase-completion-"))); await rm(root, { recursive: true, force: true }); });
async function readyFile(owner = crypto.randomUUID(), count = 3, filename = "report.md") {
  const bytes = Buffer.from("Original source: START-2410. MIDDLE-2410. END-2410.");
  const { doc } = await newDocumentUpload(owner, "completion", filename, bytes.length);
  await saveLocalUpload(doc, bytes);
  const chunks = Array.from({ length: count }, (_, index) => ({ index, location: `section ${index + 1}`, text: `SECTION-${index + 1} ` + "record ".repeat(count === 800 ? 340 : 3) + (index === 0 ? "START-2410" : index === count - 1 ? "END-2410" : "MIDDLE-2410") }));
  await saveChunks(doc, chunks); await updateDocument({ ...doc, status: "ready", chunkCount: count, indexed: count, checksum: "fixed-source" });
  return { doc: await getDocument(owner, doc.id), chunks, bytes };
}
const content = (body) => typeof body.messages.at(-1).content === "string" ? body.messages.at(-1).content : body.messages.at(-1).content.map((part) => part.text ?? "").join("");
function provider(onCall = () => {}, finishReason = "stop") {
  return async (url, init) => {
    assert.equal(new URL(url).hostname, "openrouter.ai");
    const body = JSON.parse(init.body); const prompt = JSON.parse(content(body));
    assert.equal(body.model, SUMMARY_MODEL);
    assert.equal(body.provider.max_price.prompt, 0.10);
    assert.equal(body.provider.max_price.completion, 0.40);
    assert.ok(body.max_tokens <= 3200);
    await onCall(prompt);
    const text = prompt.sections ? prompt.sections.map((section) => `Section ${section.index + 1}: ${section.text.split(" ").at(-1)} [${prompt.filename}, ${section.location}]`).join("\n") : "All supplied sections were reviewed. START-2410; MIDDLE-2410; END-2410. [report.md, sections 1–800]";
    return Response.json({ id: "synthetic-summary", created: 1, model: body.model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: finishReason }], usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 } });
  };
}

test("the complete summary pipeline reviews all 800 sections before reduction and final output", async () => {
  const { doc, chunks } = await readyFile(undefined, 800);
  assert.ok(chunks.map((chunk) => chunk.text).join(" ").split(/\s+/).length > 250_000);
  assert.ok(summaryCostBound(chunks, doc.filename) < 0.50);
  const start = await beginSummary(doc.owner, doc.id, "completion");
  assert.equal(start.created, true);
  assert.equal((await beginSummary(doc.owner, doc.id, "completion")).created, false);
  const seen = []; let calls = 0;
  const fetch = provider((prompt) => { calls++; if (prompt.sections) seen.push(...prompt.sections.map((section) => section.index)); });
  for (let step = 0; step < 60; step++) if (!await summaryStep(doc.owner, doc.id, start.job.id, fetch)) break;
  assert.deepEqual(seen, Array.from({ length: 800 }, (_, i) => i));
  assert.equal(calls, 58);
  const job = await summaryStatus(doc.owner, doc.id, "completion");
  assert.equal(job.status, "ready"); assert.equal(job.completedSections, 800);
  assert.equal(job.notes.length, 50); assert.equal(job.combined.length, 7);
  assert.match(job.result, /START-2410.*MIDDLE-2410.*END-2410/);
  assert.equal((await beginSummary(doc.owner, doc.id, "completion")).job.id, job.id, "Read cached summary without a new paid job");
  assert.deepEqual(await readDocumentBytes(doc), Buffer.from("Original source: START-2410. MIDDLE-2410. END-2410."));
});

test("summary starts and paid steps are claimed once under concurrent requests", async () => {
  const { doc } = await readyFile();
  const starts = await Promise.all([beginSummary(doc.owner, doc.id, "completion"), beginSummary(doc.owner, doc.id, "completion")]);
  assert.equal(starts.filter((result) => result.created).length, 1);
  let calls = 0;
  await Promise.all([summaryStep(doc.owner, doc.id, starts[0].job.id, provider(() => { calls++; })), summaryStep(doc.owner, doc.id, starts[0].job.id, provider(() => { calls++; }))]);
  assert.equal(calls, 1);
});

test("cancellation during a paid step cannot be overwritten by a late provider result", async () => {
  const { doc } = await readyFile(); const { job } = await beginSummary(doc.owner, doc.id, "completion");
  const fetch = provider(async () => {
    const running = (await getDocument(doc.owner, doc.id)).summary;
    assert.equal(running.active, true);
    assert.ok(await changeSummary(doc.owner, doc.id, running, { ...running, active: false, status: "cancelled" }));
  });
  await summaryStep(doc.owner, doc.id, job.id, fetch);
  assert.equal((await getDocument(doc.owner, doc.id)).summary.status, "cancelled");
  assert.equal(await summaryStep(doc.owner, doc.id, job.id, async () => assert.fail("No new request after cancellation")), false);
});

test("provider errors, incomplete output and stalled steps never trigger automatic paid retries", async () => {
  for (const mode of ["error", "length", "stalled"]) {
    const { doc } = await readyFile(); const { job } = await beginSummary(doc.owner, doc.id, "completion");
    let calls = 0;
    if (mode === "stalled") {
      await changeSummary(doc.owner, doc.id, job, { ...job, active: true, status: "processing" });
      assert.equal(await summaryStep(doc.owner, doc.id, job.id, async () => { calls++; assert.fail(); }), false);
    } else {
      const fetch = mode === "error" ? async () => { calls++; return Response.json({ error: { message: "synthetic provider failure" } }, { status: 503 }); } : provider(() => { calls++; }, "length");
      await summaryStep(doc.owner, doc.id, job.id, fetch);
      assert.equal((await getDocument(doc.owner, doc.id)).summary.status, "failed");
      assert.equal(calls, 1);
    }
  }
});

test("source changes, missing sections, ownership and cost checks fail before a provider call", async () => {
  const { doc } = await readyFile(); const { job } = await beginSummary(doc.owner, doc.id, "completion");
  await assert.rejects(beginSummary(crypto.randomUUID(), doc.id, "completion"), /unavailable/);
  await assert.rejects(beginSummary(doc.owner, doc.id, "other"), /unavailable/);
  await updateDocument({ ...(await getDocument(doc.owner, doc.id)), checksum: "changed" });
  await assert.rejects(summaryStep(doc.owner, doc.id, job.id, async () => assert.fail()), /source file changed/);
  await failSummary(doc.owner, doc.id, job.id, new Error("do not expose raw errors"));
  assert.ok(!(await getDocument(doc.owner, doc.id)).summary.error.includes("do not expose"));
  assert.ok(summaryCostBound(Array.from({ length: 800 }, (_, index) => ({ index, location: "page", text: "漢".repeat(4000) })), "unicode.md") > 0.50);
  const broken = await readyFile();
  await updateDocument({ ...broken.doc, chunkCount: 4 });
  await assert.rejects(beginSummary(broken.doc.owner, broken.doc.id, "completion"), /unavailable/);
});

test("removed files retain original bytes for restoration while access and indexing are blocked", async () => {
  const { doc, bytes } = await readyFile();
  const { job } = await beginSummary(doc.owner, doc.id, "completion");
  const removed = await setDocumentRemoved(doc.owner, doc.id, "completion", true);
  assert.ok(removed.removedAt); assert.equal(removed.summary.status, "cancelled");
  assert.equal(publicDocument(removed).status, "removed");
  await assert.rejects(readDocumentBytes(removed), /removed/);
  await assert.rejects(documentDownload(removed), /removed/);
  await assert.rejects(getChunks(removed), /removed/);
  assert.equal(await updateDocument({ ...doc, status: "ready" }), false, "Stale background writes cannot revive a removed file");
  assert.equal(await changeSummary(doc.owner, doc.id, job, { ...job, status: "processing" }), undefined);
  await assert.rejects(setDocumentRemoved(crypto.randomUUID(), doc.id, "completion", false), /unavailable/);
  assert.equal((await listDocuments(doc.owner)).length, 1);
  const restored = await setDocumentRemoved(doc.owner, doc.id, "completion", false);
  assert.equal(restored.removedAt, undefined); assert.deepEqual(await readDocumentBytes(restored), bytes);
});

test("a removed attachment does not break ordinary chat or erase saved context", async () => {
  const request = new Request("http://127.0.0.1/api/media/session");
  const session = mediaSession(request, true);
  const { doc } = await readyFile(session.owner);
  await setDocumentRemoved(doc.owner, doc.id, "completion", true);
  const messages = [{ id: "upload", role: "user", parts: [{ type: "text", text: "Remember the project name: Summit." }, { type: "file", filename: doc.filename, mediaType: "text/plain", url: `/api/documents/${doc.id}` }] }, { id: "followup", role: "user", parts: [{ type: "text", text: "What is the project name?" }] }];
  assert.equal(conversationSchema.safeParse({ id: "completion", title: "Keep this", updatedAt: 1, model: "openai/gpt-4.1-mini", messages: snapshotMessages(messages) }).success, true);
  const response = await handleChat(new Request("http://127.0.0.1/api/chat", { method: "POST", headers: { origin: "http://127.0.0.1", host: "127.0.0.1", cookie: session.cookie.split(";")[0], "Content-Type": "application/json" }, body: JSON.stringify({ id: "completion", model: "openai/gpt-4.1-mini", messages }) }), async (_url, init) => {
    const body = JSON.parse(init.body); const prompt = JSON.stringify(body.messages);
    assert.match(prompt, /Summit/); assert.match(prompt, /Removed.*Earlier chat messages/); assert.ok(!prompt.includes("SECTION-1"));
    const common = { id: "synthetic", object: "chat.completion.chunk", created: 1, model: body.model };
    return new Response(`data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { role: "assistant", content: "The project name is Summit." }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  });
  assert.equal(response.status, 200); assert.match(await response.text(), /Summit/);
});
