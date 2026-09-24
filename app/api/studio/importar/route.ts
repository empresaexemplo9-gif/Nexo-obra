import { z } from "zod";

import { UNIDADES, Unidade } from "@/lib/integrations/dxf";
import { createFormatRegistry, MAX_CAD_BYTES } from "@/lib/cad-formats";
import { converterDwgParaDxfBytes, DwgConversaoFalhou, DwgConversorIndisponivel } from "@/lib/server/dwg-converter";
import { ApiError, apiRoute, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { readWholeFile, requireReadableFile } from "@/lib/server/org-files";
import { responder } from "@/lib/server/studio-corpo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ENVIO_DIRETO = 12 * 1024 * 1024;

const pelaBibliotecaSchema = z.object({
  fileId: z.string().trim().min(1).max(80),
  unidade: z.enum(Object.keys(UNIDADES) as [Unidade, ...Unidade[]]).optional(),
}).strict();

async function lerEnvioDireto(request: Request, contentType: string) {
  const anunciado = Number(request.headers.get("content-length") ?? 0);
  if (anunciado > MAX_ENVIO_DIRETO + 128 * 1024) {
    throw new ApiError(413, "file_too_large", "Arquivo grande: envie pela biblioteca da Prancheta e importe de lá.");
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
      if (length > MAX_ENVIO_DIRETO + 128 * 1024) { await reader.cancel(); throw new ApiError(413, "file_too_large", "Arquivo grande: envie pela biblioteca da Prancheta e importe de lá."); }
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
  if (arquivo.size > MAX_ENVIO_DIRETO) throw new ApiError(413, "file_too_large", "Arquivo grande: envie pela biblioteca da Prancheta e importe de lá.");
  const pedida = String(formulario.get("unidade") ?? "").trim();
  if (pedida && !Object.hasOwn(UNIDADES, pedida)) throw new ApiError(400, "invalid_unit", "Unidade de desenho inválida.");
  return { nome: arquivo.name, bytes: new Uint8Array(await arquivo.arrayBuffer()), unidade: pedida ? pedida as Unidade : undefined };
}

// A leitura acontece no servidor, não no navegador: um DXF de planta inteira derruba a
// aba do celular, e aqui o resultado ainda passa pelo mesmo esquema que governa a
// gravação. Nada é persistido — a importação devolve o desenho para quem abriu revisar e
// gravar, porque um arquivo lido com a unidade errada não pode entrar sozinho na prancha.
//
// Dois caminhos: arquivo pequeno vem no próprio formulário; arquivo grande já está na
// biblioteca da Prancheta (enviado em partes cifradas) e vem pelo identificador — o corpo
// da função não comporta um DWG de 30 MB.
export async function POST(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "studio", "edit");

    const contentType = request.headers.get("content-type") ?? "";
    let entrada: { nome: string; bytes: Uint8Array; unidade?: Unidade };
    if (contentType.startsWith("multipart/form-data;")) entrada = await lerEnvioDireto(request, contentType);
    else if (contentType.startsWith("application/json")) {
      const analisado = pelaBibliotecaSchema.safeParse(await jsonBody(request));
      if (!analisado.success) throw validationError(analisado.error.flatten().fieldErrors);
      const arquivo = await requireReadableFile(context, analisado.data.fileId);
      if (!["dwg", "dxf", "nexo"].includes(arquivo.extension)) throw new ApiError(415, "cad_invalido", "Só DWG, DXF e NEXO entram no Editor CAD.");
      if (arquivo.status !== "ready") throw new ApiError(409, "upload_incomplete", "O envio deste arquivo ainda não terminou.");
      entrada = { nome: arquivo.name, bytes: await readWholeFile(context, arquivo, MAX_CAD_BYTES), unidade: analisado.data.unidade };
    } else throw new ApiError(415, "invalid_upload", "Envie o arquivo pelo formulário ou escolha um da biblioteca.");

    try {
      const importacao = await createFormatRegistry(converterDwgParaDxfBytes).import(entrada.bytes, entrada.unidade);
      return responder(request, {
        nomeArquivo: entrada.nome.slice(0, 180),
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
      if (erro instanceof DwgConversaoFalhou) throw new ApiError(415, "dwg_conversion_failed", erro.message);
      if (erro instanceof Error) throw new ApiError(415, "cad_invalido", erro instanceof SyntaxError ? "O arquivo contém dados inválidos." : erro.message);
      throw erro;
    }
  });
}
