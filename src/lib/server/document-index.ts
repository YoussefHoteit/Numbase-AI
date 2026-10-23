import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { embedMany } from "ai";
import { chunkSections, type DocumentRecord } from "../documents.ts";
import { parseDocument } from "./document-parser.ts";
import { documentChecksum, getChunks, getDocument, readDocumentBytes, saveChunks, updateDocument } from "./document-store.ts";
import { RequestError } from "./request.ts";

export const EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
export async function embedDocumentText(values: string[], signal?: AbortSignal) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    if (process.env.NODE_ENV === "production") throw new RequestError("OpenRouter is not configured for document search.", 503);
    return;
  }
  const router = createOpenRouter({ apiKey });
  const { embeddings } = await embedMany({
    model: router.textEmbeddingModel(EMBEDDING_MODEL), values,
    maxRetries: 0,
    abortSignal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000),
  });
  if (embeddings.length !== values.length || embeddings.some((row) => row.length !== EMBEDDING_DIMENSIONS || row.some((value) => !Number.isFinite(value)))) throw new RequestError("The document search provider returned invalid embeddings.", 502);
  return embeddings;
}

export async function parseAndSaveDocument(owner: string, id: string) {
  const doc = await getDocument(owner, id);
  if (doc.status === "ready" || (doc.chunkCount && doc.status === "processing")) return doc.chunkCount;
  if (doc.status !== "queued" && doc.status !== "processing") throw new RequestError("This file is not queued for processing.", 409);
  const bytes = await readDocumentBytes(doc);
  if (bytes.length !== doc.size) throw new RequestError("The uploaded file size does not match. Upload it again.", 400);
  const parsed = await parseDocument(bytes, doc.filename);
  let chunks;
  try { chunks = chunkSections(parsed.sections); }
  catch { throw new RequestError("This file needs too many search sections. Split it into smaller documents.", 413); }
  // Save small batches; workflow events contain only counts and IDs, never document text.
  for (let offset = 0; offset < chunks.length; offset += 16) await saveChunks(doc, chunks.slice(offset, offset + 16));
  const next: DocumentRecord = { ...doc, status: "processing", chunkCount: chunks.length, checksum: documentChecksum(bytes), warnings: parsed.warnings };
  if (!process.env.OPENROUTER_API_KEY?.trim()) next.warnings = [...parsed.warnings, "Development search uses keyword matching without an OpenRouter key."];
  await updateDocument(next);
  return chunks.length;
}

export async function indexDocumentBatch(owner: string, id: string, offset: number) {
  const doc = await getDocument(owner, id);
  if (doc.status === "ready" || doc.indexed > offset) return;
  if (doc.status !== "processing") throw new RequestError("Document processing was interrupted.", 409);
  const chunks = await getChunks(doc, offset, 16);
  if (!chunks.length) throw new RequestError("Document search sections are missing.", 500);
  const embeddings = await embedDocumentText(chunks.map((chunk) => chunk.text));
  if (embeddings) await saveChunks(doc, chunks.map((chunk, index) => ({ ...chunk, embedding: embeddings[index] })));
  const indexed = offset + chunks.length;
  await updateDocument({ ...doc, indexed, status: indexed === doc.chunkCount ? "ready" : "processing" });
}
export async function failDocument(owner: string, id: string, message: string) {
  const doc = await getDocument(owner, id);
  if (doc.status !== "ready") await updateDocument({ ...doc, status: "failed", error: message.slice(0, 500) });
}
