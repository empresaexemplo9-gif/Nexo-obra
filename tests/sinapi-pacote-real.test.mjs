// Nomenclatura real dos pacotes da Caixa.
//
// Os nomes vieram da listagem de GO fornecida pelo titular — 115 arquivos, e não há um
// padrão só: `202412` (AAAAMM) convive com `092023` (MMAAAA, invertido), com retificações
// separadas por sublinhado (`..._Desonerado_Retificacao01`) e coladas
// (`...DesoneradoRetificacao02`), além de pacotes semestrais e quadrimestrais.
//
// O extrator exigia a competência escrita como `AAAA_MM` E a palavra "referencia" no nome.
// Isso recusava praticamente todo o acervo histórico, e a mensagem de erro não dizia o que
// havia dentro do pacote — quem tentava importar ficava sem caminho adiante.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { createServer } from "vite";
import { montarZip, xlsx } from "./helpers/sinapi-fixtures.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ configFile: false, appType: "custom", root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const { referenceFile, formasDaCompetencia, parseNationalPackage } = await vite.ssrLoadModule("/lib/integrations/sinapi-mapped.ts");
after(() => vite.close());

const planilha = () => xlsx({ "Composições": [["SINAPI"], ["Código", "Descrição", "Unidade", "GO"], ["1", "Serviço", "M2", "1.234,56"]] });

test("competência é reconhecida nas quatro formas que a Caixa usa", () => {
  assert.deepEqual(formasDaCompetencia("2024-12"), ["2024_12", "202412", "122024", "2024-12"]);
});

test("pacote mensal recente: AAAAMM sem sublinhado", () => {
  // SINAPI_ref_Insumos_Composicoes_GO_202412_NaoDesonerado.zip
  const pacote = montarZip({ "SINAPI_Custo_Ref_Composicoes_Analitico_GO_202412_NaoDesonerado.xlsx": planilha() });
  assert.match(referenceFile(pacote, "2024-12").name, /202412/);
});

test("pacote histórico com mês e ano invertidos", () => {
  // SINAPI_ref_Insumos_Composicoes_GO_092023_Desonerado.zip — MMAAAA, não AAAAMM.
  const pacote = montarZip({ "SINAPI_Custo_Ref_Composicoes_Analitico_GO_092023_Desonerado.xlsx": planilha() });
  assert.match(referenceFile(pacote, "2023-09").name, /092023/);
});

test("retificação, com e sem sublinhado antes do sufixo", () => {
  const comTraco = montarZip({ "SINAPI_Referencia_GO_202305_NaoDesonerado_Retificacao01.xlsx": planilha() });
  assert.ok(referenceFile(comTraco, "2023-05").bytes.length);
  // SINAPI_ref_Insumos_Composicoes_GO_102022_DesoneradoRetificacao02 — colado.
  const colado = montarZip({ "SINAPI_Referencia_GO_102022_DesoneradoRetificacao02.xlsx": planilha() });
  assert.ok(referenceFile(colado, "2022-10").bytes.length);
});

test("planilha única no pacote é aceita mesmo sem a competência no nome", () => {
  // Pacotes antigos nomeiam a planilha sem repetir a competência.
  const pacote = montarZip({ "Relatorio_Insumos_Composicoes.xlsx": planilha() });
  assert.equal(referenceFile(pacote, "2017-07").name, "Relatorio_Insumos_Composicoes.xlsx");
});

test("a planilha da competência vence as outras do mesmo pacote", () => {
  // Pacotes semestrais trazem vários meses juntos; escolher o errado importaria preço de
  // outro mês sem nenhum aviso.
  const pacote = montarZip({
    "SINAPI_Referencia_GO_202411_Desonerado.xlsx": planilha(),
    "SINAPI_Referencia_GO_202412_Desonerado.xlsx": planilha(),
    "leiame.txt": Buffer.from("aviso"),
  });
  assert.match(referenceFile(pacote, "2024-12").name, /202412/);
});

test("ambiguidade na mesma competência lista o que existe, em vez de só dizer que não deu", () => {
  // Acontece de verdade: o pacote traz os dois regimes da mesma competência. Escolher um
  // por conta própria importaria preço desonerado como não desonerado, ou o contrário.
  const pacote = montarZip({
    "SINAPI_Referencia_GO_202412_Desonerado.xlsx": planilha(),
    "SINAPI_Referencia_GO_202412_NaoDesonerado.xlsx": planilha(),
  });
  assert.throws(() => referenceFile(pacote, "2024-12"), (erro) => {
    assert.match(erro.message, /não consegui identificar/i);
    // A mensagem tem que carregar os nomes: é o que permite consertar em uma rodada.
    assert.match(erro.message, /Desonerado/);
    assert.match(erro.message, /NaoDesonerado/);
    return true;
  });
});

test("pacote só com PDF diz para baixar a versão xlsx", () => {
  // Boa parte do acervo antigo de GO é "Versão PDF" — sem planilha nenhuma.
  const pacote = montarZip({ "Relatorio.pdf": Buffer.from("%PDF-1.4"), "leiame.txt": Buffer.from("x") });
  assert.throws(() => referenceFile(pacote, "2015-01"), /nenhuma planilha \.xlsx.*formato xlsx/s);
});

test("pacote do mês errado é recusado, mesmo com uma planilha só", () => {
  // Sem isto, o fallback de "planilha única" aceitaria o arquivo de outro mês e os preços
  // entrariam rotulados com a competência pedida — errado e sem nenhum aviso.
  const pacote = montarZip({ "SINAPI_Referencia_GO_202411_Desonerado.xlsx": planilha() });
  assert.throws(() => referenceFile(pacote, "2024-12"), /competência 2024-12.*202411/s);
});

function tabelaNacional(regime, goInsumo, spInsumo, goComposicao, spComposicao) {
  const tituloInsumos = `RELATÓRIO DE PREÇOS DE INSUMOS - ENCARGOS SOCIAIS ${regime}`;
  const tituloComposicoes = `RELATÓRIO DE CUSTOS DE COMPOSIÇÕES - ENCARGOS SOCIAIS ${regime}`;
  const insumos = xlsx({ Insumos: [
    [tituloInsumos],
    ["Classificação", "Código do Insumo", "Descrição do Insumo", "Unidade", "Origem de Preço", "GO", "SP"],
    ...Array.from({ length: 120 }, (_, i) => ["MATERIAL", String(i + 1), `Insumo ${i + 1}`, "UN", "C", goInsumo, spInsumo]),
  ] });
  const composicoes = xlsx({ Composicoes: [
    [tituloComposicoes],
    ["Grupo", "Código da Composição", "Descrição", "Unidade", "GO Custo (R$)", "GO %AS", "SP Custo (R$)", "SP %AS"],
    ...Array.from({ length: 120 }, (_, i) => ["Grupo", String(1000 + i), `Composição ${i + 1}`, "M2", goComposicao, "0%", spComposicao, "0%"]),
  ] });
  return { insumos, composicoes };
}

test("pacote nacional 2025+ seleciona a UF pedida sem misturar preços", () => {
  const sem = tabelaNacional("SEM DESONERAÇÃO", "1,23", "9,87", "4,56", "8,76");
  const pacote = montarZip({
    "Relatorio_Insumos_Sem_Desoneracao.xlsx": sem.insumos,
    "Relatorio_Composicoes_Sem_Desoneracao.xlsx": sem.composicoes,
  });
  const go = parseNationalPackage(pacote, "2026-08", "GO", "NaoDesonerado");
  const sp = parseNationalPackage(pacote, "2026-08", "SP", "NaoDesonerado");
  assert.ok(go); assert.ok(sp);
  assert.equal(go.itens.length, 240); assert.equal(sp.itens.length, 240);
  assert.equal(go.itens.find((i) => i.tipo === "insumo").custoUnitarioCentavos, 123);
  assert.equal(sp.itens.find((i) => i.tipo === "insumo").custoUnitarioCentavos, 987);
  assert.equal(go.itens.find((i) => i.tipo === "composicao").custoUnitarioCentavos, 456);
  assert.equal(sp.itens.find((i) => i.tipo === "composicao").custoUnitarioCentavos, 876);
});

test("pacote nacional não mistura desonerado com não desonerado", () => {
  const sem = tabelaNacional("SEM DESONERAÇÃO", "1,00", "2,00", "3,00", "4,00");
  const com = tabelaNacional("COM DESONERAÇÃO", "11,00", "12,00", "13,00", "14,00");
  const pacote = montarZip({
    "Insumos_Sem_Desoneracao.xlsx": sem.insumos,
    "Composicoes_Sem_Desoneracao.xlsx": sem.composicoes,
    "Insumos_Desonerado.xlsx": com.insumos,
    "Composicoes_Desonerado.xlsx": com.composicoes,
  });
  const nao = parseNationalPackage(pacote, "2026-08", "GO", "NaoDesonerado");
  const des = parseNationalPackage(pacote, "2026-08", "GO", "Desonerado");
  assert.ok(nao); assert.ok(des);
  assert.equal(nao.itens.find((i) => i.tipo === "insumo").custoUnitarioCentavos, 100);
  assert.equal(des.itens.find((i) => i.tipo === "insumo").custoUnitarioCentavos, 1100);
});
