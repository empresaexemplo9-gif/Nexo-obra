import type { PermissionModule } from "@/lib/permissions";
import { lerModulosHabilitados, marcaPadrao, type MarcaDaEmpresa } from "@/lib/empresa-config";

/**
 * As três tabelas desta configuração chegam por migração aditiva, aplicada de hora em
 * hora. Entre a publicação do código e essa aplicação, elas ainda não existem. Nesse
 * intervalo a plataforma responde como antes delas: todos os módulos, marca padrão,
 * nenhuma delegação. Só a ausência da tabela é tolerada; qualquer outro erro sobe.
 */
function tabelaAusente(error: unknown) {
  for (let atual: unknown = error, passo = 0; atual && passo < 5; passo += 1) {
    if (/no such table/i.test(atual instanceof Error ? atual.message : String(atual))) return true;
    atual = atual instanceof Error ? atual.cause : undefined;
  }
  return false;
}

async function tolerante<T>(consulta: () => Promise<T>, padrao: T): Promise<T> {
  try { return await consulta(); }
  catch (error) { if (tabelaAusente(error)) return padrao; throw error; }
}

export async function modulosDaEmpresa(db: D1Database, organizationId: string): Promise<PermissionModule[]> {
  const linha = await tolerante(
    () => db.prepare("SELECT enabled_json FROM organization_modules WHERE organization_id = ?1").bind(organizationId).first<{ enabled_json: string }>(),
    null,
  );
  return lerModulosHabilitados(linha?.enabled_json);
}

export async function membroPodeCriarContas(db: D1Database, organizationId: string, memberId: string) {
  const linha = await tolerante(
    () => db.prepare("SELECT can_create_accounts FROM member_delegations WHERE member_id = ?1 AND organization_id = ?2")
      .bind(memberId, organizationId).first<{ can_create_accounts: number }>(),
    null,
  );
  return linha?.can_create_accounts === 1;
}

export async function delegacoesDaEmpresa(db: D1Database, organizationId: string): Promise<Set<string>> {
  const linhas = await tolerante(
    async () => (await db.prepare("SELECT member_id FROM member_delegations WHERE organization_id = ?1 AND can_create_accounts = 1")
      .bind(organizationId).all<{ member_id: string }>()).results,
    [] as { member_id: string }[],
  );
  return new Set(linhas.map((linha) => linha.member_id));
}

export type LinhaDaMarca = {
  menu_color: string | null; accent_color: string | null; band_color: string | null;
  logo_version: number; has_logo: number; revision: number;
};

/** Marca sem os bytes do logotipo: vai em toda sessão, então precisa ser leve. */
export async function marcaDaEmpresa(db: D1Database, organizationId: string): Promise<MarcaDaEmpresa & { revision: number }> {
  const linha = await tolerante(
    () => db.prepare(`SELECT menu_color, accent_color, band_color, logo_version,
        CASE WHEN logo_base64 IS NULL THEN 0 ELSE 1 END AS has_logo, revision
      FROM organization_branding WHERE organization_id = ?1`).bind(organizationId).first<LinhaDaMarca>(),
    null,
  );
  if (!linha) return { ...marcaPadrao, revision: 0 };
  return {
    menuColor: linha.menu_color, accentColor: linha.accent_color, bandColor: linha.band_color,
    logoVersion: linha.logo_version, hasLogo: linha.has_logo === 1, revision: linha.revision,
  };
}

export async function logotipoDaEmpresa(db: D1Database, organizationId: string) {
  return tolerante(
    () => db.prepare("SELECT logo_mime, logo_base64, logo_version FROM organization_branding WHERE organization_id = ?1 AND logo_base64 IS NOT NULL")
      .bind(organizationId).first<{ logo_mime: string; logo_base64: string; logo_version: number }>(),
    null,
  );
}
