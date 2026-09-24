import { getDatabase } from "@/db";
import { ApiError } from "@/lib/server/api-error";
import { ensureLoginAttemptsTable } from "@/lib/server/migrations";
import { runtimeEnv } from "@/lib/server/runtime";

// Autenticação própria da plataforma.
//
// Substitui a identidade que vinha dos cabeçalhos `oai-authenticated-user-*`. Aqueles
// cabeçalhos só são confiáveis atrás de uma borda que os sobrescreva; em qualquer outra
// hospedagem, um visitante podia enviá-los e se passar por outra pessoa. Aqui a identidade
// vem de um cookie assinado pelo servidor, emitido só depois de conferir a senha.
//
// O formato de senha e a assinatura da sessão são os mesmos já usados pelo
// superadministrador: PBKDF2-SHA256 com 100.000 iterações e HMAC-SHA256 no cookie.

const SESSION_COOKIE = "__Host-nexo-session";
const SESSION_DURATION_SECONDS = 12 * 60 * 60;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const encoder = new TextEncoder();

export type SessionUser = { id: string; email: string; displayName: string };

function sessionSecret() {
  const env = runtimeEnv();
  // Sem segredo não há sessão: melhor recusar do que emitir cookie que qualquer um forja.
  const secret = env.SESSION_SECRET ?? env.SUPERADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new ApiError(
      503,
      "session_secret_missing",
      "A autenticação da plataforma não está configurada: defina SESSION_SECRET com pelo menos 32 caracteres.",
    );
  }
  return secret;
}

// ---------------------------------------------------------------------------
// Senha
// ---------------------------------------------------------------------------

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: ownedBuffer(salt), iterations: 100_000 }, key, 256,
  );
  // Dois-pontos como separador: painéis de publicação expandem "$" e mutilam o valor.
  return `pbkdf2-sha256:100000:${toBase64Url(salt)}:${toBase64Url(new Uint8Array(bits))}`;
}

export async function passwordMatches(password: string, stored: string) {
  const parts = stored.trim().replace(/^['"]|['"]$/g, "").split(stored.includes(":") ? ":" : "$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256" || Number(parts[1]) !== 100_000) return false;
  try {
    const salt = fromBase64Url(parts[2]);
    const digest = fromBase64Url(parts[3]);
    if (salt.byteLength < 8 || digest.byteLength < 16) return false;
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: ownedBuffer(salt), iterations: 100_000 }, key, digest.byteLength * 8,
    );
    return constantTimeEqual(new Uint8Array(bits), digest);
  } catch {
    return false;
  }
}

export function assertPasswordStrength(password: string) {
  if (password.length < 10) {
    throw new ApiError(400, "weak_password", "Use uma senha com pelo menos 10 caracteres.");
  }
}

// ---------------------------------------------------------------------------
// Sessão
// ---------------------------------------------------------------------------

export async function createSessionCookie(user: SessionUser) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS;
  const payload = toBase64Url(encoder.encode(JSON.stringify({
    sub: user.id, email: user.email, name: user.displayName, exp: expiresAt,
  })));
  const signature = await sign(payload, sessionSecret());
  return {
    // SameSite=Lax porque o acesso chega por link de convite, uma navegação de outro site.
    cookie: `${SESSION_COOKIE}=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DURATION_SECONDS}`,
    expiresAt,
  };
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function readSessionUser(request: Request): Promise<SessionUser | null> {
  let secret: string;
  try { secret = sessionSecret(); } catch { return null; }
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const [payload, signature, ...extra] = token.split(".");
  if (!payload || !signature || extra.length) return null;
  if (!await verifySignature(payload, signature, secret)) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as {
      sub?: unknown; email?: unknown; name?: unknown; exp?: unknown;
    };
    if (typeof parsed.sub !== "string" || typeof parsed.email !== "string") return null;
    if (typeof parsed.exp !== "number" || parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    return {
      id: parsed.sub,
      email: parsed.email,
      displayName: typeof parsed.name === "string" && parsed.name ? parsed.name : parsed.email,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

type CredentialRow = { user_id: string; email: string; password_hash: string; display_name: string; active: number };

// Mesma proteção do portão administrativo: cinco erros na mesma origem bloqueiam por
// quinze minutos, e o bloqueio vale até para a senha correta.
export async function signIn(request: Request, email: string, password: string) {
  const db = getDatabase();
  await ensureLoginAttemptsTable(db);
  const normalized = email.trim().toLowerCase();
  const fingerprint = `user:${normalized}:${await originFingerprint(request)}`;
  const now = Date.now();

  const attempt = await db.prepare(
    "SELECT failed_count, window_started_at, locked_until FROM superadmin_login_attempts WHERE fingerprint = ?1",
  ).bind(fingerprint).first<{ failed_count: number; window_started_at: number; locked_until: number }>();
  if (attempt && attempt.locked_until > now) {
    throw new ApiError(429, "sign_in_locked", "Muitas tentativas. Aguarde 15 minutos e tente novamente.");
  }

  const credential = await db.prepare(
    "SELECT user_id, email, password_hash, display_name, active FROM user_credentials WHERE email = ?1",
  ).bind(normalized).first<CredentialRow>();

  const valid = credential?.active === 1 && await passwordMatches(password, credential.password_hash);
  if (!valid) {
    const withinWindow = attempt && now - attempt.window_started_at < LOCK_WINDOW_MS;
    const failedCount = withinWindow ? attempt.failed_count + 1 : 1;
    await db.prepare(
      `INSERT INTO superadmin_login_attempts (fingerprint, failed_count, window_started_at, locked_until, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(fingerprint) DO UPDATE SET
       failed_count = excluded.failed_count, window_started_at = excluded.window_started_at,
       locked_until = excluded.locked_until, updated_at = excluded.updated_at`,
    ).bind(fingerprint, failedCount, withinWindow ? attempt.window_started_at : now,
      failedCount >= MAX_ATTEMPTS ? now + LOCK_WINDOW_MS : 0, now).run();
    // A mesma mensagem para e-mail inexistente e senha errada: não revela quem existe.
    throw new ApiError(401, "invalid_credentials", "E-mail ou senha inválidos.");
  }

  await db.prepare("DELETE FROM superadmin_login_attempts WHERE fingerprint = ?1").bind(fingerprint).run();
  return { id: credential.user_id, email: credential.email, displayName: credential.display_name };
}

// Cria a senha de quem aceita um convite pela primeira vez. NUNCA sobrescreve: se o e-mail
// já tem credencial, nada muda. Sobrescrever permitia a quem emite um convite para o e-mail
// de outra pessoa trocar a senha dela pelo link.
export function saveCredentialStatement(
  db: D1Database,
  user: { id: string; email: string; displayName: string },
  passwordHash: string,
  now = Date.now(),
) {
  return db.prepare(
    `INSERT INTO user_credentials (user_id, email, password_hash, display_name, active, password_updated_at, created_at)
     VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)
     ON CONFLICT(email) DO NOTHING`,
  ).bind(user.id, user.email.trim().toLowerCase(), passwordHash, user.displayName, now);
}

export async function credentialExists(email: string) {
  const row = await getDatabase().prepare("SELECT user_id FROM user_credentials WHERE email = ?1 AND active = 1")
    .bind(email.trim().toLowerCase()).first<{ user_id: string }>();
  return row?.user_id ?? null;
}

async function originFingerprint(request: Request) {
  const ip = request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]
    ?? request.headers.get("x-real-ip")
    ?? "unknown";
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(ip.trim()));
  return toBase64Url(new Uint8Array(digest)).slice(0, 22);
}

async function sign(payload: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
}

async function verifySignature(payload: string, signature: string, secret: string) {
  try {
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
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

function ownedBuffer(value: Uint8Array) { return Uint8Array.from(value).buffer; }

function toBase64Url(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}
