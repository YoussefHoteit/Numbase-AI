import { z } from "zod";

export const SUMMARY_MODEL = "google/gemini-2.5-flash-lite";
export const SUMMARY_LIMITS = { batch: 16, group: 8, noteCharacters: 5000, resultCharacters: 10_000, maxCostUsd: 0.50, staleMs: 10 * 60_000 } as const;
const noteSchema = z.strictObject({ start: z.number().int().min(1).max(800), end: z.number().int().min(1).max(800), text: z.string().min(1).max(SUMMARY_LIMITS.noteCharacters) });
export const summaryJobSchema = z.object({
  id: z.uuid(), status: z.enum(["queued", "processing", "ready", "failed", "cancelled"]),
  revision: z.number().int().min(0), createdAt: z.number(), updatedAt: z.number(),
  checksum: z.string(), totalSections: z.number().int().min(1).max(800), completedSections: z.number().int().min(0).max(800),
  notes: z.array(noteSchema).max(50), combined: z.array(noteSchema).max(7),
  active: z.boolean(), reservedUsd: z.number().min(0).max(SUMMARY_LIMITS.maxCostUsd),
  result: z.string().max(SUMMARY_LIMITS.resultCharacters).optional(), error: z.string().max(500).optional(),
});
export type SummaryJob = z.infer<typeof summaryJobSchema>;
export function publicSummary(job?: SummaryJob) {
  return job ? { id: job.id, status: job.status, totalSections: job.totalSections, completedSections: job.completedSections,
    model: SUMMARY_MODEL, result: job.result, error: job.error, maximumCostUsd: SUMMARY_LIMITS.maxCostUsd } : { status: "not-started" as const };
}
