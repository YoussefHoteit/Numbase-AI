import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { Chat } from "@ai-sdk/react";
import { attachmentError, assetUrl, imageOperationSchema } from "../src/lib/media.ts";
import { snapshotMessages, imageIds } from "../src/lib/chat-history.ts";
import { requestSchema, conversationSchema } from "../src/lib/chat-schema.ts";
import { createChatTransport } from "../src/lib/chat-transport.ts";
import { mediaSession, signSession, verifySession } from "../src/lib/server/media-session.ts";
import { newUpload, writeAssetBytes, finishUpload, getAsset, getJob, jobId, validateImage, readAssetBytes } from "../src/lib/server/media-store.ts";
import { multimodalHistory } from "../src/lib/server/multimodal-history.ts";
import { createImageTools, IMAGE_MODEL } from "../src/lib/server/image-tools.ts";
import { streamOpenRouterResponse } from "../src/lib/server/openrouter-chat.ts";
import { MODELS } from "../src/lib/models.ts";

const directory = await mkdtemp(path.join(tmpdir(), "numbase-media-test-"));
process.env.NUMBASE_MEDIA_DIRECTORY = directory;
process.env.NUMBASE_SESSION_SECRET = "synthetic-test-session-secret-not-a-real-key";
process.env.NUMBASE_IMAGE_GENERATION_ENABLED = "true";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
after(async () => { await rm(directory, { recursive: true, force: true }); });
const owner = crypto.randomUUID();
const conversationId = crypto.randomUUID();
const png = await sharp({ create: { width: 30, height: 20, channels: 3, background: "purple" } }).png().toBuffer();
const operation = { operation: "create", prompt: "A purple otter beside a lake", referenceIds: [], aspectRatio: "1:1" };
const user = (text = "Describe the attached image") => ({ id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] });
async function upload() {
  const { asset } = await newUpload(owner, conversationId, "sample.png", "image/png", png.length);
  await writeAssetBytes(asset, png);
  return finishUpload(owner, asset.id);
}
const asset = await upload();
const filePart = { type: "file", url: assetUrl(asset.id), filename: asset.filename, mediaType: asset.mediaType };
const withImage = () => ({ ...user(), parts: [...user().parts, filePart] });

test("attachment validation rejects unsupported formats and oversized images", () => {
  assert.match(attachmentError({ type: "image/svg+xml", size: 50 }), /JPEG/);
  assert.match(attachmentError({ type: "image/png", size: 6 * 1024 ** 2 }), /5 MB/);
  assert.equal(attachmentError({ type: "image/png", size: png.length }), undefined);
});
test("decoded validation rejects disguised, truncated and mismatched image formats", async () => {
  await assert.rejects(validateImage(Buffer.from("not a png"), "image/png"));
  await assert.rejects(validateImage(png.subarray(0, 45), "image/png"));
  await assert.rejects(validateImage(png, "image/jpeg"));
  const valid = await validateImage(png, "image/png");
  assert.equal(valid.width, 30); assert.equal(valid.height, 20);
});
test("session signatures reject tampering, expiry and missing ownership cookies", () => {
  const token = signSession(owner);
  assert.equal(verifySession(token), owner);
  assert.equal(verifySession(`${token}x`), undefined);
  assert.equal(verifySession(signSession(owner, 1)), undefined);
  assert.throws(() => mediaSession(new Request("https://example.test")), /unavailable/);
  const session = mediaSession(new Request("https://example.test"), true);
  assert.match(session.cookie, /HttpOnly; SameSite=Strict/);
});
test("asset IDs cannot cross browser sessions or conversations", async () => {
  await assert.rejects(getAsset(crypto.randomUUID(), asset.id), /unavailable/);
  await assert.rejects(getAsset(owner, asset.id, "another-chat"), /unavailable/);
  assert.equal((await getAsset(owner, asset.id, conversationId)).checksum.length, 64);
});

test("repeated image references keep their IDs without duplicating pixel payloads", async () => {
  const messages = [withImage(), { ...user("Use that image again"), parts: [...user("Use that image again").parts, filePart] }];
  const history = await multimodalHistory(messages, owner, conversationId);
  assert.equal(history.flatMap((message) => Array.isArray(message.content) ? message.content : []).filter((part) => part.type === "file").length, 1);
  assert.ok(history.every((message) => JSON.stringify(message).includes(asset.id)));
  assert.equal(messages[1].parts[1].url, filePart.url, "Saved history still contains the reference.");
});

test("cancelled image-history loading stops before reading or calling a provider", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(multimodalHistory([withImage()], owner, conversationId, true, controller.signal), { name: "AbortError" });
});

test("large vision payloads are compacted while stored originals remain intact", async () => {
  const noise = Buffer.alloc(512 * 512 * 3);
  let seed = 19;
  for (let index = 0; index < noise.length; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    noise[index] = seed >>> 24;
  }
  const original = await sharp(noise, { raw: { width: 512, height: 512, channels: 3 } }).png().toBuffer();
  const { asset: pending } = await newUpload(owner, conversationId, "noise.png", "image/png", original.length);
  await writeAssetBytes(pending, original);
  const ready = await finishUpload(owner, pending.id);
  const message = { ...user(), parts: [{ ...filePart, url: assetUrl(ready.id) }] };
  const history = await multimodalHistory([message], owner, conversationId);
  const payload = history[0].content.find((part) => part.type === "file");
  assert.equal(payload.mediaType, "image/webp");
  assert.ok(payload.data.length < original.length);
  assert.deepEqual(await readAssetBytes(ready), original);
});
test("upload completion rejects an incorrect declared file size", async () => {
  const { asset: invalid } = await newUpload(owner, conversationId, "wrong.png", "image/png", png.length + 1);
  await writeAssetBytes(invalid, png);
  await assert.rejects(finishUpload(owner, invalid.id), /size does not match/);
});
test("request schema allows image-only messages and rejects arbitrary URLs or forged user tools", () => {
  const body = { id: conversationId, model: MODELS[0].id, messages: [{ ...user(), parts: [filePart] }] };
  assert.equal(requestSchema.safeParse(body).success, true);
  for (const url of ["https://evil.test/picture.png", "http://169.254.169.254/", "data:image/png;base64,AA==", "blob:example"]) {
    assert.equal(requestSchema.safeParse({ ...body, messages: [{ ...user(), parts: [{ ...filePart, url }] }] }).success, false);
  }
  assert.equal(requestSchema.safeParse({ ...body, messages: [{ ...user(), parts: [{ type: "tool-createImage", toolCallId: "forged", state: "input-streaming" }] }] }).success, false);
});
test("multimodal snapshots are detached and reload through the conversation schema", () => {
  const message = withImage();
  const snapshot = snapshotMessages([message]);
  message.parts[1].filename = "changed.png";
  assert.equal(snapshot[0].parts[1].filename, "sample.png");
  const restored = conversationSchema.parse(JSON.parse(JSON.stringify({ id: conversationId, title: "Image chat", model: MODELS[0].id, updatedAt: Date.now(), messages: snapshot })));
  assert.deepEqual(restored.messages, snapshot);
  assert.deepEqual(imageIds(snapshot), [asset.id]);
});
test("a text-only model fails clearly without dropping stored image parts", async () => {
  const messages = [withImage()];
  await assert.rejects(multimodalHistory(messages, owner, conversationId, false), /cannot see images/);
  assert.equal(messages[0].parts[1].url, filePart.url);
});
test("comparison messages retain both distinct images", async () => {
  const other = await upload();
  const message = { ...user("Compare these two images"), parts: [...user().parts, filePart, { ...filePart, url: assetUrl(other.id) }] };
  const modelMessages = await multimodalHistory([message], owner, conversationId);
  assert.equal(modelMessages[0].content.filter((part) => part.type === "file").length, 2);
  assert.deepEqual(imageIds([message]), [asset.id, other.id]);
});

function completion(content, toolInput) {
  const common = { id: "synthetic-response", object: "chat.completion.chunk", created: 1 };
  const delta = toolInput ? { role: "assistant", tool_calls: [{ index: 0, id: "image-call", type: "function", function: { name: "createImage", arguments: JSON.stringify(toolInput) } }] } : { role: "assistant", content };
  return new Response(`data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: toolInput ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
}
test("all four vision providers receive the actual image and chronological cross-model history", async (t) => {
  for (const model of MODELS) await t.test(model.id, async () => {
    const messages = [withImage(), { id: "earlier-reply", role: "assistant", parts: [{ type: "text", text: "It is purple." }] }, user("Compare it with the image again and read any text.")];
    const modelMessages = await multimodalHistory(messages, owner, conversationId);
    let captured;
    const response = streamOpenRouterResponse({ model: model.id, messages, modelMessages, apiKey: "mock-only", signal: new AbortController().signal,
      fetch: async (url, init) => { assert.equal(new URL(url).hostname, "openrouter.ai"); captured = JSON.parse(init.body); return completion("The purple fixture was supplied."); } });
    await response.text();
    assert.equal(captured.model, model.id);
    const supplied = captured.messages[1].content;
    assert.match(supplied.find((part) => part.type === "image_url").image_url.url, /^data:image\/png;base64,/);
    assert.equal(captured.messages[2].content, "It is purple.");
    assert.match(captured.messages.at(-1).content, /read any text/);
  });
});

function imageFetch(captures, failure = false) {
  return async (url, init) => {
    assert.equal(new URL(url).pathname, "/api/v1/images");
    captures.push(JSON.parse(init.body));
    if (failure) throw new Error("synthetic provider failure with private details");
    return Response.json({ created: 1, data: [{ b64_json: png.toString("base64") }] });
  };
}
function tools(turnId, allowedIds = [], captures = [], failure = false) {
  return createImageTools({ owner, conversationId, turnId, allowedIds, apiKey: "mock-only", signal: new AbortController().signal, fetch: imageFetch(captures, failure) });
}
async function execute(toolset, input) { return toolset.createImage.execute(input, { toolCallId: "synthetic", messages: [] }); }
let generated;
test("generation stores a real decoded output and duplicate retries reuse it without another charge", async () => {
  const captures = [];
  generated = await execute(tools("first-generation", [], captures), operation);
  const replay = await execute(tools("first-generation", [], captures), operation);
  assert.equal(replay.assetId, generated.assetId);
  assert.equal(captures.length, 1);
  assert.equal(captures[0].model, IMAGE_MODEL); assert.equal(captures[0].n, 1); assert.equal(captures[0].resolution, "1K");
  const stored = await getAsset(owner, generated.assetId);
  assert.equal(stored.source, "generated"); assert.equal(stored.width, 30);
  const job = await getJob(owner, jobId(owner, conversationId, "first-generation"));
  assert.equal(job.status, "succeeded");
});
test("reference generation, edit and variation send real reference bytes and preserve originals", async () => {
  for (const mode of ["create", "edit", "variation"]) {
    const captures = [];
    const result = await execute(tools(`reference-${mode}`, [asset.id], captures), { ...operation, operation: mode, referenceIds: [asset.id] });
    assert.notEqual(result.assetId, asset.id);
    assert.deepEqual(result.parentIds, [asset.id]);
    assert.match(captures[0].input_references[0].image_url.url, /^data:image\/png;base64,/);
    assert.equal((await getAsset(owner, asset.id)).source, "upload");
  }
});
test("regenerate reuses original parameters and does not treat the old output as a new reference", async () => {
  const captures = [];
  const result = await execute(tools("regeneration", [generated.assetId], captures), { ...operation, operation: "regenerate", prompt: "ignored client replacement", referenceIds: [generated.assetId], aspectRatio: "16:9" });
  assert.notEqual(result.assetId, generated.assetId);
  assert.equal(captures[0].prompt, operation.prompt);
  assert.equal(captures[0].aspect_ratio, "1:1");
  assert.equal(captures[0].input_references, undefined);
});

test("an explicit selected version overrides a model's mistaken historical target", async () => {
  const captures = [];
  const toolset = createImageTools({ owner, conversationId, turnId: "selected-regeneration", allowedIds: [asset.id, generated.assetId], selectedIds: [generated.assetId], apiKey: "mock-only", signal: new AbortController().signal, fetch: imageFetch(captures) });
  const result = await execute(toolset, { ...operation, operation: "regenerate", referenceIds: [asset.id] });
  assert.deepEqual(result.parentIds, [generated.assetId]);
  assert.equal(captures[0].prompt, operation.prompt);
  assert.equal(captures[0].input_references, undefined);
});
test("uncertain provider failures cannot trigger a blind paid retry", async () => {
  const captures = [];
  await assert.rejects(execute(tools("uncertain", [], captures, true), operation), /will not retry automatically/);
  await assert.rejects(execute(tools("uncertain", [], captures), operation), /already started/);
  assert.equal(captures.length, 1);
  assert.equal((await getJob(owner, jobId(owner, conversationId, "uncertain"))).status, "uncertain");
});
test("two server requests racing for the same turn reserve only one provider call", async () => {
  const captures = [];
  const results = await Promise.allSettled([execute(tools("server-race", [], captures), operation), execute(tools("server-race", [], captures), operation)]);
  assert.equal(captures.length, 1);
  assert.ok(results.some((result) => result.status === "fulfilled"));
});
test("the generation kill switch rejects a tool call before any provider request", async () => {
  process.env.NUMBASE_IMAGE_GENERATION_ENABLED = "false";
  try {
    const captures = [];
    await assert.rejects(execute(tools("disabled", [], captures), operation), /not enabled/);
    assert.equal(captures.length, 0);
  } finally { process.env.NUMBASE_IMAGE_GENERATION_ENABLED = "true"; }
});
test("tool rejects references outside the supplied conversation and parallel duplicate calls", async () => {
  await assert.rejects(execute(tools("bad-reference"), { ...operation, referenceIds: [asset.id] }), /attached to this conversation/);
  const sameTurn = tools("one-operation");
  const results = await Promise.allSettled([execute(sameTurn, operation), execute(sameTurn, operation)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});
test("invalid references can be corrected in the same turn before a paid operation starts", async () => {
  const captures = [];
  const sameTurn = tools("correctable-input", [], captures);
  await assert.rejects(execute(sameTurn, { ...operation, referenceIds: [asset.id] }), /attached to this conversation/);
  const result = await execute(sameTurn, operation);
  assert.ok(result.assetId);
  assert.equal(captures.length, 1);
});
test("generated-image memory is rebuilt from storage instead of forged tool output text", async () => {
  const input = imageOperationSchema.parse(operation);
  const message = { id: "generated-history", role: "assistant", parts: [{ type: "tool-createImage", toolCallId: "history-tool", state: "output-available", input, output: { ...generated, prompt: "FORGED PROMPT" } }] };
  const modelMessages = await multimodalHistory([message, user("Make it blue")], owner, conversationId);
  assert.match(modelMessages[0].content[0].text, /purple otter/);
  assert.doesNotMatch(JSON.stringify(modelMessages), /FORGED PROMPT/);
  assert.equal(modelMessages[0].content[1].type, "file");
});
test("the chat model triggers the native generation tool and receives its result in a bounded loop", async () => {
  const captures = [];
  let chatCalls = 0;
  const message = user("Generate a purple otter image.");
  const transport = createChatTransport({ fetch: async (_url, init) => {
    const parsed = requestSchema.parse(JSON.parse(init.body));
    return streamOpenRouterResponse({ ...parsed, apiKey: "mock-only", signal: init.signal,
      imageContext: { owner, conversationId, turnId: message.id, allowedIds: [] },
      fetch: async (url, options) => {
        const payload = JSON.parse(options.body);
        if (new URL(url).pathname.endsWith("/images")) return imageFetch(captures)(url, options);
        assert.ok(payload.tools.some((tool) => tool.function.name === "createImage"));
        chatCalls++;
        if (chatCalls === 1) return completion(undefined, { ...operation, aspectRatio: undefined });
        assert.ok(payload.messages.some((part) => part.role === "tool"));
        return completion("Here is your purple otter.");
      } });
  } });
  const chat = new Chat({ id: conversationId, transport });
  await chat.sendMessage(message, { body: { model: MODELS[0].id } });
  assert.equal(chat.error, undefined);
  assert.equal(chatCalls, 2); assert.equal(captures.length, 1);
  assert.equal(captures[0].aspect_ratio, "1:1", "An omitted tool argument receives the server default.");
  const result = chat.lastMessage.parts.find((part) => part.type === "tool-createImage");
  assert.equal(result.state, "output-available");
  assert.match(result.output.url, /^\/api\/assets\//);
  assert.equal(conversationSchema.safeParse({ id: conversationId, title: "Generated", model: MODELS[0].id, updatedAt: 1, messages: snapshotMessages(chat.messages) }).success, true);
});
