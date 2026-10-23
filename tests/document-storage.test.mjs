import test, { after } from "node:test";
import assert from "node:assert/strict";
import { newDocumentUpload, getDocument, updateDocument, saveChunks, documentDownload } from "../src/lib/server/document-store.ts";
import { retrieveDocuments, addDocumentContext, waitForReadyDocuments } from "../src/lib/server/document-retrieval.ts";
import { embedDocumentText } from "../src/lib/server/document-index.ts";
import { streamOpenRouterResponse } from "../src/lib/server/openrouter-chat.ts";
import { MODELS } from "../src/lib/models.ts";
import { snapshotMessages } from "../src/lib/chat-history.ts";
import { documentUrl } from "../src/lib/documents.ts";

// Exercise the actual SDK and storage client against strict in-process mocks.
const realFetch = globalThis.fetch;
const rows = new Map();
const calls = [];
const vector = Array.from({ length: 1536 }, (_, index) => index === 0 ? 1 : 0);
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "https://synthetic-documents.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-value-not-a-credential";
process.env.OPENROUTER_API_KEY = "synthetic-test-value-not-a-credential";
delete process.env.NUMBASE_IMAGE_GENERATION_ENABLED;
after(() => { globalThis.fetch = realFetch; });
let invalidEmbedding = false;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : input);
  assert.ok(init.signal instanceof AbortSignal);
  const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  calls.push({ hostname: url.hostname, path: url.pathname, method: init.method ?? "GET", query: url.searchParams, body });
  if (url.hostname === "openrouter.ai") {
    assert.equal(url.pathname, "/api/v1/embeddings");
    assert.equal(body.model, "openai/text-embedding-3-small");
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    return Response.json({ object: "list", model: body.model, data: inputs.map((_, index) => ({ object: "embedding", index, embedding: invalidEmbedding ? [1] : vector })), usage: { prompt_tokens: 4, total_tokens: 4 } });
  }
  assert.equal(url.hostname, "synthetic-documents.supabase.co", "Never contact a real storage project.");
  if (url.pathname.endsWith("/rpc/numbase_reserve_document")) {
    rows.set(body.document_record.id, body.document_record);
    return new Response(null, { status: 204 });
  }
  if (url.pathname.includes("/object/upload/sign/")) return Response.json({ url: "/object/upload/sign/numbase-documents/synthetic?token=synthetic-scoped-upload" });
  if (url.pathname.includes("/object/sign/")) return Response.json({ signedURL: "/object/sign/numbase-documents/synthetic?token=synthetic-short-lived-download" });
  if (url.pathname.endsWith("/numbase_documents")) {
    const id = url.searchParams.get("id")?.slice(3);
    const owner = url.searchParams.get("owner")?.slice(3);
    const current = rows.get(id);
    if (init.method === "PATCH") {
      const expected = url.searchParams.get("status")?.slice(3);
      if (!current || current.owner !== owner || (expected && current.status !== expected)) return Response.json([]);
      rows.set(id, body.record);
      return Response.json([{ id }]);
    }
    return Response.json(current?.owner === owner ? [{ record: current }] : []);
  }
  if (url.pathname.endsWith("/numbase_document_chunks") && init.method === "POST") {
    assert.ok(body.every((row) => row.owner && row.conversation_id && row.document_id));
    return new Response(null, { status: 204 });
  }
  if (url.pathname.endsWith("/rpc/numbase_reserve_document_query")) return new Response(null, { status: 204 });
  if (url.pathname.endsWith("/rpc/numbase_match_document")) {
    const doc = rows.get(body.file_id);
    assert.equal(body.session_owner, doc.owner);
    assert.equal(body.chat_id, doc.conversationId);
    assert.equal(body.query_embedding.length, 1536);
    return Response.json([{ chunk_index: 0, location: "page 2", content: `The approved amount for ${doc.filename} is USD 1250.`, score: 0.9 }]);
  }
  assert.fail(`Unmocked request: ${url.pathname}`);
};

test("private document uploads use scoped URLs and ownership-filtered metadata", async () => {
  const owner = crypto.randomUUID();
  const { doc, uploadUrl } = await newDocumentUpload(owner, "chat", "invoice.pdf", 1200);
  assert.match(uploadUrl, /upload\/sign\/numbase-documents/);
  assert.equal((await getDocument(owner, doc.id, "chat")).filename, "invoice.pdf");
  await assert.rejects(getDocument(crypto.randomUUID(), doc.id), /unavailable/);
  await assert.rejects(getDocument(owner, doc.id, "different"), /unavailable/);
  assert.match(await documentDownload(doc), /short-lived-download/);
  assert.ok(!JSON.stringify(rows.get(doc.id)).includes("token="));
});

test("racing completion requests can reserve only one indexing workflow", async () => {
  const owner = crypto.randomUUID();
  const { doc } = await newDocumentUpload(owner, "chat", "code.ts", 40);
  const queued = { ...doc, status: "queued" };
  const results = await Promise.all([updateDocument(queued, "pending"), updateDocument(queued, "pending")]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.ok(calls.some((call) => call.method === "PATCH" && call.query.get("owner") === `eq.${owner}` && call.query.get("status") === "eq.pending"));
  await saveChunks(queued, [{ index: 0, location: "lines 1–2", text: "export const amount = 1250;", embedding: vector }]);
});

test("a first question can wait for indexing without duplicate uploads or ignoring cancellation", async () => {
  const owner = crypto.randomUUID();
  const { doc } = await newDocumentUpload(owner, "first-question", "code.ts", 40);
  await updateDocument({ ...doc, status: "processing" });
  const ready = setTimeout(() => { rows.set(doc.id, { ...doc, status: "ready", chunkCount: 1, indexed: 1 }); }, 10);
  try { await waitForReadyDocuments(owner, "first-question", [doc.id], AbortSignal.timeout(2000), 1000); }
  finally { clearTimeout(ready); }
  assert.equal((await getDocument(owner, doc.id)).status, "ready");
  await updateDocument({ ...doc, status: "processing" });
  await assert.rejects(waitForReadyDocuments(owner, "first-question", [doc.id], AbortSignal.timeout(10), 1000), /abort|timeout/i);
  await assert.rejects(waitForReadyDocuments(owner, "wrong-chat", [doc.id], undefined, 0), /unavailable/);
});

test("query embeddings and pgvector search use the same key with owner/chat/file filters", async () => {
  const owner = crypto.randomUUID();
  const { doc } = await newDocumentUpload(owner, "shared-chat", "invoice.pdf", 1200);
  await updateDocument({ ...doc, status: "ready", indexed: 1, chunkCount: 1 });
  const matches = await retrieveDocuments(owner, "shared-chat", [doc.id], "What is the approved amount?");
  assert.equal(matches[0].location, "page 2");
  assert.match(matches[0].text, /USD 1250/);
  assert.ok(calls.some((call) => call.path.endsWith("/rpc/numbase_reserve_document_query") && call.body.session_owner === owner));
  invalidEmbedding = true;
  try { await assert.rejects(embedDocumentText(["input"]), /invalid embeddings/); }
  finally { invalidEmbedding = false; }
});

test("all four model SDK requests retain retrieved file evidence across a model switch", async () => {
  const owner = crypto.randomUUID();
  const { doc } = await newDocumentUpload(owner, "model-switch", "invoice.pdf", 1200);
  await updateDocument({ ...doc, status: "ready", indexed: 1, chunkCount: 1 });
  const messages = [{ id: "upload", role: "user", parts: [
    { type: "text", text: "What is the approved amount?" },
    { type: "file", mediaType: "application/pdf", filename: doc.filename, url: documentUrl(doc.id) },
  ] }];
  const captures = [];
  for (const model of MODELS) {
    const snapshot = snapshotMessages(messages);
    const matches = await retrieveDocuments(owner, "model-switch", [doc.id], "approved amount");
    const modelMessages = addDocumentContext(snapshot.map((message) => ({ role: message.role, content: message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n") })), matches);
    const response = streamOpenRouterResponse({ model: model.id, messages: snapshot, modelMessages, apiKey: "synthetic-test-value", signal: AbortSignal.timeout(5000),
      fetch: async (_input, init) => {
        captures.push(JSON.parse(init.body));
        const chunk = { id: "synthetic", object: "chat.completion.chunk", created: 1, model: model.id };
        return new Response([
          { ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: "USD 1250 [invoice.pdf, page 2]." }, finish_reason: null }] },
          { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        ].map((part) => `data: ${JSON.stringify(part)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
      },
    });
    assert.match(await response.text(), /USD 1250/);
    messages.push({ id: `reply-${model.id}`, role: "assistant", parts: [{ type: "text", text: "USD 1250 [invoice.pdf, page 2]." }] });
    messages.push({ id: `followup-${model.id}`, role: "user", parts: [{ type: "text", text: "Confirm the amount in the same document." }] });
  }
  assert.equal(captures.length, 4);
  captures.forEach((payload) => {
    assert.ok(JSON.stringify(payload.messages).includes("The approved amount for invoice.pdf is USD 1250"));
    assert.ok(!JSON.stringify(payload.messages).includes(documentUrl(doc.id)), "Private download references are never sent as public model URLs.");
  });
  assert.ok(captures.at(-1).messages.length > captures[0].messages.length);
});
