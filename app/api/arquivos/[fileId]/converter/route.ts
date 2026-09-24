import { z } from "zod";

import { ApiError, apiRoute, isPlatformSuperAdmin, jsonBody, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { converterDwgParaDxfBytes, DwgConversaoFalhou, DwgConversorIndisponivel } from "@/lib/server/dwg-converter";
import { fileResponse, fileSelect, readWholeFile, requireReadableFile, storeGeneratedFile, type OrgFileRow } from "@/lib/server/org-files";
import { versaoDoDwg } from "@/lib/integrations/dxf";

export const dynamic = "force-dynamic";
// A conversão do LibreDWG leva segundos em planta grande; o padrão da função é curto.
export const maxDuration = 60;

type RouteContext = { params: Promise<{ fileId: string }> };

const schema = z.object({
  para: z.literal("dxf"),
  // false: cópia só para visualizar, fora da biblioteca. true: entra na biblioteca.
  biblioteca: z.boolean().default(false),
}).strict();

const MAX_DWG_BYTES = 60 * 1024 * 1024;

/**
 * DWG → DXF no servidor, com o LibreDWG. É a única conversão que precisa do servidor:
 * DWG é binário fechado e o navegador não o lê. As demais (desenho para PDF/SVG/PNG,
 * PDF para imagem, imagem para PDF) acontecem no navegador a partir do que já está na tela.
 *
 * A mesma conversão não é refeita: se já existe o DXF deste DWG, ele é devolvido.
 */
export async function POST(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const parsed = schema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten());
    const { fileId } = await route.params;
    const source = await requireReadableFile(context, fileId);
    if (source.status !== "ready") throw new ApiError(409, "upload_incomplete", "O envio deste arquivo ainda não terminou.");
    const podeEditarBiblioteca = isPlatformSuperAdmin(context) || context.member.permissions.studio.edit;
    if (parsed.data.biblioteca && !podeEditarBiblioteca) {
      throw new ApiError(403, "module_permission_denied", "Seu acesso não permite guardar arquivos na Prancheta.");
    }

    const existing = await context.db.prepare(
      `${fileSelect} WHERE f.organization_id = ?1 AND f.source_file_id = ?2 AND f.conversion = 'dwg-dxf' AND f.status = 'ready'
       ORDER BY f.in_library DESC, f.created_at LIMIT 1`,
    ).bind(context.organization.id, source.id).first<OrgFileRow>();
    if (existing) {
      if (parsed.data.biblioteca && !existing.in_library) {
        await context.db.prepare("UPDATE org_files SET in_library = 1 WHERE id = ?1 AND organization_id = ?2")
          .bind(existing.id, context.organization.id).run();
        return Response.json({ file: fileResponse({ ...existing, in_library: 1 }), reused: true });
      }
      return Response.json({ file: fileResponse(existing), reused: true });
    }

    const bytes = await readWholeFile(context, source, MAX_DWG_BYTES);
    const versao = versaoDoDwg(bytes.subarray(0, 16));
    if (!versao) throw new ApiError(415, "not_dwg", "O conteúdo deste arquivo não é um DWG.");
    let dxf: Uint8Array;
    try {
      dxf = await converterDwgParaDxfBytes(bytes);
    } catch (error) {
      if (error instanceof DwgConversaoFalhou) throw new ApiError(422, "dwg_conversion_failed", `Não foi possível converter este DWG (${versao.nome}): ${error.message}`);
      if (error instanceof DwgConversorIndisponivel) throw new ApiError(503, "dwg_converter_unavailable", error.message);
      throw error;
    }
    const name = `${source.name.replace(/\.dwg$/i, "")}.dxf`;
    const file = await storeGeneratedFile(context, {
      name, mimeType: "image/vnd.dxf", bytes: dxf, sourceFileId: source.id, conversion: "dwg-dxf",
      projectId: source.project_id, inLibrary: parsed.data.biblioteca,
    });
    return Response.json({ file: fileResponse(file), reused: false, dwgVersion: versao.nome }, { status: 201 });
  });
}
