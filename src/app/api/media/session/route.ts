import { readChatBody } from "@/lib/server/request";
import { mediaSession } from "@/lib/server/media-session";
import { assertMediaEnabled, mediaError } from "@/lib/server/media-http";
export async function POST(request: Request) {
  try {
    assertMediaEnabled();
    await readChatBody(request);
    const session = mediaSession(request, true);
    return Response.json({ ready: true }, { headers: { "Cache-Control": "no-store", ...(session.cookie ? { "Set-Cookie": session.cookie } : {}) } });
  } catch (error) { return mediaError(error); }
}
