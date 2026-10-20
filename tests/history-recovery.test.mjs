import test from "node:test";
import assert from "node:assert/strict";
import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport, createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { snapshotMessages } from "../src/lib/chat-history.ts";
import { conversationSchema, requestSchema } from "../src/lib/chat-schema.ts";

const KEY = "numbase.conversations.v2";
const model = "openai/gpt-4.1-mini";
const healthy = {
  id: "healthy-chat", title: "Unrelated conversation", model, updatedAt: 1,
  messages: [{ id: "healthy-user", role: "user", parts: [{ type: "text", text: "Preserve this unrelated history." }] }],
};
let instance = 0;
function memoryStorage(raw, failBackup = false) {
  const entries = new Map([[KEY, raw]]);
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      if (failBackup && key.startsWith(`${KEY}.recovery.`)) throw new Error("Synthetic quota exceeded");
      entries.set(key, value);
    },
  };
}
async function restore(storage) {
  globalThis.localStorage = storage;
  const { conversations } = await import(`../src/lib/conversations.ts?recovery=${++instance}`);
  conversations.hydrate();
  return conversations;
}
const workspace = (chats, activeId = healthy.id) => JSON.stringify({ version: 2, activeId, conversations: chats });

for (const interruption of ["reload", "stop", "tool error"]) {
  test(`actual SDK partial tool arguments survive ${interruption} alongside an unrelated chat`, async (t) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const chat = new Chat({
      id: "interrupted-chat",
      transport: new DefaultChatTransport({
        fetch: async () => createUIMessageStreamResponse({ stream: createUIMessageStream({
          execute: async ({ writer }) => {
            writer.write({ type: "start", messageId: "streamed-assistant" });
            writer.write({ type: "tool-input-start", toolCallId: "streamed-tool", toolName: "createImage" });
            writer.write({ type: "tool-input-delta", toolCallId: "streamed-tool", inputTextDelta: '{"operation":"ed","prompt":"Make it blue","referenceIds":["1111' });
            await gate;
            writer.write({ type: "tool-output-error", toolCallId: "streamed-tool", errorText: "Synthetic interrupted input" });
            writer.write({ type: "finish", finishReason: "stop" });
            writer.setOutcome({ status: "completed" });
          },
        }) }),
      }),
    });
    const pending = chat.sendMessage({ text: "Edit this image" });
    t.after(async () => { release(); await pending; });
    let part;
    for (let attempt = 0; attempt < 100; attempt++) {
      part = chat.lastMessage?.parts.find((item) => item.type === "tool-createImage");
      if (part?.input?.referenceIds?.[0] === "1111") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(part?.state, "input-streaming");
    assert.equal(part.input.referenceIds[0], "1111");
    if (interruption === "stop") await chat.stop();
    if (interruption === "tool error") { release(); await pending; }
    const interrupted = { id: chat.id, title: "Interrupted image edit", model, updatedAt: 1, messages: snapshotMessages(chat.messages) };
    assert.equal(conversationSchema.safeParse(interrupted).success, true);
    const raw = workspace([healthy, interrupted], interrupted.id);
    const storage = memoryStorage(raw);
    const store = await restore(storage);
    assert.deepEqual(store.getSnapshot().conversations, [healthy, interrupted]);
    assert.equal(storage.getItem(KEY), raw, "Hydration must not rewrite the saved workspace.");
    assert.equal(store.getSnapshot().activeId, interrupted.id);
    assert.equal(store.getSnapshot().conversations[1].messages.at(-1).parts[0].toolCallId, "streamed-tool");
    store.update(healthy.id, { title: "Still editable" });
    const reloaded = await restore(storage);
    assert.equal(reloaded.getSnapshot().conversations.length, 2);
    assert.deepEqual(reloaded.getSnapshot().conversations[1].messages, interrupted.messages);
  });
}

test("failed inputs remain recoverable while invalid completed tool calls stay rejected", () => {
  const failed = { ...healthy, messages: [{ id: "failed-input", role: "assistant", parts: [{
    type: "tool-createImage", toolCallId: "unparsed", state: "output-error", rawInput: "{invalid input", errorText: "Could not parse tool arguments",
  }] }] };
  const recovered = conversationSchema.parse(failed);
  assert.equal(recovered.messages[0].parts[0].input, null);
  assert.equal(recovered.messages[0].parts[0].rawInput, "{invalid input");
  for (const state of ["input-available", "output-available"]) {
    const invalid = { ...healthy, messages: [...healthy.messages, {
      id: "bad-completed", role: "assistant", parts: [{ type: "tool-createImage", toolCallId: "bad", state,
        input: { operation: "ed", prompt: "Make it blue", referenceIds: ["1111"] }, output: {} }],
    }] };
    assert.equal(conversationSchema.safeParse(invalid).success, false);
    assert.equal(requestSchema.safeParse({ model, messages: [...invalid.messages, healthy.messages[0]] }).success, false);
  }
});

test("one malformed conversation is isolated, raw workspace is backed up, and later saves preserve recovery", async () => {
  const raw = workspace([healthy, { ...healthy, id: "broken", messages: "not messages" }], "broken");
  const storage = memoryStorage(raw);
  const store = await restore(storage);
  assert.deepEqual(store.getSnapshot().conversations, [healthy]);
  assert.equal(store.getSnapshot().activeId, healthy.id);
  assert.equal(storage.getItem(KEY), raw);
  const recovery = [...storage.entries].filter(([key]) => key.startsWith(`${KEY}.recovery.`));
  assert.equal(recovery.length, 1);
  assert.equal(recovery[0][1], raw);
  store.update(healthy.id, { title: "Recovered and renamed" });
  assert.equal(JSON.parse(storage.getItem(KEY)).conversations[0].title, "Recovered and renamed");
  assert.equal(storage.getItem(recovery[0][0]), raw);
});

test("unreadable JSON remains untouched during hydration and has an exact recovery copy", async () => {
  const raw = '{"version":2,"conversations":[';
  const storage = memoryStorage(raw);
  const store = await restore(storage);
  assert.equal(store.getSnapshot().ready, true);
  assert.equal(storage.getItem(KEY), raw);
  assert.equal([...storage.entries.values()].filter((value) => value === raw).length, 2);
});

test("failed recovery backup prevents later edits from overwriting the only saved copy", async () => {
  const raw = workspace([healthy, { broken: true }]);
  const storage = memoryStorage(raw, true);
  const store = await restore(storage);
  store.update(healthy.id, { title: "Memory-only edit" });
  store.create();
  assert.equal(storage.getItem(KEY), raw);
  assert.equal(store.getSnapshot().conversations.find((chat) => chat.id === healthy.id).title, "Memory-only edit");
});

test("storage read failure cannot be followed by a destructive initial write", async () => {
  let writes = 0;
  const store = await restore({ getItem() { throw new Error("Synthetic read failure"); }, setItem() { writes++; } });
  store.create();
  assert.equal(writes, 0);
  assert.equal(store.getSnapshot().ready, true);
});

test("a damaged active selection does not prevent valid chats from loading", async () => {
  const raw = JSON.stringify({ version: 2, activeId: null, conversations: [healthy] });
  const storage = memoryStorage(raw);
  const store = await restore(storage);
  assert.deepEqual(store.getSnapshot().conversations, [healthy]);
  assert.equal(store.getSnapshot().activeId, healthy.id);
  assert.equal(storage.getItem(KEY), raw);
});

test("an empty damaged storage entry is preserved instead of treated as a new installation", async () => {
  const storage = memoryStorage("");
  await restore(storage);
  assert.equal(storage.getItem(KEY), "");
  assert.equal([...storage.entries.keys()].filter((key) => key.startsWith(`${KEY}.recovery.`)).length, 1);
});
