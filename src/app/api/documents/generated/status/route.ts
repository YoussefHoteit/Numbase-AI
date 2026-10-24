import { z } from "zod";
import { connection } from "next/server";
import { requireFileGeneration, documentError } from "@/lib/server/document-config";
import { readChatBody, RequestError } from "@/lib/server/request";
import { mediaSession } from "@/lib/server/media-session";
import { recoveredFile } from "@/lib/server/file-tools";

const schema = z.strictObject({ conversationId: z.string().min(1).max(128), turnId: z.string().min(1).max(128) });
export async function POST(request: Request) {
  try {
    await connection();
    const parsed = schema.safeParse(await readChatBody(request));
    if (!parsed.success) throw new RequestError("Invalid file status request.", 400);
    requireFileGeneration();
    const { owner } = mediaSession(request);
    return Response.json(await recoveredFile(owner, parsed.data.conversationId, parsed.data.turnId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return documentError(error); }
}
