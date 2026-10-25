import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport, createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { createDocumentTools, documentOverview, checkedSections } from "../src/lib/server/document-reading.ts";
import { documentReadResultSchema } from "../src/lib/document-reading.ts";
import { boundedDocumentMatches } from "../src/lib/server/document-retrieval.ts";
import { newDocumentUpload, saveChunks, updateDocument } from "../src/lib/server/document-store.ts";
import { extractionSource, extractDocument } from "../src/lib/server/document-extraction.ts";
import { extractionWorkbook } from "../src/lib/server/extraction-export.ts";
import ExcelJS from "exceljs";
import { extractionSchema, extractionRequestSchema, extractionContext, INVOICE_FIELDS } from "../src/lib/extractions.ts";
import { snapshotMessages } from "../src/lib/chat-history.ts";
import { requestSchema, conversationSchema } from "../src/lib/chat-schema.ts";
import { streamOpenRouterResponse } from "../src/lib/server/openrouter-chat.ts";
import { MODELS } from "../src/lib/models.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "numbase-reading-"));
process.env.NODE_ENV = "test";
process.env.NUMBASE_DOCUMENT_DIRECTORY = root;
process.env.NUMBASE_DOCUMENTS_ENABLED = "true";
process.env.NUMBASE_PUBLIC_ACCESS_ENABLED = "true";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.OPENROUTER_API_KEY;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => assert.fail("Never contact real services in these tests");
after(async () => {
  globalThis.fetch = originalFetch;
  assert.ok(root.startsWith(path.join(os.tmpdir(), "numbase-reading-")));
  await rm(root, { recursive: true, force: true });
});
const owner = crypto.randomUUID();
const chunks = Array.from({ length: 800 }, (_, index) => ({
  index, location: `page ${index + 1}`, text: `SECTION-${index + 1} ` + "record ".repeat(340) + ` END-${index + 1}`,
}));
const { doc: reservation } = await newDocumentUpload(owner, "large-chat", "large.md", 1_950_000);
const doc = { ...reservation, chunkCount: chunks.length, indexed: chunks.length, status: "ready" };
await saveChunks(doc, chunks);
await updateDocument(doc);
const options = () => ({ owner, conversationId: "large-chat", allowedIds: [doc.id], signal: AbortSignal.timeout(15_000) });
const read = () => createDocumentTools(options()).readDocument;
const input = (operation = "overview", startSection = 1, endSection = 1) => ({ documentId: doc.id, operation, startSection, endSection });
const call = (tool, args) => tool.execute(args, { toolCallId: crypto.randomUUID(), messages: [] });

test("an oversized overview includes beginning, middle and end within a fixed source budget and reports sampling", () => {
  assert.ok(chunks.map((chunk) => chunk.text).join(" ").split(/\s+/).length > 250_000);
  const result = documentOverview(doc, chunks);
  assert.equal(result.coverage.totalSections, 800);
  assert.equal(result.coverage.includedSections, 48);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.shortened, true);
  assert.equal(result.sections[0].section, 1);
  assert.equal(result.sections.at(-1).section, 800);
  assert.ok(result.sections.some((section) => section.section > 350 && section.section < 450));
  assert.match(result.sections.at(-1).text, /END-800/);
  assert.ok(result.sections.reduce((sum, section) => sum + section.text.length, 0) <= 12_000);
  assert.equal(documentReadResultSchema.safeParse(result).success, true);
  assert.match(result.note, /not an exhaustive/);
});

test("small overviews return complete source text while missing or reordered chunks are rejected", () => {
  const small = documentOverview({ ...doc, chunkCount: 2 }, chunks.slice(0, 2));
  assert.equal(small.coverage.complete, true);
  assert.equal(small.coverage.shortened, false);
  assert.equal(small.sections[1].text, chunks[1].text);
  assert.throws(() => checkedSections([chunks[0], chunks[2]], 0, 2), /unavailable/);
  assert.throws(() => checkedSections([chunks[1], chunks[0]], 0, 2), /unavailable/);
  assert.throws(() => documentOverview(doc, chunks.slice(1)), /unavailable/);
});

test("focused reading reaches the end of a large file without truncating the selected source", async () => {
  const result = await call(read(), input("sections", 799, 800));
  assert.equal(result.coverage.includedSections, 2);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.shortened, false);
  assert.equal(result.sections[1].text, chunks[799].text);
  assert.equal(result.sections[1].section, 800);
  await assert.rejects(call(read(), input("sections", 800, 801)), /consecutive sections/);
  await assert.rejects(call(read(), input("sections", 1, 9)), /consecutive sections/);
  await assert.rejects(call(read(), input("sections", 1, 8)), /too large/);
});

test("document reads enforce ownership, conversation scope, readiness, configuration and cancellation", async () => {
  await assert.rejects(call(read(), { ...input(), documentId: crypto.randomUUID() }), /this conversation/);
  await assert.rejects(call(createDocumentTools({ ...options(), owner: crypto.randomUUID() }).readDocument, input()), /unavailable/);
  await assert.rejects(call(createDocumentTools({ ...options(), conversationId: "other" }).readDocument, input()), /unavailable/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(call(createDocumentTools({ ...options(), signal: abort.signal }).readDocument, input()), { name: "AbortError" });
  await updateDocument({ ...doc, status: "processing" });
  try { await assert.rejects(call(read(), input()), /Wait until/); }
  finally { await updateDocument(doc); }
  process.env.NUMBASE_DOCUMENTS_ENABLED = "false";
  try { await assert.rejects(call(read(), input()), /not configured/); }
  finally { process.env.NUMBASE_DOCUMENTS_ENABLED = "true"; }
});

test("one answer cannot exceed four reads or 32,000 source characters", async () => {
  const tool = read();
  for (let i = 0; i < 4; i++) await call(tool, input("sections", i + 1, i + 1));
  await assert.rejects(call(tool, input("sections", 5, 5)), /reading limit/);
  const overview = read();
  const results = [];
  for (let i = 0; i < 3; i++) results.push(await call(overview, input()));
  assert.ok(results.flatMap((result) => result.sections).reduce((sum, section) => sum + section.text.length, 0) <= 32_000);
  await assert.rejects(call(overview, input()), /reading limit/);
});

test("parallel model tool calls cannot oversubscribe the source budget", async () => {
  const tool = read();
  const reads = await Promise.allSettled(Array.from({ length: 4 }, () => call(tool, input())));
  const returned = reads.filter((read) => read.status === "fulfilled").map((read) => read.value);
  assert.equal(returned.length, 3);
  assert.ok(returned.flatMap((read) => read.sections).reduce((sum, section) => sum + section.text.length, 0) <= 32_000);
  assert.match(reads.find((read) => read.status === "rejected").reason.message, /reading limit/);
});

test("retrieval shares its context budget fairly across eight files", () => {
  const matches = Array.from({ length: 8 }, (_, i) => Array.from({ length: 3 }, (_, index) => ({
    documentId: String(i), filename: `${i}.md`, index, location: `page ${index}`, text: "x".repeat(4000), score: 1,
  }))).flat();
  const bounded = boundedDocumentMatches(matches);
  assert.equal(new Set(bounded.map((match) => match.documentId)).size, 8);
  assert.equal(bounded.reduce((sum, match) => sum + match.text.length, 0), 24_000);
});

test("range extraction reads exact late sections and rejects invalid coverage before any model call", async () => {
  const source = await extractionSource(owner, "large-chat", doc.id, { start: 799, end: 800 });
  assert.deepEqual(source.chunks, chunks.slice(798));
  assert.deepEqual(source.scope, { start: 799, end: 800, totalSections: 800, complete: false });
  await assert.rejects(extractionSource(owner, "large-chat", doc.id), /too large.*Choose/);
  for (const range of [{ start: 0, end: 2 }, { start: 2, end: 1 }, { start: 1, end: 13 }, { start: 800, end: 801 }]) {
    assert.equal(extractionRequestSchema.safeParse({ conversationId: "large-chat", kind: "invoice", range }).success, false);
    await assert.rejects(extractionSource(owner, "large-chat", doc.id, range), /valid section range/);
  }
  assert.equal(extractionRequestSchema.safeParse({ conversationId: "large-chat", kind: "invoice" }).success, true, "Older requests remain compatible");
});

test("real SDK extraction retains high source indices, partial coverage and reviewed context", async () => {
  const fields = Object.fromEntries(Object.keys(INVOICE_FIELDS).map((key) => [key, { value: null, evidence: null }]));
  fields.invoiceNumber = { value: "SECTION-800", evidence: { chunk: 799, quote: "SECTION-800" } };
  process.env.OPENROUTER_API_KEY = "synthetic-not-a-credential";
  let calls = 0;
  try {
    const result = await extractDocument({ owner, conversationId: "large-chat", id: doc.id, kind: "invoice", range: { start: 799, end: 800 }, signal: AbortSignal.timeout(5000),
      fetch: async (_url, init) => {
        calls++;
        const body = JSON.parse(init.body);
        const prompt = body.messages.at(-1).content;
        assert.match(JSON.stringify(prompt), /SECTION-800/);
        assert.ok(!JSON.stringify(prompt).includes("SECTION-1 "));
        return Response.json({ id: "synthetic", created: 1, model: body.model, choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ fields, lineItems: [], warnings: [], truncated: false }) }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 } });
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.scope.complete, false);
    assert.equal(result.sources[1].index, 799);
    assert.match(extractionContext(result), /"complete":false/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await extractionWorkbook(result)));
    const notes = workbook.getWorksheet("Read me");
    let coverage;
    notes.eachRow((row) => { if (row.getCell(1).value === "Source coverage") coverage = row.getCell(2).value; });
    assert.match(coverage, /Sections 799–800 of 800.*selected range only/);
    assert.equal(extractionSchema.safeParse({ ...result, scope: { ...result.scope, complete: true } }).success, false);
    const messages = [{ id: "extraction", role: "assistant", parts: [{ type: "data-extraction", data: result }] }];
    assert.equal(conversationSchema.safeParse({ id: "large-chat", title: "Long file", model: MODELS[0].id, updatedAt: 1, messages: snapshotMessages(messages) }).success, true);
  } finally { delete process.env.OPENROUTER_API_KEY; }
});

test("real SDK reads source through tools for all four models, then streams an answer", async () => {
  for (const model of MODELS) {
    let calls = 0;
    const response = streamOpenRouterResponse({ model: model.id, apiKey: "synthetic-not-a-key", signal: AbortSignal.timeout(10_000),
      messages: [{ id: "read-turn", role: "user", parts: [{ type: "text", text: "Read the final two sections" }] }], documentContext: options(),
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body); calls++;
        assert.equal(body.model, model.id);
        assert.ok(body.tools.some((tool) => tool.function.name === "readDocument"));
        if (calls === 2) assert.match(JSON.stringify(body.messages), /END-800/);
        const delta = calls === 1 ? { role: "assistant", tool_calls: [{ index: 0, id: "read", type: "function", function: { name: "readDocument", arguments: JSON.stringify(input("sections", 799, 800)) } }] }
          : { role: "assistant", content: "The last marker is END-800 [large.md, page 800]. Only sections 799–800 were reviewed." };
        const common = { id: "synthetic", object: "chat.completion.chunk", created: 1, model: model.id };
        return new Response(`data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: calls === 1 ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
      },
    });
    const text = await response.text();
    assert.match(text, /tool-output-available/);
    assert.match(text, /END-800/);
    assert.equal(calls, 2);
  }
});

test("snapshots keep coverage but omit bulky read text without trusting it on later model switches", () => {
  const result = documentOverview(doc, chunks);
  const original = [{ id: "read", role: "assistant", parts: [{ type: "tool-readDocument", toolCallId: "read", state: "output-available", input: input(), output: result }] }];
  const snapshot = snapshotMessages(original);
  assert.ok(snapshot[0].parts[0].output.sections.every((section) => section.text === ""));
  assert.notEqual(original[0].parts[0].output.sections[0].text, "");
  assert.equal(snapshot[0].parts[0].output.coverage.totalSections, 800);
  assert.equal(conversationSchema.safeParse({ id: "large-chat", title: "Read", model: MODELS[1].id, updatedAt: 1, messages: snapshot }).success, true);
  const next = [...snapshot, { id: "next", role: "user", parts: [{ type: "text", text: "Continue" }] }];
  assert.equal(requestSchema.safeParse({ id: "large-chat", model: MODELS[1].id, messages: next }).success, true);
});

test("actual SDK partial reading inputs survive recovery beside an unrelated healthy conversation", async () => {
  let release; const gate = new Promise((resolve) => { release = resolve; });
  const chat = new Chat({ id: "partial-reading", transport: new DefaultChatTransport({ fetch: async () => createUIMessageStreamResponse({ stream: createUIMessageStream({ execute: async ({ writer }) => {
    writer.write({ type: "start", messageId: "partial" });
    writer.write({ type: "tool-input-start", toolCallId: "read", toolName: "readDocument" });
    writer.write({ type: "tool-input-delta", toolCallId: "read", inputTextDelta: '{"documentId":"1111","operation":"over' });
    await gate;
    writer.write({ type: "tool-output-error", toolCallId: "read", errorText: "Interrupted" });
    writer.write({ type: "finish", finishReason: "stop" }); writer.setOutcome({ status: "completed" });
  } }) }) }) });
  const pending = chat.sendMessage({ text: "Summarize the file" });
  try {
    for (let i = 0; i < 100 && !chat.lastMessage?.parts.some((part) => part.type === "tool-readDocument"); i++) await new Promise((resolve) => setTimeout(resolve, 5));
    const messages = snapshotMessages(chat.messages);
    assert.equal(messages.at(-1).parts[0].state, "input-streaming");
    const healthy = { id: "healthy", title: "Keep me", model: MODELS[0].id, updatedAt: 1, messages: [{ id: "healthy-user", role: "user", parts: [{ type: "text", text: "unrelated" }] }] };
    const partial = { ...healthy, id: "partial-reading", messages };
    const entries = new Map([["numbase.conversations.v2", JSON.stringify({ version: 2, activeId: partial.id, conversations: [healthy, partial] })]]);
    globalThis.localStorage = { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
    const { conversations } = await import("../src/lib/conversations.ts?partial-reading"); conversations.hydrate();
    const saved = JSON.parse(entries.get("numbase.conversations.v2"));
    assert.equal(saved.conversations.length, 2);
    assert.ok(saved.conversations.some((item) => item.id === "healthy"));
    const next = [...messages, { id: "next", role: "user", parts: [{ type: "text", text: "Continue" }] }];
    assert.equal(requestSchema.safeParse({ id: "partial-reading", model: MODELS[1].id, messages: next }).success, true);
  } finally { release(); await pending; delete globalThis.localStorage; }
});
