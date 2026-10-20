import test, { after } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { newUpload, finishUpload, getAsset, assetReadUrl, getJob, reserveJob, saveJob, jobId, storageMode } from "../src/lib/server/media-store.ts";

// Contract tests run against an in-process mock, never a user's Supabase project.
const realFetch = globalThis.fetch;
const calls = [];
const rows = new Map();
const jobs = new Map();
const png = await sharp({ create: { width: 12, height: 8, channels: 3, background: "blue" } }).png().toBuffer();
process.env.SUPABASE_URL = "https://synthetic-project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-key-not-a-credential";
after(() => { globalThis.fetch = realFetch; });
globalThis.fetch = async (input, init = {}) => {
  assert.ok(init.signal instanceof AbortSignal, "Storage requests have a bounded lifetime.");
  const url = new URL(input instanceof Request ? input.url : input);
  assert.equal(url.hostname, "synthetic-project.supabase.co", "No real network requests are permitted.");
  const method = init.method ?? "GET";
  calls.push({ method, path: url.pathname, search: url.search, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
  const body = calls.at(-1).body;
  if (url.pathname.endsWith("/rpc/numbase_reserve_asset")) { rows.set(body.asset_row.id, body.asset_row); return new Response(null, { status: 204 }); }
  if (url.pathname.endsWith("/rpc/numbase_update_asset")) { rows.set(body.asset_row.id, body.asset_row); return new Response(null, { status: 204 }); }
  if (url.pathname.endsWith("/rpc/numbase_reserve_image_job")) { jobs.set(body.job_row.id, { ...body.job_row, record: body.job_row }); return new Response(null, { status: 204 }); }
  if (url.pathname.endsWith("/numbase_assets")) {
    const id = url.searchParams.get("id")?.slice(3);
    const owner = url.searchParams.get("owner")?.slice(3);
    if (method === "PATCH") { rows.set(id, body); return new Response(null, { status: 204 }); }
    const row = rows.get(id);
    return Response.json(row?.owner === owner ? [{ record: row.record }] : []);
  }
  if (url.pathname.endsWith("/numbase_image_jobs")) {
    const id = url.searchParams.get("id")?.slice(3);
    const owner = url.searchParams.get("owner")?.slice(3);
    if (method === "PATCH") { jobs.set(id, { ...jobs.get(id), ...body }); return new Response(null, { status: 204 }); }
    const row = jobs.get(id);
    return Response.json(row?.owner === owner ? [{ record: row.record }] : []);
  }
  if (url.pathname.includes("/object/upload/sign/")) return Response.json({ url: "/object/upload/sign/numbase-images/synthetic?token=scoped-test-token" });
  if (url.pathname.includes("/object/sign/")) return Response.json({ signedURL: "/object/sign/numbase-images/synthetic?token=short-lived-view" });
  if (method === "GET" && url.pathname.includes("/object/")) return new Response(png, { headers: { "Content-Type": "image/png" } });
  if (method === "POST" && url.pathname.includes("/object/")) return Response.json({ Key: "numbase-images/synthetic" });
  throw new Error(`Unmocked storage request: ${method} ${url.pathname}`);
};
test("Supabase uses private metadata, scoped uploads, ownership filters, and temporary read links", async () => {
  assert.equal(storageMode(), "supabase");
  const owner = crypto.randomUUID();
  const created = await newUpload(owner, "test-conversation", "fixture.png", "image/png", png.length);
  assert.match(created.uploadUrl, /upload\/sign/);
  assert.equal(rows.get(created.asset.id).owner, owner);
  assert.equal(rows.get(created.asset.id).byte_size, 5 * 1024 * 1024, "Pending signed uploads reserve the full allowed size.");
  assert.equal(JSON.stringify(rows.get(created.asset.id)).includes("token="), false);
  const asset = await finishUpload(owner, created.asset.id);
  assert.equal(asset.status, "ready"); assert.equal(asset.width, 12);
  assert.equal(rows.get(asset.id).byte_size, asset.size);
  assert.match(await assetReadUrl(asset), /short-lived-view/);
  assert.match(await assetReadUrl(asset, true), /download=fixture.png/);
  await assert.rejects(getAsset(crypto.randomUUID(), asset.id), /unavailable/);
  assert.ok(calls.some((call) => call.path.includes("numbase_assets") && call.search.includes("owner=eq.")));
});
test("Supabase jobs use atomic reservation RPCs and persist success before returning", async () => {
  const owner = crypto.randomUUID();
  const id = jobId(owner, "chat", "turn");
  await reserveJob({ id, owner, status: "running", createdAt: 1 });
  assert.equal((await getJob(owner, id)).status, "running");
  await saveJob({ id, owner, status: "succeeded", assetId: crypto.randomUUID(), createdAt: 1 });
  assert.equal((await getJob(owner, id)).status, "succeeded");
  assert.ok(calls.some((call) => call.path.endsWith("/rpc/numbase_reserve_image_job")));
});

test("cancelling a history request aborts an in-flight storage lookup", async () => {
  const mock = globalThis.fetch;
  const controller = new AbortController();
  let observed;
  globalThis.fetch = async (_input, init) => {
    observed = init.signal;
    return new Promise((_resolve, reject) => {
      const fail = () => reject(init.signal.reason);
      if (init.signal.aborted) fail();
      else init.signal.addEventListener("abort", fail, { once: true });
    });
  };
  try {
    const loading = getAsset(crypto.randomUUID(), crypto.randomUUID(), "chat", controller.signal);
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(loading, /temporarily unavailable/);
    assert.equal(observed.aborted, true);
  } finally { globalThis.fetch = mock; }
});
