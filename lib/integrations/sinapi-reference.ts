import { abrirZip } from "./planilha-zip";
import { abrirPlanilha } from "./planilha-xlsx";
export const SINAPI_TABLES = { analytic: "Composições analíticas", families: "Famílias e coeficientes", labor: "Percentual de mão de obra", maintenance: "Manutenções", charges: "Encargos sociais", unburdened: "Preços sem encargos sociais" };
export function readSinapiTable(bytes: Buffer, table: keyof typeof SINAPI_TABLES, regime: string, query: string) {
  const zip = abrirZip(bytes);
  const pattern = table === "families" ? /familias/i : table === "maintenance" ? /manuten/i : table === "labor" ? /mao_de_obra/i : /refer[eê]ncia/i;
  const entry = zip.entradas.find((e)=>pattern.test(e.nome) && /\.xlsx$/i.test(e.nome));
  if (!entry) throw new Error("Este arquivo não contém o relatório solicitado. O CSV inclui somente os preços informados.");
  const book = abrirPlanilha(zip.extrair(entry.nome));
  const sheet = table === "analytic" ? "Analítico" : table === "charges" ? regime === "Desonerado" ? "ICD" : "ISD" : table === "unburdened" ? "ISE" : table === "labor" ? regime === "Desonerado" ? "COM Desoneração" : "SEM Desoneração" : book.abas[0];
  const rows = book.linhas(sheet);
  const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (table === "charges") return {file:entry.nome,sheet,headers:rows[3],rows:rows.slice(4,7),total:3};
  const head = rows.findIndex((r)=>r.some((v)=>/codigo/i.test(normalize(v))));
  if (head < 0) throw new Error("Cabeçalho do relatório não reconhecido.");
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const found = rows.slice(head+1).filter((r)=>r.some(Boolean) && terms.every((t)=>normalize(r.join(" ")).includes(t)));
  return {file:entry.nome,sheet,headers:rows[head],rows:found.slice(0,100),total:found.length};
}
