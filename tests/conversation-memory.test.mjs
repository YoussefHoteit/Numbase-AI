import test from "node:test";
import assert from "node:assert/strict";
import { Chat } from "@ai-sdk/react";
import { createChatTransport } from "../src/lib/chat-transport.ts";
import { snapshotTextMessages, toModelMessages } from "../src/lib/chat-history.ts";
import { metadataSchema, requestSchema } from "../src/lib/chat-schema.ts";
import { MODELS } from "../src/lib/models.ts";
import { readChatBody } from "../src/lib/server/request.ts";
import { streamOpenRouterResponse } from "../src/lib/server/openrouter-chat.ts";

const GPT = "openai/gpt-4.1-mini";
const GEMINI = "google/gemini-2.5-flash-lite";
const MISTRAL = "mistralai/mistral-small-3.2-24b-instruct";
const KEY = "numbase.conversations.v1";
const origin = "https://numbase-ai.vercel.app";
// Public synthetic fixtures, not real credentials or private project data.
const seed = "Remember these three details for our conversation:\n- Project name: Numbase AI\n- Secret number: 84729\n- Secret word: Quantum\n\nRespond only with 'Information stored.'";
const recall = "What project name, secret number, and secret word did I give you earlier in this conversation?";
const textOf = (message) => message.parts.filter(part => part.type === "text").map(part => part.text).join("\n");
const user = (id, text) => ({ id, role: "user", parts: [{ type: "text", text }] });
const assistant = (id, text, modelId = GPT) => ({ id, role: "assistant", parts: [{ type: "text", text }], metadata: { modelId, demo: false, createdAt: 1 } });
let instance = 0;

function memoryStorage() {
  const entries = new Map();
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
}

async function loadStore(storage) {
  globalThis.localStorage = storage;
  const { conversations } = await import(`../src/lib/conversations.ts?memory-test=${++instance}`);
  conversations.hydrate();
  return conversations;
}

function mockProvider(captures) {
  return async (url, init) => {
    assert.equal(new URL(url).hostname, "openrouter.ai", "Only the injected OpenRouter mock may be called.");
    const payload = JSON.parse(init.body);
    // Capture bodies only. Authorization headers are never saved or logged.
    captures.push(structuredClone(payload));
    const messages = payload.messages.filter(message => message.role !== "system");
    const last = messages.at(-1).content;
    const containsSeed = messages.some(message => message.role === "user" && message.content.includes("84729") && message.content.includes("Quantum"));
    const answer = last.includes("Respond only") ? "Information stored."
      : containsSeed ? "Project name: Numbase AI\nSecret number: 84729\nSecret word: Quantum"
      : "Those details are absent from the supplied conversation.";
    const common = { id: crypto.randomUUID(), object: "chat.completion.chunk", created: 1, model: payload.model };
    const chunks = [
      { ...common, choices: [{ index: 0, delta: { role: "assistant", content: answer.slice(0, 7) }, finish_reason: null }] },
      { ...common, choices: [{ index: 0, delta: { content: answer.slice(7) }, finish_reason: null }] },
      { ...common, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ];
    return new Response(new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          await new Promise(resolve => setTimeout(resolve, 3));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }), { headers: { "Content-Type": "text/event-stream" } });
  };
}

function connect(store, clientPayloads, upstreamPayloads, { savePartial = true } = {}) {
  const conversation = store.getSnapshot().conversations.find(item => item.id === store.getSnapshot().activeId);
  const transport = createChatTransport({ fetch: async (url, init) => {
    assert.equal(url, "/api/chat");
    const headers = new Headers(init.headers);
    headers.set("origin", origin);
    headers.set("host", new URL(origin).host);
    assert.equal(headers.has("authorization"), false, "The browser must not send provider credentials.");
    const raw = await readChatBody(new Request(origin + url, { ...init, headers }));
    clientPayloads.push(structuredClone(raw));
    const parsed = requestSchema.parse(raw);
    return streamOpenRouterResponse({ ...parsed, signal: init.signal, apiKey: "mock-only-not-a-credential", fetch: mockProvider(upstreamPayloads) });
  } });
  const chat = new Chat({
    id: conversation.id,
    messages: snapshotTextMessages(conversation.messages),
    messageMetadataSchema: metadataSchema,
    transport,
    onFinish: ({ messages }) => store.saveMessages(conversation.id, messages),
  });
  if (savePartial) chat["~registerMessagesCallback"](() => store.saveMessages(chat.id, chat.messages));
  return chat;
}

async function harness(options) {
  const storage = memoryStorage();
  const store = await loadStore(storage);
  const clientPayloads = [];
  const upstreamPayloads = [];
  return { storage, store, clientPayloads, upstreamPayloads, chat: connect(store, clientPayloads, upstreamPayloads, options) };
}

async function send(h, model, text) {
  const before = structuredClone(h.chat.messages);
  h.store.setModel(h.chat.id, model);
  assert.deepEqual(h.chat.messages, before, "Selecting a model must not reset the SDK history.");
  await h.chat.sendMessage({ text }, { body: { model } });
  assert.equal(h.chat.error, undefined);
  assert.equal(h.chat.status, "ready");
  assert.equal(h.chat.lastMessage.metadata.modelId, model);
  assert.equal(h.chat.lastMessage.metadata.demo, false);
  return textOf(h.chat.lastMessage);
}

function assertWireHistory(h, call, expectedMessages, model) {
  const client = h.clientPayloads[call];
  const upstream = h.upstreamPayloads[call];
  assert.equal(client.id, h.chat.id);
  assert.equal(client.model, model);
  assert.deepEqual(client.messages, snapshotTextMessages(expectedMessages));
  assert.equal(upstream.model, model);
  assert.deepEqual(upstream.messages.filter(message => message.role !== "system"), toModelMessages(expectedMessages));
  assert.equal(upstream.messages[0].role, "system");
  assert.ok(upstream.messages.every(message => ["system", "user", "assistant"].includes(message.role)));
  assert.equal(upstream.max_tokens, 4096);
  assert.equal(upstream.transforms, undefined, "The app must not enable upstream history compression.");
}

test("A: Mistral same-model recall retains the earlier user and assistant messages", async () => {
  const h = await harness();
  assert.equal(await send(h, MISTRAL, seed), "Information stored.");
  const prior = structuredClone(h.chat.messages);
  assert.match(await send(h, MISTRAL, recall), /84729[\s\S]*Quantum/);
  assertWireHistory(h, 1, [...prior, h.chat.messages.at(-2)], MISTRAL);
});

test("B: GPT to Gemini to Mistral shares complete chronological history", async () => {
  const h = await harness();
  await send(h, GPT, seed);
  for (const model of [GEMINI, MISTRAL]) {
    const prior = structuredClone(h.chat.messages);
    assert.match(await send(h, model, recall), /84729[\s\S]*Quantum/);
    assertWireHistory(h, h.clientPayloads.length - 1, [...prior, h.chat.messages.at(-2)], model);
    assert.deepEqual(h.chat.messages.slice(0, prior.length), prior);
  }
});

test("C: GPT to Gemini to Mistral to GPT keeps message order and original model labels", async () => {
  const h = await harness();
  const sequence = [GPT, GEMINI, MISTRAL, GPT];
  for (const [index, model] of sequence.entries()) await send(h, model, index === 0 ? seed : recall);
  assert.equal(h.chat.messages.length, 8);
  assert.equal(new Set(h.chat.messages.map(message => message.id)).size, 8);
  assert.deepEqual(h.chat.messages.map(message => message.role), ["user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant"]);
  assert.deepEqual(h.chat.messages.filter(message => message.role === "assistant").map(message => message.metadata.modelId), sequence);
  assert.deepEqual(h.clientPayloads.map(payload => payload.messages.length), [1, 3, 5, 7]);
});

test("D: reload and reopening restore full streamed text before the next model request", async () => {
  const h = await harness();
  await send(h, GPT, seed);
  await send(h, GEMINI, recall);
  const expected = snapshotTextMessages(h.chat.messages);
  const restored = await loadStore(h.storage);
  assert.deepEqual(restored.getSnapshot().conversations[0].messages, expected);
  restored.create();
  restored.select(h.chat.id);
  h.store = restored;
  h.chat = connect(restored, h.clientPayloads, h.upstreamPayloads);
  assert.match(await send(h, MISTRAL, recall), /84729[\s\S]*Quantum/);
  assertWireHistory(h, 2, [...expected, h.chat.messages.at(-2)], MISTRAL);
});

test("E: actual SDK request bodies preserve the same roles and text for every supported provider", async (t) => {
  for (const entry of MODELS) await t.test(entry.id, async () => {
    const h = await harness();
    const previous = [user("u1", seed), assistant("a1", "Information stored.", GPT), user("u2", recall), assistant("a2", "Numbase AI, 84729, Quantum", GEMINI)];
    h.store.saveMessages(h.chat.id, previous);
    h.chat = connect(h.store, h.clientPayloads, h.upstreamPayloads);
    assert.match(await send(h, entry.id, recall), /84729[\s\S]*Quantum/);
    assertWireHistory(h, 0, [...previous, h.chat.messages.at(-2)], entry.id);
  });
});

test("stream snapshots are detached and a later delta cannot bypass persistence", async () => {
  const storage = memoryStorage();
  const store = await loadStore(storage);
  const id = store.getSnapshot().activeId;
  const messages = [user("u", seed), assistant("a", "Information")];
  store.saveMessages(id, messages);
  messages[1].parts[0].text = "Information stored.";
  messages[1].metadata.modelId = MISTRAL;
  assert.equal(textOf(store.getSnapshot().conversations[0].messages[1]), "Information");
  store.saveMessages(id, messages);
  const persisted = JSON.parse(storage.getItem(KEY)).conversations[0];
  assert.equal(textOf(persisted.messages[1]), "Information stored.");
  assert.equal(persisted.messages[1].metadata.modelId, MISTRAL);
});

test("completion persistence does not depend on a throttled rendering notification", async () => {
  const h = await harness({ savePartial: false });
  await send(h, MISTRAL, seed);
  await send(h, MISTRAL, recall);
  assert.deepEqual(JSON.parse(h.storage.getItem(KEY)).conversations[0].messages, snapshotTextMessages(h.chat.messages));
});

test("regeneration keeps earlier context while replacing only the last response", async () => {
  const h = await harness();
  await send(h, GPT, seed);
  await send(h, GEMINI, recall);
  const earlier = structuredClone(h.chat.messages.slice(0, -1));
  await h.chat.regenerate({ body: { model: MISTRAL } });
  assert.equal(h.chat.error, undefined);
  assert.equal(h.chat.messages.length, 4);
  assert.deepEqual(h.chat.messages.slice(0, -1), earlier);
  assert.equal(h.chat.lastMessage.metadata.modelId, MISTRAL);
  assertWireHistory(h, 2, earlier, MISTRAL);
});

test("a request without the fixture never acquires facts from another conversation", async () => {
  const h = await harness();
  assert.match(await send(h, MISTRAL, recall), /absent/);
  assert.equal(h.clientPayloads[0].messages.length, 1);
  assert.ok(!JSON.stringify(h.upstreamPayloads[0].messages).includes("84729"));
});
