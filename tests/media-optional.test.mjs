import test from "node:test";
import assert from "node:assert/strict";
import { handleChat } from "../src/lib/server/chat-handler.ts";
import { chatConfig } from "../src/lib/server/media-config.ts";
import { assertMediaEnabled } from "../src/lib/server/media-http.ts";

const origin = "https://numbase-ai.vercel.app";
const history = [
  { id: "first", role: "user", parts: [{ type: "text", text: "Remember the number 84729." }] },
  { id: "reply", role: "assistant", parts: [{ type: "text", text: "Stored." }] },
  { id: "followup", role: "user", parts: [{ type: "text", text: "What was the number?" }] },
];

function configure({ storage = false, secret = false, protectedDeployment = true } = {}) {
  process.env.NODE_ENV = "production";
  process.env.OPENROUTER_API_KEY = "mock-only-not-a-credential";
  process.env.NUMBASE_DEPLOYMENT_PROTECTED = String(protectedDeployment);
  delete process.env.NUMBASE_PUBLIC_ACCESS_ENABLED;
  process.env.NUMBASE_IMAGE_GENERATION_ENABLED = "true";
  for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NUMBASE_SESSION_SECRET"])
    delete process.env[name];
  if (storage) {
    process.env.SUPABASE_URL = "https://storage.invalid";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-only-not-a-credential";
  }
  if (secret) process.env.NUMBASE_SESSION_SECRET = "synthetic-session-secret-for-tests-only";
}

function request(messages = history, cookie) {
  return new Request(origin + "/api/chat", {
    method: "POST",
    headers: { origin, host: new URL(origin).host, "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ id: "same-conversation", model: "anthropic/claude-haiku-4.5", messages }),
  });
}

// Exercise the real request validation and SDK serialization without provider or storage traffic.
function provider(captures) {
  return async (url, init) => {
    assert.equal(new URL(url).hostname, "openrouter.ai");
    const payload = JSON.parse(init.body);
    captures.push(payload);
    const chunk = { id: "mock", object: "chat.completion.chunk", created: 1, model: payload.model };
    return new Response([
      { ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: "The number is 84729." }, finish_reason: null }] },
      { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ].map((part) => `data: ${JSON.stringify(part)}\n\n`).join("") + "data: [DONE]\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    });
  };
}

for (const [name, config] of [
  ["without any media configuration", {}],
  ["with storage but no session secret", { storage: true }],
  ["with a session secret but no storage", { secret: true }],
]) {
  test(`production text chat streams full switched-model history ${name}`, async () => {
    configure(config);
    const captures = [];
    // A pre-existing cookie must not make text-only requests verify an unavailable media secret.
    const response = await handleChat(request(history, "numbase.media-session=invalid"), provider(captures));
    assert.equal(response.status, 200);
    assert.equal(response.headers.has("set-cookie"), false);
    assert.match(await response.text(), /The number is 84729/);
    assert.equal(captures.length, 1);
    assert.equal(captures[0].model, "anthropic/claude-haiku-4.5");
    assert.deepEqual(captures[0].messages.filter((m) => m.role !== "system").map(({ role, content }) => ({ role, content })),
      history.map(({ role, parts }) => ({ role, content: parts[0].text })));
    assert.equal(captures[0].tools, undefined);
    assert.equal(chatConfig().enabled, true);
    assert.equal(chatConfig().images, false);
    assert.equal(chatConfig().generation, false);
    assert.throws(assertMediaEnabled, /Images are unavailable.*Text chat is still available/);
  });
}

test("missing media setup rejects image history clearly instead of silently dropping it", async () => {
  configure();
  const messages = structuredClone(history);
  messages[0].parts.push({ type: "file", mediaType: "image/png", url: "/api/assets/11111111-1111-4111-8111-111111111111" });
  const response = await handleChat(request(messages), () => assert.fail("No provider request is allowed."));
  assert.equal(response.status, 503);
  assert.match(await response.text(), /Images are unavailable.*Text chat is still available/);
});

test("production guard still blocks live chat with no media configuration", async () => {
  configure({ protectedDeployment: false });
  const response = await handleChat(request(), () => assert.fail("No provider request is allowed."));
  assert.equal(response.status, 503);
  assert.equal(chatConfig().enabled, false);
  assert.equal(chatConfig().images, false);
  assert.throws(assertMediaEnabled, /Images are not enabled/);
});

test("fully configured media remains available and generation stays opt-in", () => {
  configure({ storage: true, secret: true });
  assert.equal(chatConfig().images, true);
  assert.equal(chatConfig().generation, true);
  process.env.NUMBASE_IMAGE_GENERATION_ENABLED = "false";
  assert.equal(chatConfig().images, true);
  assert.equal(chatConfig().generation, false);
  assert.doesNotThrow(assertMediaEnabled);
});

test("explicit public production access streams text without pretending authentication is enabled", async () => {
  configure({ protectedDeployment: false });
  process.env.NUMBASE_PUBLIC_ACCESS_ENABLED = "true";
  const captures = [];
  const response = await handleChat(request(), provider(captures));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /84729/);
  assert.equal(chatConfig().enabled, true);
  assert.equal(chatConfig().images, false);
  assert.equal(process.env.NUMBASE_DEPLOYMENT_PROTECTED, "false");
});

test("public media still requires private storage and a signed session secret", () => {
  configure({ protectedDeployment: false, storage: true });
  process.env.NUMBASE_PUBLIC_ACCESS_ENABLED = "true";
  assert.equal(chatConfig().images, false);
  assert.throws(assertMediaEnabled, /Images are unavailable/);
  process.env.NUMBASE_SESSION_SECRET = "synthetic-session-secret-for-tests-only";
  assert.equal(chatConfig().images, true);
  assert.equal(chatConfig().generation, true);
  assert.doesNotThrow(assertMediaEnabled);
});
