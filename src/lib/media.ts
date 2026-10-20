import { z } from "zod";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS = 4;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const imageTypeSchema = z.enum(IMAGE_TYPES);
export const assetIdSchema = z.string().uuid();
export const assetUrl = (id: string) => `/api/assets/${id}`;
export function assetIdFromUrl(url: string): string | undefined {
  const match = /^\/api\/assets\/([0-9a-f-]{36})$/i.exec(url);
  return match && assetIdSchema.safeParse(match[1]).success ? match[1] : undefined;
}
const aspectRatioSchema = z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]);
export const imageOperationSchema = z.object({
  operation: z.enum(["create", "edit", "variation", "regenerate"]).describe("Use create for a new image, edit for a requested change, variation for a new version, or regenerate to repeat the original generation parameters."),
  prompt: z.string().trim().min(1).max(4000),
  referenceIds: z.array(assetIdSchema).max(MAX_ATTACHMENTS).describe("For a new image from text only, use an empty array []. For reference-based work, use only exact asset UUIDs supplied in the conversation; never invent IDs."),
  aspectRatio: aspectRatioSchema.default("1:1").describe("Use 1:1 unless the user requests another shape. Regeneration restores the saved original aspect ratio automatically."),
}).strict();
export type ImageOperation = z.infer<typeof imageOperationSchema>;
export const imageResultSchema = z.object({
  assetId: assetIdSchema,
  url: z.string().refine((s) => !!assetIdFromUrl(s)),
  prompt: z.string().max(4000),
  modelId: z.string().max(128),
  parentIds: z.array(assetIdSchema).max(MAX_ATTACHMENTS),
  operation: imageOperationSchema.shape.operation,
  aspectRatio: aspectRatioSchema,
}).strict();
export type ImageResult = z.infer<typeof imageResultSchema>;

export function attachmentError(file: Pick<File, "size" | "type">): string | undefined {
  if (!IMAGE_TYPES.includes(file.type as (typeof IMAGE_TYPES)[number]))
    return "Choose a JPEG, PNG, or WebP image.";
  if (!file.size || file.size > MAX_IMAGE_BYTES)
    return "Each image must be between 1 byte and 5 MB.";
}
