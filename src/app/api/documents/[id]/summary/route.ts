import { start } from "workflow/api";
import { summarizeDocument } from "@/workflows/summarize-document";
import { requireSummaries, documentError } from "@/lib/server/document-config";
import { mediaSession } from "@/lib/server/media-session";
import { readChatBody, RequestError, takeRequestSlot } from "@/lib/server/request";
import { beginSummary, changeSummary, summaryStatus } from "@/lib/server/document-summary";
import { publicSummary } from "@/lib/document-summary";
import { z } from "zod";

export const maxDuration = 60;
const bodySchema = z.strictObject({ conversationId: z.string().min(1).max(128), action: z.enum(["start", "cancel"]) });
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    requireSummaries();
    const { owner } = mediaSession(request);
    const conversationId = z.string().min(1).max(128).parse(new URL(request.url).searchParams.get("conversationId"));
    return Response.json(publicSummary(await summaryStatus(owner, (await context.params).id, conversationId)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return documentError(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    requireSummaries();
    const body = bodySchema.safeParse(await readChatBody(request));
    if (!body.success) throw new RequestError("Choose a summary action in this conversation.", 400);
    const { owner } = mediaSession(request);
    const { id } = await context.params;
    if (!takeRequestSlot()) throw new RequestError("Too many requests. Wait a minute.", 429);
    if (body.data.action === "cancel") {
      const job = await summaryStatus(owner, id, body.data.conversationId);
      const cancelled = job && ["queued", "processing"].includes(job.status) ? await changeSummary(owner, id, job, { ...job, status: "cancelled", active: false }) : job;
      return Response.json(publicSummary(cancelled), { headers: { "Cache-Control": "no-store" } });
    }
    const { job, created } = await beginSummary(owner, id, body.data.conversationId);
    if (created) {
      try { await start(summarizeDocument, [owner, id, job.id], { experimental_retention: 0 }); }
      catch {
        await changeSummary(owner, id, job, { ...job, status: "failed", error: "Could not start the summary. No provider request was sent." });
        throw new RequestError("Could not start the summary. Please try later.", 503);
      }
    }
    return Response.json(publicSummary(job), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return documentError(error); }
}
