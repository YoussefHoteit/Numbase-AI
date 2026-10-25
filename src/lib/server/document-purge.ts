import { unlink } from "node:fs/promises";
import { type DocumentRecord } from "../documents.ts";
import { documentClient, getDocument, localDocumentLock, saveDocumentTombstone, documentObjectKey, documentLocalFile } from "./document-store.ts";
import { RequestError } from "./request.ts";

// Supabase signed upload URLs last two hours. Wait past their expiry before
// removing uploaded bytes so an old upload ticket cannot recreate an orphan.
export function purgeAvailableAt(doc: DocumentRecord) {
  return doc.generated ? doc.createdAt : doc.createdAt + 125 * 60_000;
}
export async function purgeDocument(owner: string, id: string, conversationId: string, confirmation: string) {
  const doc = await getDocument(owner, id, conversationId);
  if (confirmation !== doc.filename) throw new RequestError("Type the exact filename to confirm permanent deletion.", 400);
  if (doc.purgedAt) return doc;
  if (!doc.removedAt) throw new RequestError("Remove this file before deleting it permanently.", 409);
  if (Date.now() < purgeAvailableAt(doc)) throw new RequestError("This upload ticket has not expired yet. Permanent deletion is available after " + new Date(purgeAvailableAt(doc)).toISOString() + ".", 409);
  const db = documentClient();
  if (db) {
    const { error: claimError } = await db.rpc("numbase_begin_document_purge", { session_owner: owner, file_id: id, chat_id: conversationId });
    if (claimError) throw new RequestError("This file cannot be deleted yet. Refresh its status and try again.", 409);
    // Storage objects must be removed through the Storage API, never SQL.
    const { error: storageError } = await db.storage.from("numbase-documents").remove([documentObjectKey(doc)]);
    if (storageError) throw new RequestError("Deletion did not finish. The file remains removed; retry permanent deletion. Storage capacity has not been released.", 503);
    const { data, error } = await db.rpc("numbase_finish_document_purge", { session_owner: owner, file_id: id, chat_id: conversationId });
    if (error || !data) throw new RequestError("The bytes were removed but cleanup did not finish. Retry permanent deletion to finish safely.", 503);
    return data as DocumentRecord;
  }
  return localDocumentLock("remove-" + owner, async () => {
    const current = await getDocument(owner, id, conversationId);
    if (current.purgedAt) return current;
    const pending = { ...current, purgePendingAt: Date.now() };
    await saveDocumentTombstone(pending);
    for (const suffix of ["bin", "chunks.json"]) {
      try { await unlink(await documentLocalFile(owner, id, suffix)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const next: DocumentRecord = { id: current.id, owner, conversationId, filename: current.filename, kind: current.kind,
      createdAt: current.createdAt, removedAt: current.removedAt, purgedAt: Date.now(), status: "failed", size: 0, indexed: 0, chunkCount: 0 };
    await saveDocumentTombstone(next);
    return next;
  });
}
