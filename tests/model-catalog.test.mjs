import test from "node:test";
import assert from "node:assert/strict";
import { MODELS, LEGACY_MODELS, findModel } from "../src/lib/models.ts";
import { conversationSchema, requestSchema } from "../src/lib/chat-schema.ts";

test("the selector offers four budget models from four providers", () => {
  assert.equal(MODELS.length, 4);
  assert.equal(new Set(MODELS.map(model => model.provider)).size, 4);
  assert.ok(MODELS.some(model => model.id === "openai/gpt-4.1-mini"));
  for (const model of LEGACY_MODELS) assert.ok(!MODELS.some(active => active.id === model.id));
});

test("saved conversations migrate their selected model without changing history or labels", () => {
  const replacements = ["anthropic/claude-haiku-4.5", "google/gemini-2.5-flash-lite", "mistralai/mistral-small-3.2-24b-instruct"];
  LEGACY_MODELS.forEach((old, index) => {
    const saved = {
      id: "saved-chat", title: "Project Cedar", model: old.id, updatedAt: 1,
      messages: [
        {id:"user",role:"user",parts:[{type:"text",text:"Remember Cedar."}]},
        {id:"assistant",role:"assistant",parts:[{type:"text",text:"I remember Cedar."}],metadata:{modelId:old.id,demo:false,createdAt:1}},
      ],
    };
    const restored = conversationSchema.parse(saved);
    assert.equal(restored.model, replacements[index]);
    assert.deepEqual(restored.messages, saved.messages);
    assert.equal(restored.messages[1].metadata.modelId, old.id);
    assert.equal(findModel(restored.messages[1].metadata.modelId).name, old.name);
    assert.equal(saved.model, old.id, "parsing must not mutate the source");
  });
});

test("retired models cannot be selected for new provider requests", () => {
  const messages = [{id:"user",role:"user",parts:[{type:"text",text:"Hello"}]}];
  for (const model of LEGACY_MODELS) assert.equal(requestSchema.safeParse({model:model.id,messages}).success, false);
  for (const model of MODELS) assert.equal(requestSchema.safeParse({model:model.id,messages}).success, true);
});

test("new requests retain historical response metadata and full text history", () => {
  const messages = [
    {id:"u1",role:"user",parts:[{type:"text",text:"Our codename is Cedar."}]},
    {id:"a1",role:"assistant",parts:[{type:"text",text:"Understood."}],metadata:{modelId:"anthropic/claude-sonnet-4.5",demo:false,createdAt:1}},
    {id:"u2",role:"user",parts:[{type:"text",text:"What is our codename?"}]},
  ];
  const request = requestSchema.parse({model:"mistralai/mistral-small-3.2-24b-instruct",messages});
  assert.deepEqual(request.messages, messages);
});
