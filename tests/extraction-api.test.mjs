import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";

// Requires an isolated server with the synthetic provider fixture, never a paid key.
const base = process.env.EXTRACTION_TEST_URL;
if (!base || !["localhost", "127.0.0.1"].includes(new URL(base).hostname) || process.env.EXTRACTION_TEST_FIXTURE !== "yes")
  throw new Error("Set EXTRACTION_TEST_URL to the isolated fixture server and EXTRACTION_TEST_FIXTURE=yes.");
const config = await (await fetch(`${base}/api/config`)).json();
assert.equal(config.extraction, true);
let cookie;
const headers = () => ({ Origin: base, "Content-Type": "application/json", ...(cookie ? { cookie } : {}) });
const post = (url, body, extra = {}) => fetch(`${base}${url}`, { method: "POST", headers: { ...headers(), ...extra }, body: JSON.stringify(body) });
const bytes = Buffer.from("Invoice INV-84729. Supplier Numbase. Total USD 1250.");
let ticket;
let result;
test("HTTP extraction requires an owned ready file and a valid same-origin request", { timeout: 90000 }, async () => {
  const upload = await post("/api/documents", { conversationId: "extraction-http", filename: "invoice.txt", size: bytes.length });
  assert.equal(upload.status, 200, await upload.clone().text());
  cookie = upload.headers.get("set-cookie").split(";")[0];
  ticket = await upload.json();
  assert.equal((await fetch(new URL(ticket.uploadUrl, base), { method: "PUT", headers: { Origin: base, cookie, "Content-Type": "text/plain" }, body: bytes })).status, 204);
  assert.equal((await post(`${ticket.url}/complete`, {})).status, 200);
  let state;
  for (let count = 0; count < 90; count++) {
    state = await (await fetch(`${base}${ticket.url}`, { headers: { cookie } })).json();
    if (state.status === "ready" || state.status === "failed") break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(state.status, "ready", JSON.stringify(state));
  const body = { conversationId: "extraction-http", kind: "invoice" };
  assert.equal((await post(`${ticket.url}/extract`, body, { Origin: "https://untrusted.invalid" })).status, 403);
  assert.equal((await post(`${ticket.url}/extract`, body, { cookie: "" })).status, 404);
  assert.equal((await post(`${ticket.url}/extract`, { ...body, conversationId: "other" })).status, 404);
  assert.equal((await post(`${ticket.url}/extract`, { ...body, kind: "execute-code" })).status, 400);
  const extracted = await post(`${ticket.url}/extract`, body);
  assert.equal(extracted.status, 200, await extracted.clone().text());
  assert.match(extracted.headers.get("cache-control"), /no-store/);
  result = await extracted.json();
  assert.equal(result.data.fields.total.value, "1250");
  assert.equal(result.data.fields.customer.value, null);
  assert.ok(!("owner" in result));
});
test("reviewed JSON/Excel downloads validate shape and ownership without another model call", async () => {
  assert.ok(result);
  const edited = structuredClone(result); edited.data.fields.total.value = "1400"; edited.edited = true;
  const body = { conversationId: "extraction-http", format: "json", result: edited };
  const json = await post(`${ticket.url}/export`, body);
  assert.equal(json.status, 200);
  assert.match(json.headers.get("content-disposition"), /attachment/);
  assert.equal(json.headers.get("x-content-type-options"), "nosniff");
  assert.match(json.headers.get("cache-control"), /private, no-store/);
  const exported = await json.json();
  assert.equal(exported.data.fields.total.value, "1400");
  assert.match(exported.reviewNotice, /may be edited/);
  const xlsx = await post(`${ticket.url}/export`, { ...body, format: "xlsx" });
  assert.equal(xlsx.status, 200);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(await xlsx.arrayBuffer()));
  assert.equal(workbook.getWorksheet("Invoice").getCell("B10").value, "1400");
  assert.equal((await post(`${ticket.url}/export`, body, { cookie: "" })).status, 404);
  assert.equal((await post(`${ticket.url}/export`, { ...body, conversationId: "other" })).status, 404);
  assert.equal((await post(`${ticket.url}/export`, { ...body, result: { ...edited, documentId: crypto.randomUUID() } })).status, 400);
  assert.equal((await post(`${ticket.url}/export`, { ...body, format: "exe" })).status, 400);
  assert.equal((await post(`${ticket.url}/export`, { ...body, result: { ...edited, surprise: "invalid" } })).status, 400);
});
