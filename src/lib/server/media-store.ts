import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { assetIdSchema, MAX_IMAGE_BYTES, type ImageOperation } from "../media.ts";
import { RequestError } from "./request.ts";

export type Asset = {
  id: string; owner: string; conversationId: string; filename: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp"; size: number;
  status: "pending" | "ready"; source: "upload" | "generated";
  checksum?: string; width?: number; height?: number;
  prompt?: string; modelId?: string; parentIds: string[];
  referenceIds?: string[];
  operation?: ImageOperation["operation"]; aspectRatio?: ImageOperation["aspectRatio"];
  createdAt: number;
};
export type GenerationJob = {
  id: string; owner: string; status: "running" | "succeeded" | "uncertain";
  assetId?: string; createdAt: number;
};
const BUCKET = "numbase-images";
function client(signal?: AbortSignal) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  if (new URL(url).protocol !== "https:") throw new RequestError("Invalid storage configuration.", 503);
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => {
      const source = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      return globalThis.fetch(input, { ...init, signal: AbortSignal.any([
        ...(source ? [source] : []), ...(signal ? [signal] : []), AbortSignal.timeout(60_000),
      ]) });
    } },
  });
}
export function storageMode(): "supabase" | "local" | "unavailable" {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return "supabase";
  return process.env.NODE_ENV !== "production" ? "local" : "unavailable";
}
function localRoot() {
  if (process.env.NODE_ENV === "production") throw new RequestError("Image storage is not configured yet.", 503);
  return process.env.NUMBASE_MEDIA_DIRECTORY ?? path.join(process.cwd(), ".local-media");
}
function id(value: string) {
  const parsed = assetIdSchema.safeParse(value);
  if (!parsed.success) throw new RequestError("Invalid image ID.", 400);
  return parsed.data;
}
function location(asset: Asset) { return `${id(asset.owner)}/${id(asset.id)}`; }
async function localPath(kind: "assets" | "bytes" | "jobs", key: string) {
  if (!/^[a-z0-9-]+$/i.test(key)) throw new RequestError("Invalid image ID.", 400);
  // Development data is never part of a production function's traced bundle.
  const dir = path.join(/* turbopackIgnore: true */ localRoot(), kind);
  await mkdir(dir, { recursive: true });
  return path.join(/* turbopackIgnore: true */ dir, key);
}
async function optionalJSON<T>(filename: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(filename, "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
}
export async function getAsset(owner: string, assetId: string, conversationId?: string, signal?: AbortSignal): Promise<Asset> {
  signal?.throwIfAborted();
  id(owner); id(assetId);
  const db = client(signal);
  let asset: Asset | undefined;
  if (db) {
    const { data, error } = await db.from("numbase_assets").select("record").eq("id", assetId).eq("owner", owner).maybeSingle();
    if (error) throw new RequestError("Image storage is temporarily unavailable.", 503);
    asset = data?.record as Asset | undefined;
  } else asset = await optionalJSON<Asset>(await localPath("assets", assetId));
  if (!asset || asset.owner !== owner || (conversationId && asset.conversationId !== conversationId))
    throw new RequestError("This image is unavailable in this conversation.", 404);
  return asset;
}
export async function putAsset(asset: Asset, initial = false) {
  const db = client();
  if (db) {
    // A signed upload can contain up to the bucket limit before completion checks.
    const row = { id: asset.id, owner: asset.owner, conversation_id: asset.conversationId, status: asset.status, byte_size: asset.status === "pending" ? MAX_IMAGE_BYTES : asset.size, record: asset };
    const result = initial
      ? await db.rpc("numbase_reserve_asset", { asset_row: row })
      : await db.rpc("numbase_update_asset", { asset_row: row });
    if (result.error) throw new RequestError("Image storage is full or unavailable. Please try later.", 503);
  } else await writeFile(await localPath("assets", asset.id), JSON.stringify(asset), initial ? { flag: "wx" } : {});
}
export async function newUpload(owner: string, conversationId: string, filename: string, mediaType: Asset["mediaType"], size: number) {
  const asset: Asset = {
    id: crypto.randomUUID(), owner, conversationId, filename: filename.replace(/[\x00-\x1f/\\]/g, "_").slice(0, 160),
    mediaType, size, status: "pending", source: "upload", parentIds: [], createdAt: Date.now(),
  };
  await putAsset(asset, true);
  const db = client();
  if (db) {
    const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(location(asset), { upsert: false });
    if (error || !data) throw new RequestError("Could not start the image upload.", 503);
    return { asset, uploadUrl: data.signedUrl };
  }
  return { asset, uploadUrl: `/api/assets/${asset.id}/upload` };
}
export async function readAssetBytes(asset: Asset, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const db = client(signal);
  if (db) {
    try {
      const { data, error } = await db.storage.from(BUCKET).download(location(asset));
      if (error || !data) throw new RequestError("The image could not be loaded. Please try again when your connection is stable.", 503);
      if (data.size > MAX_IMAGE_BYTES) throw new RequestError("Image is too large.", 413);
      return Buffer.from(await data.arrayBuffer());
    } catch (error) {
      if (error instanceof RequestError) throw error;
      throw new RequestError("Loading your image took too long. Please try again when your connection is stable.", 503);
    }
  }
  return readFile(await localPath("bytes", asset.id));
}
export async function writeAssetBytes(asset: Asset, bytes: Uint8Array, replace = false) {
  const db = client();
  if (db) {
    const { error } = await db.storage.from(BUCKET).upload(location(asset), bytes, { contentType: asset.mediaType, upsert: replace });
    if (error) throw new RequestError("Could not save the image. Please try later.", 503);
  } else await writeFile(await localPath("bytes", asset.id), bytes, replace ? {} : { flag: "wx" });
}
export async function validateImage(bytes: Uint8Array, mediaType: Asset["mediaType"]) {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new RequestError("Each image must be 5 MB or smaller.", 413);
  try {
    const image = sharp(bytes, { limitInputPixels: 20_000_000, failOn: "warning" });
    const metadata = await image.metadata();
    const expected = mediaType === "image/jpeg" ? "jpeg" : mediaType.split("/")[1];
    if (metadata.format !== expected || (metadata.pages ?? 1) > 1) throw new Error("Invalid format");
    const decoded = await image.rotate().toBuffer({ resolveWithObject: true });
    if (decoded.data.length > MAX_IMAGE_BYTES) throw new Error("Too large");
    return { bytes: decoded.data, width: decoded.info.width, height: decoded.info.height,
      checksum: createHash("sha256").update(decoded.data).digest("hex") };
  } catch { throw new RequestError("That image is invalid, animated, or too large to process. Choose a different JPEG, PNG, or WebP.", 400); }
}
export async function finishUpload(owner: string, assetId: string) {
  const asset = await getAsset(owner, assetId);
  if (asset.status === "ready") return asset;
  const bytes = await readAssetBytes(asset);
  if (bytes.length !== asset.size) throw new RequestError("The uploaded size does not match. Upload the image again.", 400);
  const decoded = await validateImage(bytes, asset.mediaType);
  await writeAssetBytes(asset, decoded.bytes, true);
  const ready: Asset = { ...asset, status: "ready", size: decoded.bytes.length, width: decoded.width, height: decoded.height, checksum: decoded.checksum };
  await putAsset(ready);
  return ready;
}
export async function assetReadUrl(asset: Asset, download = false) {
  const db = client();
  if (!db) return;
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(location(asset), 60, download ? { download: asset.filename } : undefined);
  if (error || !data) throw new RequestError("Image storage is temporarily unavailable.", 503);
  return data.signedUrl;
}
export function jobId(owner: string, conversationId: string, turnId: string) {
  return createHash("sha256").update(JSON.stringify([owner, conversationId, turnId])).digest("hex");
}
export async function getJob(owner: string, key: string): Promise<GenerationJob | undefined> {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new RequestError("Invalid job ID.", 400);
  const db = client();
  if (db) {
    const { data, error } = await db.from("numbase_image_jobs").select("record").eq("id", key).eq("owner", owner).maybeSingle();
    if (error) throw new RequestError("Image job storage is unavailable.", 503);
    return data?.record as GenerationJob | undefined;
  }
  const job = await optionalJSON<GenerationJob>(await localPath("jobs", key));
  return job?.owner === owner ? job : undefined;
}
export async function reserveJob(job: GenerationJob) {
  const db = client();
  if (db) {
    const { error } = await db.rpc("numbase_reserve_image_job", { job_row: job });
    if (error) throw new RequestError("An image request is already running, or today's image limit has been reached.", 429);
  } else {
    try { await writeFile(await localPath("jobs", job.id), JSON.stringify(job), { flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new RequestError("This image request has already started. Wait for its result before trying a new request.", 409); throw error; }
  }
}
export async function saveJob(job: GenerationJob) {
  const db = client();
  if (db) {
    const { error } = await db.from("numbase_image_jobs").update({ status: job.status, record: job }).eq("id", job.id).eq("owner", job.owner);
    if (error) throw new RequestError("Could not update the image job.", 503);
  } else await writeFile(await localPath("jobs", job.id), JSON.stringify(job));
}
