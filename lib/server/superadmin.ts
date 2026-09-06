import { env } from "cloudflare:workers";

import { ApiError } from "@/lib/server/backend";

type SuperAdminRuntimeEnv = {
  SUPERADMIN_EMAIL?: string;
  SUPERADMIN_PASSWORD_HASH?: string;
  SUPERADMIN_SESSION_SECRET?: string;
};

type PasswordHash = {
  iterations: number;
  salt: Uint8Array;
  digest: Uint8Array;
};

const SESSION_COOKIE = "__Host-nexo-superadmin";
const SESSION_DURATION_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();

function runtimeEnv() {
  return env as unknown as SuperAdminRuntimeEnv;
}

function requiredConfig() {
  const config = runtimeEnv();
  if (!config.SUPERADMIN_EMAIL || !config.SUPERADMIN_PASSWORD_HASH || !config.SUPERADMIN_SESSION_SECRET) {
    throw new ApiError(
      503,
      "superadmin_not_configured",
      "O acesso administrativo ainda não foi configurado.",
    );
  }
  return {
    email: config.SUPERADMIN_EMAIL,
    passwordHash: config.SUPERADMIN_PASSWORD_HASH,
    sessionSecret: config.SUPERADMIN_SESSION_SECRET,
  };
}

function parsePasswordHash(value: string): PasswordHash | null {
  const [algorithm, iterationsText, saltText, digestText] = value.split("$");
  const iterations = Number(iterationsText);
  if (algorithm !== "pbkdf2-sha256" || iterations !== 100_000) return null;
  try {
    return {
      iterations,
      salt: fromBase64Url(saltText),
      digest: fromBase64Url(digestText),
    };
  } catch {
    return null;
  }
}

async function passwordMatches(password: string, encodedHash: string) {
  const parsed = parsePasswordHash(encodedHash);
  if (!parsed) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: ownedBuffer(parsed.salt), iterations: parsed.iterations },
    key,
    parsed.digest.byteLength * 8,
  );
  return constantTimeEqual(new Uint8Array(bits), parsed.digest);
}

async function emailMatches(email: string, expected: string) {
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(email.trim().toLowerCase())),
    crypto.subtle.digest("SHA-256", encoder.encode(expected.trim().toLowerCase())),
  ]);
  return constantTimeEqual(new Uint8Array(actualDigest), new Uint8Array(expectedDigest));
}

export async function verifySuperAdminCredentials(email: string, password: string) {
  const config = requiredConfig();
  const [validEmail, validPassword] = await Promise.all([
    emailMatches(email, config.email),
    passwordMatches(password, config.passwordHash),
  ]);
  return validEmail && validPassword;
}

export async function createSuperAdminSessionCookie() {
  const { email, sessionSecret } = requiredConfig();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS;
  const payload = toBase64Url(encoder.encode(JSON.stringify({ sub: email, exp: expiresAt })));
  const signature = await sign(payload, sessionSecret);
  return {
    cookie: `${SESSION_COOKIE}=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DURATION_SECONDS}`,
    expiresAt,
  };
}

export function clearSuperAdminSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function requireSuperAdmin(request: Request) {
  const config = requiredConfig();
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) throw new ApiError(401, "superadmin_sign_in_required", "Entre como superadministrador.");
  const [payload, signature, ...extra] = token.split(".");
  if (!payload || !signature || extra.length || !await verifySignature(payload, signature, config.sessionSecret)) {
    throw new ApiError(401, "invalid_superadmin_session", "Sua sessão administrativa é inválida.");
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as { sub?: unknown; exp?: unknown };
    if (parsed.sub !== config.email || typeof parsed.exp !== "number" || parsed.exp <= Math.floor(Date.now() / 1000)) {
      throw new Error("expired");
    }
    return { email: config.email, expiresAt: parsed.exp };
  } catch {
    throw new ApiError(401, "invalid_superadmin_session", "Sua sessão administrativa expirou.");
  }
}

export function rejectCrossSiteMutation(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ApiError(403, "cross_site_request", "A solicitação administrativa foi bloqueada.");
  }
}

export async function loginFingerprint(request: Request) {
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const agent = request.headers.get("user-agent") ?? "unknown";
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${ip.trim()}|${agent.slice(0, 180)}`));
  return toBase64Url(new Uint8Array(digest));
}

async function sign(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
}

async function verifySignature(payload: string, signature: string, secret: string) {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify("HMAC", key, ownedBuffer(fromBase64Url(signature)), encoder.encode(payload));
  } catch {
    return false;
  }
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

function ownedBuffer(value: Uint8Array) {
  return Uint8Array.from(value).buffer;
}

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
