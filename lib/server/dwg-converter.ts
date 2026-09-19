import { runtimeEnv as platformEnv } from "@/lib/server/runtime";

type DwgRuntimeEnv = {
  DWG_CONVERTER_URL?: string;
  DWG_CONVERTER_TOKEN?: string;
};

const MAX_OUTPUT_BYTES = 48 * 1024 * 1024;
const TIMEOUT_MS = 45_000;

export class DwgConversorIndisponivel extends Error {
  constructor(message = "O conversor DWG não está configurado nesta publicação.") {
    super(message);
    this.name = "DwgConversorIndisponivel";
  }
}

function configuracao(): DwgRuntimeEnv {
  return platformEnv() as unknown as DwgRuntimeEnv;
}

/** Envia o DWG bruto a um conversor isolado e devolve DXF ASCII para o leitor CAD interno. */
export async function converterDwgParaDxf(bytes: Uint8Array): Promise<string> {
  const env = configuracao();
  const url = env.DWG_CONVERTER_URL?.trim();
  if (!url) throw new DwgConversorIndisponivel();

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
  if (env.DWG_CONVERTER_TOKEN?.trim()) {
    headers.set("Authorization", `Bearer ${env.DWG_CONVERTER_TOKEN.trim()}`);
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

  const corpo = await resposta.arrayBuffer();
  if (!corpo.byteLength) throw new DwgConversorIndisponivel("O conversor DWG devolveu uma resposta vazia.");
  if (corpo.byteLength > MAX_OUTPUT_BYTES) throw new DwgConversorIndisponivel("A conversão DWG excedeu o limite de 48 MB.");
  return new TextDecoder("utf-8", { fatal: false }).decode(corpo);
}

export function estadoDoConversorDwg(): "ok" | "nao_configurado" | "configuracao_invalida" {
  const url = configuracao().DWG_CONVERTER_URL?.trim();
  if (!url) return "nao_configurado";
  try {
    const protocolo = new URL(url).protocol;
    return protocolo === "http:" || protocolo === "https:" ? "ok" : "configuracao_invalida";
  } catch {
    return "configuracao_invalida";
  }
}
