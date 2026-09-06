import { env } from "cloudflare:workers";

type RuntimeEnv = {
  MAINTENANCE_ADMIN_EMAIL?: string;
  MAINTENANCE_ADMIN_PASSWORD_HASH?: string;
  MAINTENANCE_ADMIN_SESSION_SECRET?: string;
};

const COOKIE = "__Host-nexo-maintenance";
export const MAINTENANCE_ORGANIZATION_ID = "00000000-0000-4000-9000-000000000001";
const DURATION_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();

function config() {
  const runtime = env as unknown as RuntimeEnv;
  if (!runtime.MAINTENANCE_ADMIN_EMAIL || !runtime.MAINTENANCE_ADMIN_PASSWORD_HASH || !runtime.MAINTENANCE_ADMIN_SESSION_SECRET) return null;
  return {
    email: runtime.MAINTENANCE_ADMIN_EMAIL.trim().toLowerCase(),
    passwordHash: runtime.MAINTENANCE_ADMIN_PASSWORD_HASH,
    secret: runtime.MAINTENANCE_ADMIN_SESSION_SECRET,
  };
}

export async function verifyMaintenanceCredentials(email: string, password: string) {
  const current = config();
  if (!current) return false;
  const [validEmail, validPassword] = await Promise.all([
    equalDigest(email.trim().toLowerCase(), current.email),
    passwordMatches(password, current.passwordHash),
  ]);
  return validEmail && validPassword;
}

export async function createMaintenanceSessionCookie() {
  const current = config();
  if (!current) throw new Error("maintenance_not_configured");
  const expiresAt = Math.floor(Date.now() / 1000) + DURATION_SECONDS;
  const payload = toBase64Url(encoder.encode(JSON.stringify({ sub: current.email, exp: expiresAt })));
  const signature = await sign(payload, current.secret);
  return {
    cookie: `${COOKIE}=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${DURATION_SECONDS}`,
    expiresAt,
    email: current.email,
  };
}

export function clearMaintenanceSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function readMaintenanceIdentity(request: Request) {
  const current = config();
  const token = readCookie(request, COOKIE);
  if (!current || !token) return null;
  const [payload, signature, ...extra] = token.split(".");
  if (!payload || !signature || extra.length || !await verifySignature(payload, signature, current.secret)) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as { sub?: unknown; exp?: unknown };
    if (parsed.sub !== current.email || typeof parsed.exp !== "number" || parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    return { id: "nexo-maintenance-admin", email: current.email, displayName: "Administrador de manutenção", expiresAt: parsed.exp, scope: "maintenance" as const };
  } catch { return null; }
}

function parseHash(value: string) {
  const [algorithm, iterationsText, saltText, digestText] = value.split("$");
  const iterations = Number(iterationsText);
  if (algorithm !== "pbkdf2-sha256" || iterations !== 100_000) return null;
  try { return { iterations, salt: fromBase64Url(saltText), digest: fromBase64Url(digestText) }; }
  catch { return null; }
}

async function passwordMatches(password: string, encoded: string) {
  const parsed = parseHash(encoded);
  if (!parsed) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: ownedBuffer(parsed.salt), iterations: parsed.iterations },
    key,
    parsed.digest.byteLength * 8,
  );
  return constantTimeEqual(new Uint8Array(bits), parsed.digest);
}

async function equalDigest(left: string, right: string) {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  return constantTimeEqual(new Uint8Array(a), new Uint8Array(b));
}

async function sign(payload: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
}

async function verifySignature(payload: string, signature: string, secret: string) {
  try {
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify("HMAC", key, ownedBuffer(fromBase64Url(signature)), encoder.encode(payload));
  } catch { return false; }
}

function readCookie(request: Request, name: string) {
  for (const item of (request.headers.get("cookie") ?? "").split(";")) {
    const [candidate, ...value] = item.trim().split("=");
    if (candidate === name) return value.join("=");
  }
  return null;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  let mismatch = 0;
  for (let index = 0; index < left.byteLength; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

function ownedBuffer(value: Uint8Array) { return Uint8Array.from(value).buffer; }
function toBase64Url(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function fromBase64Url(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
