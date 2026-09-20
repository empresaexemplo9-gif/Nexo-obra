import { z } from "zod";

import { documentoSchema, documentoVazio } from "@/lib/prancheta";
import { ApiError, apiRoute, auditStatement, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";

export const dynamic = "force-dynamic";

import { ESPECIES, resposta } from "@/lib/server/studio-response";

const criarSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  especie: z.enum(ESPECIES).default("planta"),
  projectId: z.string().trim().min(1).max(64).nullable().optional(),
  // Documento inicial é opcional: quem cria da tela em branco recebe a folha padrão, e
  // quem duplica uma prancha manda o desenho junto.
  documento: documentoSchema.optional(),
}).strict();

type Linha = {
  id: string; nome: string; especie: string; revisao: number;
  project_id: string | null; project_name: string | null; project_code: string | null;
  autor: string | null; created_at: string; updated_at: string;
};

const selecao = `SELECT d.id, d.nome, d.especie, d.revisao, d.project_id,
  p.name AS project_name, p.code AS project_code,
  m.name AS autor, d.created_at, d.updated_at
  FROM studio_drawings d
  LEFT JOIN projects p ON p.id = d.project_id AND p.organization_id = d.organization_id
  LEFT JOIN members m ON m.id = d.atualizado_por_membro_id AND m.organization_id = d.organization_id`;



// A lista não carrega o desenho. Uma prancha cheia tem centenas de kB de JSON, e a tela
// de índice só precisa de nome, projeto e data — trazer tudo tornaria a abertura lenta
// na exata proporção do trabalho já feito.
export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "studio", "view");
    const projectId = new URL(request.url).searchParams.get("projectId")?.trim();
    const filtros = ["d.organization_id = ?1"];
    const valores: unknown[] = [context.organization.id];
    if (projectId) { valores.push(projectId); filtros.push(`d.project_id = ?${valores.length}`); }
    const resultado = await context.db.prepare(
      `${selecao} WHERE ${filtros.join(" AND ")} ORDER BY d.updated_at DESC LIMIT 300`,
    ).bind(...valores).all<Linha>();
    return Response.json({ pranchas: resultado.results.map(resposta) });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "studio", "edit");
    const analisado = criarSchema.safeParse(await jsonBody(request));
    if (!analisado.success) throw validationError(analisado.error.flatten().fieldErrors);
    const { nome, especie, documento } = analisado.data;
    const projectId = analisado.data.projectId ?? null;
    if (projectId) {
      const projeto = await context.db.prepare("SELECT id FROM projects WHERE id = ?1 AND organization_id = ?2")
        .bind(projectId, context.organization.id).first<{ id: string }>();
      if (!projeto) throw new ApiError(400, "invalid_project", "O projeto não pertence à empresa atual.");
    }
    const id = crypto.randomUUID();
    await context.db.batch([
      context.db.prepare(
        `INSERT INTO studio_drawings (id, organization_id, project_id, nome, especie, documento, revisao,
          criado_por_membro_id, atualizado_por_membro_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ).bind(id, context.organization.id, projectId, nome, especie,
        JSON.stringify(documento ?? documentoVazio()), context.member.id),
      auditStatement(context, "studio.drawing.created", "studio_drawing", id, { nome, especie, projectId }),
    ]);
    const linha = await context.db.prepare(`${selecao} WHERE d.id = ?1 AND d.organization_id = ?2`)
      .bind(id, context.organization.id).first<Linha>();
    return Response.json({ prancha: resposta(linha!) }, { status: 201 });
  });
}
