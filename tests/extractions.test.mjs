import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { EXTRACTION_MODEL, INVOICE_FIELDS, extractionSchema, extractionContext } from "../src/lib/extractions.ts";
import { extractDocument, extractionSource, validateExtractionEvidence } from "../src/lib/server/document-extraction.ts";
import { extractionWorkbook } from "../src/lib/server/extraction-export.ts";
import { newDocumentUpload, saveChunks, updateDocument } from "../src/lib/server/document-store.ts";
import { snapshotMessages, toModelMessages } from "../src/lib/chat-history.ts";
import { conversationSchema, requestSchema } from "../src/lib/chat-schema.ts";
import { multimodalHistory } from "../src/lib/server/multimodal-history.ts";
import { requireExtractions } from "../src/lib/server/document-config.ts";

const temp = await mkdtemp(path.join(os.tmpdir(), "numbase-extraction-"));
process.env.NODE_ENV = "test";
process.env.NUMBASE_DOCUMENT_DIRECTORY = temp;
process.env.NUMBASE_DOCUMENTS_ENABLED = "true";
process.env.NUMBASE_EXTRACTION_ENABLED = "true";
process.env.OPENROUTER_API_KEY = "synthetic-test-value-not-a-credential";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const realFetch = globalThis.fetch;
after(async () => { globalThis.fetch = realFetch; await rm(temp, { recursive: true, force: true }); });
const owner = crypto.randomUUID();
const quote = "Invoice INV-84729. Supplier Numbase. Total USD 1250.";
const chunks = [{ index: 0, location: "page 1", text: quote }];
const evidence = { chunk: 0, quote };
const fields = Object.fromEntries(Object.keys(INVOICE_FIELDS).map((key) => [key, { value: null, evidence: null }]));
Object.assign(fields, { invoiceNumber: { value: "INV-84729", evidence }, supplier: { value: "Numbase", evidence }, currency: { value: "USD", evidence }, total: { value: "1250", evidence } });
const invoice = { fields, lineItems: [], warnings: [], truncated: false };
const table = { columns: ["Product", "Amount"], rows: [{ cells: ["Blue barrel", "1250"], evidence: { chunk: 0, quote: "Blue barrel | 1250" } }], warnings: [], truncated: false };
const base = { version: 1, documentId: crypto.randomUUID(), filename: "invoice.pdf", model: EXTRACTION_MODEL, createdAt: 1, edited: false, demo: false, sources: [{ index: 0, location: "page 1" }] };
const result = { ...base, kind: "invoice", data: invoice };
async function localFile(text = quote) {
  const { doc } = await newDocumentUpload(owner, "chat", "invoice.pdf", 500);
  await saveChunks(doc, [{ index: 0, location: "page 1", text }]);
  await updateDocument({ ...doc, status: "ready", indexed: 1, chunkCount: 1 });
  return doc;
}
let providerCalls = 0;
const provider = (value, status = 200, finishReason = "stop") => async (input, init) => {
  providerCalls++;
  assert.equal(new URL(input).hostname, "openrouter.ai");
  const body = JSON.parse(init.body);
  assert.equal(body.model, EXTRACTION_MODEL);
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.provider.require_parameters, true);
  assert.notEqual(body.stream, true);
  assert.ok(init.signal instanceof AbortSignal);
  assert.match(JSON.stringify(body.messages), /untrusted data/);
  return status === 200 ? Response.json({ id: "synthetic-extraction", created: 1, model: EXTRACTION_MODEL,
    choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(value) }, finish_reason: finishReason }], usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 } })
    : Response.json({ error: { message: "synthetic provider response must not reach client", code: status } }, { status });
};

test("real SDK requests strict schema output and grounds invoice fields in all supplied sections", async () => {
  const doc = await localFile();
  const extracted = await extractDocument({ owner, conversationId: "chat", id: doc.id, kind: "invoice", signal: new AbortController().signal, fetch: provider(invoice) });
  assert.equal(extracted.data.fields.total.value, "1250");
  assert.equal(extracted.data.fields.dueDate.value, null);
  assert.deepEqual(extracted.sources, [{ index: 0, location: "page 1" }]);
  assert.equal(extracted.documentId, doc.id);
  assert.ok(extractionSchema.safeParse(extracted).success);
});
test("table extraction validates row widths, value evidence and omitted-row warnings", async () => {
  const doc = await localFile("Blue barrel | 1250");
  const extracted = await extractDocument({ owner, conversationId: "chat", id: doc.id, kind: "table", signal: new AbortController().signal, fetch: provider({ ...table, truncated: true, warnings: ["Only the first table is included."] }) });
  assert.deepEqual(extracted.data.rows[0].cells, ["Blue barrel", "1250"]);
  assert.equal(extracted.data.truncated, true);
  assert.equal(extractionSchema.safeParse({ ...extracted, data: { ...table, rows: [{ ...table.rows[0], cells: ["1250"] }] } }).success, false);
});
test("fabricated values, forged quotes and invalid section IDs are rejected", () => {
  for (const field of [{ value: "9000", evidence }, { value: "1250", evidence: { chunk: 0, quote: "Total USD 9000" } }, { value: "1250", evidence: { ...evidence, chunk: 7 } }, { value: "1250", evidence: null }]) {
    assert.throws(() => validateExtractionEvidence({ ...result, data: { ...invoice, fields: { ...fields, total: field } } }, chunks), /ground/);
  }
});
test("spreadsheet rows rebuild exact evidence and restore decimal formatting from a unique matching row", () => {
  const source = [{ index: 0, location: "CSV, row 1", text: "1: Product | 2: Amount\n[CSV, row 2] 1: Blue barrel | 2: 320.00" }];
  const extracted = { ...base, kind: "table", data: { ...table, rows: [{ cells: ["Blue barrel", "320"], evidence: { chunk: 0, quote: "Blue barrel | 320" } }] } };
  validateExtractionEvidence(extracted, source);
  assert.deepEqual(extracted.data.rows[0].cells, ["Blue barrel", "320.00"]);
  assert.equal(extracted.data.rows[0].evidence.quote, "[CSV, row 2] 1: Blue barrel | 2: 320.00");
});
test("spreadsheet evidence never combines separate rows or accepts fabricated values or ambiguous formatting", () => {
  const source = [{ index: 0, location: "CSV, row 1", text: "1: Blue barrel | 2: 1250\n[CSV, row 2] 1: Red barrel | 2: 320.00" }];
  for (const cells of [["Blue barrel", "320"], ["Blue barrel", "9000"], ["Blue barrel", "1,250"]]) {
    const extracted = { ...base, kind: "table", data: { ...table, rows: [{ cells, evidence: { chunk: 0, quote: cells.join(" | ") } }] } };
    assert.throws(() => validateExtractionEvidence(extracted, source), /row 1/);
  }
});
test("ownership, conversation, readiness and whole-file limits fail before a paid call", async () => {
  const doc = await localFile();
  await assert.rejects(extractionSource(crypto.randomUUID(), "chat", doc.id), /unavailable/);
  await assert.rejects(extractionSource(owner, "wrong-chat", doc.id), /unavailable/);
  await updateDocument({ ...doc, status: "processing", chunkCount: 1 });
  await assert.rejects(extractionSource(owner, "chat", doc.id), /ready/);
  await updateDocument({ ...doc, status: "ready", chunkCount: 13 });
  await assert.rejects(extractionSource(owner, "chat", doc.id), /too large/);
  await updateDocument({ ...doc, status: "ready", chunkCount: 2 });
  await assert.rejects(extractionSource(owner, "chat", doc.id), /sections/);
});
test("invalid structured output, provider limits and cancellation do not trigger paid retries", async () => {
  const doc = await localFile();
  let before = providerCalls;
  await assert.rejects(extractDocument({ owner, conversationId: "chat", id: doc.id, kind: "invoice", signal: new AbortController().signal, fetch: provider({ invalid: true }) }), /valid structured/);
  assert.equal(providerCalls - before, 1);
  before = providerCalls;
  await assert.rejects(extractDocument({ owner, conversationId: "chat", id: doc.id, kind: "invoice", signal: new AbortController().signal, fetch: provider({}, 429) }), /rate-limited/);
  assert.equal(providerCalls - before, 1);
  before = providerCalls;
  await assert.rejects(extractDocument({ owner, conversationId: "chat", id: doc.id, kind: "invoice", signal: new AbortController().signal, fetch: provider(invoice, 200, "length") }), /complete/);
  assert.equal(providerCalls - before, 1);
  const controller = new AbortController(); controller.abort();
  before = providerCalls;
  await assert.rejects(extractDocument({ owner, conversationId: "chat", id: doc.id, kind: "invoice", signal: controller.signal, fetch: provider(invoice) }));
  assert.equal(providerCalls, before);
});
test("unconfigured extraction leaves document questions and stored data independent", async () => {
  delete process.env.NUMBASE_EXTRACTION_ENABLED;
  assert.throws(requireExtractions, /not enabled/);
  process.env.NUMBASE_EXTRACTION_ENABLED = "true";
  delete process.env.OPENROUTER_API_KEY;
  const doc = await localFile();
  await assert.rejects(extractDocument({ owner, conversationId: "chat", id: doc.id, kind: "invoice", signal: new AbortController().signal }), /OpenRouter connection/);
  process.env.OPENROUTER_API_KEY = "synthetic-test-value-not-a-credential";
});
test("database extraction reservation fails closed before contacting the provider", async () => {
  process.env.SUPABASE_URL = "https://synthetic-extraction.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-value-not-a-credential";
  let quotaCode = "P0001";
  const doc = { id: base.documentId, owner, conversationId: "chat", filename: "invoice.pdf", status: "ready", chunkCount: 1 };
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    assert.equal(url.hostname, "synthetic-extraction.supabase.co");
    if (url.pathname.endsWith("numbase_documents")) { assert.equal(url.searchParams.get("owner"), `eq.${owner}`); return Response.json([{ record: doc }]); }
    if (url.pathname.endsWith("numbase_document_chunks")) { assert.equal(url.searchParams.get("conversation_id"), "eq.chat"); return Response.json([{ chunk_index: 0, location: "page 1", content: quote }]); }
    assert.ok(url.pathname.endsWith("/rpc/numbase_reserve_extraction"));
    assert.equal(JSON.parse(init.body).session_owner, owner);
    return Response.json({ code: quotaCode, message: "private internal details" }, { status: 400 });
  };
  try {
    for (const [code, status] of [["P0001", 429], ["PGRST202", 503]]) {
      quotaCode = code;
      await assert.rejects(extractDocument({ owner, conversationId: "chat", id: doc.id, kind: "invoice", signal: new AbortController().signal, fetch: () => assert.fail("No paid call after failed reservation") }), (error) => error.status === status && !error.message.includes("private internal"));
    }
  } finally { delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; globalThis.fetch = realFetch; }
});
test("saved edited extraction survives snapshots and reaches switched chat/vision models", async () => {
  const extraction = { ...result, edited: true, data: structuredClone(invoice) };
  extraction.data.fields.total.value = "1400";
  const messages = [{ id: "user", role: "user", parts: [{ type: "text", text: "Review this invoice" }] }, { id: "extracted", role: "assistant", parts: [{ type: "data-extraction", data: extraction }] }];
  const snapshot = snapshotMessages(messages);
  extraction.data.fields.total.value = "9999";
  const stored = JSON.parse(JSON.stringify({ id: "chat", title: "Invoice", model: "anthropic/claude-haiku-4.5", updatedAt: 1, messages: snapshot }));
  assert.ok(conversationSchema.safeParse(stored).success);
  const history = toModelMessages(stored.messages);
  assert.match(history[1].content, /1400/);
  assert.match(history[1].content, /user edits/);
  assert.doesNotMatch(history[1].content, /9999/);
  assert.deepEqual(await multimodalHistory(stored.messages, owner, "chat"), history);
  assert.equal(requestSchema.safeParse({ model: "anthropic/claude-haiku-4.5", messages: [...snapshot, { id: "next", role: "user", parts: [{ type: "text", text: "Use my reviewed value" }] }] }).success, true);
  assert.equal(requestSchema.safeParse({ model: EXTRACTION_MODEL, messages: [{ ...snapshot[1], role: "user" }] }).success, false);
});
test("extraction data counts toward context limits instead of bypassing the chat budget", () => {
  const extracted = { id: "extracted", role: "assistant", parts: [{ type: "data-extraction", data: result }] };
  const messages = [extracted, { id: "big1", role: "user", parts: [{ type: "text", text: "x".repeat(32000) }] }, { id: "big2", role: "user", parts: [{ type: "text", text: "x".repeat(32000) }] }];
  assert.equal(requestSchema.safeParse({ model: EXTRACTION_MODEL, messages }).success, false);
});
test("model context keeps current reviewed values separate from original evidence and edit direction", () => {
  const edited = structuredClone(result); edited.edited = true; edited.data.fields.total.value = "1400";
  const text = extractionContext(edited);
  const data = JSON.parse(text.split("\n").at(-1));
  assert.equal(data.CURRENT_REVIEWED_VALUES.fields.total, "1400");
  assert.equal(data.ORIGINAL_SOURCE_EVIDENCE.fields.total.quote, quote);
  assert.match(data.ORIGINAL_SOURCE_EVIDENCE.fields.total.quote, /1250/);
  assert.doesNotMatch(data.ORIGINAL_SOURCE_EVIDENCE.fields.total.quote, /1400/);
  assert.match(text, /Do not reverse these labels/);
});
test("workspace reload preserves an extraction and an unrelated healthy conversation", async () => {
  const previousStorage = globalThis.localStorage;
  const chats = [
    { id: "extraction-chat", title: "Invoice", model: EXTRACTION_MODEL, updatedAt: 1, messages: [{ id: "result", role: "assistant", parts: [{ type: "data-extraction", data: result }] }] },
    { id: "unrelated-chat", title: "Keep this chat", model: EXTRACTION_MODEL, updatedAt: 2, messages: [{ id: "healthy", role: "user", parts: [{ type: "text", text: "This conversation must survive." }] }] },
  ];
  const raw = JSON.stringify({ version: 2, activeId: "extraction-chat", conversations: chats });
  const values = new Map([["numbase.conversations.v2", raw]]);
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  try {
    const { conversations } = await import(`../src/lib/conversations.ts?extraction-reload=${crypto.randomUUID()}`);
    conversations.hydrate();
    const loaded = conversations.getSnapshot();
    assert.equal(loaded.conversations.length, 2);
    assert.equal(loaded.conversations.find(chat => chat.id === "extraction-chat").messages[0].parts[0].data.data.fields.total.value, "1250");
    assert.equal(loaded.conversations.find(chat => chat.id === "unrelated-chat").messages[0].parts[0].text, "This conversation must survive.");
    assert.equal(values.get("numbase.conversations.v2"), raw);
    assert.equal(values.size, 1, "Valid extraction data must not trigger recovery or overwrite storage.");
  } finally { globalThis.localStorage = previousStorage; }
});
test("real Excel exports preserve text values and cannot turn cells into formulas or links", async () => {
  const malicious = '=HYPERLINK("https://untrusted.invalid","click")';
  const exported = { ...base, edited: true, kind: "table", data: { ...table, rows: [{ ...table.rows[0], cells: [malicious, "001250.00"] }] } };
  const bytes = await extractionWorkbook(exported);
  assert.equal(Buffer.from(bytes).subarray(0, 2).toString(), "PK");
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(bytes));
  const sheet = workbook.getWorksheet("Table");
  assert.equal(sheet.getCell("A2").value, malicious);
  assert.equal(sheet.getCell("A2").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("A2").formula, undefined);
  assert.equal(sheet.getCell("A2").hyperlink, undefined);
  assert.equal(sheet.getCell("B2").value, "001250.00");
  assert.match(workbook.getWorksheet("Read me").getCell("B3").value, /quotes do not validate user edits/);
  const invoiceBook = new ExcelJS.Workbook(); await invoiceBook.xlsx.load(Buffer.from(await extractionWorkbook(result)));
  assert.equal(invoiceBook.getWorksheet("Invoice").getCell("B10").value, "1250");
});
