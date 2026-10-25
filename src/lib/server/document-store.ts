import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { DOCUMENT_LIMITS, DOCUMENT_TYPES, documentKind, type DocumentRecord, type DocumentChunk, type DocumentStatus } from "../documents.ts";
import { RequestError } from "./request.ts";

const BUCKET = "numbase-documents";
const localLocks = new Map<string, Promise<void>>();
export async function localDocumentLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = localLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  localLocks.set(key, current);
  await previous;
  try { return await action(); }
  finally { release(); if (localLocks.get(key) === current) localLocks.delete(key); }
}
export function documentClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    if (process.env.NODE_ENV === "production") throw new RequestError("Private document storage is not configured.", 503);
    return;
  }
  if (new URL(url).protocol !== "https:") throw new RequestError("Invalid document storage configuration.", 503);
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => globalThis.fetch(input, {
      ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(45_000)]),
    }) },
  });
}
function validId(id: string) {
  if (!z.uuid().safeParse(id).success) throw new RequestError("Invalid document ID.", 400);
  return id;
}
function storageKey(doc: DocumentRecord) { return `${validId(doc.owner)}/${validId(doc.id)}/original`; }
async function localPath(owner: string, id: string, suffix: string) {
  if (process.env.NODE_ENV === "production") throw new RequestError("Private document storage is not configured.", 503);
  const root = process.env.NUMBASE_DOCUMENT_DIRECTORY ?? path.join(process.cwd(), ".local-documents");
  const directory = path.join(/* turbopackIgnore: true */ root, validId(owner));
  await mkdir(directory, { recursive: true });
  return path.join(/* turbopackIgnore: true */ directory, `${validId(id)}.${suffix}`);
}
async function localJSON<T>(owner: string, id: string, suffix: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(await localPath(owner, id, suffix), "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
}
// This development-only backend writes whole snapshots atomically. Production uses row locks.
async function saveLocal(owner: string, id: string, suffix: string, value: unknown) {
  const filename = await localPath(owner, id, suffix);
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value));
  // Windows may briefly lock a snapshot while a status poll reads it. Retry only
  // the atomic local replacement, never an upload, embedding or provider request.
  for (let attempt = 0; ; attempt++) {
    try { await rename(temporary, filename); break; }
    catch (error) {
      if (attempt === 4 || !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      await pause(25 * (attempt + 1));
    }
  }
}
export async function getDocument(owner: string, id: string, conversationId?: string): Promise<DocumentRecord> {
  validId(owner); validId(id);
  const db = documentClient();
  let doc: DocumentRecord | undefined;
  if (db) {
    const { data, error } = await db.from("numbase_documents").select("record").eq("id", id).eq("owner", owner).maybeSingle();
    if (error) throw new RequestError("Document storage is unavailable. Check the document migration and storage configuration.", 503);
    doc = data?.record as DocumentRecord | undefined;
  } else doc = await localJSON<DocumentRecord>(owner, id, "json");
  if (!doc || doc.owner !== owner || (conversationId && doc.conversationId !== conversationId)) throw new RequestError("This file is unavailable in this conversation or browser session.", 404);
  return doc;
}
export async function updateDocument(doc: DocumentRecord, expected?: DocumentStatus): Promise<boolean> {
  const db = documentClient();
  if (db) {
    let query = db.from("numbase_documents").update({ record: doc, status: doc.status }).eq("id", doc.id).eq("owner", doc.owner).is("record->removedAt", null);
    if (expected) query = query.eq("status", expected);
    const { data, error } = await query.select("id");
    if (error) throw new RequestError("Could not save document progress.", 503);
    return !!data?.length;
  }
  return localDocumentLock(doc.id, async () => {
    const current = await getDocument(doc.owner, doc.id);
    if (current.removedAt || (expected && current.status !== expected)) return false;
    await saveLocal(doc.owner, doc.id, "json", doc);
    return true;
  });
}
export async function reserveDocument(owner: string, conversationId: string, filename: string, size: number, id: string = crypto.randomUUID()) {
  validId(owner);
  const kind = documentKind(filename);
  if (!kind || size < 1 || size > DOCUMENT_LIMITS.bytes) throw new RequestError("Choose a supported document up to 20 MB.", 400);
  const doc: DocumentRecord = {
    id: validId(id), owner, conversationId, filename: filename.replace(/[\x00-\x1f/\\]/g, "_").slice(0, 160),
    kind, size, status: "pending", createdAt: Date.now(), indexed: 0, chunkCount: 0,
  };
  const db = documentClient();
  if (db) {
    const { error } = await db.rpc("numbase_reserve_document", { document_record: doc });
    if (error) throw new RequestError("Document uploads have reached a storage or daily limit. Please try later.", 429);
  } else {
    // A deterministic generated-file ID may be claimed by only one concurrent request.
    await writeFile(await localPath(owner, doc.id, "json"), JSON.stringify(doc), { flag: "wx" });
  }
  return doc;
}
export async function newDocumentUpload(owner: string, conversationId: string, filename: string, size: number) {
  const doc = await reserveDocument(owner, conversationId, filename, size);
  const db = documentClient();
  if (db) {
    const { data, error: uploadError } = await db.storage.from(BUCKET).createSignedUploadUrl(storageKey(doc), { upsert: false });
    if (uploadError || !data) throw new RequestError("Could not start the private document upload.", 503);
    return { doc, uploadUrl: data.signedUrl };
  }
  return { doc, uploadUrl: `/api/documents/${doc.id}/upload` };
}
export async function writeGeneratedBytes(doc: DocumentRecord, bytes: Uint8Array) {
  if (doc.status !== "pending" || bytes.length !== doc.size) throw new RequestError("Invalid generated file reservation.", 400);
  const db = documentClient();
  if (!db) return saveLocalUpload(doc, bytes);
  const { error } = await db.storage.from(BUCKET).upload(storageKey(doc), bytes, { contentType: DOCUMENT_TYPES[doc.kind], upsert: false });
  if (error) throw new RequestError("Could not save the generated file. It will not be retried automatically.", 503);
}
export async function readDocumentBytes(doc: DocumentRecord): Promise<Buffer> {
  assertDocumentActive(doc);
  const db = documentClient();
  if (!db) return readFile(await localPath(doc.owner, doc.id, "bin"));
  const { data, error } = await db.storage.from(BUCKET).download(storageKey(doc));
  if (error || !data) throw new RequestError("The original file could not be loaded.", 503);
  if (data.size > DOCUMENT_LIMITS.bytes) throw new RequestError("This document is too large.", 413);
  return Buffer.from(await data.arrayBuffer());
}
export async function saveLocalUpload(doc: DocumentRecord, bytes: Uint8Array) {
  if (process.env.NODE_ENV === "production" || documentClient()) throw new RequestError("Use the private signed upload URL.", 400);
  if (doc.status !== "pending" || bytes.length !== doc.size) throw new RequestError("This upload is already complete or its size does not match.", 400);
  await writeFile(await localPath(doc.owner, doc.id, "bin"), bytes, { flag: "wx" });
}
export async function documentDownload(doc: DocumentRecord) {
  assertDocumentActive(doc);
  const db = documentClient();
  if (!db) return;
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(storageKey(doc), 60, { download: doc.filename });
  if (error || !data) throw new RequestError("Could not create the private download.", 503);
  return data.signedUrl;
}
export function publicDocument(doc: DocumentRecord) {
  return { id: doc.id, url: `/api/documents/${doc.id}`, filename: doc.filename, mediaType: DOCUMENT_TYPES[doc.kind], size: doc.size, status: doc.removedAt ? "removed" : doc.status, removedAt: doc.removedAt, indexed: doc.indexed, chunkCount: doc.chunkCount, error: doc.error, warnings: doc.warnings ?? [] };
}
export type IndexedChunk = DocumentChunk & { embedding?: number[] };
export async function saveChunks(doc: DocumentRecord, chunks: IndexedChunk[]) {
  const db = documentClient();
  if (db) {
    const { error } = await db.from("numbase_document_chunks").upsert(chunks.map((chunk) => ({
      document_id: doc.id, owner: doc.owner, conversation_id: doc.conversationId,
      chunk_index: chunk.index, location: chunk.location, content: chunk.text,
      ...(chunk.embedding ? { embedding: chunk.embedding } : {}),
    })), { onConflict: "document_id,chunk_index" });
    if (error) throw new RequestError("Could not save document sections.", 503);
  } else {
    const current = await localJSON<IndexedChunk[]>(doc.owner, doc.id, "chunks.json") ?? [];
    const merged = new Map(current.map((chunk) => [chunk.index, chunk]));
    chunks.forEach((chunk) => merged.set(chunk.index, { ...merged.get(chunk.index), ...chunk }));
    await saveLocal(doc.owner, doc.id, "chunks.json", [...merged.values()].sort((a, b) => a.index - b.index));
  }
}
export async function getChunks(doc: DocumentRecord, offset = 0, count = 16): Promise<IndexedChunk[]> {
  assertDocumentActive(doc);
  const db = documentClient();
  if (!db) return (await localJSON<IndexedChunk[]>(doc.owner, doc.id, "chunks.json") ?? []).slice(offset, offset + count);
  const { data, error } = await db.from("numbase_document_chunks").select("chunk_index,location,content")
    .eq("owner", doc.owner).eq("document_id", doc.id).eq("conversation_id", doc.conversationId).order("chunk_index").range(offset, offset + count - 1);
  if (error) throw new RequestError("Could not load document sections.", 503);
  return (data ?? []).map((row) => ({ index: row.chunk_index as number, location: row.location as string, text: row.content as string }));
}
export const documentChecksum = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function assertDocumentActive(doc: DocumentRecord) {
  if (doc.removedAt || doc.purgedAt) throw new RequestError("This file was removed from the workspace. Restore it in Files to use its contents again.", 410);
}
export async function listDocuments(owner: string): Promise<DocumentRecord[]> {
  validId(owner);
  const db = documentClient();
  if (db) {
    const { data, error } = await db.from("numbase_documents").select("record").eq("owner", owner).order("created_at", { ascending: false }).limit(50);
    if (error) throw new RequestError("Your files could not be loaded.", 503);
    return (data ?? []).map((row) => row.record as DocumentRecord);
  }
  const directory = path.dirname(await localPath(owner, crypto.randomUUID(), "json"));
  const names = (await readdir(directory)).filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name));
  return (await Promise.all(names.map((name) => getDocument(owner, name.slice(0, -5))))).sort((a, b) => b.createdAt - a.createdAt);
}
export async function setDocumentRemoved(owner: string, id: string, conversationId: string, removed: boolean) {
  // Use the same scoped 404 as uploads/downloads before a quota-changing RPC.
  await getDocument(owner, id, conversationId);
  const db = documentClient();
  if (db) {
    const { data, error } = await db.rpc("numbase_set_document_removed", { session_owner: validId(owner), file_id: validId(id), chat_id: conversationId, remove_file: removed });
    if (error) throw new RequestError(error.code === "P0001" ? "This file is processing, or the active-file limit prevents restoring it. Wait for processing to finish or remove another file." : "File management is not configured yet.", error.code === "P0001" ? 409 : 503);
    return data as DocumentRecord;
  }
  return localDocumentLock(`remove-${owner}`, async () => {
    const doc = await getDocument(owner, id, conversationId);
    if (removed === !!doc.removedAt) return doc;
    if (removed && ["queued", "processing"].includes(doc.status) && Date.now() - doc.createdAt < 10 * 60_000) throw new RequestError("Wait for processing to finish before removing this file.", 409);
    if (!removed && (await listDocuments(owner)).filter((file) => !file.removedAt).length >= 5) throw new RequestError("Remove another file before restoring this one.", 409);
    const next = { ...doc };
    if (removed) {
      next.removedAt = Date.now();
      if (next.summary && ["queued", "processing"].includes(next.summary.status)) next.summary = { ...next.summary, status: "cancelled", active: false, revision: next.summary.revision + 1 };
    } else {
      delete next.removedAt;
      if (["pending", "queued", "processing"].includes(next.status)) { next.status = "failed"; next.error = "Processing was interrupted. Upload a fresh copy to index it."; }
    }
    await saveLocal(owner, id, "json", next);
    return next;
  });
}
