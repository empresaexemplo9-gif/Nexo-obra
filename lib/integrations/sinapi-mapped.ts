import { createHash } from "node:crypto";
import { abrirPlanilha } from "./planilha-xlsx";
import { abrirZip } from "./planilha-zip";
import { paraCentavos, type ItemSinapi } from "./sinapi-planilha";
import type { Mapping } from "./sinapi-contract";

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function referenceFile(zipBytes: Buffer, month: string) {
  const zip = abrirZip(zipBytes);
  const files = zip.entradas.filter((e) => /referencia/.test(normalize(e.nome)) && e.nome.endsWith(".xlsx") && normalize(e.nome).includes(month.replace("-", "_")));
  if (files.length !== 1) throw new Error("O pacote não contém uma única planilha de referência da competência solicitada.");
  return { name: files[0].nome, bytes: zip.extrair(files[0].nome) };
}
export function inspectReference(bytes: Buffer) {
  const book = abrirPlanilha(bytes);
  if (book.abas.length > 80) throw new Error("Quantidade de abas fora do limite.");
  return book.abas.map((aba) => ({ aba, linhas: book.linhas(aba, 30).map((row) => row.slice(0, 201)) }));
}
export function parseMapped(bytes: Buffer, mappings: Mapping[]) {
  const book = abrirPlanilha(bytes); const itens: ItemSinapi[] = []; const signatures: string[] = [];
  let semPreco = 0;
  const seen = new Set<string>();
  for (const m of mappings) {
    const rows = book.linhas(m.aba);
    const header = rows[m.cabecalho - 1];
    if (!header || [m.codigo, m.descricao, m.unidade, m.preco].some((i) => !header[i]?.trim())) throw new Error(`Cabeçalho incompleto na aba ${m.aba}. Selecione a linha que identifica as colunas.`);
    // Compara o cabeçalho completo: uma nova UF ou coluna deslocada exige nova revisão.
    signatures.push(createHash("sha256").update(JSON.stringify({ ...m, header })).digest("hex"));
    let count = 0;
    for (const row of rows.slice(m.cabecalho)) {
      const codigo = row[m.codigo]?.trim() ?? "";
      if (!/^\d+$/.test(codigo)) continue;
      const descricao = row[m.descricao]?.trim(); const unidade = row[m.unidade]?.trim();
      const rawPrice = row[m.preco]?.trim() ?? "";
      if (!rawPrice || /^(?:-|–|—|N\/A)$/i.test(rawPrice)) { semPreco++; continue; }
      const price = paraCentavos(rawPrice);
      if (!descricao || !unidade || price === null || !Number.isSafeInteger(price)) throw new Error(`Item ${codigo} inválido na aba ${m.aba}.`);
      const key = `${m.tipo}:${codigo}`;
      if (seen.has(key)) throw new Error(`Código duplicado: ${key}. Confira a aba selecionada.`);
      seen.add(key); count++;
      itens.push({ codigo, descricao, unidade, custoUnitarioCentavos: price, tipo: m.tipo });
      if (itens.length > 150000) throw new Error("A tabela excede o limite de 150 mil itens por UF e regime.");
    }
    if (count < 100) throw new Error(`A aba ${m.aba} produziu menos de 100 preços. A tabela não será ativada.`);
  }
  return { itens, signatures, semPreco };
}
