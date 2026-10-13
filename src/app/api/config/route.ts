import { connection } from "next/server";
export async function GET() {
  await connection();
  const demo = !process.env.OPENROUTER_API_KEY?.trim();
  const enabled = demo || process.env.NODE_ENV !== "production" || process.env.NUMBASE_DEPLOYMENT_PROTECTED === "true";
  return Response.json({ demo, enabled }, { headers: { "Cache-Control": "no-store" } });
}
