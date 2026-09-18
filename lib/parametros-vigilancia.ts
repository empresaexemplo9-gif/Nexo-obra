import { createHash } from "node:crypto";

import { FONTES, Fonte } from "@/lib/parametros";

// Vigilância das fontes dos parâmetros.
//
// ## Por que não é preciso API
//
// Norma técnica não tem API, e não precisa ter. O que muda quando a ABNT revisa uma norma
// é a PÁGINA que a publica: sai "NBR 5410:2004" e entra outro ano, ou aparece "em
// revisão". Buscar a página e comparar com a última vez resolve — e custa zero.
//
// O que esta rotina faz é exatamente isso: guarda uma impressão digital do que a fonte
// dizia da última vez e avisa quando ela deixa de bater.
//
// ## O que ela NÃO faz, e por quê
//
// Ela não altera parâmetro nenhum sozinha. Uma página pode mudar por mil motivos que não
// são revisão de norma — trocaram o rodapé, mudaram um banner, o site foi redesenhado.
// Promover isso a "parâmetro novo" poria número inventado dentro de orçamento. Ela
// levanta a mão; quem confere a norma e muda o valor é uma pessoa.
//
// É a mesma regra do SINAPI: ingestão automática, aprovação humana.

/** Só o que importa para saber se a norma mudou: o resto da página é ruído de layout. */
export function assinaturaDaPagina(html: string, fonteId: string): string {
  const texto = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;?/gi, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();

  // Anos de quatro dígitos e menções a revisão são o sinal; o resto da página não é.
  // Comparar a página inteira acusaria mudança toda semana e ninguém olharia mais.
  const marcas = [
    ...new Set([
      ...(texto.match(/\b(19|20)\d{2}\b/g) ?? []),
      ...(texto.match(/\bEM REVIS[AÃ]O\b/g) ?? []),
      ...(texto.match(/\bCANCELAD[AO]\b/g) ?? []),
      ...(texto.match(/\bVERS[AÃ]O CORRIGIDA\b/g) ?? []),
      ...(texto.match(/\bEMENDA\b/g) ?? []),
    ]),
  ].sort();

  return createHash("sha256").update(`${fonteId}|${marcas.join(",")}`).digest("hex");
}

export type EstadoDaFonte = {
  fonteId: string;
  assinatura: string | null;
  conferidoEm: number | null;
  falha: string | null;
};

export type Veredito = {
  fonteId: string;
  nome: string;
  url: string;
  revisaoEmUso: string;
  /** "igual" | "mudou" | "primeira" | "inalcancavel" */
  estado: "igual" | "mudou" | "primeira" | "inalcancavel";
  assinatura: string | null;
  conferidoEm: number;
  detalhe: string;
};

export type Buscador = (url: string) => Promise<{ ok: boolean; status: number; corpo: string }>;

/** Busca real, usada em produção. O ambiente publicado tem saída de rede; o limite de
 *  tamanho existe porque uma página que virou download travaria a rotina. */
export const buscaHttp: Buscador = async (url) => {
  try {
    const resposta = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "H.OIKOS/1.0 (verificador de vigencia de norma)" },
    });
    const bruto = await resposta.text();
    return { ok: resposta.ok, status: resposta.status, corpo: bruto.slice(0, 2 * 1024 * 1024) };
  } catch {
    return { ok: false, status: 0, corpo: "" };
  }
};

/**
 * Confere uma fonte contra o que foi visto da última vez.
 *
 * Fonte fora do ar NÃO vira "mudou": a assinatura guardada é preservada e o estado é
 * `inalcancavel`. Tratar indisponibilidade como mudança encheria a tela de alarme falso
 * toda vez que um site saísse do ar, e alarme falso é o que faz ninguém olhar o alarme.
 */
export async function conferirFonte(fonte: Fonte, anterior: EstadoDaFonte | null, buscar: Buscador, agora = Date.now()): Promise<Veredito> {
  const base = { fonteId: fonte.id, nome: fonte.nome, url: fonte.url, revisaoEmUso: fonte.revisao, conferidoEm: agora };
  const resposta = await buscar(fonte.url);

  if (!resposta.ok || !resposta.corpo.trim()) {
    return {
      ...base,
      estado: "inalcancavel",
      assinatura: anterior?.assinatura ?? null,
      detalhe: resposta.status
        ? `A fonte respondeu HTTP ${resposta.status}. A assinatura anterior foi preservada.`
        : "Não foi possível alcançar a fonte. A assinatura anterior foi preservada.",
    };
  }

  const assinatura = assinaturaDaPagina(resposta.corpo, fonte.id);
  if (!anterior?.assinatura) {
    return { ...base, estado: "primeira", assinatura, detalhe: "Primeira conferência: a assinatura da fonte foi registrada. A partir de agora, mudanças nela aparecem aqui." };
  }
  if (anterior.assinatura === assinatura) {
    return { ...base, estado: "igual", assinatura, detalhe: `Sem mudança desde a última conferência. Em uso: ${fonte.revisao}.` };
  }
  return {
    ...base,
    estado: "mudou",
    assinatura,
    detalhe: `A página da norma mudou desde a última conferência. Abra a fonte e confira se houve revisão; se houve, os valores em lib/parametros.ts precisam ser revistos à mão. Em uso hoje: ${fonte.revisao}.`,
  };
}

export async function conferirTodas(estados: EstadoDaFonte[], buscar: Buscador, agora = Date.now()): Promise<Veredito[]> {
  const porId = new Map(estados.map((estado) => [estado.fonteId, estado]));
  const vereditos: Veredito[] = [];
  // Em série, de propósito: são poucas fontes e nenhuma pressa, e em paralelo a
  // plataforma bateria em vários sites oficiais ao mesmo tempo sem necessidade.
  for (const fonte of FONTES) {
    vereditos.push(await conferirFonte(fonte, porId.get(fonte.id) ?? null, buscar, agora));
  }
  return vereditos;
}

/** Quantas fontes pedem atenção. É o número que vai no painel. */
export const precisamDeAtencao = (vereditos: Veredito[]) => vereditos.filter((veredito) => veredito.estado === "mudou").length;
