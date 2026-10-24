import { connection } from "next/server";
import { chatConfig } from "@/lib/server/media-config";
import { documentsAvailable, extractionsAvailable } from "@/lib/server/document-config";

export async function GET() {
  await connection();
  return Response.json({ ...chatConfig(), documents: documentsAvailable(), extraction: extractionsAvailable() }, { headers: { "Cache-Control": "no-store" } });
}
