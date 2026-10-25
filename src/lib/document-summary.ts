import { z } from "zod";
import { sourceFactSchema } from "./source-facts.ts";
export const SUMMARY_VERSION = 2;

export const SUMMARY_MODEL = "mistralai/mistral-small-3.2-24b-instruct";
export const SUMMARY_LIMITS = { batch: 16, group: 8, noteCharacters: 5000, resultCharacters: 10_000, maxCostUsd: 0.50, staleMs: 10 * 60_000 } as const;
const noteSchema = z.strictObject({ start: z.number().int().min(1).max(800), end: z.number().int().min(1).max(800), text: z.string().min(1).max(SUMMARY_LIMITS.noteCharacters) });
export const summaryJobSchema = z.object({
  id: z.uuid(), status: z.enum(["queued", "processing", "ready", "failed", "cancelled"]),
  revision: z.number().int().min(0), createdAt: z.number(), updatedAt: z.number(),
  checksum: z.string(), totalSections: z.number().int().min(1).max(800), completedSections: z.number().int().min(0).max(800),
  notes: z.array(noteSchema).max(50), combined: z.array(noteSchema).max(7),
  version: z.number().int().min(1).max(SUMMARY_VERSION).optional(), sourceFacts: z.array(sourceFactSchema).max(64).optional(),
  active: z.boolean(), reservedUsd: z.number().min(0).max(SUMMARY_LIMITS.maxCostUsd),
  result: z.string().max(SUMMARY_LIMITS.resultCharacters).optional(), error: z.string().max(500).optional(),
});
export type SummaryJob = z.infer<typeof summaryJobSchema>;
export function publicSummary(job?: SummaryJob) {
  return job ? { id: job.id, status: job.status, totalSections: job.totalSections, completedSections: job.completedSections,
    model: SUMMARY_MODEL, result: summaryText(job), error: job.error, maximumCostUsd: SUMMARY_LIMITS.maxCostUsd, sourceFacts: job.sourceFacts ?? [], canUpdate: job.status === "ready" && (job.version ?? 1) < SUMMARY_VERSION } : { status: "not-started" as const };
}

// Index labels and sampled notes are not evidence of the source's structure or
// of a fact being absent. Keep those claims out of the user-facing synthesis.
export function summaryText(job: SummaryJob): string | undefined {
  if (!job.result) return undefined;
  let sourceFactSection = false;
  const lines: string[] = [];
  for (const line of job.result.split("\n")) {
    const heading = /^#{1,6}\s+(.+)$/u.exec(line.trim());
    if (heading) {
      sourceFactSection = /^source\s*facts?\b/iu.test(heading[1]);
      if (sourceFactSection || /^sections?\s+summary\b/iu.test(heading[1])) continue;
    }
    if (sourceFactSection) continue;
    const plain = line.replace(/\[[^\]]*\]/gu, "").replaceAll("*", "").trim();
    if (/^(?:[-+]\s*)?(?:sections?|pages?|lines?)\s+\d/iu.test(plain)
      || /\b(?:placeholder|repetitive|structured|substantive information|no specific|no meaningful|no discernible)\b/iu.test(plain)
      || /\b(?:all|each|every|majority)(?:\s+of\s+the)?\s+(?:sections?|pages?|lines?)\b/iu.test(plain)
      || /\b(?:first|final|last)\s+section\b/iu.test(plain)) continue;
    lines.push(line);
  }
  const result = lines.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
  if (result.split("\n").some((line) => line.trim() && !/^#{1,6}\s/u.test(line.trim()))) return result;
  let fallback = "## Source-grounded summary\n";
  for (const fact of job.sourceFacts ?? []) {
    const quote = fact.quote.replaceAll("[", "\\[").replaceAll("]", "\\]");
    const line = "\n- " + quote + " [" + fact.location + "]";
    if (fallback.length + line.length > SUMMARY_LIMITS.resultCharacters) break;
    fallback += line;
  }
  return fallback;
}
