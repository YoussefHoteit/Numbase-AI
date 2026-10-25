import test from "node:test";
import assert from "node:assert/strict";
const base = process.env.COMPLETION_TEST_URL;
if (!base || !["localhost", "127.0.0.1"].includes(new URL(base).hostname) || process.env.COMPLETION_TEST_FIXTURE !== "yes") throw new Error("Use the isolated synthetic completion fixture only.");
let cookie, ticket, jobId;
const chat = "completion-http";
const headers = () => ({ Origin: base, "Content-Type": "application/json", ...(cookie ? { cookie } : {}) });
const post = (path, body, extra = {}) => fetch(base + path, { method: "POST", headers: { ...headers(), ...extra }, body: JSON.stringify(body) });
const get = (path, extra = {}) => fetch(base + path, { headers: { ...(cookie ? { cookie } : {}), ...extra } });

test("complete summaries run through real HTTP and Workflow steps with synthetic providers", { timeout: 90000 }, async () => {
  const config = await (await get("/api/config")).json(); assert.equal(config.summaries, true); assert.equal(config.lifecycle, true);
  const bytes = Buffer.from(Array.from({ length: 200 }, (_, i) => `Section ${i + 1}: START-2410. ${"source words ".repeat(30)} END-2410.`).join("\n"));
  const created = await post("/api/documents", { conversationId: chat, filename: "completion.md", size: bytes.length });
  assert.equal(created.status, 200); cookie = created.headers.get("set-cookie").split(";")[0]; ticket = await created.json();
  assert.equal((await fetch(base + ticket.uploadUrl, { method: "PUT", headers: { Origin: base, cookie, "Content-Type": "text/plain" }, body: bytes })).status, 204);
  assert.equal((await post(ticket.url + "/complete", {})).status, 200);
  let status;
  for (let i = 0; i < 120; i++) { status = await (await get(ticket.url)).json(); if (["ready", "failed"].includes(status.status)) break; await new Promise((r) => setTimeout(r, 250)); }
  assert.equal(status.status, "ready", JSON.stringify(status));
  assert.ok(status.chunkCount > 12);
  assert.equal((await post(ticket.url + "/summary", { conversationId: chat, action: "start" }, { Origin: "https://untrusted.invalid" })).status, 403);
  assert.equal((await post(ticket.url + "/summary", { conversationId: "wrong", action: "start" })).status, 404);
  const started = await post(ticket.url + "/summary", { conversationId: chat, action: "start" });
  assert.equal(started.status, 200, await started.clone().text()); jobId = (await started.json()).id;
  for (let i = 0; i < 120; i++) { status = await (await get(ticket.url + "/summary?conversationId=" + chat)).json(); if (["ready", "failed"].includes(status.status)) break; await new Promise((r) => setTimeout(r, 250)); }
  assert.equal(status.status, "ready", JSON.stringify(status)); assert.equal(status.completedSections, status.totalSections); assert.match(status.result, /END-2410/);
  assert.ok(!("notes" in status)); assert.ok(!("owner" in status));
  assert.equal((await (await post(ticket.url + "/summary", { conversationId: chat, action: "start" })).json()).id, jobId);
  const response = await get(ticket.url + "/summary?conversationId=" + chat, { cookie: "" }); assert.equal(response.status, 404);
});

test("HTTP file management preserves history references and restores the private original", async () => {
  const before = Buffer.from(await (await get(ticket.url + "?download=1")).arrayBuffer());
  assert.equal((await get("/api/documents/manage", { cookie: "" })).status, 404);
  const list = await (await get("/api/documents/manage")).json(); assert.ok(list.files.some((file) => file.id === ticket.id));
  const change = { documentId: ticket.id, conversationId: chat, removed: true };
  assert.equal((await post("/api/documents/manage", change, { Origin: "https://untrusted.invalid" })).status, 403);
  assert.equal((await post("/api/documents/manage", { ...change, conversationId: "wrong" })).status, 404);
  assert.equal((await post("/api/documents/manage", change)).status, 200);
  assert.equal((await (await get(ticket.url)).json()).status, "removed");
  assert.equal((await get(ticket.url + "?download=1")).status, 410);
  assert.equal((await get(ticket.url + "/summary?conversationId=" + chat)).status, 410);
  assert.equal((await post("/api/documents/manage", { ...change, removed: false })).status, 200);
  const after = Buffer.from(await (await get(ticket.url + "?download=1")).arrayBuffer()); assert.deepEqual(after, before);
  assert.equal((await (await get(ticket.url + "/summary?conversationId=" + chat)).json()).status, "ready");
});

test("range extraction from a large file reports selected source coverage", async () => {
  const response = await post(ticket.url + "/extract", { conversationId: chat, kind: "invoice", range: { start: 13, end: 14 } });
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json(); assert.equal(result.scope.start, 13); assert.equal(result.scope.end, 14); assert.equal(result.scope.complete, false);
  assert.equal(result.sources[0].index, 12);
});
