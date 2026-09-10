import "server-only";

import { headers } from "next/headers";

import { chatGPTSignInPath, chatGPTSignOutPath } from "@/app/chatgpt-auth";

/**
 * Fronteira de identidade.
 *
 * Só este arquivo sabe COMO o usuário foi autenticado. Todo o resto do produto
 * consome `resolveIdentity()` e recebe sempre a mesma forma. Trocar de provedor
 * (host da plataforma, e-mail e senha próprios, SSO) é editar este arquivo, não
 * espalhar `headers()` por rotas e telas.
 *
 * `subject` é a chave estável gravada em `members.external_user_id`. Ela precisa
 * ser imutável para o usuário: se o provedor passar a expor um ID próprio,
 * migre a coluna em vez de trocar o significado do campo.
 */

export type Identity = {
  /** Chave estável do usuário no provedor. Vai para `members.external_user_id`. */
  subject: string;
  email: string;
  fullName: string | null;
  displayName: string;
  provider: "platform" | "dev";
};

const PLATFORM_EMAIL_HEADER = "oai-authenticated-user-email";
const PLATFORM_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const PLATFORM_FULL_NAME_ENCODING_HEADER = "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Identidade injetada pelo host de hospedagem. Os headers `oai-*` são
 * adicionados pela borda autenticada e não podem ser falsificados pelo
 * navegador; se este projeto passar a rodar atrás de outro proxy, esta função
 * precisa ser trocada junto.
 */
function fromPlatformHeaders(requestHeaders: Headers): Identity | null {
  const email = requestHeaders.get(PLATFORM_EMAIL_HEADER);
  if (!email?.trim()) return null;

  const encodedFullName = requestHeaders.get(PLATFORM_FULL_NAME_HEADER);
  const fullName =
    encodedFullName &&
    requestHeaders.get(PLATFORM_FULL_NAME_ENCODING_HEADER) === PERCENT_ENCODED_UTF8
      ? safeDecodeURIComponent(encodedFullName)
      : null;

  const normalized = normalizeEmail(email);
  return {
    subject: normalized,
    email: normalized,
    fullName,
    displayName: fullName ?? normalized,
    provider: "platform",
  };
}

/**
 * Identidade de desenvolvimento, habilitada apenas por variável de ambiente.
 *
 * Existe para que o fluxo autenticado possa ser exercitado localmente e nos
 * testes sem depender do host. Nunca é consultada quando o provedor real já
 * respondeu, e a checagem de produção abaixo impede que ela vaze.
 */
function fromDevEnvironment(env: Record<string, string | undefined>): Identity | null {
  if (env.NODE_ENV === "production" && env.NEXO_ALLOW_DEV_LOGIN !== "true") return null;

  const email = env.NEXO_DEV_USER_EMAIL;
  if (!email?.trim()) return null;

  const normalized = normalizeEmail(email);
  return {
    subject: normalized,
    email: normalized,
    fullName: env.NEXO_DEV_USER_NAME ?? null,
    displayName: env.NEXO_DEV_USER_NAME ?? normalized,
    provider: "dev",
  };
}

/** Fonte de ambiente separada para o teste conseguir injetar valores. */
export function resolveIdentityFrom(
  requestHeaders: Headers,
  env: Record<string, string | undefined>,
): Identity | null {
  return fromPlatformHeaders(requestHeaders) ?? fromDevEnvironment(env);
}

export async function resolveIdentity(): Promise<Identity | null> {
  return resolveIdentityFrom(await headers(), process.env);
}

/**
 * Caminhos de entrada e saída do provedor atual.
 *
 * Reexportados daqui para que as telas importem a fronteira de identidade, e não
 * o detalhe da plataforma. Ao trocar de provedor, troque estas duas linhas junto
 * com `fromPlatformHeaders` — nenhum componente precisa mudar.
 */
export { chatGPTSignInPath as signInPath, chatGPTSignOutPath as signOutPath };
