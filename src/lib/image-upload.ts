import type { FileUIPart } from "ai";
import { attachmentError } from "./media";

async function checked(response: Response) {
  if (!response.ok) throw new Error(await response.text() || "The upload did not finish. Please try again.");
  return response;
}
export async function ensureMediaSession(signal?: AbortSignal) {
  await checked(await fetch("/api/media/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal }));
}
export async function uploadImage(file: File, conversationId: string, signal?: AbortSignal): Promise<FileUIPart> {
  const error = attachmentError(file);
  if (error) throw new Error(error);
  const ticket = await (await checked(await fetch("/api/assets", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ conversationId, filename: file.name.slice(0,160), mediaType: file.type, size: file.size }),
  }))).json();
  // The signed URL grants upload access to this object only; provider keys stay server-side.
  await checked(await fetch(ticket.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type }, signal }));
  const asset = await (await checked(await fetch(`/api/assets/${ticket.assetId}/complete`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal,
  }))).json();
  return { type: "file", url: asset.url, filename: asset.filename, mediaType: asset.mediaType };
}
