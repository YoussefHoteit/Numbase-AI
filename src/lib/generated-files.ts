import { z } from "zod";
import { documentKind, documentUrl } from "./documents.ts";

export const FILE_LIMITS = { characters: 24_000, rows: 100, columns: 12, paragraphs: 60, bytes: 2_000_000 } as const;
const plain = (max: number) => z.string().max(max).refine((text) => !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text), "Remove control characters.");
// A flat object is supported by each provider's tool schema. Unused fields stay empty.
export const fileDraftSchema = z.strictObject({
  format: z.enum(["docx", "pdf", "xlsx", "code"]),
  filename: z.string().min(1).max(100),
  title: plain(200),
  paragraphs: z.array(plain(4000)).max(FILE_LIMITS.paragraphs),
  columns: z.array(plain(100)).max(FILE_LIMITS.columns),
  rows: z.array(z.array(plain(1000)).max(FILE_LIMITS.columns)).max(FILE_LIMITS.rows),
  code: plain(FILE_LIMITS.characters),
}).superRefine((draft, ctx) => {
  const bad = (message: string) => ctx.addIssue({ code: "custom", message });
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_. -]*$/u.test(draft.filename) || draft.filename.includes("..")) bad("Use a simple filename without paths.");
  const kind = documentKind(draft.filename);
  if (draft.format === "code" ? kind !== "text" : kind !== draft.format) bad("The filename extension must match the file format.");
  if (draft.rows.some((row) => row.length !== draft.columns.length)) bad("Every row must match the columns.");
  if (draft.rows.length && !draft.columns.length) bad("Table rows require column headings.");
  if (draft.format === "code") {
    if (!draft.code.trim() || draft.title || draft.paragraphs.length || draft.columns.length || draft.rows.length) bad("Code files use only filename and code.");
  } else {
    if (draft.code) bad("Document content belongs in paragraphs or table rows.");
    if (!draft.title.trim() && !draft.paragraphs.some((p) => p.trim()) && !draft.rows.length) bad("Include some file content.");
    if (draft.format === "xlsx" && (!draft.columns.length || draft.paragraphs.length)) bad("Spreadsheets require columns and rows; paragraphs must be empty.");
  }
  if (JSON.stringify(draft).length > FILE_LIMITS.characters) bad("The file draft is too large. Request a smaller file.");
});
export type FileDraft = z.infer<typeof fileDraftSchema>;
export const createFileInputSchema = z.strictObject({ parentId: z.uuid().nullable(), draft: fileDraftSchema });
export const fileResultSchema = z.strictObject({
  documentId: z.uuid(), filename: z.string().min(1).max(100), format: z.enum(["docx", "pdf", "xlsx", "code"]),
  version: z.number().int().min(1).max(1000), parentId: z.uuid().nullable(),
  size: z.number().int().min(1).max(FILE_LIMITS.bytes),
  url: z.string(),
}).refine((result) => result.url === documentUrl(result.documentId), "Invalid file download.");
export type FileResult = z.infer<typeof fileResultSchema>;
export const fileEditPartSchema = z.strictObject({ type: z.literal("data-file-edit"), data: z.strictObject({ documentId: z.uuid() }) });
export function fileEditTarget(messages: readonly { role: string; parts: readonly { type: string; data?: unknown }[] }[]) {
  const part = messages.findLast((message) => message.role === "user")?.parts.find((part) => part.type === "data-file-edit");
  const parsed = fileEditPartSchema.safeParse(part);
  return parsed.success ? parsed.data.data.documentId : undefined;
}

export function generatedFileIds(messages: readonly { parts: readonly { type: string; state?: string; output?: unknown }[] }[]) {
  return [...new Set(messages.flatMap((message) => message.parts.flatMap((part) => {
    if (part.type !== "tool-createFile" || part.state !== "output-available") return [];
    const result = fileResultSchema.safeParse(part.output);
    return result.success ? [result.data.documentId] : [];
  })))];
}

export function draftText(draft: FileDraft) {
  return [draft.title, ...draft.paragraphs, draft.columns.join(" | "), ...draft.rows.map((row) => row.join(" | ")), draft.code].filter(Boolean).join("\n\n");
}
