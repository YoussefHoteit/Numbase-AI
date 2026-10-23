import { start } from "workflow/api";
import { indexDocument } from "@/workflows/index-document";
import { requireDocuments, documentError } from "@/lib/server/document-config";
import { mediaSession } from "@/lib/server/media-session";
import { getDocument, updateDocument, publicDocument } from "@/lib/server/document-store";
import { readChatBody, RequestError } from "@/lib/server/request";

export const maxDuration = 60;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireDocuments();
    await readChatBody(request);
    const { owner } = mediaSession(request);
    const doc = await getDocument(owner, (await context.params).id);
    if (doc.status !== "pending") return Response.json(publicDocument(doc), { headers: { "Cache-Control": "no-store" } });
    const queued = { ...doc, status: "queued" as const };
    // Only the request that wins this transition may start a workflow.
    if (await updateDocument(queued, "pending")) {
      try { await start(indexDocument, [owner, doc.id], { experimental_retention: 0 }); }
      catch {
        await updateDocument({ ...queued, status: "failed", error: "Could not start document processing. Upload the file again." });
        throw new RequestError("Could not start document processing. Upload the file again.", 503);
      }
    }
    return Response.json(publicDocument(await getDocument(owner, doc.id)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return documentError(error); }
}
