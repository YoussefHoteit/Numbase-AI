import { RequestError } from "./request.ts";
import { liveRequestsEnabled, requireMedia } from "./media-config.ts";
export function mediaError(error: unknown) {
  return new Response(error instanceof RequestError ? error.message : "Image storage is temporarily unavailable. Please try again.", {
    status: error instanceof RequestError ? error.status : 500,
    headers: { "Cache-Control": "no-store" },
  });
}
export function assertMediaEnabled() {
  if (!liveRequestsEnabled())
    throw new RequestError("Images are not enabled on this deployment yet.", 503);
  requireMedia();
}
