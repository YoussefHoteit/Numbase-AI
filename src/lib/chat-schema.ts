import { z } from "zod";
import { MODELS } from "./models";
import type { UIMessage } from "ai";
export const modelSchema = z.enum(MODELS.map((model) => model.id));
export const metadataSchema = z.object({ modelId: modelSchema, demo: z.boolean(), createdAt: z.number() });
export type ChatMessage = UIMessage<z.infer<typeof metadataSchema>>;
export const messageSchema = z.object({
  id: z.string().min(1).max(128), role: z.enum(["user", "assistant"]),
  parts: z.array(z.object({ type: z.literal("text"), text: z.string().max(32_000) })).min(1).max(20),
  metadata: metadataSchema.optional(),
});
export const requestSchema = z.object({ model: modelSchema, messages: z.array(messageSchema).min(1).max(100) })
  .superRefine(({ messages }, context) => {
    if (messages.at(-1)?.role !== "user") context.addIssue({ code: "custom", message: "End with a user message." });
    if (messages.reduce((n, m) => n + m.parts.reduce((sum, p) => sum + p.text.length, 0), 0) > 64_000)
      context.addIssue({ code: "custom", message: "Conversation is too long." });
    if (!messages.at(-1)?.parts.some((part) => part.text.trim())) context.addIssue({ code: "custom", message: "Message is empty." });
  });
export const conversationSchema = z.object({
  id: z.string().min(1).max(128), title: z.string().min(1).max(100), model: modelSchema,
  updatedAt: z.number(), messages: z.array(messageSchema).max(200),
});
export type Conversation = Omit<z.infer<typeof conversationSchema>, "messages"> & { messages: ChatMessage[] };
