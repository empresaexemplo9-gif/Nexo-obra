// Copiar, recortar e colar dentro da planilha, com o "colar especial" do Excel.
//
// A área de transferência do sistema continua recebendo o texto em TSV — é o que o Excel
// e o Google Planilhas entendem. Para colar dentro da própria planilha guardamos também o
// recorte completo (fórmulas, estilos e negrito), e o texto serve para reconhecer que a
// colagem veio daqui: se a pessoa copiou outra coisa depois, o texto não bate e vale o TSV.

import { cellKey, displayValue, offsetFormula, SHEET_MAX_COLUMNS, SHEET_MAX_ROWS, type SheetCells, type SheetResult } from "@/lib/spreadsheet";
import { boundsOf, type Bounds, type CellStyle, type CellStyles } from "@/lib/worksheet-format";

export type ModoDeColagem = "tudo" | "valores" | "formatacao" | "transposto";

export type Recorte = {
  origem: { row: number; column: number };
  linhas: number;
  colunas: number;
  brutos: Array<Array<string | undefined>>;
  valores: Array<Array<string | undefined>>;
  estilos: Array<Array<CellStyle | undefined>>;
  negrito: boolean[][];
  notas: Array<Array<string | undefined>>;
};

type Conteudo = { cells: SheetCells; styles?: CellStyles; bold: string[]; notes?: Record<string, string>; merges?: string[] };

/** Valor calculado escrito como entrada literal: número com vírgula, texto com apóstrofo. */
function comoLiteral(result: SheetResult[string] | undefined) {
  if (!result || result.value === null || result.value === "") return undefined;
  if (result.error) return undefined;
  if (typeof result.value === "number") return String(result.value).replace(".", ",");
  if (typeof result.value === "string") return `'${result.value}`;
  return displayValue(result.value);
}

export function copiarIntervalo(content: Conteudo, computed: SheetResult, bounds: Bounds): Recorte {
  const negrito = new Set(content.bold);
  const linhas = bounds.bottom - bounds.top + 1, colunas = bounds.right - bounds.left + 1;
  const grade = <T,>(ler: (key: string) => T) => Array.from({ length: linhas }, (_, i) =>
    Array.from({ length: colunas }, (_, j) => ler(cellKey({ row: bounds.top + i, column: bounds.left + j }))));
  return {
    origem: { row: bounds.top, column: bounds.left },
    linhas, colunas,
    brutos: grade((key) => content.cells[key]),
    valores: grade((key) => {
      const raw = content.cells[key];
      return raw?.startsWith("=") ? comoLiteral(computed[key]) : raw;
    }),
    estilos: grade((key) => content.styles?.[key]),
    negrito: grade((key) => negrito.has(key)),
    notas: grade((key) => content.notes?.[key]),
  };
}

/**
 * Limpa as células, como os três "Limpar" do Excel: conteúdo (só o valor), formatação
 * (estilo e negrito) ou tudo (inclusive a nota).
 */
export function limparChaves(content: Conteudo, keys: Iterable<string>, oQue: "conteudo" | "formatacao" | "tudo") {
  const cells = { ...content.cells }, styles = { ...(content.styles ?? {}) }, notes = { ...(content.notes ?? {}) };
  const alvo = new Set(keys);
  for (const key of alvo) {
    if (oQue !== "formatacao") delete cells[key];
    if (oQue !== "conteudo") delete styles[key];
    if (oQue === "tudo") delete notes[key];
  }
  const bold = oQue === "conteudo" ? content.bold : content.bold.filter((key) => !alvo.has(key));
  return { cells, styles, notes, bold };
}

export function chavesDoIntervalo(bounds: Bounds) {
  const keys: string[] = [];
  for (let row = bounds.top; row <= bounds.bottom; row += 1) {
    for (let column = bounds.left; column <= bounds.right; column += 1) keys.push(cellKey({ row, column }));
  }
  return keys;
}

/** Recortar tira tudo do lugar de origem — valor, formatação e nota vão juntos no recorte. */
export function limparIntervalo(content: Conteudo, bounds: Bounds, oQue: "conteudo" | "formatacao" | "tudo") {
  return limparChaves(content, chavesDoIntervalo(bounds), oQue);
}

/** Texto da área de transferência comparável: o Windows troca \n por \r\n no caminho. */
export function mesmoTexto(a: string, b: string) {
  const normal = (texto: string) => texto.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  return normal(a) === normal(b);
}

/**
 * Cola o recorte a partir de `destino`. Fórmula copiada anda como no Excel: a referência
 * relativa desloca, a travada com $ fica. Célula vazia no recorte limpa o destino — colar
 * é substituir o retângulo inteiro, não mesclar com o que havia.
 *
 * Transposto troca linhas por colunas. Fórmulas vão como resultado: transpor referências
 * relativas produz conta diferente da original, e isso passaria despercebido.
 */
export function colarRecorte(content: Conteudo, recorte: Recorte, destino: { row: number; column: number }, modo: ModoDeColagem) {
  const transposto = modo === "transposto";
  const altura = transposto ? recorte.colunas : recorte.linhas;
  const largura = transposto ? recorte.linhas : recorte.colunas;
  const alvo: Bounds = { top: destino.row, left: destino.column, bottom: destino.row + altura - 1, right: destino.column + largura - 1 };
  if (alvo.bottom >= SHEET_MAX_ROWS || alvo.right >= SHEET_MAX_COLUMNS) {
    throw new Error(`O recorte não cabe a partir de ${cellKey(destino)}. Limite: ${SHEET_MAX_ROWS} linhas e ${SHEET_MAX_COLUMNS} colunas.`);
  }
  for (const range of content.merges ?? []) {
    const merge = boundsOf(range);
    if (!merge) continue;
    const cruza = merge.left <= alvo.right && alvo.left <= merge.right && merge.top <= alvo.bottom && alvo.top <= merge.bottom;
    const dentro = merge.left >= alvo.left && merge.right <= alvo.right && merge.top >= alvo.top && merge.bottom <= alvo.bottom;
    if (cruza && !dentro) throw new Error(`A colagem corta a mesclagem ${range}. Desfaça-a antes.`);
  }

  const cells = { ...content.cells }, styles = { ...(content.styles ?? {}) }, notes = { ...(content.notes ?? {}) };
  const negrito = new Set(content.bold);
  for (let i = 0; i < recorte.linhas; i += 1) {
    for (let j = 0; j < recorte.colunas; j += 1) {
      const row = destino.row + (transposto ? j : i), column = destino.column + (transposto ? i : j);
      const key = cellKey({ row, column });
      if (modo !== "formatacao") {
        const bruto = recorte.brutos[i][j];
        const valor = modo === "valores" || (transposto && bruto?.startsWith("="))
          ? recorte.valores[i][j]
          : bruto === undefined ? undefined : offsetFormula(bruto, row - (recorte.origem.row + i), column - (recorte.origem.column + j));
        if (valor === undefined || valor === "") delete cells[key]; else cells[key] = valor;
      }
      if (modo !== "valores") {
        const estilo = recorte.estilos[i][j];
        if (estilo) styles[key] = estilo; else delete styles[key];
        if (recorte.negrito[i][j]) negrito.add(key); else negrito.delete(key);
      }
      if (modo === "tudo" || modo === "transposto") {
        const nota = recorte.notas[i][j];
        if (nota) notes[key] = nota; else delete notes[key];
      }
    }
  }
  if (Object.keys(cells).length > 20_000) throw new Error("A planilha excederia 20.000 células preenchidas.");
  return { cells, styles, notes, bold: [...negrito], alvo };
}
