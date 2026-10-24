import { extractionRequestSchema } from "@/lib/extractions";
import { requireExtractions, documentError } from "@/lib/server/document-config";
import { extractDocument } from "@/lib/server/document-extraction";
import { mediaSession } from "@/lib/server/media-session";
import { readChatBody, RequestError, takeRequestSlot } from "@/lib/server/request";

export const maxDuration = 100;
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireExtractions();
    const body = extractionRequestSchema.safeParse(await readChatBody(request));
    if (!body.success) throw new RequestError("Choose invoice fields or a table in this conversation.", 400);
    const session = mediaSession(request);
    if (!takeRequestSlot()) throw new RequestError("Too many requests. Wait a minute before extracting again.", 429);
    const { id } = await params;
    const result = await extractDocument({ owner: session.owner, id, ...body.data, signal: request.signal });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return documentError(error); }
}
