import { UNIDADES, Unidade } from "@/lib/integrations/dxf";
import { createFormatRegistry } from "@/lib/cad-formats";
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
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError(400, "empty_upload", "Escolha um arquivo CAD.");
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_BYTES + 128 * 1024) { await reader.cancel(); throw new ApiError(413, "file_too_large", "O arquivo pode ter no máximo 12 MB."); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const payload = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { payload.set(chunk, offset); offset += chunk.byteLength; }
    const formulario = await new Response(payload, { headers: { "Content-Type": contentType } }).formData().catch(() => {
      throw new ApiError(400, "invalid_upload", "Não foi possível ler o arquivo enviado.");
    });
    const arquivo = formulario.get("file");
    if (!arquivo || typeof arquivo === "string") throw new ApiError(400, "invalid_upload", "Escolha um arquivo CAD.");
    if (!arquivo.size) throw new ApiError(400, "empty_upload", "O arquivo está vazio.");
    if (arquivo.size > MAX_BYTES) throw new ApiError(413, "file_too_large", "O arquivo pode ter no máximo 12 MB.");

    const bytes = new Uint8Array(await arquivo.arrayBuffer());

    const pedida = String(formulario.get("unidade") ?? "").trim();
    if (pedida && !Object.hasOwn(UNIDADES, pedida)) {
      throw new ApiError(400, "invalid_unit", "Unidade de desenho inválida.");
    }

    try {
      const importacao = await createFormatRegistry(converterDwgParaDxf).import(bytes, pedida ? pedida as Unidade : undefined);
      return Response.json({
        nomeArquivo: arquivo.name.slice(0, 180),
        unidade: importacao.unidade,
        unidadeDeclarada: importacao.unidadeDeclarada,
        camadas: importacao.camadas,
        elementos: importacao.elementos,
        avisos: importacao.avisos,
        truncado: importacao.truncado,
        report: importacao.report,
      }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (erro) {
      if (erro instanceof DwgConversorIndisponivel) throw new ApiError(503, "dwg_converter_unavailable", `${erro.message} Como alternativa, exporte como DXF ASCII no programa de origem.`);
      if (erro instanceof Error) throw new ApiError(415, "cad_invalido", erro instanceof SyntaxError ? "O arquivo contém dados inválidos." : erro.message);
      throw erro;
    }
  });
}
