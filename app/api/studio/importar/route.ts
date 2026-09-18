import { DxfInvalido, UNIDADES, Unidade, lerDxf, versaoDoDwg } from "@/lib/integrations/dxf";
import { ApiError, apiRoute, requireModulePermission, requireOrganizationContext } from "@/lib/server/backend";

export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024;

// A leitura acontece no servidor, não no navegador: um DXF de planta inteira derruba a
// aba do celular, e aqui o resultado ainda passa pelo mesmo esquema que governa a
// gravação. Nada é persistido — a importação devolve o desenho para quem abriu revisar e
// gravar, porque um arquivo lido com a unidade errada não pode entrar sozinho na prancha.
export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "studio", "edit");

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.startsWith("multipart/form-data;")) {
      throw new ApiError(415, "invalid_upload", "Envie o arquivo pelo formulário.");
    }
    const anunciado = Number(request.headers.get("content-length") ?? 0);
    if (anunciado > MAX_BYTES + 128 * 1024) {
      throw new ApiError(413, "file_too_large", "O arquivo pode ter no máximo 12 MB.");
    }
    const formulario = await request.formData().catch(() => {
      throw new ApiError(400, "invalid_upload", "Não foi possível ler o arquivo enviado.");
    });
    const arquivo = formulario.get("file");
    if (!arquivo || typeof arquivo === "string") throw new ApiError(400, "invalid_upload", "Escolha um arquivo DXF.");
    if (!arquivo.size) throw new ApiError(400, "empty_upload", "O arquivo está vazio.");
    if (arquivo.size > MAX_BYTES) throw new ApiError(413, "file_too_large", "O arquivo pode ter no máximo 12 MB.");

    const bytes = new Uint8Array(await arquivo.arrayBuffer());

    // DWG chega aqui com frequência, porque é o que o cliente manda. Em vez de um
    // "formato não suportado", a pessoa ouve qual é o arquivo dela e o que fazer.
    const dwg = versaoDoDwg(bytes);
    if (dwg) {
      throw new ApiError(415, "dwg_nao_suportado",
        `Este é um arquivo DWG (${dwg.nome}). O DWG é formato fechado e sem especificação publicada; ler por engenharia reversa erraria medidas em silêncio. Abra o arquivo no CAD e exporte como DXF ASCII — a geometria vem inteira por lá.`,
        { versao: dwg.codigo });
    }

    const pedida = String(formulario.get("unidade") ?? "").trim();
    if (pedida && !Object.hasOwn(UNIDADES, pedida)) {
      throw new ApiError(400, "invalid_unit", "Unidade de desenho inválida.");
    }

    try {
      const importacao = lerDxf(new TextDecoder("utf-8", { fatal: false }).decode(bytes),
        pedida ? { unidade: pedida as Unidade } : {});
      return Response.json({
        nomeArquivo: arquivo.name.slice(0, 180),
        unidade: importacao.unidade,
        unidadeDeclarada: importacao.unidadeDeclarada,
        camadas: importacao.camadas,
        elementos: importacao.elementos,
        avisos: importacao.avisos,
        truncado: importacao.truncado,
      }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (erro) {
      if (erro instanceof DxfInvalido) throw new ApiError(415, "dxf_invalido", erro.message);
      throw erro;
    }
  });
}
