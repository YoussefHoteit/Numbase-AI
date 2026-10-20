import { handleChat } from "@/lib/server/chat-handler";

export const maxDuration = 180;

export async function POST(request: Request) {
  return handleChat(request);
}
