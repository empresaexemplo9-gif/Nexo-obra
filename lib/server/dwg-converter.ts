import { runtimeEnv as platformEnv } from "@/lib/server/runtime";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertDwgToDxf } from "dwg2dxf-converter";

type DwgRuntimeEnv = {
  DWG_CONVERTER_URL?: string;
  DWG_CONVERTER_TOKEN?: string;
};

const MAX_OUTPUT_BYTES = 48 * 1024 * 1024;
const TIMEOUT_MS = 45_000;

export class DwgConversorIndisponivel extends Error {
  constructor(message = "O conversor DWG não está disponível nesta publicação.") {
    super(message);
    this.name = "DwgConversorIndisponivel";
  }
}

export class DwgConversaoFalhou extends Error {
  constructor(message = "Não foi possível converter este arquivo DWG.") {
    super(message);
    this.name = "DwgConversaoFalhou";
  }
}

function configuracao(): DwgRuntimeEnv {
  return platformEnv() as unknown as DwgRuntimeEnv;
}

async function converterRemotamente(bytes: Uint8Array, url: string, token?: string): Promise<Uint8Array> {
  let destino: URL;
  try {
    destino = new URL(url);
  } catch {
    throw new DwgConversorIndisponivel("A URL do conversor DWG é inválida.");
  }
  if (!['http:', 'https:'].includes(destino.protocol)) {
    throw new DwgConversorIndisponivel("A URL do conversor DWG deve usar HTTP ou HTTPS.");
  }

  const headers = new Headers({
    "Content-Type": "application/acad",
    Accept: "text/plain, application/dxf",
  });
  if (token?.trim()) {
    headers.set("Authorization", `Bearer ${token.trim()}`);
  }

  let resposta: Response;
  try {
    resposta = await fetch(destino, {
      method: "POST",
      headers,
      body: bytes.slice().buffer,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new DwgConversorIndisponivel("Não foi possível alcançar o conversor DWG.");
  }
  if (!resposta.ok) {
    throw new DwgConversorIndisponivel(`O conversor DWG respondeu HTTP ${resposta.status}.`);
  }

  if (!resposta.body) throw new DwgConversorIndisponivel("O conversor DWG devolveu uma resposta vazia.");
  const reader = resposta.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_OUTPUT_BYTES) {
        await reader.cancel();
        throw new DwgConversorIndisponivel("A conversão DWG excedeu o limite de 48 MB.");
      }
      parts.push(value);
    }
  } catch (error) {
    if (error instanceof DwgConversorIndisponivel) throw error;
    throw new DwgConversorIndisponivel("A resposta do conversor DWG foi interrompida.");
  } finally { reader.releaseLock(); }
  if (!total) throw new DwgConversorIndisponivel("O conversor DWG devolveu uma resposta vazia.");
  const saida = new Uint8Array(total);
  let offset = 0;
  for (const parte of parts) { saida.set(parte, offset); offset += parte.byteLength; }
  return saida;
}

/**
 * Converte dentro da própria função usando LibreDWG em WebAssembly. O diretório temporário
 * é exclusivo por pedido e sempre removido; nenhum desenho do cliente fica persistido no
 * servidor. O serviço HTTP continua opcional para instalações que prefiram isolar a carga.
 */
async function converterLocalmente(bytes: Uint8Array): Promise<Uint8Array> {
  const pasta = await mkdtemp(join(tmpdir(), "nexo-dwg-"));
  const origem = join(pasta, "entrada.dwg");
  const destino = join(pasta, "saida.dxf");
  try {
    await writeFile(origem, bytes);
    const resultado = await convertDwgToDxf(origem, destino, { timeout: TIMEOUT_MS });
    if (!resultado.success) {
      throw new DwgConversaoFalhou(resultado.error?.trim() || "O arquivo DWG é inválido ou usa recursos não suportados.");
    }
    if (resultado.fileSize > MAX_OUTPUT_BYTES) {
      throw new DwgConversaoFalhou("A conversão DWG excedeu o limite de 48 MB.");
    }
    const dxf = await readFile(destino);
    if (!dxf.byteLength) throw new DwgConversaoFalhou("O conversor DWG devolveu uma resposta vazia.");
    if (dxf.byteLength > MAX_OUTPUT_BYTES) throw new DwgConversaoFalhou("A conversão DWG excedeu o limite de 48 MB.");
    return new Uint8Array(dxf);
  } catch (erro) {
    if (erro instanceof DwgConversaoFalhou) throw erro;
    throw new DwgConversorIndisponivel("Não foi possível iniciar o conversor DWG local.");
  } finally {
    await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * DWG bruto em DXF, byte a byte como o conversor escreveu. O DXF do LibreDWG declara a
 * página de código em $DWGCODEPAGE (ANSI_1252 em planta brasileira); decodificar como
 * UTF-8 aqui trocaria cada acento por "�" no arquivo entregue.
 */
export async function converterDwgParaDxfBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const env = configuracao();
  const url = env.DWG_CONVERTER_URL?.trim();
  return url
    ? converterRemotamente(bytes, url, env.DWG_CONVERTER_TOKEN)
    : converterLocalmente(bytes);
}

/** Converte DWG bruto em DXF ASCII para o leitor CAD interno. */
export async function converterDwgParaDxf(bytes: Uint8Array): Promise<string> {
  return new TextDecoder("utf-8", { fatal: false }).decode(await converterDwgParaDxfBytes(bytes));
}

export function estadoDoConversorDwg(): "ok" | "nao_configurado" | "configuracao_invalida" {
  const url = configuracao().DWG_CONVERTER_URL?.trim();
  if (!url) return "ok";
  try {
    const protocolo = new URL(url).protocol;
    return protocolo === "http:" || protocolo === "https:" ? "ok" : "configuracao_invalida";
  } catch {
    return "configuracao_invalida";
  }
}
