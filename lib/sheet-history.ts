// Desfazer e refazer da planilha. Camada pura: sem React e sem DOM, para que a mesma
// regra valha na tela, no teste e em qualquer tela futura que edite `SheetCells`.
//
// POR QUE GUARDAR O ESTADO INTEIRO EM VEZ DE DIFERENÇAS
//
// Medido com cópia rasa de `SheetCells` (as strings são imutáveis e ficam compartilhadas
// entre os passos; o que cada passo paga de fato é a tabela de chaves):
//
//   planilha comum     8 col × 60 lin  =    480 células →    4 KB/passo → 50 passos = 0,2 MB
//   orçamento grande  12 col × 300 lin =  3.600 células →  192 KB/passo → 50 passos = 9,4 MB
//   grade 100% cheia  52 col × 500 lin = 26.000 células → 1536 KB/passo → 50 passos =  75 MB
//
// Nos dois primeiros casos — que são a planilha real do produto — o estado inteiro custa
// pouco e dispensa a máquina de aplicar e reverter patches, que é justamente onde mora o
// erro caro: um patch reverso incompleto devolve a planilha quase certa, e planilha quase
// certa é o defeito que este módulo existe para evitar. Só a grade cheia aperta, e para
// ela basta um segundo teto medido em células: o histórico encurta em vez de trocar de
// estrutura.

import type { SheetCells } from "./spreadsheet";

/**
 * O que um passo guarda além das células.
 *
 * Existe porque excluir uma coluna não mexe só nas células: mexe em `columns`, e mexe
 * nos parâmetros de análise, que guardam POSIÇÕES (qual linha é o cabeçalho, qual coluna
 * é o custo). Um histórico só de células desfaria a exclusão devolvendo o conteúdo numa
 * grade que continua encolhida — a coluna volta e não aparece — e com a coluna "Custo"
 * apontando para a vizinha. Planilha quase certa é exatamente o defeito que desfazer
 * existe para evitar.
 *
 * É genérico e opaco aqui de propósito: o formato desses campos é assunto da tela, e
 * importá-lo tornaria este módulo dependente do domínio de planilhas do produto.
 */
export type EstadoPlanilha<F> = Readonly<{ cells: SheetCells; forma: F }>;

/** Passos que o histórico guarda. Acima disso o mais antigo sai. */
export const TETO_PASSOS = 50;

/**
 * Orçamento de células somando todos os passos guardados. A ~60 bytes por célula medidos
 * acima, 400 mil células ficam em torno de 24 MB: segura a grade cheia (cai para ~15
 * passos) sem encurtar o histórico de quem trabalha numa planilha de tamanho normal, onde
 * 50 passos de 480 células somam 24 mil.
 */
export const TETO_CELULAS = 400_000;

type Passo<F> = Readonly<{
  cells: SheetCells;
  forma: F;
  rotulo: string;
  /** Guardado junto para aplicar o orçamento sem varrer as chaves a cada digitação. */
  celulas: number;
}>;

export type HistoricoPlanilha<F = void> = Readonly<{
  passos: readonly Passo<F>[];
  /** Posição atual. 0 é o estado em que a planilha foi aberta. */
  atual: number;
}>;

export type MovimentoHistorico<F = void> = Readonly<{
  historico: HistoricoPlanilha<F>;
  cells: SheetCells;
  forma: F;
  /** O que acabou de ser desfeito ou refeito, para a confirmação na tela. */
  rotulo: string;
}>;

// O histórico nunca compartilha objeto com quem chama: guarda uma cópia congelada e
// devolve outra cópia, solta. Sem isso, um `cells[chave] = valor` na tela reescreveria o
// passado e desfazer passaria a "restaurar" o estado que o usuário quis abandonar.
function guardar(cells: SheetCells): SheetCells {
  return Object.freeze({ ...cells });
}

function soltar(cells: SheetCells): SheetCells {
  return { ...cells };
}

// Célula ausente e célula vazia são a mesma planilha: `evaluateSheet`, `sortRows` e
// `axisLastFilled` tratam `undefined` e `""` igual. Então digitar e apagar de volta não
// vira passo — senão o botão fica aceso prometendo uma mudança que ninguém vê acontecer.
function mesmoConteudo(a: SheetCells, b: SheetCells) {
  for (const chave of Object.keys(a)) if (a[chave] !== (b[chave] ?? "")) return false;
  for (const chave of Object.keys(b)) if (!(chave in a) && b[chave] !== "") return false;
  return true;
}

export function criarHistorico<F>(inicial: EstadoPlanilha<F>): HistoricoPlanilha<F> {
  const cells = guardar(inicial.cells);
  // O estado de abertura não tem rótulo: ninguém executou ação nenhuma para chegar nele.
  return {
    passos: [{ cells, forma: inicial.forma, rotulo: "", celulas: Object.keys(cells).length }],
    atual: 0,
  };
}

// Duas formas são a mesma quando descrevem a mesma grade. Comparação estrutural barata:
// são poucos campos (linhas, colunas, cabeçalho, papéis), e o custo some perto do que já
// se gasta copiando as células.
function mesmaForma<F>(a: F, b: F) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Empilha um passo. `rotulo` é o texto curto que a tela mostra no botão: "Excluir linha 7",
 * "Preencher para baixo", "Colar 3 linhas × 4 colunas".
 *
 * Registrar depois de desfazer descarta o que estava à frente, como em qualquer editor:
 * a partir do momento em que a pessoa edita, o caminho antigo deixou de existir.
 */
export function registrar<F>(
  historico: HistoricoPlanilha<F>,
  estado: EstadoPlanilha<F>,
  rotulo: string,
): HistoricoPlanilha<F> {
  const topo = historico.passos[historico.atual];
  // A forma entra na comparação porque há mudança estrutural que não toca célula
  // nenhuma: inserir coluna depois da última muda `columns` e mais nada. Comparando só
  // as células, esse passo não seria registrado e desfazer pularia por cima dele.
  if (topo && mesmoConteudo(estado.cells, topo.cells) && mesmaForma(estado.forma, topo.forma)) {
    return historico;
  }

  const guardadas = guardar(estado.cells);
  const passos: Passo<F>[] = [
    ...historico.passos.slice(0, historico.atual + 1),
    { cells: guardadas, forma: estado.forma, rotulo: rotulo.trim(), celulas: Object.keys(guardadas).length },
  ];

  let total = passos.reduce((soma, passo) => soma + passo.celulas, 0);
  let corte = 0;
  // Sempre pela frente: o passo recém-registrado é o único que não pode cair, mesmo que
  // sozinho estoure o orçamento.
  while (passos.length - corte > 1 && (passos.length - corte > TETO_PASSOS + 1 || total > TETO_CELULAS)) {
    total -= passos[corte].celulas;
    corte += 1;
  }

  const finais = corte ? passos.slice(corte) : passos;
  return { passos: finais, atual: finais.length - 1 };
}

export function podeDesfazer<F>(historico: HistoricoPlanilha<F>) {
  return historico.atual > 0;
}

export function podeRefazer<F>(historico: HistoricoPlanilha<F>) {
  return historico.atual < historico.passos.length - 1;
}

export function desfazer<F>(historico: HistoricoPlanilha<F>): MovimentoHistorico<F> | null {
  if (!podeDesfazer(historico)) return null;
  const desfeito = historico.passos[historico.atual];
  const destino = historico.atual - 1;
  return {
    historico: { ...historico, atual: destino },
    cells: soltar(historico.passos[destino].cells),
    forma: historico.passos[destino].forma,
    rotulo: desfeito.rotulo,
  };
}

export function refazer<F>(historico: HistoricoPlanilha<F>): MovimentoHistorico<F> | null {
  if (!podeRefazer(historico)) return null;
  const destino = historico.atual + 1;
  const refeito = historico.passos[destino];
  return {
    historico: { ...historico, atual: destino },
    cells: soltar(refeito.cells),
    forma: refeito.forma,
    rotulo: refeito.rotulo,
  };
}

// "Excluir linha 7" vira "Desfazer excluir linha 7". Sigla fica intacta: "CSV importado"
// viraria "cSV importado", que se lê pior do que a maiúscula fora de lugar.
function inicialMinuscula(texto: string) {
  const segunda = texto[1];
  const ehLetraMaiuscula = (letra: string) =>
    letra.toLocaleUpperCase("pt-BR") === letra && letra.toLocaleLowerCase("pt-BR") !== letra;
  if (segunda && ehLetraMaiuscula(segunda)) return texto;
  return texto[0].toLocaleLowerCase("pt-BR") + texto.slice(1);
}

function frase(verbo: "Desfazer" | "Refazer", rotulo: string) {
  const texto = rotulo.trim();
  return texto ? `${verbo} ${inicialMinuscula(texto)}` : `${verbo} a última alteração`;
}

/**
 * Texto do `title`/`aria-label` do botão. Botão que não diz o que vai desfazer obriga a
 * clicar para descobrir — e descobrir errado é outra perda.
 */
export function rotuloDoProximoDesfazer<F>(historico: HistoricoPlanilha<F>) {
  if (!podeDesfazer(historico)) return "Nada para desfazer";
  return frase("Desfazer", historico.passos[historico.atual].rotulo);
}

export function rotuloDoProximoRefazer<F>(historico: HistoricoPlanilha<F>) {
  if (!podeRefazer(historico)) return "Nada para refazer";
  return frase("Refazer", historico.passos[historico.atual + 1].rotulo);
}
