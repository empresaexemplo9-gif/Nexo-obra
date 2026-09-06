import crypto from "crypto";

const COOKIE_NAME = "__Host-session";
const DEFAULT_MAX_AGE = 60 * 60; // 1 hour

type SessionPayload = {
  user: string;
  role: "admin" | "consultant" | string;
  iat: number;
  exp?: number;
};

function base64(input: string) {
  return Buffer.from(input, "utf8").toString("base64");
}
function base64Decode(input: string) {
  return Buffer.from(input, "base64").toString("utf8");
}

function getSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET not set in environment");
  return s;
}

export function signSession(payload: Omit<SessionPayload, "iat">) {
  const body = { ...payload, iat: Math.floor(Date.now() / 1000) };
  const bodyStr = JSON.stringify(body);
  const bodyB64 = base64(bodyStr);
  const hmac = crypto.createHmac("sha256", getSecret()).update(bodyB64).digest("base64");
  // token: body.sig
  return `${bodyB64}.${hmac}`;
}

export function verifySession(token: string | undefined): SessionPayload | null {
  try {
    if (!token) return null;
    const [bodyB64, sig] = token.split(".");
    if (!bodyB64 || !sig) return null;
    const expected = crypto.createHmac("sha256", getSecret()).update(bodyB64).digest("base64");
    // constant-time compare
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    if (a.length !== b.length) return null;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    if (diff !== 0) return null;
    const bodyStr = base64Decode(bodyB64);
    const obj = JSON.parse(bodyStr) as SessionPayload;
    if (obj.exp && Math.floor(Date.now() / 1000) > obj.exp) return null;
    return obj;
  } catch {
    return null;
  }
}

export function createSessionCookie(token: string, maxAge = DEFAULT_MAX_AGE) {
  // __Host- prefix requires Secure and Path=/ and no Domain
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=deleted; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function parseCookieHeader(cookieHeader: string | undefined) {
  if (!cookieHeader) return {} as Record<string, string>;
  return cookieHeader.split(";").map((p) => p.trim()).reduce((acc: Record<string, string>, part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return acc;
    const key = part.slice(0, idx);
    const val = part.slice(idx + 1);
    acc[key] = val;
    return acc;
  }, {} as Record<string, string>);
}
