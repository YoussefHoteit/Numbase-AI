import { documentTicketSchema, documentUrl } from "@/lib/documents";
import { requireDocuments, documentError } from "@/lib/server/document-config";
import { mediaSession } from "@/lib/server/media-session";
import { newDocumentUpload } from "@/lib/server/document-store";
import { readChatBody, RequestError, takeRequestSlot } from "@/lib/server/request";

export async function POST(request: Request) {
  try {
    requireDocuments();
    const parsed = documentTicketSchema.safeParse(await readChatBody(request));
    if (!parsed.success) throw new RequestError("Choose a supported document up to 20 MB.", 400);
    if (!takeRequestSlot()) throw new RequestError("Too many uploads. Please wait a minute.", 429);
    const session = mediaSession(request, true);
    const { doc, uploadUrl } = await newDocumentUpload(session.owner, parsed.data.conversationId, parsed.data.filename, parsed.data.size);
    return Response.json({ id: doc.id, url: documentUrl(doc.id), uploadUrl }, { headers: { "Cache-Control": "no-store", ...(session.cookie ? { "Set-Cookie": session.cookie } : {}) } });
  } catch (error) { return documentError(error); }
}
