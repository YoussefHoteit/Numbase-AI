import { connection } from "next/server";
import { chatConfig } from "@/lib/server/media-config";

export async function GET() {
  await connection();
  return Response.json(chatConfig(), { headers: { "Cache-Control": "no-store" } });
}
