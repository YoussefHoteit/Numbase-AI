import { z } from "zod";
import { extractionSchema } from "@/lib/extractions";
import { requireDocuments, documentError } from "@/lib/server/document-config";
import { extractionWorkbook } from "@/lib/server/extraction-export";
import { getDocument } from "@/lib/server/document-store";
import { mediaSession } from "@/lib/server/media-session";
import { readChatBody, RequestError, takeRequestSlot } from "@/lib/server/request";

const exportSchema = z.strictObject({ conversationId: z.string().min(1).max(128), format: z.enum(["json", "xlsx"]), result: extractionSchema });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireDocuments();
    const body = exportSchema.safeParse(await readChatBody(request));
    if (!body.success) throw new RequestError("Check the extraction before downloading.", 400);
    const { id } = await params;
    const { owner } = mediaSession(request);
    const doc = await getDocument(owner, id, body.data.conversationId);
    if (body.data.result.documentId !== doc.id) throw new RequestError("This extraction belongs to another file.", 400);
    if (!takeRequestSlot()) throw new RequestError("Too many downloads. Please wait a minute.", 429);
    // Exports contain reviewed browser values, not a claim of authenticated AI provenance.
    const result = { ...body.data.result, filename: doc.filename };
    const json = body.data.format === "json";
    const bytes = json ? JSON.stringify({ ...result, reviewNotice: "Values may be edited. Verify against the original; source quotes do not validate edits." }, null, 2) : await extractionWorkbook(result);
    return new Response(typeof bytes === "string" ? bytes : new Uint8Array(bytes).buffer, { headers: {
      "Content-Type": json ? "application/json; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="numbase-${result.kind}.${body.data.format}"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return documentError(error); }
}
