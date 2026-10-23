import { DOCUMENT_LIMITS } from "@/lib/documents";
import { requireDocuments, documentError } from "@/lib/server/document-config";
import { mediaSession } from "@/lib/server/media-session";
import { getDocument, saveLocalUpload } from "@/lib/server/document-store";
import { assertSameOrigin, readBoundedBody, RequestError } from "@/lib/server/request";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireDocuments();
    assertSameOrigin(request);
    // Production uploads go directly to storage, outside the function payload limit.
    if (process.env.NODE_ENV === "production") throw new RequestError("Use the private upload URL.", 400);
    const { owner } = mediaSession(request);
    const doc = await getDocument(owner, (await context.params).id);
    await saveLocalUpload(doc, await readBoundedBody(request, DOCUMENT_LIMITS.bytes));
    return new Response(null, { status: 204 });
  } catch (error) { return documentError(error); }
}
