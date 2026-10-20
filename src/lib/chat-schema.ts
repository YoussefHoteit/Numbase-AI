import { z } from "zod";
import { LEGACY_MODELS, MODELS, resolveModelId } from "./models.ts";
import type { UIMessage } from "ai";
import { assetIdFromUrl, imageTypeSchema, imageOperationSchema, imageResultSchema } from "./media.ts";
export const modelSchema = z.enum(MODELS.map((model) => model.id));
const historicalModelSchema = z.enum([
  ...MODELS.map((model) => model.id),
  ...LEGACY_MODELS.map((model) => model.id),
]);
export const metadataSchema = z.object({
  modelId: historicalModelSchema,
  demo: z.boolean(),
  createdAt: z.number(),
});
export type ChatMessage = UIMessage<z.infer<typeof metadataSchema>>;
const textPart = z.object({ type: z.literal("text"), text: z.string().max(32_000) });
const filePart = z.object({
  type: z.literal("file"),
  mediaType: imageTypeSchema,
  filename: z.string().max(160).optional(),
  url: z.string().refine((url) => !!assetIdFromUrl(url), "Use an uploaded image."),
});
const imageToolBase = {
  type: z.literal("tool-createImage"),
  toolCallId: z.string().min(1).max(128),
};
const imageToolPart = z.discriminatedUnion("state", [
  // SDK deltas can contain unfinished enums/UUIDs. These inputs are display-only;
  // complete calls and successful results still use the strict operation schema.
  z.object({ ...imageToolBase, state: z.literal("input-streaming"), input: z.json().optional(), rawInput: z.string().optional() }),
  z.object({ ...imageToolBase, state: z.literal("input-available"), input: imageOperationSchema }),
  z.object({ ...imageToolBase, state: z.literal("output-available"), input: imageOperationSchema, output: imageResultSchema }),
  z.object({ ...imageToolBase, state: z.literal("output-error"), input: z.json().default(null), rawInput: z.json().optional(), errorText: z.string().max(1000) }),
]);
export const messageSchema = z.object({
  id: z.string().min(1).max(128),
  role: z.enum(["user", "assistant"]),
  parts: z
    .array(z.union([textPart, filePart, imageToolPart]))
    .min(1)
    .max(20),
  metadata: metadataSchema.optional(),
}).superRefine((message, context) => {
  if (message.parts.filter((part) => part.type === "file").length > 4)
    context.addIssue({ code: "custom", message: "Attach up to four images." });
  if (message.role === "user" && message.parts.some((part) => part.type.startsWith("tool-")))
    context.addIssue({ code: "custom", message: "User messages cannot contain tool results." });
});
export const requestSchema = z
  .object({
    model: modelSchema,
    id: z.string().min(1).max(128).optional(),
    messages: z.array(messageSchema).min(1).max(100),
  })
  .superRefine(({ messages }, context) => {
    const lastMessage = messages.at(-1);
    if (lastMessage?.role !== "user")
      context.addIssue({ code: "custom", message: "End with a user message." });
    if (
      messages.reduce(
        (n, m) => n + m.parts.reduce((sum, p) => sum + (p.type === "text" ? p.text.length : 0), 0),
        0,
      ) > 64_000
    )
      context.addIssue({
        code: "custom",
        message: "Conversation is too long.",
      });
    if (!lastMessage?.parts.some((part) => part.type === "file" || (part.type === "text" && part.text.trim())))
      context.addIssue({ code: "custom", message: "Message is empty." });
    if (messages.flatMap((message) => message.parts).filter((part) => part.type === "file" || part.type === "tool-createImage").length > 12)
      context.addIssue({ code: "custom", message: "This chat has too many images. Start a new chat." });
  });
export const conversationSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(100),
  model: historicalModelSchema.transform(resolveModelId),
  updatedAt: z.number(),
  messages: z.array(messageSchema).max(200),
});
export type Conversation = Omit<
  z.infer<typeof conversationSchema>,
  "messages"
> & { messages: ChatMessage[] };

export type ChatConfig = { demo: boolean; enabled: boolean; images?: boolean; generation?: boolean; storage?: "local" | "supabase" | "unavailable" };
