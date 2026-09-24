import { z } from "zod";

import { ApiError, auditStatement, type OrganizationContext } from "@/lib/server/backend";
import { areaM2, layoutConteudoSchema, layoutDoModelo, MODELOS, type LayoutConteudo } from "@/lib/layout";

// Layouts da empresa. Toda consulta filtra a empresa da sessão; o conteúdo só entra
// validado por lib/layout.ts, e salvar exige a revisão aberta — duas pessoas editando o
// mesmo layout não se sobrescrevem em silêncio.

const MAX_CONTEUDO = 1_500_000;

type LayoutRow = {
  id: string; name: string; project_id: string | null; project_code: string | null; project_name: string | null;
  content_json: string; revision: number; created_by_name: string; updated_by_name: string; created_at: string; updated_at: string;
};

const selecao = `SELECT l.id, l.name, l.project_id, p.code AS project_code, p.name AS project_name, l.content_json, l.revision,
  l.created_by_name, l.updated_by_name, l.created_at, l.updated_at
  FROM layouts l LEFT JOIN projects p ON p.id = l.project_id AND p.organization_id = l.organization_id`;

const nomeSchema = z.string().trim().min(1, "Dê um nome ao layout.").max(100);
const projetoSchema = z.string().trim().min(1).max(80).nullable().optional();

export const criarSchema = z.object({
  name: nomeSchema,
  projectId: projetoSchema,
  modelo: z.enum(MODELOS.map((m) => m.id) as [string, ...string[]]).default("vazio"),
  duplicarDe: z.string().trim().min(1).max(80).optional(),
}).strict();

export const salvarSchema = z.object({
  name: nomeSchema,
  projectId: projetoSchema,
  revision: z.number().int().min(1),
  content: z.unknown(),
}).strict();

function resumo(row: LayoutRow) {
  let conteudo: LayoutConteudo | null = null;
  try { conteudo = JSON.parse(row.content_json) as LayoutConteudo; } catch { conteudo = null; }
  return {
    id: row.id, name: row.name, projectId: row.project_id, projectCode: row.project_code, projectName: row.project_name,
    revision: Number(row.revision), createdByName: row.created_by_name, updatedByName: row.updated_by_name,
    createdAt: row.created_at, updatedAt: row.updated_at,
    itens: conteudo?.itens.length ?? 0,
    comodos: conteudo?.comodos.length ?? 0,
    areaM2: Math.round((conteudo?.comodos.reduce((soma, c) => soma + areaM2(c.pontos), 0) ?? 0) * 100) / 100,
  };
}

async function projetoDaEmpresa(context: OrganizationContext, projectId: string | null | undefined) {
  if (!projectId) return null;
  const projeto = await context.db.prepare("SELECT id FROM projects WHERE id = ?1 AND organization_id = ?2")
    .bind(projectId, context.organization.id).first<{ id: string }>();
  if (!projeto) throw new ApiError(400, "invalid_project", "O projeto não pertence à empresa atual.");
  return projeto.id;
}

function validarConteudo(content: unknown) {
  const texto = JSON.stringify(content ?? null);
  if (texto.length > MAX_CONTEUDO) throw new ApiError(413, "layout_too_large", "O layout passou do tamanho máximo. Divida em mais de um layout.");
  const parsed = layoutConteudoSchema.safeParse(content);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_layout", parsed.error.issues[0]?.message ?? "O layout tem dados inválidos.", parsed.error.flatten());
  }
  return parsed.data;
}

export async function listarLayouts(context: OrganizationContext) {
  const rows = await context.db.prepare(`${selecao} WHERE l.organization_id = ?1 ORDER BY l.updated_at DESC LIMIT 300`)
    .bind(context.organization.id).all<LayoutRow>();
  return rows.results.map(resumo);
}

export async function abrirLayout(context: OrganizationContext, layoutId: string) {
  const row = await context.db.prepare(`${selecao} WHERE l.id = ?1 AND l.organization_id = ?2`)
    .bind(layoutId, context.organization.id).first<LayoutRow>();
  if (!row) throw new ApiError(404, "layout_not_found", "Layout não encontrado.");
  return { ...resumo(row), content: validarConteudo(JSON.parse(row.content_json)) };
}

export async function criarLayout(context: OrganizationContext, input: z.infer<typeof criarSchema>) {
  const projectId = await projetoDaEmpresa(context, input.projectId);
  const conteudo = input.duplicarDe
    ? (await abrirLayout(context, input.duplicarDe)).content
    : layoutDoModelo(input.modelo as typeof MODELOS[number]["id"]);
  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  await context.db.batch([
    context.db.prepare(
      `INSERT INTO layouts (id, organization_id, project_id, name, content_json, revision, created_by_name, updated_by_name, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6, ?7, ?7)`,
    ).bind(id, context.organization.id, projectId, input.name, JSON.stringify(conteudo), context.user.displayName, agora),
    auditStatement(context, "layout.created", "layout", id, { name: input.name, modelo: input.duplicarDe ? "copia" : input.modelo }),
  ]);
  return abrirLayout(context, id);
}

export async function salvarLayout(context: OrganizationContext, layoutId: string, input: z.infer<typeof salvarSchema>) {
  const conteudo = validarConteudo(input.content);
  const projectId = await projetoDaEmpresa(context, input.projectId);
  const resultado = await context.db.prepare(
    `UPDATE layouts SET name = ?3, project_id = ?4, content_json = ?5, revision = revision + 1, updated_by_name = ?6, updated_at = ?7
     WHERE id = ?1 AND organization_id = ?2 AND revision = ?8`,
  ).bind(layoutId, context.organization.id, input.name, projectId, JSON.stringify(conteudo), context.user.displayName, new Date().toISOString(), input.revision).run();
  if (!Number(resultado.meta?.changes ?? 0)) {
    const atual = await context.db.prepare("SELECT revision, updated_by_name FROM layouts WHERE id = ?1 AND organization_id = ?2")
      .bind(layoutId, context.organization.id).first<{ revision: number; updated_by_name: string }>();
    if (!atual) throw new ApiError(404, "layout_not_found", "Layout não encontrado.");
    throw new ApiError(409, "layout_conflict", `${atual.updated_by_name} salvou este layout enquanto você editava. Abra de novo para ver a versão atual antes de salvar.`);
  }
  return abrirLayout(context, layoutId);
}

export async function excluirLayout(context: OrganizationContext, layoutId: string) {
  const row = await context.db.prepare("SELECT name FROM layouts WHERE id = ?1 AND organization_id = ?2")
    .bind(layoutId, context.organization.id).first<{ name: string }>();
  if (!row) throw new ApiError(404, "layout_not_found", "Layout não encontrado.");
  await context.db.batch([
    context.db.prepare("DELETE FROM layouts WHERE id = ?1 AND organization_id = ?2").bind(layoutId, context.organization.id),
    auditStatement(context, "layout.deleted", "layout", layoutId, { name: row.name }),
  ]);
}
