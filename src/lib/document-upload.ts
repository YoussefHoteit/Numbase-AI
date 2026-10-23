import type { FileUIPart } from "ai";
import { DOCUMENT_TYPES, documentAttachmentError, documentKind } from "./documents";

async function checked(response: Response) {
  if (!response.ok) throw new Error(await response.text() || "The document upload failed.");
  return response;
}
export async function uploadDocument(file: File, conversationId: string, signal: AbortSignal): Promise<FileUIPart> {
  const error = documentAttachmentError(file);
  if (error) throw new Error(error);
  const ticket = await (await checked(await fetch("/api/documents", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ conversationId, filename: file.name.slice(0, 160), size: file.size }),
  }))).json();
  const mediaType = DOCUMENT_TYPES[documentKind(file.name)!];
  await checked(await fetch(ticket.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": mediaType }, signal }));
  await checked(await fetch(`${ticket.url}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal }));
  // The queued file is immediately saved in chat history; it survives leaving or reloading.
  return { type: "file", url: ticket.url, filename: file.name.slice(0, 160), mediaType };
}
