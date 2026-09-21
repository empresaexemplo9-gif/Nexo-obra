import { createHash } from "node:crypto";
import { abrirPlanilha } from "./planilha-xlsx";
import { abrirZip } from "./planilha-zip";
import { paraCentavos, type ItemSinapi } from "./sinapi-planilha";
import { normalizeReferenceMonth, normalizeSinapiUf, type Mapping, type SinapiRegime } from "./sinapi-contract";

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const compact = (value: string) => normalize(value).replace(/[^a-z0-9]+/g, " ").trim();

// Formas com que a competência aparece no nome dos arquivos da Caixa.
//
// Não é um padrão só. Na listagem real de GO convivem `202412` (AAAAMM), `092023`
// (MMAAAA, invertido), `2024_12`, e ainda retificações com e sem sublinhado
// (`..._NaoDesonerado_Retificacao01` e `..._DesoneradoRetificacao02`). Exigir uma única
// forma recusa a maior parte do acervo histórico.
export function formasDaCompetencia(month: string): string[] {
  const [ano, mes] = month.split("-");
  return [`${ano}_${mes}`, `${ano}${mes}`, `${mes}${ano}`, `${ano}-${mes}`];
}

// Acha uma planilha de referência dentro dos pacotes antigos da Caixa. A partir de 2025
// a Caixa publica um pacote nacional com várias planilhas; esse formato é tratado por
// parseNationalPackage abaixo e esta função permanece como contingência/histórico.
export function referenceFile(zipBytes: Buffer, month: string) {
  const zip = abrirZip(zipBytes);
  const planilhas = zip.entradas.filter((e) => normalize(e.nome).endsWith(".xlsx"));
  if (!planilhas.length) {
    const conteudo = zip.entradas.slice(0, 12).map((e) => e.nome).join(", ");
    throw new Error(`O pacote não contém nenhuma planilha .xlsx. Encontrei: ${conteudo || "nada"}. Baixe a versão em formato xlsx, não a versão só em PDF.`);
  }

  const formas = formasDaCompetencia(month);
  const daCompetencia = planilhas.filter((e) => formas.some((forma) => normalize(e.nome).includes(forma)));

  // Se o pacote datou os nomes e nenhum é a competência pedida, é o pacote errado. Aceitar
  // assim mesmo importaria preço de outro mês com o rótulo deste — errado e silencioso.
  // Por isso o encaixe por "planilha única" só vale quando NENHUM nome traz data alguma.
  const algumNomeTemData = planilhas.some((e) => /(?:^|[^0-9])\d{6}(?:[^0-9]|$)|\d{4}[_-]\d{2}/.test(normalize(e.nome)));
  if (!daCompetencia.length && algumNomeTemData) {
    const nomes = planilhas.slice(0, 12).map((e) => e.nome).join(", ");
    throw new Error(`Nenhuma planilha do pacote é da competência ${month}. Encontrei: ${nomes}. Confira se baixou o arquivo do mês certo.`);
  }

  // Preferência decrescente: nome que traz a competência; depois o que se diz referência;
  // por fim, se só existe uma planilha e o pacote não data nada, ela é a planilha.
  const escolhidas = daCompetencia.length ? daCompetencia
    : planilhas.filter((e) => /referencia|insumos|composicoes/.test(normalize(e.nome)));
  const alvo = escolhidas.length === 1 ? escolhidas[0]
    : escolhidas.length === 0 && planilhas.length === 1 ? planilhas[0]
    : null;

  if (!alvo) {
    // Listar o que existe transforma "não deu" em "é este aqui": a próxima tentativa é
    // informada pelo pacote, não por suposição sobre o nome.
    const nomes = planilhas.slice(0, 12).map((e) => e.nome).join(", ");
    throw new Error(
      `Não consegui identificar uma única planilha da competência ${month} no pacote. ` +
      `Planilhas encontradas: ${nomes}${planilhas.length > 12 ? ", ..." : ""}.`,
    );
  }
  return { name: alvo.nome, bytes: zip.extrair(alvo.nome) };
}

export function inspectReference(bytes: Buffer) {
  const book = abrirPlanilha(bytes);
  if (book.abas.length > 80) throw new Error("Quantidade de abas fora do limite.");
  return book.abas.map((aba) => ({ aba, linhas: book.linhas(aba, 30).map((row) => row.slice(0, 201)) }));
}

function regimeMatches(text: string, regime: SinapiRegime) {
  const value = compact(text);
  const naoDesonerado = /(?:nao|sem)\s+desoner/.test(value) || /naodesoner/.test(value);
  const desonerado = /(?:com\s+)?desoner/.test(value) && !naoDesonerado;
  return regime === "NaoDesonerado" ? naoDesonerado : desonerado;
}

function columnIndex(row: string[], pattern: RegExp) {
  return row.findIndex((cell) => pattern.test(compact(cell ?? "")));
}

type NationalTable = {
  arquivo: string;
  aba: string;
  tipo: ItemSinapi["tipo"];
  cabecalho: number;
  codigo: number;
  descricao: number;
  unidade: number;
  preco: number;
  header: string[];
};

function detectNationalTable(arquivo: string, aba: string, rows: string[][], uf: string, regime: SinapiRegime): NationalTable | null {
  const fileAndSheet = compact(`${arquivo} ${aba}`);
  const preview = compact(`${arquivo} ${aba} ${rows.slice(0, 40).flat().join(" ")}`);
  // Percentuais de mão de obra não são custos monetários.
  if (/porcentagem de mao|percentual de mao|familias e coeficientes|manutencoes/.test(preview)) return null;
  if (!regimeMatches(preview, regime)) return null;

  for (let h = 0; h < Math.min(rows.length, 40); h++) {
    const row = rows[h] ?? [];
    const codigo = columnIndex(row, /^codigo(?:\s+do\s+insumo|\s+da\s+composicao)?$/);
    const descricao = columnIndex(row, /^descricao(?:\s+do\s+insumo)?$/);
    const unidade = columnIndex(row, /^unidade$/);
    if (codigo < 0 || descricao < 0 || unidade < 0) continue;

    const normalizedHeader = row.map((cell) => compact(cell ?? ""));
    const next = rows[h + 1] ?? [];
    const previous = rows[h - 1] ?? [];
    const nextIsData = /^\d+$/.test(next[codigo]?.trim() ?? "");
    const combined = Array.from({ length: Math.max(row.length, nextIsData ? 0 : next.length) }, (_, c) => compact(`${row[c] ?? ""} ${nextIsData ? "" : next[c] ?? ""}`));
    const headerText = compact(row.join(" "));
    const tipo: ItemSinapi["tipo"] | null = /insumo/.test(headerText) || /insumo/.test(fileAndSheet)
      ? "insumo"
      : /composicao/.test(headerText) || /compos/.test(fileAndSheet)
        ? "composicao"
        : null;
    if (!tipo) continue;

    const state = compact(uf);
    let preco = -1;
    if (tipo === "insumo") {
      preco = normalizedHeader.findIndex((cell) => cell === state || cell.startsWith(`${state} preco`) || cell.startsWith(`${state} valor`));
      if (preco < 0) preco = combined.findIndex((cell) => cell === state || cell.startsWith(`${state} preco`) || cell.startsWith(`${state} valor`));
    } else {
      preco = row.findIndex((cell, c) => compact(previous[c] ?? "") === state && /^custo/.test(compact(cell)));
      if (preco < 0)
      preco = combined.findIndex((cell) => cell.startsWith(`${state} custo`) || cell === `${state} r` || cell === state);
      if (preco >= 0 && /%as|percent/.test(compact(next[preco] ?? ""))) preco = -1;
    }
    if (preco < 0 || new Set([codigo, descricao, unidade, preco]).size !== 4) continue;
    return { arquivo, aba, tipo, cabecalho: h, codigo, descricao, unidade, preco, header: combined.map((cell, c) => /^[A-Z]{2}$/.test(previous[c] ?? "") ? `${previous[c]} ${cell}` : cell) };
  }
  return null;
}

export type NationalPackage = {
  itens: ItemSinapi[];
  signatures: string[];
  semPreco: number;
  arquivos: string[];
};

// Novo formato oficial (2025+): um único ZIP XLSX mensal contém os relatórios de insumos
// e composições de todas as UFs. Esta leitura seleciona a coluna da UF e o regime pedidos,
// sem depender do nome exato dos arquivos ou de uma API de terceiro.
//
// Retorna null quando o pacote não parece ser o formato nacional; assim os pacotes antigos
// continuam seguindo o fluxo manual já homologado.
export function parseNationalPackage(zipBytes: Buffer, month: string, state: string, regime: SinapiRegime): NationalPackage | null {
  const reference = normalizeReferenceMonth(month);
  if (reference < "2025-01") return null;
  const uf = normalizeSinapiUf(state);
  const zip = abrirZip(zipBytes);
  const files = zip.entradas.filter((entry) => normalize(entry.nome).endsWith(".xlsx"));
  if (files.length < 2) return null;

  const tables: { table: NationalTable; rows: string[][] }[] = [];
  for (const entry of files) {
    let book: ReturnType<typeof abrirPlanilha>;
    try { book = abrirPlanilha(zip.extrair(entry.nome)); } catch { continue; }
    for (const aba of book.abas) {
      const preview = book.linhas(aba, 45);
      const table = detectNationalTable(entry.nome, aba, preview, uf, regime);
      if (!table) continue;
      const declared = preview.find((row) => compact(row[0] ?? "") === "mes de referencia")?.[1];
      if (declared && declared !== `${reference.slice(5)}/${reference.slice(0, 4)}`) throw new Error(`A planilha informa competência ${declared}, diferente de ${reference}.`);
      tables.push({ table, rows: book.linhas(aba) });
    }
  }

  // O pacote nacional utilizável precisa entregar preços de insumos E custos sintéticos de
  // composições. Se não reconhecemos os dois, não adivinhamos: o fluxo legado/manual fica
  // responsável pela conferência.
  if (!tables.some(({ table }) => table.tipo === "insumo") || !tables.some(({ table }) => table.tipo === "composicao")) return null;

  const itens: ItemSinapi[] = [];
  const signatures: string[] = [];
  const arquivos = new Set<string>();
  const seen = new Set<string>();
  let semPreco = 0;
  const count: Record<ItemSinapi["tipo"], number> = { insumo: 0, composicao: 0 };

  for (const { table, rows } of tables) {
    arquivos.add(table.arquivo);
    // A assinatura não inclui competência, nome do arquivo nem preços: ela mede apenas o
    // contrato estrutural da tabela para permitir renovar o mês seguinte com segurança.
    signatures.push(createHash("sha256").update(JSON.stringify({
      tipo: table.tipo, uf, regime, aba: compact(table.aba), codigo: table.codigo,
      descricao: table.descricao, unidade: table.unidade, preco: table.preco,
      header: table.header.map(compact),
    })).digest("hex"));

    for (const row of rows.slice(table.cabecalho + 1)) {
      const codigo = row[table.codigo]?.trim() ?? "";
      if (!/^\d+$/.test(codigo)) continue;
      if (Number(codigo) === 0) throw new Error("Código SINAPI zero: confira as fórmulas da planilha original.");
      const descricao = row[table.descricao]?.trim() ?? "";
      const unidade = row[table.unidade]?.trim() ?? "";
      const rawPrice = row[table.preco]?.trim() ?? "";
      if (!rawPrice || /^(?:-|–|—|N\/A)$/i.test(rawPrice)) { semPreco++; continue; }
      const price = paraCentavos(rawPrice);
      // Na publicação SINAPI, custo zero de composição significa sem custo calculado.
      if (table.tipo === "composicao" && price === 0) { semPreco++; continue; }
      if (!descricao || !unidade || price === null || !Number.isSafeInteger(price)) throw new Error(`Item ${codigo} inválido na tabela nacional da SINAPI (${uf}).`);
      const key = `${table.tipo}:${codigo}`;
      if (seen.has(key)) throw new Error(`Código duplicado no pacote nacional: ${key}. A estrutura publicada pela CAIXA precisa ser conferida.`);
      seen.add(key); count[table.tipo]++;
      itens.push({ codigo, descricao, unidade, custoUnitarioCentavos: price, tipo: table.tipo });
      if (itens.length > 150000) throw new Error("A tabela excede o limite de 150 mil itens por UF e regime.");
    }
  }

  if (count.insumo < 100 || count.composicao < 100) return null;
  signatures.sort();
  return { itens, signatures, semPreco, arquivos: [...arquivos].sort() };
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
