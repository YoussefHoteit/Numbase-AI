import { connection } from "next/server";
import { chatConfig } from "@/lib/server/media-config";
import { documentsAvailable } from "@/lib/server/document-config";

export async function GET() {
  await connection();
  return Response.json({ ...chatConfig(), documents: documentsAvailable() }, { headers: { "Cache-Control": "no-store" } });
}
