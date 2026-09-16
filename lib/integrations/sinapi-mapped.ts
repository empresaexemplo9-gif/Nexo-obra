import { createHash } from "node:crypto";
import { abrirPlanilha } from "./planilha-xlsx";
import { abrirZip } from "./planilha-zip";
import { paraCentavos, type ItemSinapi } from "./sinapi-planilha";
import type { Mapping } from "./sinapi-contract";

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
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

// Acha a planilha de referência dentro do pacote da Caixa.
//
// Antes exigia a palavra "referencia" no nome E a competência escrita como `AAAA_MM`.
// Os pacotes históricos reais não atendem nem a primeira nem a segunda condição, e o erro
// dizia só que não havia "uma única planilha" — sem contar o que havia, o que deixava
// quem tentou importar sem nenhum caminho adiante.
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
