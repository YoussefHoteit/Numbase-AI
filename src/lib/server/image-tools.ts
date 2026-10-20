import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateImage, tool } from "ai";
import { assetUrl, imageOperationSchema, type ImageResult } from "../media.ts";
import { getAsset, getJob, jobId, putAsset, readAssetBytes, reserveJob, saveJob, validateImage, writeAssetBytes, type Asset } from "./media-store.ts";
import { RequestError } from "./request.ts";

export const IMAGE_MODEL = "google/gemini-3.1-flash-image";
export function resultOf(asset: Asset): ImageResult {
  return {
    assetId: asset.id, url: assetUrl(asset.id), prompt: asset.prompt ?? "",
    modelId: asset.modelId ?? IMAGE_MODEL, parentIds: asset.parentIds,
    operation: asset.operation ?? "create", aspectRatio: asset.aspectRatio ?? "1:1",
  };
}
export function createImageTools({ owner, conversationId, turnId, allowedIds, selectedIds = [], apiKey, signal, fetch }: {
  owner: string; conversationId: string; turnId: string; allowedIds: string[]; selectedIds?: string[];
  apiKey: string; signal: AbortSignal; fetch?: typeof globalThis.fetch;
}) {
  // Even parallel tool calls share one operation per user turn.
  let used = false;
  return {
    createImage: tool({
      description: "Create an image from text, edit an existing image, make a variation, or regenerate. Call this only when the user asks to produce or modify an image. For descriptions, OCR, analysis, and comparisons, inspect the supplied images yourself. Reference IDs must come from this conversation's available images. Never claim success until the tool returns an asset.",
      inputSchema: imageOperationSchema,
      execute: async (input) => {
        // An explicit single-image action must target the version the user selected.
        const referenceIds = input.operation !== "create" && selectedIds.length === 1 ? selectedIds : input.referenceIds;
        if (used) throw new RequestError("Only one image operation is available per message.", 429);
        if (process.env.NUMBASE_IMAGE_GENERATION_ENABLED !== "true")
          throw new RequestError("Image generation is not enabled yet. Image upload and analysis are still available.", 503);
        if (referenceIds.some((id) => !allowedIds.includes(id)))
          throw new RequestError("Use images attached to this conversation.", 400);
        if (input.operation !== "create" && !referenceIds.length)
          throw new RequestError("Choose an image to edit, vary, or regenerate first.", 400);
        if (input.operation === "regenerate" && referenceIds.length !== 1)
          throw new RequestError("Choose one generated image to regenerate.", 400);
        // Invalid arguments may be corrected without consuming a paid operation.
        used = true;
        const key = jobId(owner, conversationId, turnId);
        const prior = await getJob(owner, key);
        if (prior?.status === "succeeded" && prior.assetId)
          return resultOf(await getAsset(owner, prior.assetId, conversationId));
        if (prior) throw new RequestError("This generation already started. Its result may still be pending; it will not be charged again automatically.", 409);
        const originals = await Promise.all(referenceIds.map((id) => getAsset(owner, id, conversationId, signal)));
        if (originals.some((asset) => asset.status !== "ready")) throw new RequestError("Wait for the image upload to finish.", 400);
        let prompt = input.prompt;
        let aspectRatio = input.aspectRatio;
        let references = originals;
        if (input.operation === "regenerate") {
          const original = originals[0];
          if (original.source !== "generated" || !original.prompt) throw new RequestError("Only generated images can be regenerated.", 400);
          prompt = original.prompt;
          aspectRatio = original.aspectRatio ?? "1:1";
          references = await Promise.all((original.referenceIds ?? original.parentIds).map((id) => getAsset(owner, id, conversationId)));
        }
        const referenceBytes = await Promise.all(references.map((asset) => readAssetBytes(asset, signal)));
        const job = { id: key, owner, status: "running" as const, createdAt: Date.now() };
        await reserveJob(job);
        try {
          const openrouter = createOpenRouter({ apiKey, fetch });
          const { image } = await generateImage({
            model: openrouter.imageModel(IMAGE_MODEL),
            prompt: referenceBytes.length ? { text: prompt, images: referenceBytes } : prompt,
            n: 1, maxImagesPerCall: 1, aspectRatio,
            providerOptions: { openrouter: { resolution: "1K" } },
            maxRetries: 0,
            abortSignal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
          });
          if (image.mediaType !== "image/png" && image.mediaType !== "image/jpeg" && image.mediaType !== "image/webp")
            throw new Error("Unsupported generated image format");
          const decoded = await validateImage(image.uint8Array, image.mediaType);
          const asset: Asset = {
            id: crypto.randomUUID(), owner, conversationId, filename: `numbase-${Date.now()}.${image.mediaType.split("/")[1]}`,
            mediaType: image.mediaType, size: decoded.bytes.length, source: "generated", status: "ready",
            width: decoded.width, height: decoded.height, checksum: decoded.checksum,
            prompt, modelId: IMAGE_MODEL, parentIds: referenceIds,
            referenceIds: references.map((asset) => asset.id), operation: input.operation, aspectRatio, createdAt: Date.now(),
          };
          await putAsset(asset, true);
          await writeAssetBytes(asset, decoded.bytes);
          await saveJob({ ...job, status: "succeeded", assetId: asset.id });
          return resultOf(asset);
        } catch (error) {
          // Network failure or cancellation can happen after a provider accepted a billable job.
          await saveJob({ ...job, status: "uncertain" }).catch(() => {});
          throw new RequestError(error instanceof RequestError ? error.message : "The image request did not finish. It will not retry automatically. Check this turn's status before making a new request.", 503);
        }
      },
    }),
  };
}
