import { parseAndSaveDocument, indexDocumentBatch, failDocument } from "../lib/server/document-index";
import { RequestError } from "../lib/server/request";

export async function indexDocument(owner: string, id: string) {
  "use workflow";
  try {
    const count = await parseStep(owner, id);
    for (let offset = 0; offset < count; offset += 16) await embedStep(owner, id, offset);
  } catch {
    // The safe error is persisted by the failing step; no raw provider errors reach the browser.
    return { status: "failed" };
  }
  return { status: "ready" };
}
async function parseStep(owner: string, id: string) {
  "use step";
  try { return await parseAndSaveDocument(owner, id); }
  catch (error) {
    await failDocument(owner, id, error instanceof RequestError ? error.message : "This file could not be processed. Try a fresh copy.");
    throw error;
  }
}
async function embedStep(owner: string, id: string, offset: number) {
  "use step";
  try { await indexDocumentBatch(owner, id, offset); }
  catch {
    await failDocument(owner, id, "Document search indexing failed. Check the provider allowance before uploading again.");
    throw new Error("Document indexing failed.");
  }
}
// A failed provider call may have been billed. Never hide paid retries in workflow recovery.
parseStep.maxRetries = 0;
embedStep.maxRetries = 0;
