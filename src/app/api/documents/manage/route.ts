import { requireLifecycle, documentError } from "@/lib/server/document-config";
import { mediaSession } from "@/lib/server/media-session";
import { listDocuments, setDocumentRemoved, publicDocument } from "@/lib/server/document-store";
import { readChatBody, RequestError } from "@/lib/server/request";
import { z } from "zod";

const changeSchema = z.strictObject({ documentId: z.uuid(), conversationId: z.string().min(1).max(128), removed: z.boolean() });
export async function GET(request: Request) {
  try {
    requireLifecycle();
    const { owner } = mediaSession(request);
    const files = await listDocuments(owner);
    return Response.json({ files: files.map((doc) => ({ ...publicDocument(doc), conversationId: doc.conversationId })), active: files.filter((doc) => !doc.removedAt).length, capacity: 5 }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return documentError(error); }
}
export async function POST(request: Request) {
  try {
    requireLifecycle();
    const body = changeSchema.safeParse(await readChatBody(request));
    if (!body.success) throw new RequestError("Choose a file to remove or restore.", 400);
    const { owner } = mediaSession(request);
    const doc = await setDocumentRemoved(owner, body.data.documentId, body.data.conversationId, body.data.removed);
    return Response.json(publicDocument(doc), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return documentError(error); }
}
