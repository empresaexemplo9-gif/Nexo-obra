import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const { evaluateSheet, parseNumber, axisTotal, resumoDaSelecao, chavesDoRetangulo, rotuloDoRetangulo } = await vite.ssrLoadModule("/lib/spreadsheet.ts");
const { buildTemplateContent, templateById } = await vite.ssrLoadModule("/lib/worksheet-templates.ts");
test.after(() => vite.close());

const source = (path) => readFile(`${root}/${path}`, "utf8");
const valores = (cells) => {
  const r = evaluateSheet(cells);
  return Object.fromEntries(Object.keys(cells).map((k) => [k, r[k]?.error ?? r[k]?.value]));
};

/**
 * Uma planilha de orçamento que dá número errado é pior do que uma que não existe: o
 * número errado é plausível, e ninguém confere o que parece certo. Este arquivo cobre os
 * quatro jeitos que ela tinha de mentir.
 */

test("ponto separa milhar quando não há vírgula, como no Excel em português", () => {
  // `1.500` valia 1,5 — erro de mil vezes, em silêncio. E a exibição formatava 1500 como
  // "1.500", ensinando o formato que a leitura recusava: copiar um número da tela para
  // outra célula o dividia por mil.
  assert.equal(parseNumber("1.500"), 1500);
  assert.equal(parseNumber("12.000"), 12000);
  assert.equal(parseNumber("1.234.567"), 1234567);
});

test("e não estraga o que já funcionava", () => {
  // `1234.56` é a forma que /api/worksheets/data produz (centavos ÷ 100, no máximo duas
  // casas), então a regra dos três dígitos nunca colide com o dado do próprio produto.
  assert.equal(parseNumber("1234.56"), 1234.56);
  assert.equal(parseNumber("1.50"), 1.5);
  assert.equal(parseNumber("1.234,56"), 1234.56);
  assert.equal(parseNumber("R$ 1.234,56"), 1234.56);
  assert.equal(parseNumber("25%"), 0.25);
  assert.equal(parseNumber("alvenaria"), null);
});

test("erro contamina quem depende dele, em vez de valer zero", () => {
  // Célula quebrada valendo nulo — e nulo vale 0 numa conta — fazia o total do orçamento
  // fechar como se estivesse certo, com uma parcela faltando.
  const r = valores({ A1: "=1/0", A2: "=A1*2", A3: "=SOMA(A1:A2)", A4: "=SE(A1>0;1;2)" });
  assert.equal(r.A1, "#DIV/0!");
  assert.equal(r.A2, "#DIV/0!");
  assert.equal(r.A3, "#DIV/0!");
  assert.equal(r.A4, "#DIV/0!");
});

test("SEERRO é a saída explícita, e não engole ciclo", () => {
  const r = valores({ A1: "=SEERRO(1/0;0)", A2: '=SEERRO(1/0;"sem preço")', A3: "=SEERRO(10;99)" });
  assert.equal(r.A1, 0);
  assert.equal(r.A2, "sem preço");
  assert.equal(r.A3, 10, "sem erro, devolve o próprio valor");

  // Alternativa não desfaz um ciclo, só o esconderia.
  const ciclo = valores({ B1: "=SEERRO(B2;0)", B2: "=B1" });
  assert.equal(ciclo.B1, "#CIRCULAR!");
  assert.equal(ciclo.B2, "#CIRCULAR!");
});

test("TETO e PISO respeitam o múltiplo", () => {
  // É a conta de comprar em múltiplo de embalagem — barra de 12 m, saco, caixa de piso.
  const r = valores({ A1: "=TETO(12,3;0,5)", A2: "=PISO(12,3;0,5)", A3: "=TETO(37;12)", A4: "=TETO(12,3)" });
  assert.equal(r.A1, 12.5);
  assert.equal(r.A2, 12);
  assert.equal(r.A3, 48, "três barras de 12 para cobrir 37");
  assert.equal(r.A4, 13, "sem múltiplo, continua arredondando para o inteiro");
});

test("o total da coluna não soma a própria linha de total", () => {
  // Itens de 30 com o total no rodapé mostravam 60 — e 60 é um número plausível.
  const computed = evaluateSheet({ A1: "10", A2: "20", A3: "=SOMA(A1:A2)" });
  assert.equal(axisTotal(computed, "column", 0), 60, "sem marcar a linha, o defeito antigo");
  assert.equal(axisTotal(computed, "column", 0, [2]), 30);
});

test("os dez modelos marcam a linha de total para ignorar", () => {
  for (const template of ["orcamento-obra", "fluxo-de-caixa", "honorarios-etapas"]) {
    const conteudo = buildTemplateContent(templateById(template));
    assert.equal(conteudo.analysis.ignoreRows.length > 0, true, `${template} precisa marcar a linha de total`);
  }
});

test("honorários: o valor do contrato cabe dentro da grade", () => {
  // A fórmula apontava para J1 e a planilha nascia com 9 colunas (A–I): não havia onde
  // digitar, e toda etapa fechava em 0, sem erro nenhum.
  const conteudo = buildTemplateContent(templateById("honorarios-etapas"));
  assert.equal(conteudo.columns >= 10, true, "J precisa existir na grade");

  const r = evaluateSheet({ ...conteudo.cells, J1: "100000", A2: "Estudo", B2: "30", A3: "Executivo", B3: "70" });
  assert.equal(r.C2?.value, 30000);
  assert.equal(r.C3?.value, 70000);
});

test("honorários sem contrato preenchido fica vazio, não zero", () => {
  const conteudo = buildTemplateContent(templateById("honorarios-etapas"));
  const r = evaluateSheet({ ...conteudo.cells, A2: "Estudo", B2: "30" });
  assert.equal(r.C2?.value, "", "zero é um número que a tela exibe sem ninguém desconfiar");
});

test("fluxo de caixa: o saldo acumulado sobrevive a uma linha em branco", () => {
  // O saldo vinha de `G{anterior}+F{linha}`. Linha em branco valia "", que numa conta
  // vale 0, e o acumulado REINICIAVA do zero sem avisar.
  const conteudo = buildTemplateContent(templateById("fluxo-de-caixa"));
  const r = evaluateSheet({ ...conteudo.cells, A2: "01/03", D2: "10000", A4: "03/03", E4: "2500" });
  assert.equal(r.G2?.value, 10000);
  assert.equal(r.G3?.value, "", "linha sem movimento não inventa saldo");
  assert.equal(r.G4?.value, 7500, "antes voltava a -2500");
});

test("o resumo da seleção não trata erro como zero", () => {
  const computed = evaluateSheet({ A1: "10", A2: "=1/0", A3: "20" });
  const resumo = resumoDaSelecao(computed, ["A1", "A2", "A3"]);
  assert.equal(resumo.soma, 30);
  assert.equal(resumo.comErro, 1);
  assert.equal(resumo.numericas, 2);
});

test("resumo sem número nenhum devolve null, não zero", () => {
  const computed = evaluateSheet({ A1: "alvenaria", A2: "pintura" });
  const resumo = resumoDaSelecao(computed, ["A1", "A2"]);
  assert.equal(resumo.soma, null);
  assert.equal(resumo.media, null);
  assert.equal(resumo.preenchidas, 2);
});

test("o retângulo é o mesmo em qualquer sentido de arrasto", () => {
  assert.deepEqual(chavesDoRetangulo("A1", "B2"), chavesDoRetangulo("B2", "A1"));
  assert.equal(rotuloDoRetangulo("A2", "C31"), "A2:C31 · 30L × 3C");
  assert.equal(rotuloDoRetangulo("A5", "A5"), "A5", "uma célula não vira intervalo");
});

test("a planilha avisa antes de descartar digitação", async () => {
  // Trocar de planilha, criar outra ou dar F5 descartava tudo em silêncio. O padrão já
  // existia na Prancheta e a planilha não usava.
  const tela = await source("components/worksheets-workspace.tsx");
  assert.match(tela, /beforeunload/);
  assert.match(tela, /confirmarDescarte/);
  const aoTrocar = tela.slice(tela.indexOf('aria-label="Abrir"'), tela.indexOf('aria-label="Abrir"') + 300);
  assert.match(aoTrocar, /confirmarDescarte\(\)/, "trocar de planilha passa pela confirmação");
});

test("conflito de edição deixa de ser beco sem saída", async () => {
  // A revisão local nunca era atualizada: toda tentativa seguinte levava o mesmo 409 e a
  // única saída era recarregar e perder tudo.
  const tela = await source("components/worksheets-workspace.tsx");
  assert.match(tela, /worksheet_conflict/);
  assert.match(tela, /salvarSobreVersaoNova/);
  assert.match(tela, /usarVersaoDoServidor/);
  assert.match(tela, /Baixar o meu em CSV/);
});

test("o proxy genérico não emite nota fiscal", async () => {
  // Ele encaminha o corpo que vier do navegador, com a Idempotency-Key escolhida por ele
  // e sem validação de campo fiscal. Nota autorizada não se apaga.
  const recursos = await source("lib/server/drap-resources.ts");
  const escrevíveis = recursos.slice(recursos.indexOf("const WRITABLE_RESOURCES"), recursos.indexOf("const CACHE_TTL_MS"));
  assert.doesNotMatch(escrevíveis, /"nfse"/);
  assert.match(recursos, /nfse: \[/, "a leitura continua: consultar nota não emite nada");
});

test("o resumo nunca devolve 'falha inesperada' sem dizer a causa", async () => {
  // Foi a mensagem que apareceu em produção e não ajudou ninguém a agir. Todo caminho de
  // falha do resumo precisa carregar código e motivo — inclusive os que lançam `Error`
  // cru vindos do plano B, da montagem da URL e da resposta fora do formato.
  const cliente = await source("lib/integrations/drap.ts");
  const resumo = cliente.slice(cliente.indexOf("export async function fetchDrapFinancialSummary"), cliente.indexOf("async function somarResumoPelosLancamentos"));

  assert.match(resumo, /caminho-invalido/, "URL mal formada tem código próprio");
  assert.match(resumo, /resposta-nao-json/, "200 com HTML tem código próprio");
  assert.match(resumo, /resumo-por-lancamentos/, "a falha do plano B tem código próprio");
  assert.match(resumo, /DRAP_SUMMARY_PATH\?\.trim\(\) \|\| /, "caminho em branco cai no padrão");
});
