import { connection } from "next/server";
import { chatConfig } from "@/lib/server/media-config";
import { documentsAvailable, extractionsAvailable, filesAvailable, summariesAvailable, lifecycleAvailable } from "@/lib/server/document-config";

export async function GET() {
  await connection();
  return Response.json({ ...chatConfig(), documents: documentsAvailable(), extraction: extractionsAvailable(), files: filesAvailable(), summaries: summariesAvailable(), lifecycle: lifecycleAvailable() }, { headers: { "Cache-Control": "no-store" } });
}
