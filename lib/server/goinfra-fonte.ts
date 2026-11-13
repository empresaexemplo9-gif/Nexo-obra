import { getDatabase } from "@/db";
import { rotuloRegimeGoinfra, rotuloTabelaGoinfra, type TabelaGoinfra } from "@/lib/integrations/goinfra-planilha";
import { importarGoinfra } from "@/lib/server/goinfra-import";

// Busca automática das tabelas oficiais no site da GOINFRA.
//
// A agência publica em goias.gov.br/goinfra, em páginas WordPress com a lista de arquivos
// XLS por data-base (bimestral), com e sem desoneração. Não há API, então a plataforma lê
// a página de cada tabela, acha o arquivo mais recente de cada regime e importa se ele for
// mais novo do que o ativo. Só baixa de goias.gov.br/goinfra/wp-content/uploads — qualquer
// outro endereço achado na página é ignorado.
//
// A data-base e o regime vêm do nome do arquivo e são conferidos de novo contra o cabeçalho
// da própria planilha na importação. Divergência recusa a importação.

const PORTAL = "https://goias.gov.br/goinfra/";
const PREFIXO_DOS_ARQUIVOS = "/goinfra/wp-content/uploads/";

// Página de cada tabela. Os números no fim do endereço são do WordPress e podem mudar;
// por isso a página é primeiro procurada nos índices ("Tabela de Insumos", "Tabela de
// Preços") pelo começo do endereço, e o endereço conhecido fica de reserva.
const FONTES: { tabela: TabelaGoinfra; indice: string; prefixo: string; reserva: string }[] = [
  { tabela: "materiais", indice: `${PORTAL}tabela-de-insumos/`, prefixo: "custo-referencial-de-materiais", reserva: `${PORTAL}custo-referencial-de-materiais120/` },
  { tabela: "mao-de-obra", indice: `${PORTAL}tabela-de-insumos/`, prefixo: "custo-referencial-de-mao-de-obra", reserva: `${PORTAL}custo-referencial-de-mao-de-obra-121/` },
  { tabela: "obras-civis", indice: `${PORTAL}tabela-de-precos/`, prefixo: "relatorio-sintetico-de-composicoes", reserva: `${PORTAL}relatorio-sintetico-de-composicoes-118/` },
];

const MESES: Record<string, string> = {
  JANEIRO: "01", FEVEREIRO: "02", MARCO: "03", ABRIL: "04", MAIO: "05", JUNHO: "06",
  JULHO: "07", AGOSTO: "08", SETEMBRO: "09", OUTUBRO: "10", NOVEMBRO: "11", DEZEMBRO: "12",
};
const LIMITE_DO_ARQUIVO = 30 * 1024 * 1024;
const AGENTE = "DRAP-Backoffice/1.0 (tabelas de referencia GOINFRA)";

type Buscar = typeof fetch;
export type ArquivoPublicado = { url: string; nome: string; referencia: string; regime: "Desonerado" | "NaoDesonerado" };

function textoDeHtml(valor: string) {
  return valor.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

async function pagina(url: string, buscar: Buscar): Promise<string> {
  const resposta = await buscar(url, { headers: { "User-Agent": AGENTE, Accept: "text/html" }, signal: AbortSignal.timeout(60_000), cache: "no-store" });
  if (!resposta.ok) throw new Error(`a página ${url} respondeu HTTP ${resposta.status}`);
  return resposta.text();
}

/** Lê os arquivos XLS listados numa página de tabela, com data-base e regime do nome. */
export function arquivosDaPagina(html: string): ArquivoPublicado[] {
  const lista: ArquivoPublicado[] = [];
  for (const [, href] of html.matchAll(/href="([^"]+\.xls)"/gi)) {
    let url: URL;
    try { url = new URL(textoDeHtml(href)); } catch { continue; }
    if (url.protocol !== "https:" || url.hostname !== "goias.gov.br" || !url.pathname.startsWith(PREFIXO_DOS_ARQUIVOS)) continue;
    const nome = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    const semAcento = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
    const data = /\b(JANEIRO|FEVEREIRO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)[-/ ](\d{4})\b/.exec(semAcento);
    const regime = /SEM DESONERA/.test(semAcento) ? "NaoDesonerado" : /COM DESONERA/.test(semAcento) ? "Desonerado" : null;
    if (!data || !regime) continue;
    lista.push({ url: url.toString(), nome, referencia: `${data[2]}-${MESES[data[1]]}`, regime });
  }
  return lista;
}

/** O arquivo mais recente de cada regime. */
export function maisRecentes(arquivos: ArquivoPublicado[]) {
  const escolhidos = new Map<string, ArquivoPublicado>();
  for (const a of arquivos) {
    const atual = escolhidos.get(a.regime);
    if (!atual || a.referencia > atual.referencia) escolhidos.set(a.regime, a);
  }
  return [...escolhidos.values()];
}

async function enderecoDaTabela(fonte: typeof FONTES[number], buscar: Buscar): Promise<string> {
  try {
    const indice = await pagina(fonte.indice, buscar);
    const achado = [...indice.matchAll(/href="(https:\/\/goias\.gov\.br\/goinfra\/[^"]+)"/g)].map((m) => textoDeHtml(m[1]))
      .find((href) => new URL(href).pathname.split("/").filter(Boolean).pop()?.startsWith(fonte.prefixo));
    return achado ?? fonte.reserva;
  } catch { return fonte.reserva; }
}

async function baixar(url: string, buscar: Buscar): Promise<Buffer> {
  const resposta = await buscar(url, { headers: { "User-Agent": AGENTE }, signal: AbortSignal.timeout(120_000), cache: "no-store" });
  if (!resposta.ok) throw new Error(`o arquivo respondeu HTTP ${resposta.status}`);
  const tamanho = Number(resposta.headers.get("content-length") ?? 0);
  if (tamanho > LIMITE_DO_ARQUIVO) throw new Error(`o arquivo tem ${Math.round(tamanho / 1048576)} MB; o limite é 30 MB`);
  const bytes = Buffer.from(await resposta.arrayBuffer());
  if (bytes.length > LIMITE_DO_ARQUIVO) throw new Error("o arquivo passou de 30 MB");
  return bytes;
}

// ── Execução, com trava e registro ─────────────────────────────────────────────────

const INTERVALO = 20 * 60 * 60 * 1000;

export async function situacaoDaBusca() {
  const linha = await getDatabase().prepare("SELECT last_checked_at, last_origin, last_result, last_error FROM goinfra_sync WHERE id = 1")
    .first<{ last_checked_at: number | null; last_origin: string | null; last_result: string | null; last_error: string | null }>();
  return linha?.last_checked_at ? { at: linha.last_checked_at, origin: linha.last_origin ?? "", result: linha.last_result ?? "", error: linha.last_error } : null;
}

/**
 * Confere o site e importa o que estiver mais novo. Sem `forcar`, roda no máximo uma vez
 * a cada 20 horas — a GOINFRA publica de dois em dois meses, e o agendamento que chama
 * isto passa de hora em hora.
 */
export async function sincronizarGoinfra(origem: string, opcoes: { forcar?: boolean; buscar?: Buscar } = {}) {
  const db = getDatabase();
  const buscar = opcoes.buscar ?? fetch;
  const agora = Date.now();
  await db.prepare("INSERT OR IGNORE INTO goinfra_sync (id, locked_until) VALUES (1, 0)").run();
  const estado = await db.prepare("SELECT last_checked_at FROM goinfra_sync WHERE id = 1").first<{ last_checked_at: number | null }>();
  if (!opcoes.forcar && estado?.last_checked_at && agora - estado.last_checked_at < INTERVALO) return { ran: false as const, reason: "conferido há menos de 20 horas" };
  const token = crypto.randomUUID();
  const trava = await db.prepare("UPDATE goinfra_sync SET lock_token = ?1, locked_until = ?2 WHERE id = 1 AND locked_until < ?3").bind(token, agora + 10 * 60_000, agora).run();
  if (!trava.meta?.changes) return { ran: false as const, reason: "outra busca em andamento" };

  const feitos: string[] = [];
  const falhas: string[] = [];
  try {
    const ativas = (await db.prepare("SELECT tabela, regime, referencia FROM goinfra_tabelas WHERE tabela NOT LIKE 'importando-%'").all<{ tabela: string; regime: string; referencia: string }>()).results;
    for (const fonte of FONTES) {
      let publicados: ArquivoPublicado[];
      try { publicados = maisRecentes(arquivosDaPagina(await pagina(await enderecoDaTabela(fonte, buscar), buscar))); }
      catch (error) { falhas.push(`${rotuloTabelaGoinfra[fonte.tabela]}: ${error instanceof Error ? error.message : String(error)}`); continue; }
      if (!publicados.length) { falhas.push(`${rotuloTabelaGoinfra[fonte.tabela]}: nenhum arquivo XLS reconhecido na página`); continue; }
      for (const arquivo of publicados) {
        const rotulo = `${rotuloTabelaGoinfra[fonte.tabela]} ${rotuloRegimeGoinfra[arquivo.regime].toLowerCase()} ${arquivo.referencia.slice(5)}/${arquivo.referencia.slice(0, 4)}`;
        const ativa = ativas.find((a) => a.tabela === fonte.tabela && a.regime === arquivo.regime);
        if (ativa && ativa.referencia >= arquivo.referencia) continue;
        try {
          const bytes = await baixar(arquivo.url, buscar);
          const resultado = await importarGoinfra({ nome: arquivo.nome, bytes }, { tabela: fonte.tabela, referencia: arquivo.referencia, regime: arquivo.regime }, "site da GOINFRA");
          feitos.push(`${rotulo} (${resultado.interpretacao.itens.length.toLocaleString("pt-BR")} itens)`);
        } catch (error) { falhas.push(`${rotulo}: ${error instanceof Error ? error.message : String(error)}`); }
      }
    }
    const resultado = feitos.length ? `Importadas: ${feitos.join("; ")}.` : falhas.length ? "Nenhuma tabela nova importada." : "Tabelas em dia com o site.";
    await db.prepare("UPDATE goinfra_sync SET last_checked_at = ?1, last_origin = ?2, last_result = ?3, last_error = ?4 WHERE id = 1")
      .bind(Date.now(), origem, resultado, falhas.length ? falhas.join(" | ").slice(0, 1000) : null).run();
    return { ran: true as const, imported: feitos, failures: falhas, result: resultado };
  } finally {
    await db.prepare("UPDATE goinfra_sync SET locked_until = 0 WHERE id = 1 AND lock_token = ?1").bind(token).run();
  }
}
