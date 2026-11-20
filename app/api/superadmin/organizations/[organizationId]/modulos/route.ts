import { z } from "zod";
import { getDatabase } from "@/db";
import { ApiError, apiRoute, jsonBody, validationError } from "@/lib/server/backend";
import { rejectCrossSiteMutation, requireSuperAdmin } from "@/lib/server/superadmin";
import { MAINTENANCE_ORGANIZATION_ID } from "@/lib/server/maintenance";
import { lerConfiguracao, modulosDasFerramentas, todasAsFerramentas, type Ferramenta } from "@/lib/empresa-config";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ organizationId: string }> };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

const schema = z.object({
  // Cada item do menu lateral, um a um. Lista vazia é válida: empresa sem nenhuma ferramenta.
  ferramentas: z.array(z.enum(todasAsFerramentas as [Ferramenta, ...Ferramenta[]])).max(todasAsFerramentas.length),
  // Revisão lida: duas abas do superadmin não se sobrescrevem em silêncio.
  revision: z.number().int().min(0),
}).strict();

async function empresa(organizationId: string) {
  if (!z.string().uuid().safeParse(organizationId).success) throw new ApiError(400, "invalid_organization", "Selecione uma empresa.");
  if (organizationId === MAINTENANCE_ORGANIZATION_ID) throw new ApiError(403, "maintenance_reserved", "O ambiente de manutenção não contrata módulos.");
  const linha = await getDatabase().prepare("SELECT id FROM organizations WHERE id = ?1").bind(organizationId).first();
  if (!linha) throw new ApiError(404, "organization_not_found", "Empresa não encontrada.");
}

/** Ferramentas do menu que a empresa contratou. Sem registro, todas — como antes desta configuração. */
export async function GET(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    await requireSuperAdmin(request);
    const { organizationId } = await route.params;
    await empresa(organizationId);
    const linha = await getDatabase().prepare("SELECT enabled_json, revision, updated_by, updated_at FROM organization_modules WHERE organization_id = ?1")
      .bind(organizationId).first<{ enabled_json: string; revision: number; updated_by: string; updated_at: number }>();
    const configuracao = lerConfiguracao(linha?.enabled_json);
    return json({
      ferramentas: configuracao.ferramentas,
      modulos: configuracao.modulos,
      revision: linha?.revision ?? 0,
      updatedBy: linha?.updated_by ?? null,
      updatedAt: linha?.updated_at ?? null,
    });
  });
}

export async function PUT(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const admin = await requireSuperAdmin(request);
    const { organizationId } = await route.params;
    await empresa(organizationId);
    const parsed = schema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const escolhidas = new Set(parsed.data.ferramentas);
    const ferramentas = todasAsFerramentas.filter((id) => escolhidas.has(id));
    const db = getDatabase();
    const anterior = await db.prepare("SELECT enabled_json FROM organization_modules WHERE organization_id = ?1")
      .bind(organizationId).first<{ enabled_json: string }>();
    const agora = Date.now();
    const [gravado] = await db.batch([
      db.prepare(`INSERT INTO organization_modules (organization_id, enabled_json, revision, updated_by, updated_at)
        SELECT ?1, ?2, 1, ?3, ?4 WHERE ?5 = 0 OR EXISTS (SELECT 1 FROM organization_modules WHERE organization_id = ?1)
        ON CONFLICT(organization_id) DO UPDATE SET enabled_json = excluded.enabled_json,
          revision = organization_modules.revision + 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at
        WHERE organization_modules.revision = ?5 RETURNING revision`)
        .bind(organizationId, JSON.stringify({ ferramentas }), admin.email, agora, parsed.data.revision),
      db.prepare(`INSERT INTO platform_audit_events (id, organization_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
        SELECT ?1, ?2, ?3, 'platform.modules_changed', 'organization', ?2, ?4, ?5 WHERE changes() > 0`)
        .bind(crypto.randomUUID(), organizationId, admin.email, JSON.stringify({ before: lerConfiguracao(anterior?.enabled_json).ferramentas, after: ferramentas }), agora),
    ]);
    const revisao = (gravado.results as { revision: number }[])[0]?.revision;
    if (!revisao) throw new ApiError(409, "modules_conflict", "Os módulos desta empresa mudaram em outra aba. Atualize antes de salvar.");
    return json({ ferramentas, modulos: modulosDasFerramentas(ferramentas), revision: revisao });
  });
}
