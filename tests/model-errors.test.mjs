import test from "node:test";
import assert from "node:assert/strict";
import { modelErrorMessage } from "../src/lib/server/model-errors.ts";

test("rate limits and unavailable models have actionable messages", () => {
  assert.match(modelErrorMessage({ statusCode: 429 }), /rate-limited/);
  assert.match(modelErrorMessage({ statusCode: 404 }), /unavailable/);
  assert.match(modelErrorMessage({ statusCode: 503 }), /unavailable/);
  assert.match(modelErrorMessage({ statusCode: 504 }), /too long/);
});
test("wrapped retry errors retain a safe explanation", () => {
  assert.match(
    modelErrorMessage({ lastError: { statusCode: 429 } }),
    /rate-limited/,
  );
  assert.match(
    modelErrorMessage({ cause: { name: "TimeoutError" } }),
    /too long/,
  );
});
test("provider failures never disclose upstream details", () => {
  const detail = "private-upstream-detail";
  for (const statusCode of [400, 401, 402, 403, 404, 429, 500, 503, 504]) {
    assert.ok(
      !modelErrorMessage({
        statusCode,
        message: detail,
        responseBody: detail,
      }).includes(detail),
    );
  }
  assert.match(modelErrorMessage(null), /could not respond/);
  const cycle = {};
  cycle.cause = cycle;
  assert.match(modelErrorMessage(cycle), /could not respond/);
});
