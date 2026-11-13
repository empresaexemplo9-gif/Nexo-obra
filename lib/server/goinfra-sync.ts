import { getDatabase } from "@/db";
import { ApiError } from "@/lib/server/api-error";
import { runtimeEnv } from "@/lib/server/runtime";
import { arquivosGoinfra, linksDaPagina, maisRecentes, rotuloRegimeGoinfra, rotuloTabelaGoinfra, type ArquivoGoinfra } from "@/lib/integrations/goinfra-planilha";
import { importarGoinfra, limparImportacoesInterrompidas } from "@/lib/server/goinfra-import";

// Busca automática da tabela GOINFRA.
//
// A agência não tem API: publica as planilhas no portal do Governo de Goiás. A busca lê a
// página de tabelas configurada em GOINFRA_INDICE_URL (e as páginas de tabela que ela liga,
// no mesmo site), acha as planilhas, classifica cada uma pelo nome e importa a referência
// mais nova de cada tabela e regime pelo mesmo caminho do envio manual — mesma leitura,
// mesma conferência, mesma troca atômica. Só hosts da lista abaixo são acessados, sem
// seguir redirect, e nenhuma URL vem do navegador.

const HOSTS = new Set(["goias.gov.br", "www.goias.gov.br", "goinfra.go.gov.br", "www.goinfra.go.gov.br"]);
const LIMITE_ARQUIVO = 30 * 1024 * 1024;
const LIMITE_PAGINA = 3 * 1024 * 1024;
const MAX_PAGINAS = 30;

export type ResultadoTabela = { tabela: string; regime: string; referencia: string; arquivo: string; situacao: "importada" | "atual" | "falhou"; itens?: number; abas?: number; erro?: string };
export type ResultadoBusca = { verificadoEm: number; paginas: number; arquivosEncontrados: number; xlsIgnorados: number; tabelas: ResultadoTabela[] };

export type GoinfraIO = { buscar(url: string, limite: number): Promise<{ bytes: Buffer; tipo: string }> };

async function limitado(response: Response, limite: number) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(); const partes: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.length; if (total > limite) throw new Error(`arquivo maior que ${Math.round(limite / 1048576)} MB`);
      partes.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(partes);
}

export const goinfraIO: GoinfraIO = {
  async buscar(url, limite) {
    const response = await fetch(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(90_000), headers: { "user-agent": "Mozilla/5.0 (compatible; tabela-de-referencia)" } });
    if (!response.ok) throw new Error(`o portal respondeu HTTP ${response.status}`);
    return { bytes: await limitado(response, limite), tipo: response.headers.get("content-type") ?? "" };
  },
};

function permitido(url: string) {
  try { const u = new URL(url); return u.protocol === "https:" && HOSTS.has(u.hostname); } catch { return false; }
}

export function indiceGoinfra(): string | null {
  const url = runtimeEnv().GOINFRA_INDICE_URL?.trim();
  return url && permitido(url) ? url : null;
}

/** Lê a página de tabelas e as páginas de tabela ligadas a ela, no mesmo site. */
export async function descobrirArquivos(indice: string, io: GoinfraIO = goinfraIO) {
  const fila = [indice]; const visitadas = new Set<string>();
  const links: { url: string; texto: string }[] = [];
  while (fila.length && visitadas.size < MAX_PAGINAS) {
    const pagina = fila.shift()!;
    if (visitadas.has(pagina)) continue;
    visitadas.add(pagina);
    const { bytes } = await io.buscar(pagina, LIMITE_PAGINA);
    const encontrados = linksDaPagina(bytes.toString("utf8"), pagina).filter((l) => permitido(l.url));
    links.push(...encontrados);
    // Só a página inicial abre outras: as páginas de cada tabela ("tabela-de-composicao/…")
    // que guardam os arquivos. Profundidade 1, para não varrer o portal inteiro.
    if (pagina === indice) {
      for (const l of encontrados) {
        const u = new URL(l.url); u.hash = "";
        if (/tabela/i.test(u.pathname) && !/\.[a-z0-9]{2,5}$/i.test(u.pathname) && !visitadas.has(u.toString())) fila.push(u.toString());
      }
    }
  }
  const xlsIgnorados = new Set(links.filter((l) => /\.xls$/i.test(new URL(l.url).pathname)).map((l) => l.url)).size;
  return { paginas: visitadas.size, arquivos: arquivosGoinfra(links), xlsIgnorados };
}

async function comLease<T>(acao: () => Promise<T>): Promise<T> {
  const db = getDatabase(); const token = crypto.randomUUID(); const agora = Date.now();
  await db.prepare("INSERT OR IGNORE INTO goinfra_sync(id) VALUES(1)").run();
  const obtido = await db.prepare("UPDATE goinfra_sync SET lock_token=?1, locked_until=?2 WHERE id=1 AND locked_until < ?3 RETURNING id").bind(token, agora + 600_000, agora).all();
  if (!obtido.results.length) throw new ApiError(409, "goinfra_busy", "Já existe uma busca da GOINFRA em andamento. Aguarde a conclusão.");
  try { return await acao(); }
  finally { await db.prepare("UPDATE goinfra_sync SET lock_token=NULL, locked_until=0 WHERE id=1 AND lock_token=?1").bind(token).run(); }
}

/**
 * Busca no portal e importa o que for mais novo que a tabela ativa. Uma tabela que falha
 * não impede as outras, e a ativa continua valendo: falha nunca vira tabela vazia.
 */
export async function buscarGoinfra(autor: string, io: GoinfraIO = goinfraIO): Promise<ResultadoBusca> {
  const indice = indiceGoinfra();
  if (!indice) throw new ApiError(503, "goinfra_not_configured", "Configure GOINFRA_INDICE_URL com a página de tabelas da GOINFRA (https, no portal goias.gov.br).");
  return comLease(async () => {
    const db = getDatabase();
    try {
      await limparImportacoesInterrompidas();
      const { paginas, arquivos, xlsIgnorados } = await descobrirArquivos(indice, io);
      const ativas = (await db.prepare("SELECT tabela, regime, referencia FROM goinfra_tabelas").all<{ tabela: string; regime: string; referencia: string }>()).results;
      const tabelas: ResultadoTabela[] = [];
      for (const arquivo of maisRecentes(arquivos)) tabelas.push(await importarArquivo(arquivo, ativas, autor, io));
      const resultado: ResultadoBusca = { verificadoEm: Date.now(), paginas, arquivosEncontrados: arquivos.length, xlsIgnorados, tabelas };
      let erro: string | null = null;
      if (!arquivos.length) erro = xlsIgnorados
        ? `A página tem ${xlsIgnorados} planilha(s) só em XLS antigo, que não é lido. Envie a versão XLSX manualmente.`
        : "Nenhuma planilha da GOINFRA foi reconhecida na página configurada.";
      else if (tabelas.some((t) => t.situacao === "falhou")) erro = tabelas.filter((t) => t.situacao === "falhou").map((t) => `${t.arquivo}: ${t.erro}`).join(" · ").slice(0, 500);
      await db.prepare("UPDATE goinfra_sync SET last_checked=?1, last_result_json=?2, last_error=?3 WHERE id=1").bind(resultado.verificadoEm, JSON.stringify(resultado), erro).run();
      return resultado;
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : String(error);
      await db.prepare("UPDATE goinfra_sync SET last_checked=?1, last_error=?2 WHERE id=1").bind(Date.now(), `Busca falhou: ${mensagem}`.slice(0, 500)).run();
      throw new ApiError(502, "goinfra_fetch_failed", `A busca no portal da GOINFRA falhou: ${mensagem}. As tabelas ativas foram preservadas.`);
    }
  });
}

async function importarArquivo(arquivo: ArquivoGoinfra, ativas: { tabela: string; regime: string; referencia: string }[], autor: string, io: GoinfraIO): Promise<ResultadoTabela> {
  const base = { tabela: arquivo.tabela, regime: arquivo.regime, referencia: arquivo.referencia, arquivo: arquivo.nome };
  const ativa = ativas.find((a) => a.tabela === arquivo.tabela && a.regime === arquivo.regime);
  if (ativa && ativa.referencia >= arquivo.referencia) return { ...base, situacao: "atual" };
  try {
    const { bytes } = await io.buscar(arquivo.url, LIMITE_ARQUIVO);
    const r = await importarGoinfra({ nome: arquivo.nome, bytes }, { referencia: arquivo.referencia, tabela: arquivo.tabela, regime: arquivo.regime }, autor);
    return { ...base, situacao: r.repetido ? "atual" : "importada", itens: r.interpretacao.itens.length, abas: r.interpretacao.abas.filter((a) => a.itens > 0).length };
  } catch (error) {
    return { ...base, situacao: "falhou", erro: (error instanceof Error ? error.message : String(error)).slice(0, 300) };
  }
}

export async function situacaoBuscaGoinfra() {
  const linha = await getDatabase().prepare("SELECT last_checked, last_result_json, last_error FROM goinfra_sync WHERE id = 1").first<{ last_checked: number | null; last_result_json: string | null; last_error: string | null }>();
  return {
    configurada: Boolean(indiceGoinfra()), agendada: Boolean(runtimeEnv().CRON_SECRET),
    ultimaVerificacao: linha?.last_checked ?? null, erro: linha?.last_error ?? null,
    resultado: linha?.last_result_json ? JSON.parse(linha.last_result_json) as ResultadoBusca : null,
  };
}

export const rotuloResultado = (t: ResultadoTabela) => `${rotuloTabelaGoinfra[t.tabela as keyof typeof rotuloTabelaGoinfra] ?? t.tabela} · ${rotuloRegimeGoinfra[t.regime as keyof typeof rotuloRegimeGoinfra] ?? t.regime}`;
