import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createFileTools, recoveredFile } from "../src/lib/server/file-tools.ts";
import { getDocument, readDocumentBytes } from "../src/lib/server/document-store.ts";

process.env.NODE_ENV = "test";
process.env.NUMBASE_DOCUMENTS_ENABLED = "true";
process.env.NUMBASE_FILE_GENERATION_ENABLED = "true";
process.env.SUPABASE_URL = "https://synthetic-files.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-not-a-credential";
process.env.OPENROUTER_API_KEY = "synthetic-not-a-credential";
const originalFetch = globalThis.fetch;
const records = new Map(); const objects = new Map(); const calls = [];
let limited = false; let embeddingsFail = false;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : input);
  assert.ok(["synthetic-files.supabase.co", "openrouter.ai"].includes(url.hostname), "Never contact a real service");
  calls.push({ path: url.pathname, method: init.method, owner: url.searchParams.get("owner") });
  const json = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  if (url.hostname === "openrouter.ai") {
    assert.equal(url.pathname, "/api/v1/embeddings");
    if (embeddingsFail) return Response.json({ error: { message: "Synthetic failure" } }, { status: 503 });
    return Response.json({ object: "list", model: json.model, data: json.input.map((_, index) => ({ index, object: "embedding", embedding: Array.from({ length: 1536 }, (_, n) => n === 0 ? 1 : 0) })), usage: { prompt_tokens: 1, total_tokens: 1 } });
  }
  if (url.pathname.endsWith("/rpc/numbase_reserve_document")) {
    if (limited) return Response.json({ message: "Document quota reached", code: "P0001" }, { status: 400 });
    if (records.has(json.document_record.id)) return Response.json({ message: "Duplicate ID", code: "23505" }, { status: 409 });
    records.set(json.document_record.id, json.document_record); return new Response(null, { status: 204 });
  }
  if (url.pathname.endsWith("/numbase_documents")) {
    const id = url.searchParams.get("id")?.slice(3); const owner = url.searchParams.get("owner")?.slice(3);
    const doc = records.get(id);
    if (init.method === "PATCH") {
      assert.equal(doc.owner, owner); records.set(id, json.record); return Response.json([{ id }]);
    }
    return Response.json(doc?.owner === owner ? [{ record: doc }] : []);
  }
  if (url.pathname.endsWith("/numbase_document_chunks")) {
    assert.equal(init.method, "POST");
    assert.ok(json.every((row) => row.owner && row.conversation_id === "files" && row.embedding.length === 1536));
    return new Response(null, { status: 204 });
  }
  if (url.pathname.includes("/storage/v1/object/numbase-documents/")) {
    if (init.method === "POST") {
      assert.equal(new Headers(init.headers).get("x-upsert"), "false");
      objects.set(url.pathname, Buffer.from(init.body instanceof Blob ? await init.body.arrayBuffer() : init.body));
      return Response.json({ Key: url.pathname });
    }
    return new Response(objects.get(url.pathname));
  }
  assert.fail(`Unexpected storage request ${url.pathname}`);
};
after(() => { globalThis.fetch = originalFetch; });
const owner = crypto.randomUUID();
const input = { parentId: null, draft: { format: "code", filename: "sample.ts", title: "", paragraphs: [], columns: [], rows: [], code: "export const total = 1250;\n" } };
const tool = (turnId) => createFileTools({ owner, conversationId: "files", turnId, allowedIds: [], signal: AbortSignal.timeout(5000) }).createFile;
const run = (turnId) => tool(turnId).execute(input, { toolCallId: turnId, messages: [] });

test("generated files reuse private storage reservations, no-upsert uploads and scoped indexing", async () => {
  const result = await run("first");
  const doc = await getDocument(owner, result.documentId, "files");
  assert.equal(doc.status, "ready");
  assert.equal((await readDocumentBytes(doc)).toString(), input.draft.code);
  assert.ok(calls.some((call) => call.path.endsWith("/rpc/numbase_reserve_document")));
  assert.ok(!calls.some((call) => call.path.includes("upload/sign")), "Server generation needs no browser upload token");
  await assert.rejects(getDocument(crypto.randomUUID(), doc.id, "files"), /unavailable/);
  await assert.rejects(getDocument(owner, doc.id, "other"), /unavailable/);
});

test("database quota rejection starts no embedding call or object upload", async () => {
  const before = calls.length; limited = true;
  try { await assert.rejects(run("limited"), /daily limit/); }
  finally { limited = false; }
  assert.ok(!calls.slice(before).some((call) => call.path.endsWith("/embeddings") || call.path.includes("/storage/")));
});

test("provider failure leaves a recoverable failed reservation and does not retry", async () => {
  const before = calls.filter((call) => call.path.endsWith("/embeddings")).length;
  embeddingsFail = true;
  try { await assert.rejects(run("failed"), /did not finish/); }
  finally { embeddingsFail = false; }
  assert.equal((await recoveredFile(owner, "files", "failed")).status, "failed");
  await assert.rejects(run("failed"), /already started/);
  assert.equal(calls.filter((call) => call.path.endsWith("/embeddings")).length, before + 1);
});
