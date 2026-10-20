import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { RequestError } from "./request.ts";

const COOKIE = "numbase.media-session";
let localSecret: string | undefined;
const TTL = 90 * 24 * 60 * 60;
function secret() {
  const value = process.env.NUMBASE_SESSION_SECRET;
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV === "production")
    throw new RequestError("Private image storage is not configured yet.", 503);
  if (!localSecret) {
    const directory = process.env.NUMBASE_MEDIA_DIRECTORY ?? path.join(process.cwd(), ".local-media");
    mkdirSync(directory, { recursive: true });
    const filename = path.join(directory, "session.key");
    try { writeFileSync(filename, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    localSecret = readFileSync(filename, "utf8");
  }
  return localSecret;
}
export function signSession(id: string, expires = Math.floor(Date.now() / 1000) + TTL) {
  const payload = `${id}.${expires}`;
  return `${payload}.${createHmac("sha256", secret()).update(payload).digest("base64url")}`;
}
export function verifySession(token: string, now = Date.now()): string | undefined {
  const [id, expires, signature, extra] = token.split(".");
  if (extra || !/^[a-f0-9-]{36}$/i.test(id ?? "") || !/^\d+$/.test(expires ?? "") || !signature)
    return;
  if (Number(expires) <= now / 1000) return;
  const expected = signSession(id, Number(expires)).split(".")[2];
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b) ? id : undefined;
}
export function mediaSession(request: Request, create = false) {
  const token = request.headers.get("cookie")?.split(";").map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const existing = token && verifySession(token);
  if (existing) return { owner: existing, cookie: undefined };
  if (!create) throw new RequestError("This image is unavailable in this browser session.", 404);
  const owner = crypto.randomUUID();
  return {
    owner,
    cookie: `${COOKIE}=${signSession(owner)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TTL}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  };
}
