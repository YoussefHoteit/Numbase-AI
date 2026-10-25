import { z } from "zod";
import type { FileDraft } from "./generated-files.ts";
import type { SummaryJob } from "./document-summary.ts";

export const DOCUMENT_LIMITS = {
  bytes: 20 * 1024 * 1024,
  expandedBytes: 80 * 1024 * 1024,
  entries: 2000,
  characters: 2_000_000,
  pages: 300,
  rows: 50_000,
  columns: 100,
  chunks: 800,
  filesPerChat: 8,
} as const;

export const DOCUMENT_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  text: "text/plain",
} as const;
export type DocumentKind = keyof typeof DOCUMENT_TYPES;
const CODE_EXTENSIONS = new Set("js jsx ts tsx mjs cjs py java c h cpp hpp cs go rs rb php swift kt kts sql html css scss json yaml yml xml sh ps1 r lua toml ini env example log txt md markdown".split(" "));

export function documentKind(filename: string): DocumentKind | undefined {
  const extension = filename.split(".").at(-1)?.toLowerCase() ?? "";
  if (extension === "pdf" || extension === "docx" || extension === "xlsx" || extension === "csv") return extension;
  return CODE_EXTENSIONS.has(extension) && !/^\.env(?:\.|$)/i.test(filename) ? "text" : undefined;
}
export const documentUrl = (id: string) => `/api/documents/${id}`;
export function documentIdFromUrl(url: string): string | undefined {
  const match = /^\/api\/documents\/([0-9a-f-]{36})$/i.exec(url);
  return match && z.uuid().safeParse(match[1]).success ? match[1] : undefined;
}
export function documentAttachmentError(file: Pick<File, "name" | "size">) {
  if (!documentKind(file.name)) return "Choose a PDF, DOCX, XLSX, CSV, code, text, or Markdown file. Do not upload credentials.";
  if (!file.size || file.size > DOCUMENT_LIMITS.bytes) return "Each document must be between 1 byte and 20 MB.";
}
export const documentPartSchema = z.object({
  type: z.literal("file"),
  mediaType: z.enum(Object.values(DOCUMENT_TYPES)),
  filename: z.string().min(1).max(160),
  url: z.string().refine((value) => !!documentIdFromUrl(value), "Use a document uploaded in this chat."),
});
export const documentTicketSchema = z.object({
  conversationId: z.string().min(1).max(128),
  filename: z.string().min(1).max(160),
  size: z.number().int().min(1).max(DOCUMENT_LIMITS.bytes),
}).strict();
export type DocumentStatus = "pending" | "queued" | "processing" | "ready" | "failed" | "removed";
export type DocumentRecord = {
  id: string;
  owner: string;
  conversationId: string;
  filename: string;
  kind: DocumentKind;
  size: number;
  status: DocumentStatus;
  createdAt: number;
  indexed: number;
  chunkCount: number;
  checksum?: string;
  error?: string;
  warnings?: string[];
  generated?: { version: number; parentId: string | null; draft: FileDraft };
  summary?: SummaryJob;
  removedAt?: number;
  purgedAt?: number;
};
export type DocumentSection = { location: string; text: string };
export type DocumentChunk = DocumentSection & { index: number };
export type DocumentMatch = DocumentChunk & { documentId: string; filename: string; score: number };

export function documentIds(messages: readonly { role: string; parts: readonly { type: string; url?: string }[] }[]) {
  return [...new Set(messages.filter((message) => message.role === "user").flatMap((message) =>
    message.parts.flatMap((part) => part.type === "file" && part.url ? documentIdFromUrl(part.url) ?? [] : []),
  ))];
}

// Each chunk carries its own source location; switching models doesn't change the index.
export function chunkSections(sections: DocumentSection[], size = 4000, overlap = 300): DocumentChunk[] {
  if (size < 100 || overlap < 0 || overlap >= size) throw new Error("Invalid chunk boundaries.");
  const chunks: DocumentChunk[] = [];
  for (const section of sections) {
    const text = section.text.trim();
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + size, text.length);
      if (end < text.length) {
        const boundary = text.lastIndexOf("\n", end);
        if (boundary > start + size / 2) end = boundary;
      }
      chunks.push({ index: chunks.length, location: section.location, text: text.slice(start, end) });
      if (chunks.length > DOCUMENT_LIMITS.chunks) throw new Error("This document has too many sections. Split it into smaller files.");
      if (end === text.length) break;
      start = end - overlap;
    }
  }
  return chunks;
}
