import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { selectSourceFacts } from "../src/lib/source-facts.ts";
import { suppressModelDownload } from "../src/lib/download-links.ts";
import { publicSummary, summaryText } from "../src/lib/document-summary.ts";
import { beginSummary } from "../src/lib/server/document-summary.ts";
import { newDocumentUpload, saveLocalUpload, saveChunks, getDocument, updateDocument, setDocumentRemoved, readDocumentBytes, listDocuments, documentLocalFile } from "../src/lib/server/document-store.ts";
import { purgeDocument } from "../src/lib/server/document-purge.ts";
import { handleChat } from "../src/lib/server/chat-handler.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "numbase-release-fixes-"));
process.env.NODE_ENV = "test"; process.env.NUMBASE_DOCUMENT_DIRECTORY = root;
process.env.NUMBASE_DOCUMENTS_ENABLED = "true"; process.env.NUMBASE_SESSION_SECRET = "synthetic-session-secret-at-least-32-characters";
process.env.OPENROUTER_API_KEY = "synthetic-not-a-credential";
delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const realFetch = globalThis.fetch;
globalThis.fetch = async () => assert.fail("No real network requests in deterministic tests");
after(async () => { globalThis.fetch = realFetch; assert.ok(root.startsWith(path.join(os.tmpdir(), "numbase-release-fixes-"))); await rm(root, { recursive: true, force: true }); });

async function file() {
  const owner = crypto.randomUUID();
  const bytes = Buffer.from("Project name Northern Harbor. Approved amount EUR 1250. Invoice INV-2410.");
  const { doc } = await newDocumentUpload(owner, "fixes", "report.txt", bytes.length);
  await saveLocalUpload(doc, bytes); await saveChunks(doc, [{ index: 0, location: "lines 1–3", text: bytes.toString() }]);
  await updateDocument({ ...doc, status: "ready", checksum: "source-hash", indexed: 1, chunkCount: 1 });
  return { doc: await getDocument(owner, doc.id), bytes };
}
test("exact beginning/middle/end facts survive a repetitive 400-section source", () => {
  const chunks = Array.from({ length: 400 }, (_, index) => ({ index, location: "lines " + (index * 10 + 1), text: "word ".repeat(300) + ". " + (index === 0 ? "Project name Northern Harbor." : index === 200 ? "Approved amount EUR 1250." : index === 399 ? "Invoice INV-2410. Supplier Numbase. Total USD 1250." : "") }));
  const facts = selectSourceFacts(chunks);
  for (const expected of ["Project name Northern Harbor.", "Approved amount EUR 1250.", "Invoice INV-2410.", "Total USD 1250."]) assert.ok(facts.some((fact) => fact.quote === expected), expected);
  assert.ok(facts.length <= 64);
  assert.ok(facts.every((fact) => chunks[fact.section - 1].text.includes(fact.quote)));
  assert.ok(!facts.some((fact) => fact.quote.startsWith("word word")));
});
test("dense early evidence cannot crowd later source facts out", () => {
  const chunks = Array.from({ length: 80 }, (_, index) => ({ index, location: "section " + index, text: Array.from({ length: 10 }, (_, n) => "Approved budget EUR " + (index * 100 + n) + ".").join(" ") }));
  const facts = selectSourceFacts(chunks);
  assert.equal(facts.length, 64); assert.ok(facts.some((fact) => fact.section > 70)); assert.ok(facts.some((fact) => fact.section > 35 && fact.section < 45));
});
test("model download links cannot compete with verified file cards", () => {
  for (const href of ["/api/documents/1111", "https://numbase.ai/api/documents/1111", "https://foreign.invalid/storage/v1/object/sign/x", "/%61pi/documents/1111"]) assert.equal(suppressModelDownload(href, "Here"), true);
  for (const href of ["/", "https://numbase.ai/", "https://foreign.invalid/report.docx", "sandbox:/mnt/data/report.pdf"]) assert.equal(suppressModelDownload(href, "report.docx", true), true);
  assert.equal(suppressModelDownload("https://example.com/article", "Source", true), false);
  assert.equal(suppressModelDownload("https://example.com/report.pdf", "Research paper", false), false);
});
test("legacy summary updates preserve maps, job identity and cumulative spend", async () => {
  const { doc } = await file(); const { job } = await beginSummary(doc.owner, doc.id, "fixes");
  const legacy = { ...job, version: undefined, status: "ready", completedSections: 1, notes: [{ start: 1, end: 1, text: "An old paraphrase omitted the amount." }], combined: [], reservedUsd: 0.12, result: "Old summary." };
  await updateDocument({ ...doc, summary: legacy });
  const starts = await Promise.all([beginSummary(doc.owner, doc.id, "fixes"), beginSummary(doc.owner, doc.id, "fixes")]);
  assert.equal(starts.filter((result) => result.created).length, 1);
  const next = (await getDocument(doc.owner, doc.id)).summary;
  assert.equal(next.id, job.id); assert.equal(next.reservedUsd, 0.12); assert.equal(next.completedSections, 1); assert.equal(next.version, 2);
  assert.deepEqual(next.notes, legacy.notes); assert.ok(next.sourceFacts.some((fact) => fact.quote === "Approved amount EUR 1250."));
  assert.ok(publicSummary(next).sourceFacts.some((fact) => fact.quote === "Invoice INV-2410."));
});
test("permanent deletion requires ownership, exact confirmation, removal and expired upload tickets", async () => {
  const { doc } = await file();
  await assert.rejects(purgeDocument(crypto.randomUUID(), doc.id, "fixes", doc.filename), /unavailable/);
  await assert.rejects(purgeDocument(doc.owner, doc.id, "other", doc.filename), /unavailable/);
  await assert.rejects(purgeDocument(doc.owner, doc.id, "fixes", "wrong.txt"), /exact filename/);
  await assert.rejects(purgeDocument(doc.owner, doc.id, "fixes", doc.filename), /Remove this file/);
  await setDocumentRemoved(doc.owner, doc.id, "fixes", true);
  await assert.rejects(purgeDocument(doc.owner, doc.id, "fixes", doc.filename), /ticket has not expired/);
});
test("purge removes bytes and indexed content, keeps a history tombstone and cannot restore", async () => {
  const { doc, bytes } = await file();
  await updateDocument({ ...doc, createdAt: Date.now() - 3 * 60 * 60_000 });
  assert.deepEqual(await readDocumentBytes(await getDocument(doc.owner, doc.id)), bytes);
  await setDocumentRemoved(doc.owner, doc.id, "fixes", true);
  const deleted = await purgeDocument(doc.owner, doc.id, "fixes", doc.filename);
  assert.ok(deleted.purgedAt); assert.equal(deleted.size, 0); assert.equal(deleted.summary, undefined); assert.equal(deleted.generated, undefined);
  for (const suffix of ["bin", "chunks.json"]) await assert.rejects(readFile(await documentLocalFile(doc.owner, doc.id, suffix)), { code: "ENOENT" });
  assert.equal((await getDocument(doc.owner, doc.id)).filename, doc.filename);
  assert.equal((await listDocuments(doc.owner)).length, 0);
  await assert.rejects(saveChunks(doc, [{ index: 0, location: "late", text: "Must not return" }]), /deleted|removed/);
  assert.equal(await updateDocument({ ...doc, status: "ready" }), false);
  await assert.rejects(setDocumentRemoved(doc.owner, doc.id, "fixes", false), /permanently deleted/);
  assert.equal((await purgeDocument(doc.owner, doc.id, "fixes", doc.filename)).purgedAt, deleted.purgedAt);
});
test("purged source files do not break unrelated ordinary chat context", async () => {
  // Reuse the real handler's signed browser session, without reading any real cookie.
  const { mediaSession } = await import("../src/lib/server/media-session.ts");
  const session = mediaSession(new Request("http://127.0.0.1/api/media/session"), true);
  const bytes = Buffer.from("Old source."); const { doc } = await newDocumentUpload(session.owner, "purged-chat", "old.txt", bytes.length);
  await saveLocalUpload(doc, bytes); await saveChunks(doc, [{ index: 0, location: "line 1", text: "Old source." }]);
  await updateDocument({ ...doc, status: "ready", indexed: 1, chunkCount: 1, createdAt: Date.now() - 3 * 60 * 60_000 });
  await setDocumentRemoved(doc.owner, doc.id, "purged-chat", true); await purgeDocument(doc.owner, doc.id, "purged-chat", "old.txt");
  const messages = [{ id: "first", role: "user", parts: [{ type: "text", text: "Remember Summit." }, { type: "file", filename: doc.filename, mediaType: "text/plain", url: "/api/documents/" + doc.id }] }, { id: "last", role: "user", parts: [{ type: "text", text: "What project name did I give?" }] }];
  const response = await handleChat(new Request("http://127.0.0.1/api/chat", { method: "POST", headers: { origin: "http://127.0.0.1", host: "127.0.0.1", cookie: session.cookie.split(";")[0], "Content-Type": "application/json" }, body: JSON.stringify({ id: "purged-chat", model: "openai/gpt-4.1-mini", messages }) }), async (_url, init) => {
    assert.match(init.body, /Summit/); assert.match(init.body, /Permanently deleted/);
    const common = { id: "synthetic", object: "chat.completion.chunk", created: 1, model: "openai/gpt-4.1-mini" };
    return new Response("data: " + JSON.stringify({ ...common, choices: [{ index: 0, delta: { content: "Summit." }, finish_reason: null }] }) + "\n\ndata: " + JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) + "\n\ndata: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
  });
  assert.equal(response.status, 200); assert.match(await response.text(), /Summit/);
});

test("hosted purge releases metadata only after Storage API deletion succeeds", async () => {
  const owner = crypto.randomUUID(), id = crypto.randomUUID();
  const doc = { id, owner, conversationId: "hosted-purge", filename: "old.txt", kind: "text", size: 100, status: "ready", createdAt: Date.now() - 3 * 60 * 60_000, removedAt: Date.now(), chunkCount: 1, indexed: 1 };
  process.env.SUPABASE_URL = "https://synthetic-purge.supabase.co"; process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-not-a-credential";
  try {
    for (const failure of ["storage", "finish", "none"]) {
      const calls = [];
      globalThis.fetch = async (input, init = {}) => {
        const url = new URL(input instanceof Request ? input.url : input); const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
        assert.equal(url.hostname, "synthetic-purge.supabase.co"); calls.push(url.pathname);
        if (url.pathname.endsWith("/numbase_documents")) {
          assert.equal(url.searchParams.get("owner"), "eq." + owner);
          return Response.json([{ record: doc }]);
        }
        if (url.pathname.endsWith("/rpc/numbase_begin_document_purge")) { assert.deepEqual(body, { session_owner: owner, file_id: id, chat_id: doc.conversationId }); return new Response(null, { status: 204 }); }
        if (url.pathname === "/storage/v1/object/numbase-documents") {
          assert.equal(init.method, "DELETE"); assert.deepEqual(body.prefixes, [owner + "/" + id + "/original"]);
          return failure === "storage" ? Response.json({ message: "synthetic failure" }, { status: 500 }) : Response.json([]);
        }
        if (url.pathname.endsWith("/rpc/numbase_finish_document_purge")) {
          assert.ok(calls.some((value) => value === "/storage/v1/object/numbase-documents"));
          return failure === "finish" ? Response.json({ message: "synthetic database failure" }, { status: 500 }) : Response.json({ ...doc, purgedAt: Date.now(), size: 0 });
        }
        assert.fail(url.pathname);
      };
      if (failure === "none") assert.ok((await purgeDocument(owner, id, doc.conversationId, doc.filename)).purgedAt);
      else await assert.rejects(purgeDocument(owner, id, doc.conversationId, doc.filename), /did not finish/);
      assert.equal(calls.filter((value) => value.endsWith("/rpc/numbase_finish_document_purge")).length, failure === "storage" ? 0 : 1);
    }
  } finally { delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; globalThis.fetch = async () => assert.fail("No real network"); }
});


test("cached summary prose cannot repeat inferred layout or placeholder absence claims", () => {
  const sourceFacts = [{ section: 201, location: "lines 2501–2550", quote: "Approved amount EUR 1250." }];
  const job = { result: "## Summary\n\n### Sections Summary\n- **Sections 201–4950**: Only placeholder text.\n- All sections contain no meaningful facts.\n\n### Key points\n- Project name: Northern Harbor.\n- Approved amount: EUR 1250 [report.md, lines 2501–2550].\n\n### SourceFacts\n- Duplicate model-authored source block.", sourceFacts };
  const result = summaryText(job);
  assert.match(result, /Northern Harbor/); assert.match(result, /EUR 1250/); assert.match(result, /lines 2501/);
  assert.doesNotMatch(result, /placeholder|All sections|201–4950|SourceFacts|Duplicate/);
  assert.equal(publicSummary(job).result, result); assert.deepEqual(publicSummary(job).sourceFacts, sourceFacts);
});
test("an empty filtered synthesis falls back to actual source passages", () => {
  const job = { result: "## Summary\n- Each section has 50 lines.\n- Only placeholder text.", sourceFacts: [{ section: 1, location: "paragraph 1", quote: "Project name Northern Harbor." }] };
  assert.match(summaryText(job), /Project name Northern Harbor/);
  assert.doesNotMatch(summaryText(job), /placeholder|50 lines/);
});
