import { z } from "zod";
import { DOCUMENT_LIMITS } from "./documents.ts";

export const DOCUMENT_READING_LIMITS = { calls: 4, characters: 32_000, perRead: 12_000, sections: 8, overviewSections: 48 } as const;
export const readDocumentInputSchema = z.strictObject({
  documentId: z.uuid(),
  operation: z.enum(["overview", "sections"]),
  startSection: z.number().int().min(1).max(DOCUMENT_LIMITS.chunks),
  endSection: z.number().int().min(1).max(DOCUMENT_LIMITS.chunks),
});
export const documentCoverageSchema = z.strictObject({
  totalSections: z.number().int().min(1).max(DOCUMENT_LIMITS.chunks),
  includedSections: z.number().int().min(1).max(DOCUMENT_LIMITS.chunks),
  complete: z.boolean(),
  shortened: z.boolean(),
});
export const documentReadResultSchema = z.strictObject({
  documentId: z.uuid(), filename: z.string().min(1).max(160),
  operation: z.enum(["overview", "sections"]),
  coverage: documentCoverageSchema,
  sections: z.array(z.strictObject({
    section: z.number().int().min(1).max(DOCUMENT_LIMITS.chunks),
    location: z.string().max(1000), text: z.string().max(DOCUMENT_READING_LIMITS.perRead), shortened: z.boolean(),
  })).min(1).max(DOCUMENT_READING_LIMITS.overviewSections),
  note: z.string().max(500),
});
export type DocumentReadResult = z.infer<typeof documentReadResultSchema>;
