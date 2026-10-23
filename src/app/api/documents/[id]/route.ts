import { connection } from "next/server";
import { requireDocuments, documentError } from "@/lib/server/document-config";
import { getDocument, documentDownload, publicDocument, readDocumentBytes } from "@/lib/server/document-store";
import { mediaSession } from "@/lib/server/media-session";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await connection();
    requireDocuments();
    const { owner } = mediaSession(request);
    const doc = await getDocument(owner, (await context.params).id);
    if (!new URL(request.url).searchParams.has("download")) return Response.json(publicDocument(doc), { headers: { "Cache-Control": "no-store" } });
    const signed = await documentDownload(doc);
    if (signed) return new Response(null, { status: 302, headers: { Location: signed, "Cache-Control": "no-store" } });
    return new Response(new Uint8Array(await readDocumentBytes(doc)), { headers: {
      "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
    } });
  } catch (error) { return documentError(error); }
}
