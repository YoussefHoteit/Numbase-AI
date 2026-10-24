import { liveRequestsEnabled } from "./media-config.ts";
import { RequestError } from "./request.ts";

export function documentsAvailable() {
  return liveRequestsEnabled() && process.env.NUMBASE_DOCUMENTS_ENABLED === "true" &&
    (process.env.NODE_ENV !== "production" || !!(
      process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY &&
      (process.env.NUMBASE_SESSION_SECRET?.length ?? 0) >= 32 && process.env.OPENROUTER_API_KEY?.trim()
    ));
}
export function requireDocuments() {
  if (!documentsAvailable()) throw new RequestError("Document features are not configured yet. Text chat and available image features still work.", 503);
}
export function extractionsAvailable() {
  return documentsAvailable() && process.env.NUMBASE_EXTRACTION_ENABLED === "true";
}
export function requireExtractions() {
  if (!extractionsAvailable()) throw new RequestError("Structured extraction is not enabled in this workspace. File questions still work.", 503);
}
export function documentError(error: unknown) {
  return new Response(error instanceof RequestError ? error.message : "Document processing is temporarily unavailable. Please try again.", {
    status: error instanceof RequestError ? error.status : 500,
    headers: { "Cache-Control": "no-store" },
  });
}
