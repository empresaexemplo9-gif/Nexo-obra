// O vocabulário do desfazer da planilha: os tetos e a frase do botão.
//
// O ESTADO não mora aqui — mora em `hooks/use-worksheet-history.ts`, que guarda a
// `Worksheet` inteira por passo. Este arquivo já teve uma máquina de histórico também;
// quando as duas implementações se encontraram, a do hook venceu por guardar a planilha
// completa (linhas, colunas e parâmetros de análise vêm junto, sem campo extra para
// alguém esquecer de preencher), e o que ficou aqui é o que as duas compartilhavam.
//
// Deixar a máquina morta ao lado seria pior do que nunca tê-la escrito: alguém
// corrigiria um defeito nela achando que estava corrigindo o produto, e os testes dela
// passariam confirmando a correção que ninguém executa.
//
// POR QUE OS TETOS SÃO DOIS
//
// Medido com cópia rasa das células (as strings são imutáveis e ficam compartilhadas
// entre os passos; o que cada passo paga de fato é a tabela de chaves):
//
//   planilha comum     8 col × 60 lin  =    480 células →    4 KB/passo → 50 passos = 0,2 MB
//   orçamento grande  12 col × 300 lin =  3.600 células →  192 KB/passo → 50 passos = 9,4 MB
//   grade 100% cheia  52 col × 500 lin = 26.000 células → 1536 KB/passo → 50 passos =  75 MB
//
// Só a grade cheia aperta. Um teto em passos sozinho encurtaria o histórico de todo
// mundo por causa dela; o teto em células deixa a planilha de tamanho normal com os 50
// passos inteiros e encurta só quem realmente pesa.

/** Passos que o histórico guarda. Acima disso o mais antigo sai. */
export const TETO_PASSOS = 50;

/**
 * Orçamento de células somando todos os passos guardados. A ~60 bytes por célula medidos
 * acima, 400 mil células ficam em torno de 24 MB: segura a grade cheia (cai para ~15
 * passos) sem encurtar o histórico de quem trabalha numa planilha de tamanho normal, onde
 * 50 passos de 480 células somam 24 mil.
 */
export const TETO_CELULAS = 400_000;

// "Excluir linha 7" vira "Desfazer excluir linha 7". Sigla fica intacta: "CSV importado"
// viraria "cSV importado", que se lê pior do que a maiúscula fora de lugar.
function inicialMinuscula(texto: string) {
  const segunda = texto[1];
  const ehLetraMaiuscula = (letra: string) =>
    letra.toLocaleUpperCase("pt-BR") === letra && letra.toLocaleLowerCase("pt-BR") !== letra;
  if (segunda && ehLetraMaiuscula(segunda)) return texto;
  return texto[0].toLocaleLowerCase("pt-BR") + texto.slice(1);
}

/**
 * Texto do `title`/`aria-label` do botão. Botão que não diz o que vai desfazer obriga a
 * clicar para descobrir — e descobrir errado é outra perda.
 */
export function frase(verbo: "Desfazer" | "Refazer", rotulo: string) {
  const texto = rotulo.trim();
  return texto ? `${verbo} ${inicialMinuscula(texto)}` : `${verbo} a última alteração`;
}
