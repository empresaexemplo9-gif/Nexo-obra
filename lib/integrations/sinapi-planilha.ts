import { abrirPlanilha } from "./planilha-xlsx";

// Interpretação da planilha de referência da SINAPI.
//
// As colunas são localizadas pelo NOME no cabeçalho, nunca por posição fixa. A Caixa
// republica a planilha todo mês e já mudou layout entre competências; um parser preso ao
// índice da coluna lê preço onde havia quantidade e produz orçamento errado em silêncio —
// que é o pior defeito possível aqui. Procurar pelo nome custa uma varredura e falha alto
// quando o cabeçalho não aparece.

export type ItemSinapi = { codigo: string; descricao: string; unidade: string; custoUnitarioCentavos: number; tipo: "composicao" | "insumo" };
export type Interpretacao = { itens: ItemSinapi[]; aba: string; linhaDoCabecalho: number; colunas: Record<string, number>; ignoradas: number };

// Sinônimos por coluna: a planilha varia entre "CUSTO TOTAL", "PREÇO UNITÁRIO", "CUSTO".
// A ordem importa — o primeiro que casar vence.
const SINONIMOS: Record<string, string[]> = {
  codigo: ["codigo", "codigo da composicao", "codigo do insumo", "cod", "codigo sinapi"],
  descricao: ["descricao", "descricao da composicao", "descricao do insumo", "discriminacao"],
  unidade: ["unidade", "und", "un", "unid"],
  custo: ["custo total", "custo unitario", "preco unitario", "preco mediano", "custo", "preco"],
};

// Acento, caixa e espaço repetido não podem decidir se a coluna é encontrada.
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function acharColunas(linha: string[]): Record<string, number> | null {
  const normalizada = linha.map(normalizar);
  const achado: Record<string, number> = {};
  for (const [campo, nomes] of Object.entries(SINONIMOS)) {
    const indice = nomes.map((nome) => normalizada.indexOf(nome)).find((i) => i >= 0);
    if (indice === undefined) return null;
    achado[campo] = indice;
  }
  return achado;
}

// "1.234,56" e "1234.56" convivem na mesma planilha conforme a aba e a exportação.
// Devolve centavos, que é como todo dinheiro anda neste projeto.
export function paraCentavos(bruto: string): number | null {
  const limpo = bruto.replace(/[R$\s ]/g, "");
  if (!limpo || !/\d/.test(limpo)) return null;
  // Se há vírgula e ponto, o último separador é o decimal.
  const ultimaVirgula = limpo.lastIndexOf(",");
  const ultimoPonto = limpo.lastIndexOf(".");
  const decimal = ultimaVirgula > ultimoPonto ? "," : ultimoPonto > ultimaVirgula ? "." : "";
  const semMilhar = decimal
    ? limpo.split(decimal === "," ? "." : ",").join("").replace(decimal, ".")
    : limpo;
  const numero = Number(semMilhar);
  if (!Number.isFinite(numero) || numero < 0) return null;
  return Math.round(numero * 100);
}

export function interpretar(dados: Buffer, tipo: "composicao" | "insumo"): Interpretacao {
  const planilha = abrirPlanilha(dados);
  for (const aba of planilha.abas) {
    // O cabeçalho da SINAPI vem depois de linhas de título e competência, nunca na
    // primeira. Vinte linhas de margem cobrem isso sem varrer a planilha inteira à toa.
    const inicio = planilha.linhas(aba, 20);
    const linhaDoCabecalho = inicio.findIndex((linha) => acharColunas(linha) !== null);
    if (linhaDoCabecalho < 0) continue;

    const colunas = acharColunas(inicio[linhaDoCabecalho])!;
    const todas = planilha.linhas(aba);
    const itens: ItemSinapi[] = [];
    const vistos = new Set<string>();
    let ignoradas = 0;

    for (const linha of todas.slice(linhaDoCabecalho + 1)) {
      const codigo = (linha[colunas.codigo] ?? "").trim();
      const descricao = (linha[colunas.descricao] ?? "").trim();
      const unidade = (linha[colunas.unidade] ?? "").trim();
      const custo = paraCentavos(linha[colunas.custo] ?? "");
      // Linha sem código, sem descrição ou sem custo legível é rodapé, separador ou
      // subtotal. Contar quantas foram ignoradas entra no laudo: um salto nesse número
      // entre competências é sinal de que o layout mudou.
      if (!codigo || !descricao || custo === null) { ignoradas += 1; continue; }
      if (vistos.has(codigo)) { ignoradas += 1; continue; }
      vistos.add(codigo);
      itens.push({ codigo, descricao, unidade, custoUnitarioCentavos: custo, tipo });
    }
    return { itens, aba, linhaDoCabecalho, colunas, ignoradas };
  }
  throw new Error(
    `nenhuma aba tem cabeçalho reconhecível; abas: ${planilha.abas.map((a) => `"${a}"`).join(", ")}. ` +
    "O layout da planilha mudou ou o arquivo não é a referência de preços.",
  );
}
