import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { docxFixture, pdfFixture } from "./document-fixtures.mjs";

const origin = process.env.DOCUMENT_TEST_URL;
if (!origin || !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("Set DOCUMENT_TEST_URL to an isolated loopback development server.");
const config = await (await fetch(`${origin}/api/config`)).json();
assert.equal(config.demo, true, "These HTTP checks must never run against paid provider configuration.");
assert.equal(config.documents, true);
const headers = { origin, "Content-Type": "application/json" };

test("document HTTP routes reject foreign origins and missing ownership", async () => {
  const foreign = await fetch(`${origin}/api/documents`, { method: "POST", headers: { ...headers, origin: "https://untrusted.invalid" }, body: JSON.stringify({ conversationId: "http-check", filename: "test.txt", size: 20 }) });
  assert.equal(foreign.status, 403);
  const missing = await fetch(`${origin}/api/documents/${crypto.randomUUID()}`);
  assert.equal(missing.status, 404);
});

const workbook = new ExcelJS.Workbook();
workbook.addWorksheet("Products").addRows([["Product", "Amount"], ["Barrel", 1250]]);
const fixtures = [
  ["invoice.pdf", "application/pdf", pdfFixture()],
  ["notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", docxFixture()],
  ["report.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Buffer.from(await workbook.xlsx.writeBuffer())],
  ["helper.ts", "text/plain", Buffer.from("export const amount = 1250;\n")],
];
for (const [filename, mediaType, bytes] of fixtures) {
  test(`real upload, background indexing and original download: ${filename}`, { timeout: 45000 }, async () => {
    const created = await fetch(`${origin}/api/documents`, { method: "POST", headers, body: JSON.stringify({ conversationId: `http-${filename}`, filename, size: bytes.length }) });
    assert.equal(created.status, 200, await created.clone().text());
    const cookie = created.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const ticket = await created.json();
    const uploaded = await fetch(`${origin}${ticket.uploadUrl}`, { method: "PUT", headers: { origin, cookie, "Content-Type": mediaType }, body: bytes });
    assert.equal(uploaded.status, 204, await uploaded.text());
    const complete = () => fetch(`${origin}${ticket.url}/complete`, { method: "POST", headers: { ...headers, cookie }, body: "{}" });
    const completions = await Promise.all([complete(), complete()]);
    assert.ok(completions.every((response) => response.status === 200));
    let result;
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await fetch(`${origin}${ticket.url}`, { headers: { cookie } });
      assert.equal(response.status, 200);
      result = await response.json();
      if (result.status === "ready" || result.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.equal(result.status, "ready", result.error);
    assert.equal(result.indexed, result.chunkCount);
    assert.ok(result.chunkCount > 0);
    assert.equal("owner" in result, false);
    const download = await fetch(`${origin}${ticket.url}?download=1`, { headers: { cookie } });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("X-Content-Type-Options"), "nosniff");
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    assert.equal((await fetch(`${origin}${ticket.url}`)).status, 404);
  });
}
