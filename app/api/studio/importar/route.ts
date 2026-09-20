import { DxfInvalido, UNIDADES, Unidade, lerDxf, versaoDoDwg } from "@/lib/integrations/dxf";
import { detectCadFormat, importNexo } from "@/lib/cad-formats";
import { converterDwgParaDxf, DwgConversorIndisponivel } from "@/lib/server/dwg-converter";
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
    const formato = detectCadFormat(arquivo.name, bytes);
    if (!formato) throw new ApiError(415, "formato_desconhecido", "Não foi possível identificar o formato do arquivo.");

    if (formato.id === "nexo") {
      try {
        const documento = importNexo(new TextDecoder().decode(bytes));
        return Response.json({ nomeArquivo: arquivo.name.slice(0, 180), unidade: "mm", unidadeDeclarada: true,
          camadas: documento.camadas, elementos: documento.elementos, avisos: [], truncado: false });
      } catch {
        throw new ApiError(415, "nexo_invalido", "O documento Nexo é inválido ou usa uma versão não suportada.");
      }
    }

    const pedida = String(formulario.get("unidade") ?? "").trim();
    if (pedida && !Object.hasOwn(UNIDADES, pedida)) {
      throw new ApiError(400, "invalid_unit", "Unidade de desenho inválida.");
    }

    try {
      let texto = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      const dwg = versaoDoDwg(bytes);
      if (dwg) texto = await converterDwgParaDxf(bytes);
      const importacao = lerDxf(texto,
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
      if (erro instanceof DwgConversorIndisponivel) throw new ApiError(503, "dwg_converter_unavailable", erro.message);
      if (erro instanceof DxfInvalido) throw new ApiError(415, "dxf_invalido", erro.message);
      throw erro;
    }
  });
}
