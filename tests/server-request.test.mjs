import test from "node:test";
import assert from "node:assert/strict";
import { readChatBody, RequestError, takeRequestSlot } from "../src/lib/server/request.ts";
import { requestSchema } from "../src/lib/chat-schema.ts";

const origin = "https://numbase-ai.vercel.app";
const payload = { model: "openai/gpt-4.1-mini", messages: [{ id: "test", role: "user", parts: [{ type: "text", text: "Synthetic test" }] }] };
const request = (body = JSON.stringify(payload), headers = {}) => new Request(`${origin}/api/chat`, {
  method: "POST", headers: { host: new URL(origin).host, origin, "content-type": "application/json", ...headers }, body,
});
const hasStatus = (status) => (error) => error instanceof RequestError && error.status === status;

test("accepts a valid same-origin JSON request", async () => {
  assert.deepEqual(await readChatBody(request()), payload);
});

test("rejects missing, malformed, and foreign origins even with a forged forwarded host", async () => {
  for (const source of ["", "not-a-url", "https://untrusted.example"])
    await assert.rejects(readChatBody(request(undefined, { origin: source, "x-forwarded-host": "untrusted.example" })), hasStatus(403));
});

test("rejects non-JSON bodies, malformed JSON, and declared oversized payloads", async () => {
  await assert.rejects(readChatBody(request(undefined, { "content-type": "text/plain" })), hasStatus(415));
  await assert.rejects(readChatBody(request("{broken")), hasStatus(400));
  await assert.rejects(readChatBody(request(undefined, { "content-length": "128001" })), hasStatus(413));
});

test("cancels an oversized streaming body without relying on Content-Length", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(128_001)); },
    cancel() { cancelled = true; },
  });
  const incoming = new Request(`${origin}/api/chat`, {
    method: "POST", headers: { host: new URL(origin).host, origin, "content-type": "application/json" }, body, duplex: "half",
  });
  await assert.rejects(readChatBody(incoming), hasStatus(413));
  assert.equal(cancelled, true);
});

test("validates roles, content, message counts, and total context length", () => {
  const invalid = [
    { ...payload, model: "untrusted/model" },
    { ...payload, messages: [] },
    { ...payload, messages: [{ ...payload.messages[0], role: "system" }] },
    { ...payload, messages: [{ ...payload.messages[0], parts: [{ type: "file", url: "https://untrusted.example" }] }] },
    { ...payload, messages: [{ ...payload.messages[0], parts: [{ type: "text", text: " " }] }] },
    { ...payload, messages: [{ ...payload.messages[0], parts: [{ type: "text", text: "x".repeat(32_001) }] }] },
    { ...payload, messages: Array.from({ length: 101 }, (_, i) => ({ ...payload.messages[0], id: String(i) })) },
    { ...payload, messages: Array.from({ length: 3 }, (_, i) => ({ id: String(i), role: "user", parts: [{ type: "text", text: "x".repeat(22_000) }] })) },
  ];
  for (const body of invalid) assert.equal(requestSchema.safeParse(body).success, false);
});

test("rate limiter allows twenty requests and recovers after a minute", () => {
  const now = 10_000_000;
  for (let i = 0; i < 20; i++) assert.equal(takeRequestSlot(now), true);
  assert.equal(takeRequestSlot(now + 59_999), false);
  assert.equal(takeRequestSlot(now + 60_000), true);
});
