import { storageMode } from "./media-store.ts";
import { RequestError } from "./request.ts";

export function liveRequestsEnabled() {
  // Public production access is an explicit deployment choice, separate from authentication.
  return process.env.NODE_ENV !== "production" ||
    process.env.NUMBASE_PUBLIC_ACCESS_ENABLED === "true" ||
    process.env.NUMBASE_DEPLOYMENT_PROTECTED === "true";
}

export function mediaAvailable() {
  return storageMode() !== "unavailable" &&
    (process.env.NODE_ENV !== "production" ||
      (process.env.NUMBASE_SESSION_SECRET?.length ?? 0) >= 32);
}

export function requireMedia() {
  if (!mediaAvailable())
    throw new RequestError("Images are unavailable because private image storage is not configured. Text chat is still available.", 503);
}

export function chatConfig() {
  const demo = !process.env.OPENROUTER_API_KEY?.trim();
  const allowed = liveRequestsEnabled();
  const enabled = demo || allowed;
  const images = allowed && mediaAvailable();
  return {
    demo,
    enabled,
    images,
    generation: images && !demo && process.env.NUMBASE_IMAGE_GENERATION_ENABLED === "true",
    storage: storageMode(),
  };
}
