import { base64, CABECALHO_ACEITA, CABECALHO_CONTEUDO, comprimirJson, deBase64, descomprimirJson, JSON_GZIP } from "@/lib/compressao";
import { ApiError, jsonBody } from "@/lib/server/backend";

// Corpo e armazenamento das pranchas do Editor CAD.
//
// O desenho importado de um DWG passa de 4,5 MB em JSON, que é o teto de corpo das
// funções do Vercel. O navegador manda e recebe comprimido (a marca vai no cabeçalho), e
// o banco guarda comprimido quando o JSON é grande — a linha fica com um décimo do tamanho.

const MAX_COMPRIMIDO = 8 * 1024 * 1024;
const MAX_JSON = 96 * 1024 * 1024;
const PREFIXO = "gz:";
const GUARDAR_COMPRIMIDO_ACIMA = 512 * 1024;

export async function lerCorpo(request: Request): Promise<unknown> {
  if (request.headers.get(CABECALHO_CONTEUDO) !== JSON_GZIP) return jsonBody(request);
  const leitor = request.body?.getReader();
  if (!leitor) throw new ApiError(400, "invalid_json", "O corpo da requisição está vazio.");
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await leitor.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_COMPRIMIDO) { await leitor.cancel(); throw new ApiError(413, "drawing_too_large", "O desenho passa do tamanho aceito para gravar de uma vez."); }
      partes.push(value);
    }
  } finally { leitor.releaseLock(); }
  const bytes = new Uint8Array(total);
  let posicao = 0;
  for (const parte of partes) { bytes.set(parte, posicao); posicao += parte.byteLength; }
  try { return await descomprimirJson(bytes, MAX_JSON); }
  catch (erro) {
    if (erro instanceof RangeError) throw new ApiError(413, "drawing_too_large", "O desenho passa do tamanho aceito para gravar de uma vez.");
    throw new ApiError(400, "invalid_json", "O corpo comprimido não é um JSON válido.");
  }
}

/** JSON comum, ou comprimido quando quem pediu disse que aceita. */
export async function responder(request: Request, valor: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  if (!(request.headers.get(CABECALHO_ACEITA) ?? "").includes(JSON_GZIP)) return Response.json(valor, { ...init, headers });
  headers.set("Content-Type", "application/octet-stream");
  headers.set(CABECALHO_CONTEUDO, JSON_GZIP);
  return new Response(await comprimirJson(valor) as BodyInit, { ...init, headers });
}

export async function documentoParaBanco(documento: unknown) {
  const json = JSON.stringify(documento);
  return json.length > GUARDAR_COMPRIMIDO_ACIMA ? `${PREFIXO}${base64(await comprimirJson(documento))}` : json;
}

export async function documentoDoBanco(texto: string): Promise<unknown> {
  if (texto.startsWith(PREFIXO)) return descomprimirJson(deBase64(texto.slice(PREFIXO.length)), MAX_JSON);
  return JSON.parse(texto);
}
