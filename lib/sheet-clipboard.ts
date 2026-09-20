// Ler um bloco copiado do Excel ou do Google Sheets e transformá-lo em matriz. Camada
// pura: sem React e sem DOM, para rodar igual no navegador, no servidor e no teste.
//
// Só ANÁLISE. Escrever a matriz na grade é de `placeTable`, em `lib/worksheet-tools.ts`,
// que também decide o que fazer quando o bloco não cabe. A separação vale a pena porque o
// difícil aqui é o formato — aspas, quebra de linha dentro da célula, polegada no meio do
// texto — e o difícil lá é o limite da planilha.
//
// O que chega do clipboard é texto, e só texto. Nada aqui converte número: `evaluateSheet`
// já decide o que é número, o que é data e o que é fórmula. Converter duas vezes, com duas
// regras diferentes, é como um "1.500" colado vira 1,5 em silêncio.

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
export function analisarColagem(texto: string, separador?: Separador): string[][] {
  if (!texto || !texto.trim()) return [];

  const linhas = separarCampos(texto, separador ?? escolherSeparador(texto));

  // Excel e Google Sheets terminam o bloco copiado com uma quebra de linha. Sem descartar
  // essa última linha vazia, colar três linhas apagaria a quarta.
  const ultima = linhas[linhas.length - 1];
  if (linhas.length > 1 && ultima.length === 1 && ultima[0] === "") linhas.pop();

  // Clipboard sem conteúdo nenhum não é colagem: seria apagar a célula de destino sem que
  // ninguém tenha pedido isso.
  if (linhas.length === 1 && linhas[0].length === 1 && linhas[0][0].trim() === "") return [];

  return linhas;
}

/** `"3 linhas × 4 colunas"` — o tamanho do bloco, para confirmar antes ou depois de colar. */
export function rotuloDaColagem(matriz: string[][]): string {
  const linhas = matriz.length;
  const colunas = matriz.reduce((maior, linha) => Math.max(maior, linha.length), 0);
  if (linhas === 0 || colunas === 0) return "";
  return `${linhas} ${linhas === 1 ? "linha" : "linhas"} × ${colunas} ${colunas === 1 ? "coluna" : "colunas"}`;
}
