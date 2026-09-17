import { getDatabase } from "@/db";

import { cifrarSegredo, decifrarSegredo } from "@/lib/server/segredos";

// Credenciais da Drap guardadas por empresa, cifradas.
//
// Antes elas viviam só em `DRAP_TENANTS_JSON`, no ambiente de publicação. Isso funciona
// para um punhado de empresas configuradas à mão e deixa de funcionar no instante em que a
// plataforma passa a PROVISIONAR empresas: a chave chega numa resposta HTTP, uma vez só, e
// exigir um deploy para guardá-la anularia o motivo de existir do provisionamento.
//
// O ambiente continua tendo precedência. Quem já configurou à mão não muda de caminho por
// causa desta tabela, e um segredo trocado no painel continua vencendo o que está no
// banco — que é o que se espera de uma configuração de emergência.

type LinhaCredencial = { api_token_encrypted: string | null; webhook_secret_encrypted: string | null };

async function linha(externalCompanyId: string): Promise<LinhaCredencial | null> {
  if (!externalCompanyId) return null;
  const db = getDatabase();
  return db
    .prepare(
      `SELECT api_token_encrypted, webhook_secret_encrypted
       FROM integration_connections
       WHERE provider = 'drap' AND external_company_id = ?1
       LIMIT 1`,
    )
    .bind(externalCompanyId)
    .first<LinhaCredencial>();
}

/** Token de operação desta empresa, decifrado. `null` quando não há — ou quando o
 *  envelope não abre com a chave atual, que para quem chama dá no mesmo: não dá pra
 *  falar com a Drap por esta empresa. */
export async function tokenGuardado(externalCompanyId: string): Promise<string | null> {
  const row = await linha(externalCompanyId);
  if (!row?.api_token_encrypted) return null;
  return decifrarSegredo(row.api_token_encrypted);
}

/** Segredo com que a Drap assina os webhooks desta empresa. */
export async function segredoDeWebhookGuardado(externalCompanyId: string): Promise<string | null> {
  const row = await linha(externalCompanyId);
  if (!row?.webhook_secret_encrypted) return null;
  return decifrarSegredo(row.webhook_secret_encrypted);
}

/**
 * Grava (ou substitui) a conexão da organização com a empresa na Drap.
 *
 * Devolve as instruções prontas para o `batch` de quem chama, e não executa: a conexão e
 * o registro de auditoria precisam entrar juntos. Gravar a credencial e perder a
 * auditoria deixaria uma chave no banco sem ninguém saber quem a pôs lá.
 */
export async function instrucoesParaGuardarCredenciais(entrada: {
  db: ReturnType<typeof getDatabase>;
  id: string;
  organizationId: string;
  externalCompanyId: string;
  token: string | null;
  webhookSecret?: string | null;
  origem: "provisionado" | "vinculado";
}) {
  const tokenCifrado = entrada.token ? await cifrarSegredo(entrada.token) : null;
  const segredoCifrado = entrada.webhookSecret ? await cifrarSegredo(entrada.webhookSecret) : null;

  return entrada.db.prepare(
    `INSERT INTO integration_connections (
       id, organization_id, provider, external_company_id, status, last_synced_at, last_error,
       api_token_encrypted, webhook_secret_encrypted, origem, created_at, updated_at
     ) VALUES (?1, ?2, 'drap', ?3, 'active', CURRENT_TIMESTAMP, NULL, ?4, ?5, ?6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(organization_id, provider) DO UPDATE SET
       external_company_id = excluded.external_company_id,
       status = 'active',
       last_synced_at = CURRENT_TIMESTAMP,
       last_error = NULL,
       -- COALESCE: repetir o provisionamento devolve a empresa sem a chave (a Drap não
       -- mostra a mesma duas vezes). Sobrescrever com NULL apagaria a credencial que
       -- está funcionando.
       api_token_encrypted = COALESCE(excluded.api_token_encrypted, integration_connections.api_token_encrypted),
       webhook_secret_encrypted = COALESCE(excluded.webhook_secret_encrypted, integration_connections.webhook_secret_encrypted),
       origem = excluded.origem,
       updated_at = CURRENT_TIMESTAMP`,
  ).bind(
    entrada.id,
    entrada.organizationId,
    entrada.externalCompanyId,
    tokenCifrado,
    segredoCifrado,
    entrada.origem,
  );
}
