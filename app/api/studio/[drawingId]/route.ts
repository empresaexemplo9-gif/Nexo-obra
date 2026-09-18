import { z } from "zod";

import { documentoSchema } from "@/lib/prancheta";
import { ESPECIES, resposta } from "@/app/api/studio/route";
import { ApiError, apiRoute, auditStatement, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ drawingId: string }> };

const salvarSchema = z.object({
  documento: documentoSchema,
  // Revisão que a aba leu. É o que impede duas abas abertas de se sobrescreverem em
  // silêncio: quem grava declara o que viu, e o servidor recusa se já avançou.
  revisao: z.number().int().min(1),
  nome: z.string().trim().min(1).max(120).optional(),
  especie: z.enum(ESPECIES).optional(),
  projectId: z.string().trim().min(1).max(64).nullable().optional(),
}).strict();

type Linha = {
  id: string; nome: string; especie: string; revisao: number; documento: string;
  project_id: string | null; project_name: string | null; project_code: string | null;
  autor: string | null; created_at: string; updated_at: string;
};

const selecao = `SELECT d.id, d.nome, d.especie, d.revisao, d.documento, d.project_id,
  p.name AS project_name, p.code AS project_code,
  m.name AS autor, d.created_at, d.updated_at
  FROM studio_drawings d
  LEFT JOIN projects p ON p.id = d.project_id AND p.organization_id = d.organization_id
  LEFT JOIN members m ON m.id = d.atualizado_por_membro_id AND m.organization_id = d.organization_id`;

async function daEmpresa(context: Awaited<ReturnType<typeof requireOrganizationContext>>, drawingId: string) {
  const linha = await context.db.prepare(`${selecao} WHERE d.id = ?1 AND d.organization_id = ?2`)
    .bind(drawingId, context.organization.id).first<Linha>();
  if (!linha) throw new ApiError(404, "not_found", "Prancha não encontrada.");
  return linha;
}

// O documento guardado é validado na leitura, não só na escrita. Uma linha escrita por
// uma versão anterior do formato voltaria como objeto estranho para a tela e quebraria o
// editor sem dizer por quê; aqui a falha tem nome.
function documentoDaLinha(linha: Linha) {
  let cru: unknown;
  try { cru = JSON.parse(linha.documento); }
  catch { throw new ApiError(422, "drawing_unreadable", "O desenho desta prancha está ilegível e não pode ser aberto."); }
  const analisado = documentoSchema.safeParse(cru);
  if (!analisado.success) throw new ApiError(422, "drawing_unreadable", "O desenho desta prancha está em um formato que esta versão não abre.");
  return analisado.data;
}

export async function GET(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "studio", "view");
    const { drawingId } = await route.params;
    const linha = await daEmpresa(context, drawingId);
    return Response.json({ prancha: { ...resposta(linha), documento: documentoDaLinha(linha) } },
      { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function PUT(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "studio", "edit");
    const { drawingId } = await route.params;
    const analisado = salvarSchema.safeParse(await jsonBody(request));
    if (!analisado.success) throw validationError(analisado.error.flatten().fieldErrors);
    const atual = await daEmpresa(context, drawingId);
    if (atual.revisao !== analisado.data.revisao) {
      throw new ApiError(409, "revision_conflict",
        "Esta prancha foi alterada em outro lugar depois que você abriu. Recarregue para ver a versão atual antes de gravar.");
    }
    const projectId = analisado.data.projectId === undefined ? atual.project_id : analisado.data.projectId;
    if (projectId && projectId !== atual.project_id) {
      const projeto = await context.db.prepare("SELECT id FROM projects WHERE id = ?1 AND organization_id = ?2")
        .bind(projectId, context.organization.id).first<{ id: string }>();
      if (!projeto) throw new ApiError(400, "invalid_project", "O projeto não pertence à empresa atual.");
    }
    const nome = analisado.data.nome ?? atual.nome;
    const especie = analisado.data.especie ?? atual.especie;
    const documento = JSON.stringify(analisado.data.documento);
    // A condição de revisão viaja no próprio UPDATE. Conferir antes e gravar depois deixa
    // uma fresta entre as duas consultas; aqui duas gravações simultâneas não passam as
    // duas: a segunda não encontra a linha e volta como conflito.
    const gravado = await context.db.prepare(
      `UPDATE studio_drawings SET documento = ?1, nome = ?2, especie = ?3, project_id = ?4,
         revisao = revisao + 1, atualizado_por_membro_id = ?5, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?6 AND organization_id = ?7 AND revisao = ?8`,
    ).bind(documento, nome, especie, projectId, context.member.id, drawingId, context.organization.id, analisado.data.revisao).run();
    if (!gravado.meta.changes) {
      throw new ApiError(409, "revision_conflict",
        "Esta prancha foi alterada em outro lugar enquanto você gravava. Recarregue para ver a versão atual.");
    }
    // A auditoria vai depois, e sozinha: ela não pode entrar no lote do UPDATE, porque é
    // justamente a contagem de linhas afetadas por ele que decide se houve gravação.
    await auditStatement(context, "studio.drawing.saved", "studio_drawing", drawingId,
      { nome, especie, elementos: analisado.data.documento.elementos.length }).run();
    const linha = await daEmpresa(context, drawingId);
    return Response.json({ prancha: { ...resposta(linha), documento: documentoDaLinha(linha) } });
  });
}

export async function DELETE(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "studio", "edit");
    const { drawingId } = await route.params;
    const linha = await daEmpresa(context, drawingId);
    await context.db.batch([
      context.db.prepare("DELETE FROM studio_drawings WHERE id = ?1 AND organization_id = ?2")
        .bind(drawingId, context.organization.id),
      auditStatement(context, "studio.drawing.deleted", "studio_drawing", drawingId, { nome: linha.nome }),
    ]);
    return new Response(null, { status: 204 });
  });
}
