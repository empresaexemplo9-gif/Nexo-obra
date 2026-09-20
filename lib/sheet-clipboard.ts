// Colar um bloco copiado do Excel ou do Google Sheets na grade. Camada pura: sem React e
// sem DOM, para rodar igual no navegador, no servidor e no teste.
//
// O que chega do clipboard é texto, e só texto. Nada aqui converte número: `evaluateSheet`
// já decide o que é número, o que é data e o que é fórmula. Converter duas vezes, com duas
// regras diferentes, é como um "1.500" colado vira 1,5 em silêncio.

import {
  SHEET_MAX_COLUMNS,
  SHEET_MAX_ROWS,
  cellKey,
  parseCellKey,
  type SheetCells,
} from "@/lib/spreadsheet";

/** Quanto texto uma célula aceita, igual ao `cellsSchema` de `lib/worksheets.ts`. */
export const LIMITE_CARACTERES_CELULA = 2000;

export type LimitesColagem = {
  /** Colunas visíveis da planilha. Nunca passa de `SHEET_MAX_COLUMNS`. */
  colunas?: number;
  /** Linhas visíveis da planilha. Nunca passa de `SHEET_MAX_ROWS`. */
  linhas?: number;
};

export type ResultadoColagem = {
  cells: SheetCells;
  /** Só as chaves que mudaram de valor — inclusive as que foram apagadas. */
  alterados: string[];
  /** Quantas colunas e linhas não couberam na grade, ou `null` quando coube tudo. */
  truncado: { colunas: number; linhas: number } | null;
  /** Chaves cujo texto passava de `LIMITE_CARACTERES_CELULA` e foi cortado. */
  cortadas: string[];
};

type Separador = "\t" | ";" | ",";

/**
 * Conta separadores fora das aspas, alternando o estado a cada `"`.
 *
 * Alternar é suficiente para o caso normal: `""` (aspa escapada dentro do campo) alterna
 * duas vezes e volta ao mesmo estado. O que a alternância não distingue é a aspa solta de
 * polegada — `Tubo 5" PVC;12`, que aparece o tempo todo em material de obra — e ali ela
 * abre um campo que nunca fecha, escondendo todos os separadores seguintes. Por isso quem
 * chama confere o total e recorre à contagem crua quando este resultado dá zero.
 */
function contarForaDeAspas(texto: string) {
  const total: Record<Separador, number> = { "\t": 0, ";": 0, ",": 0 };
  let dentroDeAspas = false;
  for (const caractere of texto) {
    if (caractere === '"') { dentroDeAspas = !dentroDeAspas; continue; }
    if (dentroDeAspas) continue;
    if (caractere === "\t" || caractere === ";" || caractere === ",") total[caractere] += 1;
  }
  return total;
}

function contarTudo(texto: string) {
  const total: Record<Separador, number> = { "\t": 0, ";": 0, ",": 0 };
  for (const caractere of texto) {
    if (caractere === "\t" || caractere === ";" || caractere === ",") total[caractere] += 1;
  }
  return total;
}

/**
 * O separador que o texto colado realmente usa.
 *
 * TAB vence sempre: é o formato que Excel e Google Sheets colocam no clipboard, e um TAB
 * nunca aparece por acaso dentro de um valor. Sem TAB, `;` vence `,` porque em português a
 * vírgula é o separador decimal: em `Alvenaria;1.234,56` quebrar na vírgula partiria o
 * preço ao meio.
 */
function escolherSeparador(texto: string): Separador {
  const fora = contarForaDeAspas(texto);
  const contagem = fora["\t"] + fora[";"] + fora[","] > 0 ? fora : contarTudo(texto);
  if (contagem["\t"] > 0) return "\t";
  if (contagem[";"] > 0) return ";";
  if (contagem[","] > 0) return ",";
  // Sem separador nenhum é uma coluna só; o TAB apenas nunca vai ser encontrado.
  return "\t";
}

function separarCampos(texto: string, separador: Separador): string[][] {
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let inicioDeCampo = true;
  let indice = 0;

  while (indice < texto.length) {
    const caractere = texto[indice];

    // A aspa só é delimitador no começo do campo. No meio ela é medida de polegada, e
    // `5" PVC` precisa chegar inteiro à célula.
    if (inicioDeCampo && caractere === '"') {
      indice += 1;
      while (indice < texto.length) {
        const atual = texto[indice];
        if (atual === '"') {
          if (texto[indice + 1] === '"') { campo += '"'; indice += 2; continue; }
          indice += 1;
          break;
        }
        // Quebra de linha dentro da célula vira `\n` puro: o `\r` sobrando reapareceria na
        // tela como caractere invisível e voltaria assim para o banco.
        if (atual === "\r") {
          campo += "\n";
          indice += texto[indice + 1] === "\n" ? 2 : 1;
          continue;
        }
        campo += atual;
        indice += 1;
      }
      // Aspa que nunca fecha leva o resto do texto para a célula. Recusar a colagem
      // inteira por causa de um caractere perdido custa mais do que uma célula estranha.
      inicioDeCampo = false;
      continue;
    }

    if (caractere === separador) {
      linha.push(campo);
      campo = "";
      inicioDeCampo = true;
      indice += 1;
      continue;
    }

    if (caractere === "\n" || caractere === "\r") {
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
      inicioDeCampo = true;
      indice += caractere === "\r" && texto[indice + 1] === "\n" ? 2 : 1;
      continue;
    }

    campo += caractere;
    inicioDeCampo = false;
    indice += 1;
  }

  linha.push(campo);
  linhas.push(linha);
  return linhas;
}

/**
 * Transforma o texto do clipboard na matriz que será escrita na grade.
 *
 * Aceita o TSV do Excel e do Google Sheets e o CSV de arquivo aberto no bloco de notas,
 * com célula entre aspas guardando TAB, `;`, `,` e quebra de linha.
 */
export function analisarColagem(texto: string): string[][] {
  if (!texto || !texto.trim()) return [];

  const linhas = separarCampos(texto, escolherSeparador(texto));

  // Excel e Google Sheets terminam o bloco copiado com uma quebra de linha. Sem descartar
  // essa última linha vazia, colar três linhas apagaria a quarta.
  const ultima = linhas[linhas.length - 1];
  if (linhas.length > 1 && ultima.length === 1 && ultima[0] === "") linhas.pop();

  // Clipboard sem conteúdo nenhum não é colagem: seria apagar a célula de destino sem que
  // ninguém tenha pedido isso.
  if (linhas.length === 1 && linhas[0].length === 1 && linhas[0][0].trim() === "") return [];

  return linhas;
}

function dentroDoLimite(valor: number | undefined, maximo: number) {
  if (!Number.isFinite(valor) || valor === undefined) return maximo;
  return Math.max(0, Math.min(Math.floor(valor), maximo));
}

/**
 * Escreve a matriz a partir da âncora e devolve a grade nova.
 *
 * O que passa de `SHEET_MAX_COLUMNS`/`SHEET_MAX_ROWS` é descartado e contado em
 * `truncado`, para a interface avisar. Colar 40 linhas e gravar 12 sem dizer nada é a
 * forma mais cara de perder dado: a pessoa fecha a planilha achando que copiou tudo.
 */
export function aplicarColagem(
  cells: SheetCells,
  ancora: string,
  matriz: string[][],
  limites: LimitesColagem = {},
): ResultadoColagem {
  const vazio: ResultadoColagem = { cells, alterados: [], truncado: null, cortadas: [] };
  const inicio = parseCellKey(ancora);
  if (!inicio || matriz.length === 0) return vazio;

  // O limite vem da interface, e interface não define teto: mesmo que peça 999 colunas, a
  // grade continua sendo a que `cellKey` e o schema de persistência sabem endereçar.
  const maximoColunas = dentroDoLimite(limites.colunas, SHEET_MAX_COLUMNS);
  const maximoLinhas = dentroDoLimite(limites.linhas, SHEET_MAX_ROWS);

  const largura = matriz.reduce((maior, linha) => Math.max(maior, linha.length), 0);
  const colunasQueCabem = Math.max(0, maximoColunas - inicio.column);
  const linhasQueCabem = Math.max(0, maximoLinhas - inicio.row);

  const proximas: SheetCells = { ...cells };
  const alterados: string[] = [];
  const cortadas: string[] = [];

  const linhasEscritas = Math.min(matriz.length, linhasQueCabem);
  const colunasEscritas = Math.min(largura, colunasQueCabem);

  for (let linha = 0; linha < linhasEscritas; linha += 1) {
    for (let coluna = 0; coluna < colunasEscritas; coluna += 1) {
      const chave = cellKey({ column: inicio.column + coluna, row: inicio.row + linha });
      const bruto = matriz[linha][coluna] ?? "";
      const anterior = proximas[chave];

      // Célula vazia da matriz apaga o destino, como no Excel — mas some do objeto em vez
      // de virar chave com string vazia, porque o resto do código lê ausência como vazio.
      if (bruto.trim() === "") {
        if (anterior !== undefined) { delete proximas[chave]; alterados.push(chave); }
        continue;
      }

      // Uma célula acima de 2000 caracteres faz o schema recusar o salvamento inteiro: a
      // colagem pareceria ter dado certo e todo o trabalho seguinte morreria no 400.
      const valor = bruto.length > LIMITE_CARACTERES_CELULA ? bruto.slice(0, LIMITE_CARACTERES_CELULA) : bruto;
      if (valor !== bruto) cortadas.push(chave);
      if (anterior === valor) continue;
      proximas[chave] = valor;
      alterados.push(chave);
    }
  }

  const colunasDescartadas = Math.max(0, largura - colunasQueCabem);
  const linhasDescartadas = Math.max(0, matriz.length - linhasQueCabem);
  const truncado = colunasDescartadas > 0 || linhasDescartadas > 0
    ? { colunas: colunasDescartadas, linhas: linhasDescartadas }
    : null;

  // Nada mudou: devolver a mesma referência evita marcar a planilha como suja e disparar
  // um salvamento que não tem o que salvar.
  if (alterados.length === 0) return { cells, alterados, truncado, cortadas };

  return { cells: proximas, alterados, truncado, cortadas };
}

/** `"3 linhas × 4 colunas"` — o tamanho do bloco, para confirmar antes ou depois de colar. */
export function rotuloDaColagem(matriz: string[][]): string {
  const linhas = matriz.length;
  const colunas = matriz.reduce((maior, linha) => Math.max(maior, linha.length), 0);
  if (linhas === 0 || colunas === 0) return "";
  return `${linhas} ${linhas === 1 ? "linha" : "linhas"} × ${colunas} ${colunas === 1 ? "coluna" : "colunas"}`;
}
