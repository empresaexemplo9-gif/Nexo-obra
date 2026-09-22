import { abrirZip } from "./planilha-zip";
import { abrirPlanilha } from "./planilha-xlsx";
import { UFS, columnName } from "./sinapi-contract";

export const SINAPI_TABLES = {
  inputs: "Preços de insumos", compositions: "Custos de composições", analytic: "Composições analíticas",
  families: "Famílias e coeficientes", labor: "Percentual de mão de obra", maintenance: "Manutenções",
  charges: "Encargos sociais", unburdened: "Insumos sem encargos sociais", compositionsUnburdened: "Composições sem encargos sociais",
};
const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export type ReferenceOptions = { uf?: string; page?: number; file?: string; sheet?: string };
export function sinapiWorkbookCatalog(bytes: Buffer) {
  const zip = abrirZip(bytes);
  return zip.entradas.filter(e => /\.xlsx$/i.test(e.nome)).map(e => ({ file: e.nome, sheets: abrirPlanilha(zip.extrair(e.nome)).abas }));
}
export function readSinapiTable(bytes: Buffer, table: keyof typeof SINAPI_TABLES | "original", regime: string, query: string, options: ReferenceOptions = {}) {
  const uf = options.uf ?? "all", page = options.page ?? 1, pageSize = 100;
  if (uf !== "all" && !UFS.includes(uf)) throw new Error("UF inválida.");
  if (!Number.isSafeInteger(page) || page < 1) throw new Error("Página inválida.");
  if (!["NaoDesonerado", "Desonerado"].includes(regime)) throw new Error("Regime inválido.");
  const zip = abrirZip(bytes);
  const pattern = table === "families" ? /familias/i : table === "maintenance" ? /manuten/i : table === "labor" ? /mao_de_obra/i : /refer[eê]ncia/i;
  const entry = zip.entradas.find(e => /\.xlsx$/i.test(e.nome) && (table === "original" ? e.nome === options.file : pattern.test(e.nome)));
  if (!entry) throw new Error("Planilha não disponível neste pacote. Arquivos CSV contêm somente os preços enviados.");
  const book = abrirPlanilha(zip.extrair(entry.nome));
  const sheet = table === "original" ? options.sheet ?? "" : table === "analytic" ? "Analítico"
    : table === "charges" || table === "inputs" ? regime === "Desonerado" ? "ICD" : "ISD"
    : table === "compositions" ? regime === "Desonerado" ? "CCD" : "CSD"
    : table === "compositionsUnburdened" ? "CSE" : table === "unburdened" ? "ISE"
    : table === "labor" ? regime === "Desonerado" ? "COM Desoneração" : "SEM Desoneração" : book.abas[0];
  if (!book.abas.includes(sheet)) throw new Error("Aba não disponível neste pacote.");
  const rows = book.linhas(sheet);
  const width = rows.reduce((n, r) => Math.max(n, r.length), 0);
  const head = rows.slice(0, 40).findIndex(r => r.some(v => /codigo/.test(normalize(v))));
  // A UF pode estar no próprio cabeçalho ou em uma linha acima, abrangendo custo e %AS.
  const stateRow = rows.slice(0, Math.max(head + 1, 10)).find(r => r.filter(v => UFS.includes(v.trim())).length >= 2);
  const anchors = stateRow?.flatMap((v, c) => UFS.includes(v.trim()) ? [{ c, uf: v.trim() }] : []) ?? [];
  const groupWidth = anchors.length > 1 ? Math.min(...anchors.slice(1).map((a, i) => a.c - anchors[i].c)) : 1;
  const stateFor = (c: number) => anchors.find(a => c >= a.c && c < a.c + groupWidth)?.uf;
  const columns = Array.from({ length: width }, (_, c) => c).filter(c => uf === "all" || !stateFor(c) || stateFor(c) === uf);
  const project = (row: string[]) => columns.map(c => row[c] ?? "");
  let headers: string[], body: { number: number; cells: string[] }[], metadata: string[][];
  if (table === "original") {
    headers = columns.map(c => `${columnName(c)}${stateFor(c) ? ` · ${stateFor(c)}` : ""}`);
    body = rows.map((r, i) => ({ number: i + 1, cells: project(r) })); metadata = [];
  } else if (table === "charges") {
    headers = columns.map(c => stateFor(c) ?? (c === anchors[0]?.c - 1 ? "Encargo / localidade" : columnName(c)));
    body = rows.slice(4, 7).map((r, i) => ({ number: i + 5, cells: project(r) })); metadata = rows.slice(0, 4);
  } else {
    if (head < 0) throw new Error("Cabeçalho não reconhecido. Consulte a aba original para acessar todo o conteúdo.");
    headers = columns.map(c => [stateFor(c), rows[head][c]].filter((v, i, a) => v && a.indexOf(v) === i).join(" · ") || columnName(c));
    body = rows.slice(head + 1).map((r, i) => ({ number: head + i + 2, cells: project(r) })); metadata = rows.slice(0, head);
  }
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const found = body.filter(r => (table === "original" || r.cells.some(Boolean)) && terms.every(t => normalize(r.cells.join(" ")).includes(t)));
  const pages = Math.max(1, Math.ceil(found.length / pageSize));
  const actualPage = Math.min(page, pages);
  const selected = found.slice((actualPage - 1) * pageSize, actualPage * pageSize);
  return { file: entry.nome, sheet, headers, rows: selected.map(r => r.cells), rowNumbers: selected.map(r => r.number), total: found.length,
    page: actualPage, pages, pageSize, uf, scope: anchors.length ? "uf" : "national", metadata,
    original: table === "original" };
}
