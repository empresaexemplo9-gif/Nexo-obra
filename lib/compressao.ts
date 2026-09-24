// JSON comprimido em gzip, igual no navegador e no servidor.
//
// Uma planta vinda de DWG tem dezenas de milhares de traços: o JSON passa fácil de 4,5 MB,
// o teto de corpo de requisição e de resposta das funções do Vercel. Comprimido, o mesmo
// desenho fica com um décimo disso — coordenada repetida comprime muito bem. A marca no
// cabeçalho diz ao outro lado que o corpo vem comprimido; sem ela, é JSON comum.

export const CABECALHO_CONTEUDO = "X-Hoikos-Conteudo";
export const CABECALHO_ACEITA = "X-Hoikos-Aceita";
export const JSON_GZIP = "json+gzip";

async function juntar(stream: ReadableStream<Uint8Array>, maximo: number, mensagem: string) {
  const leitor = stream.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await leitor.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximo) { await leitor.cancel(); throw new RangeError(mensagem); }
      partes.push(value);
    }
  } finally { leitor.releaseLock(); }
  const saida = new Uint8Array(total);
  let posicao = 0;
  for (const parte of partes) { saida.set(parte, posicao); posicao += parte.byteLength; }
  return saida;
}

const fluxo = (bytes: Uint8Array) => new Blob([bytes as BlobPart]).stream();

export async function comprimirJson(valor: unknown): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(JSON.stringify(valor));
  return juntar(fluxo(bytes).pipeThrough(new CompressionStream("gzip")), Number.MAX_SAFE_INTEGER, "");
}

/** Descomprime com teto: um arquivo pequeno que se expande em gigabytes não passa. */
export async function descomprimirJson<T = unknown>(bytes: Uint8Array, maximoBytes: number): Promise<T> {
  const texto = await juntar(fluxo(bytes).pipeThrough(new DecompressionStream("gzip")), maximoBytes, "O conteúdo descomprimido passa do limite aceito.");
  return JSON.parse(new TextDecoder().decode(texto)) as T;
}

export function base64(bytes: Uint8Array) {
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}

export function deBase64(texto: string) {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/** Lê a resposta como JSON, comprimida ou não, conforme a marca do servidor. */
export async function jsonDaResposta<T>(resposta: Response, maximoBytes = 256 * 1024 * 1024): Promise<T> {
  if (resposta.headers.get(CABECALHO_CONTEUDO) === JSON_GZIP) {
    return descomprimirJson<T>(new Uint8Array(await resposta.arrayBuffer()), maximoBytes);
  }
  return await resposta.json() as T;
}

/** Corpo de requisição comprimido, com a marca para o servidor. */
export async function corpoComprimido(valor: unknown): Promise<{ body: Blob; headers: Record<string, string> }> {
  const bytes = await comprimirJson(valor);
  return { body: new Blob([bytes as BlobPart], { type: "application/octet-stream" }), headers: { [CABECALHO_CONTEUDO]: JSON_GZIP, [CABECALHO_ACEITA]: JSON_GZIP } };
}
