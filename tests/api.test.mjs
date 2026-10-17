import test from "node:test";
import assert from "node:assert/strict";

const base = new URL(
  process.env.TEST_BASE_URL || "https://numbase-ai.vercel.app",
).origin;
const models = [
  "openai/gpt-4.1-mini",
  "anthropic/claude-haiku-4.5",
  "google/gemini-2.5-flash-lite",
  "mistralai/mistral-small-3.2-24b-instruct",
];
const payload = (model = models[0]) => ({
  model,
  messages: [
    { id: "test-user", role: "user", parts: [{ type: "text", text: "Hello" }] },
  ],
});
const send = (body, headers = {}) =>
  fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const preflight = await fetch(`${base}/api/config`, { redirect: "manual" });
const requiresSignIn = (response) =>
  [401, 403].includes(response.status) ||
  ([302, 303, 307, 308].includes(response.status) &&
    new URL(response.headers.get("location") || "/", base).hostname ===
      "vercel.com");
const protectedDeployment = requiresSignIn(preflight);
const appTest = (name, run) =>
  test(
    name,
    {
      skip: protectedDeployment
        ? "Vercel Authentication is enabled; run application checks in an authorized browser."
        : false,
    },
    run,
  );

test("protected deployments reject unauthenticated chat requests", async (t) => {
  if (!protectedDeployment) {
    t.skip("This deployment does not require Vercel Authentication.");
    return;
  }
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ model: "untrusted/model", messages: [] }),
  });
  assert.ok(
    requiresSignIn(response),
    "The chat endpoint must require authentication too.",
  );
});

appTest(
  "configuration exposes no credentials and identifies demo mode",
  async () => {
    const response = await fetch(`${base}/api/config`);
    assert.equal(response.status, 200);
    const config = await response.json();
    assert.deepEqual(Object.keys(config).sort(), ["demo", "enabled"]);
    assert.equal(typeof config.demo, "boolean");
    assert.equal(typeof config.enabled, "boolean");
    assert.match(response.headers.get("cache-control"), /no-store/);
  },
);
appTest("rejects cross-origin requests", async () => {
  assert.equal(
    (await send(payload(), { Origin: "https://untrusted.example" })).status,
    403,
  );
});
appTest("rejects non-JSON and malformed JSON", async () => {
  assert.equal(
    (await send(payload(), { "Content-Type": "text/plain" })).status,
    415,
  );
  assert.equal((await send("{broken")).status, 400);
});
appTest("rejects arbitrary model IDs, roles, and non-text parts", async () => {
  assert.equal((await send(payload("untrusted/model"))).status, 400);
  for (const retired of [
    "anthropic/claude-sonnet-4.5",
    "google/gemini-2.5-flash",
    "openai/gpt-4.1",
  ])
    assert.equal((await send(payload(retired))).status, 400);
  const body = payload();
  body.messages[0].role = "system";
  assert.equal((await send(body)).status, 400);
  body.messages[0].role = "user";
  body.messages[0].parts = [
    { type: "file", url: "https://untrusted.example/file" },
  ];
  assert.equal((await send(body)).status, 400);
});
appTest("rejects empty, excessive, and oversized messages", async () => {
  const body = payload();
  body.messages[0].parts[0].text = "   ";
  assert.equal((await send(body)).status, 400);
  body.messages[0].parts[0].text = "x".repeat(32_001);
  assert.equal((await send(body)).status, 400);
  body.messages = Array.from({ length: 101 }, (_, i) => ({
    id: String(i),
    role: "user",
    parts: [{ type: "text", text: "hi" }],
  }));
  assert.equal((await send(body)).status, 400);
  assert.equal((await send("x".repeat(128_001))).status, 413);
});
appTest("streams labeled sample responses for all four models", async (t) => {
  const config = await (await fetch(`${base}/api/config`)).json();
  if (!config.demo) {
    t.skip("Live deployment: sample tests never spend provider credits.");
    return;
  }
  for (const model of models) {
    const response = await send(payload(model));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    const text = await response.text();
    const events = text
      .split("\n")
      .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
      .map((line) => JSON.parse(line.slice(6)));
    const start = events.find((event) => event.type === "start");
    assert.equal(start.messageMetadata.modelId, model);
    assert.equal(start.messageMetadata.demo, true);
    const content = events
      .filter((event) => event.type === "text-delta")
      .map((event) => event.delta)
      .join("");
    assert.match(content, /sample response/);
    assert.match(content, /```typescript/);
    assert.ok(events.find((event) => event.type === "finish"));
    assert.ok(
      events.filter((event) => event.type === "text-delta").length > 10,
    );
  }
});
