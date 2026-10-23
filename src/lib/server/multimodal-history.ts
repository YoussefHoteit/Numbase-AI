import type { ModelMessage } from "ai";
import sharp from "sharp";
import type { ChatMessage } from "../chat-schema.ts";
import { imageIds, toModelMessages } from "../chat-history.ts";
import { assetIdFromUrl, imageResultSchema } from "../media.ts";
import { getAsset, readAssetBytes, type Asset } from "./media-store.ts";
import { RequestError } from "./request.ts";
import { documentIdFromUrl } from "../documents.ts";

export async function multimodalHistory(messages: ChatMessage[], owner: string, conversationId: string, supportsVision = true, signal?: AbortSignal): Promise<ModelMessage[]> {
  signal?.throwIfAborted();
  const ids = imageIds(messages);
  if (ids.length && !supportsVision) throw new RequestError("This model cannot see images. Choose a vision model to continue; your images are still saved.", 400);
  const cache = new Map<string, Asset>();
  const pixels = new Map<string, { type: "file"; data: Uint8Array; mediaType: string }>();
  // Fetch each owned image once, in parallel, instead of reloading every reference.
  async function load(assetId: string) {
    const asset = await getAsset(owner, assetId, conversationId, signal);
    if (asset.status !== "ready") throw new RequestError("An image upload is not finished yet.", 400);
    cache.set(assetId, asset);
    const original = await readAssetBytes(asset, signal);
    // Keep originals for download and generation. Bound only the chat-model payload.
    const compact = original.length > 400_000
      ? await sharp(original).resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).webp({ quality: 90 }).toBuffer()
      : undefined;
    pixels.set(assetId, { type: "file", data: new Uint8Array(compact ?? original), mediaType: compact ? "image/webp" : asset.mediaType });
  }
  for (let offset = 0; offset < ids.length; offset += 3)
    await Promise.all(ids.slice(offset, offset + 3).map(load));
  const sent = new Set<string>();
  function resolve(assetId: string) {
    signal?.throwIfAborted();
    // Later references retain their exact ID and use the pixels already in history.
    if (sent.has(assetId)) return [];
    sent.add(assetId);
    return [pixels.get(assetId)!];
  }
  const history: ModelMessage[] = [];
  for (const message of messages) {
    const text = message.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
    if (message.role === "user") {
      const content: Extract<ModelMessage, { role: "user" }>["content"] = [];
      if (text) content.push({ type: "text", text });
      for (const part of message.parts) {
        if (part.type !== "file") continue;
        if (documentIdFromUrl(part.url)) continue;
        const assetId = assetIdFromUrl(part.url);
        if (!assetId) throw new RequestError("Use an image uploaded in this chat.", 400);
        content.push({ type: "text", text: `[Attached image ID: ${assetId}]` }, ...resolve(assetId));
      }
      history.push({ role: "user", content: content.length === 1 && content[0].type === "text" ? content[0].text : content });
    } else {
      if (text) history.push({ role: "assistant", content: text });
      for (const part of message.parts) {
        if (part.type !== "tool-createImage") continue;
        if (part.state !== "output-available") {
          if (!text) history.push({ role: "assistant", content: "The earlier image operation did not produce a confirmed result." });
          continue;
        }
        const parsed = imageResultSchema.safeParse(part.output);
        if (!parsed.success) throw new RequestError("An image result is invalid.", 400);
        const image = resolve(parsed.data.assetId);
        const asset = cache.get(parsed.data.assetId)!;
        if (asset.source !== "generated") throw new RequestError("Invalid generated image.", 400);
        // Rebuild context from trusted storage, never replay browser-supplied tool outputs.
        history.push({ role: "user", content: [
          { type: "text", text: `Earlier image result in this conversation: ${JSON.stringify({ id: asset.id, prompt: asset.prompt, operation: asset.operation, parentIds: asset.parentIds })}` }, ...image,
        ] });
      }
    }
  }
  return history.length ? history : toModelMessages(messages);
}
