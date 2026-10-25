import { summaryStep, failSummary } from "../lib/server/document-summary";

export async function summarizeDocument(owner: string, id: string, jobId: string) {
  "use workflow";
  // Each step checkpoints private progress. Workflow events contain only IDs.
  for (let step = 0; step < 59; step++) {
    if (!await summarizeStep(owner, id, jobId)) return;
  }
}
async function summarizeStep(owner: string, id: string, jobId: string) {
  "use step";
  try { return await summaryStep(owner, id, jobId); }
  catch (error) { await failSummary(owner, id, jobId, error); return false; }
}
summarizeStep.maxRetries = 0;
