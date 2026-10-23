import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { docxFixture, pdfFixture, zipFixture } from "./document-fixtures.mjs";
import { parseDocument } from "../src/lib/server/document-parser.ts";
import { documentKind, documentIdFromUrl, documentUrl, chunkSections, documentIds, DOCUMENT_TYPES, DOCUMENT_LIMITS } from "../src/lib/documents.ts";
import { newDocumentUpload, saveLocalUpload, getDocument, updateDocument, readDocumentBytes } from "../src/lib/server/document-store.ts";
import { parseAndSaveDocument, indexDocumentBatch } from "../src/lib/server/document-index.ts";
import { retrieveDocuments, addDocumentContext } from "../src/lib/server/document-retrieval.ts";
import { documentPartSchema } from "../src/lib/documents.ts";
import { requestSchema, conversationSchema } from "../src/lib/chat-schema.ts";
import { snapshotMessages, imageIds } from "../src/lib/chat-history.ts";
import { multimodalHistory } from "../src/lib/server/multimodal-history.ts";
import { documentsAvailable, requireDocuments } from "../src/lib/server/document-config.ts";

const testDirectory = path.resolve(".local-documents");
await mkdir(testDirectory, { recursive: true });
const root = await mkdtemp(path.join(testDirectory, "test-"));
process.env.NUMBASE_DOCUMENT_DIRECTORY = root;
process.env.NODE_ENV = "test";
delete process.env.OPENROUTER_API_KEY;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const network = globalThis.fetch;
globalThis.fetch = async () => assert.fail("Document unit tests may not access external services.");
after(async () => {
  globalThis.fetch = network;
  assert.ok(root.startsWith(testDirectory + path.sep));
  await rm(root, { recursive: true, force: true });
});
const model = "openai/gpt-4.1-mini";

test("file references reject remote URLs, image routes, traversal, and credential filenames", () => {
  assert.equal(documentKind("summary.PDF"), "pdf");
  assert.equal(documentKind("report.docx"), "docx");
  assert.equal(documentKind("component.tsx"), "text");
  assert.equal(documentKind(".env.production"), undefined);
  assert.equal(documentKind("application.exe"), undefined);
  assert.equal(documentIdFromUrl("https://example.com/private.pdf"), undefined);
  assert.equal(documentIdFromUrl("/api/documents/../../etc/passwd"), undefined);
  assert.equal(documentPartSchema.safeParse({ type: "file", mediaType: "application/pdf", filename: "a.pdf", url: "/api/assets/11111111-1111-4111-8111-111111111111" }).success, false);
});

test("PDF and DOCX extract real container contents with page/paragraph locations", async () => {
  const pdf = await parseDocument(pdfFixture(), "invoice.pdf");
  assert.match(pdf.sections[0].text, /INV-84729.*1250/);
  assert.equal(pdf.sections[0].location, "page 1");
  const docx = await parseDocument(docxFixture(), "invoice.docx");
  assert.match(docx.sections[0].text, /INV-84729.*1250/);
  assert.equal(docx.sections[0].location, "paragraph 1");
});

test("XLSX reads all worksheets and cached formulas without executing them", async () => {
  const book = new ExcelJS.Workbook();
  book.addWorksheet("Sales").addRows([["Product", "Total"], ["Barrel", 1250]]);
  book.getWorksheet("Sales").addConditionalFormatting({ ref: "B2", rules: [{ type: "cellIs", operator: "greaterThan", formulae: [100], style: { font: { bold: true } } }] });
  book.addWorksheet("Costs").getCell("A1").value = { formula: "100+25", result: 125 };
  const parsed = await parseDocument(Buffer.from(await book.xlsx.writeBuffer()), "report.xlsx");
  assert.match(parsed.sections.map((part) => part.text).join("\n"), /Barrel.*1250/);
  assert.ok(parsed.sections.some((part) => part.location.startsWith("Costs") && part.text.includes("125")));
  assert.ok(parsed.warnings.some((warning) => warning.includes("not recalculated")));
});

test("CSV handles quoted commas and code/Markdown retain line references", async () => {
  const csv = await parseDocument(Buffer.from('name,total\n"Hoteit, Youssef",1250\n'), "data.csv");
  assert.match(csv.sections[0].text, /Hoteit, Youssef/);
  for (const name of ["helper.ts", "notes.md", "notes.txt"]) {
    const parsed = await parseDocument(Buffer.from("const token = 'Quantum';\nexport default token;"), name);
    assert.equal(parsed.sections[0].location, "lines 1–2");
    assert.match(parsed.sections[0].text, /Quantum/);
  }
});

test("empty scans, damaged files, binary text and Office format mismatches fail clearly", async () => {
  await assert.rejects(parseDocument(pdfFixture(""), "scan.pdf"), /No readable text.*OCR/);
  await assert.rejects(parseDocument(Buffer.from("not a PDF"), "fake.pdf"), /not a valid PDF/);
  await assert.rejects(parseDocument(Buffer.from([0, 4, 255]), "fake.txt"), /binary data/);
  await assert.rejects(parseDocument(Buffer.from([255]), "bad.txt"), /UTF-8/);
  await assert.rejects(parseDocument(docxFixture(), "fake.xlsx"), /do not match/);
  await assert.rejects(parseDocument(zipFixture({ "word/document.xml": "x", "word/vbaProject.bin": "macro" }), "macro.docx"), /unsafe/);
  const forged = docxFixture();
  const directory = forged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  forged.writeUInt32LE(1, directory + 24);
  await assert.rejects(parseDocument(forged, "forged.docx"), /unsafe|damaged/);
  await assert.rejects(parseDocument(Buffer.alloc(DOCUMENT_LIMITS.bytes + 1), "large.txt"), /20 MB/);
});

test("chunking covers long sections, overlaps boundaries, and never exceeds the index budget", () => {
  const text = "start " + "content ".repeat(2000) + " end";
  const chunks = chunkSections([{ location: "page 1", text }]);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((part) => part.text.length <= 4000 && part.location === "page 1"));
  assert.equal(chunks[0].text.slice(-300), chunks[1].text.slice(0, 300));
  assert.match(chunks.at(-1).text, /end$/);
  assert.throws(() => chunkSections([{ location: "x", text: "x".repeat(4_000_000) }]), /too many sections/);
});

async function upload(owner, filename, bytes, conversationId = "files-chat") {
  const { doc } = await newDocumentUpload(owner, conversationId, filename, bytes.length);
  await saveLocalUpload(doc, bytes);
  await updateDocument({ ...doc, status: "queued" }, "pending");
  const count = await parseAndSaveDocument(owner, doc.id);
  for (let offset = 0; offset < count; offset += 16) await indexDocumentBatch(owner, doc.id, offset);
  return getDocument(owner, doc.id);
}

test("large-document indexing retrieves an answer beyond a normal model context budget", async () => {
  const owner = crypto.randomUUID();
  const text = Array.from({ length: 18000 }, (_, i) => `Section ${i + 1}: This is a synthetic document record with several ordinary words and no private data.`).join("\n") + "\nFinal approval code: HORIZON-84729.";
  assert.ok(text.split(/\s+/).length > 250_000, "The fixture is larger than the smallest chat model context window.");
  assert.ok(text.length < DOCUMENT_LIMITS.characters);
  const doc = await upload(owner, "large.md", Buffer.from(text));
  assert.equal(doc.status, "ready");
  assert.equal(doc.indexed, doc.chunkCount);
  assert.ok(doc.chunkCount > 100);
  const matches = await retrieveDocuments(owner, "files-chat", [doc.id], "Final approval code HORIZON");
  assert.ok(matches.some((part) => part.text.includes("HORIZON-84729")));
  assert.ok(JSON.stringify(matches).length < 14000, "Retrieval never sends the whole source file.");
  assert.deepEqual(await readDocumentBytes(doc), Buffer.from(text));
});

test("retrieval includes each compared file and enforces browser and conversation ownership", async () => {
  const owner = crypto.randomUUID();
  const a = await upload(owner, "first.txt", Buffer.from("Invoice total USD 1250. Supplier North."));
  const b = await upload(owner, "second.txt", Buffer.from("Invoice total USD 1400. Supplier South."));
  const found = await retrieveDocuments(owner, "files-chat", [a.id, b.id], "Compare invoice total and supplier");
  assert.deepEqual(new Set(found.map((part) => part.filename)), new Set(["first.txt", "second.txt"]));
  await assert.rejects(retrieveDocuments(crypto.randomUUID(), "files-chat", [a.id], "total"), /unavailable/);
  await assert.rejects(retrieveDocuments(owner, "other-chat", [a.id], "total"), /unavailable/);
  const history = [{ role: "user", content: "Compare them" }];
  const merged = addDocumentContext(history, found);
  assert.equal(merged.at(-1).content, "Compare them");
  assert.match(merged[0].content, /untrusted source data/);
  assert.match(merged[0].content, /first.txt/);
  assert.equal(history.length, 1);
});

test("unfinished uploads and a size mismatch cannot reach ready or query a provider", async () => {
  const owner = crypto.randomUUID();
  const { doc } = await newDocumentUpload(owner, "files-chat", "file.txt", 4);
  await assert.rejects(saveLocalUpload(doc, Buffer.from("longer")), /size does not match/);
  await assert.rejects(parseAndSaveDocument(owner, doc.id), /not queued/);
  await assert.rejects(retrieveDocuments(owner, "files-chat", [doc.id], "content"), /still processing/);
});

test("saved file references survive reload and model switches alongside an unrelated chat", async () => {
  const id = crypto.randomUUID();
  const message = { id: "file-message", role: "user", parts: [{ type: "text", text: "Explain this code" }, { type: "file", mediaType: DOCUMENT_TYPES.text, filename: "code.ts", url: documentUrl(id) }] };
  const unrelated = { id: "healthy", title: "Unrelated chat", model, updatedAt: 1, messages: [{ id: "u", role: "user", parts: [{ type: "text", text: "Preserve me" }] }] };
  const chat = { id: "files-chat", title: "Code review", model, updatedAt: 1, messages: snapshotMessages([message]) };
  assert.equal(conversationSchema.safeParse(chat).success, true);
  assert.deepEqual(imageIds(chat.messages), []);
  assert.deepEqual(documentIds(chat.messages), [id]);
  const key = "numbase.conversations.v2";
  const entries = new Map([[key, JSON.stringify({ version: 2, activeId: chat.id, conversations: [chat, unrelated] })]]);
  globalThis.localStorage = { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  const { conversations } = await import("../src/lib/conversations.ts?document-reload");
  conversations.hydrate();
  conversations.setModel(chat.id, "google/gemini-2.5-flash-lite");
  assert.equal(conversations.getSnapshot().conversations.length, 2);
  assert.deepEqual(conversations.getSnapshot().conversations[1], unrelated);
  const persisted = JSON.parse(entries.get(key));
  assert.equal(persisted.conversations[0].messages[0].parts[1].url, documentUrl(id));
  assert.equal(requestSchema.safeParse({ id: chat.id, model: "google/gemini-2.5-flash-lite", messages: persisted.conversations[0].messages }).success, true);
  assert.deepEqual(await multimodalHistory([message], crypto.randomUUID(), chat.id), [{ role: "user", content: "Explain this code" }]);
});

test("production document features fail closed when setup is incomplete", () => {
  process.env.NODE_ENV = "production";
  process.env.NUMBASE_DOCUMENTS_ENABLED = "true";
  process.env.NUMBASE_PUBLIC_ACCESS_ENABLED = "true";
  try {
    assert.equal(documentsAvailable(), false);
    assert.throws(requireDocuments, /Text chat.*still work/);
  } finally { process.env.NODE_ENV = "test"; }
});
