const MAX_BYTES = 128_000;
export class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function readChatBody(request: Request): Promise<unknown> {
  const origin = request.headers.get("origin");
  let sameOrigin = false;
  try {
    const source = new URL(origin ?? "");
    // Next.js may normalize request.url to localhost behind a listener or proxy.
    // Compare against the incoming Host, never a client-supplied forwarded host.
    sameOrigin = source.host === request.headers.get("host") && ["http:", "https:"].includes(source.protocol);
  } catch { /* Missing or malformed origins are rejected. */ }
  if (!sameOrigin) throw new RequestError("This request is not allowed.", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new RequestError("Send a JSON request.", 415);
  if (Number(request.headers.get("content-length")) > MAX_BYTES) throw new RequestError("This conversation is too large. Start a new chat.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError("A message is required.", 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new RequestError("This conversation is too large. Start a new chat.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new RequestError("The request contains invalid JSON.", 400); }
}
// Per-process protection; public deployments also need authentication and a shared limiter.
const requests: number[] = [];
export function takeRequestSlot(now = Date.now()) {
  while (requests.length && requests[0] <= now - 60_000) requests.shift();
  if (requests.length >= 20) return false;
  requests.push(now); return true;
}
