// Leitor de DXF. O que se testa aqui é o que erra em silêncio: unidade, sentido do eixo
// Y, ordem dos vértices e o que o leitor deixou de trazer. Uma planta lida torto só
// aparece na obra.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ configFile: false, appType: "custom", root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const { lerDxf, pares, versaoDoDwg, DxfInvalido, UNIDADES, unidadeLabels } = await vite.ssrLoadModule("/lib/integrations/dxf.ts");
const { elementoSchema } = await vite.ssrLoadModule("/lib/prancheta.ts");
after(() => vite.close());

// Um DXF é uma sequência de pares: código numa linha, valor na seguinte.
const dxf = (...linhas) => `${linhas.flat().join("\n")}\n`;
const secao = (nome, ...conteudo) => ["0", "SECTION", "2", nome, ...conteudo.flat(), "0", "ENDSEC"];
const arquivo = (...secoes) => dxf(...secoes.flat(), "0", "EOF");
const cabecalho = (insunits) => secao("HEADER", "9", "$INSUNITS", "70", String(insunits));

const linha = (x1, y1, x2, y2, camada = "0") =>
  ["0", "LINE", "8", camada, "10", String(x1), "20", String(y1), "11", String(x2), "21", String(y2)];

const soLinha = (...args) => arquivo(secao("ENTITIES", linha(...args)));

const tracos = (resultado) => resultado.elementos.filter((elemento) => elemento.tipo === "traco");

test("separa o arquivo em pares de código e valor, ignorando lixo", () => {
  const lista = pares("  10 \n1500\nnão é código\n20\n800\n");
  assert.deepEqual(lista, [{ codigo: 10, valor: "1500" }, { codigo: 20, valor: "800" }]);
});

test("uma linha vira traço com as duas pontas em milímetro inteiro", () => {
  const resultado = lerDxf(soLinha(0, 0, 3150, 0), { unidade: "mm" });
  assert.equal(resultado.elementos.length, 1);
  const [traco] = tracos(resultado);
  assert.deepEqual(traco.pontos, [{ x: 0, y: 0 }, { x: 3150, y: 0 }]);
  assert.ok(traco.pontos.every((ponto) => Number.isInteger(ponto.x) && Number.isInteger(ponto.y)));
});

test("o eixo Y é invertido: no DXF sobe, aqui desce", () => {
  // Sem esta inversão a planta entra espelhada, e espelhada passa despercebido até
  // alguém executar a obra pelo desenho.
  const [traco] = tracos(lerDxf(soLinha(0, 0, 0, 3000), { unidade: "mm" }));
  assert.deepEqual(traco.pontos, [{ x: 0, y: 0 }, { x: 0, y: -3000 }]);
});

test("cada unidade converte para milímetro pelo fator certo", () => {
  const casos = [["mm", 1000], ["cm", 10000], ["m", 1000000], ["polegada", 25400], ["pe", 304800]];
  for (const [unidade, esperado] of casos) {
    const [traco] = tracos(lerDxf(soLinha(0, 0, 1000, 0), { unidade }));
    assert.equal(traco.pontos[1].x, esperado, `a unidade ${unidade} converteu errado`);
  }
  assert.deepEqual(Object.keys(UNIDADES).sort(), Object.keys(unidadeLabels).sort(), "toda unidade precisa de rótulo em português");
});

test("a unidade declarada no cabeçalho é obedecida sem ninguém precisar dizer", () => {
  const resultado = lerDxf(arquivo(cabecalho(6), secao("ENTITIES", linha(0, 0, 4, 0))));
  assert.equal(resultado.unidade, "m");
  assert.equal(resultado.unidadeDeclarada, true);
  assert.equal(tracos(resultado)[0].pontos[1].x, 4000);
  assert.equal(resultado.avisos.length, 0, "arquivo que declara a unidade não precisa de ressalva");
});

test("a escolha de quem importa vence a do arquivo", () => {
  const resultado = lerDxf(arquivo(cabecalho(6), secao("ENTITIES", linha(0, 0, 4, 0))), { unidade: "cm" });
  assert.equal(resultado.unidade, "cm");
  assert.equal(tracos(resultado)[0].pontos[1].x, 40);
});

test("arquivo sem unidade declarada avisa em vez de fingir que sabe", () => {
  const resultado = lerDxf(soLinha(0, 0, 1000, 0));
  assert.equal(resultado.unidade, "mm");
  assert.equal(resultado.unidadeDeclarada, false);
  assert.match(resultado.avisos.join(" "), /não declara a unidade/i);
  assert.match(resultado.avisos.join(" "), /meça algo conhecido/i);
});

test("polilinha mantém a ordem dos vértices", () => {
  // Ler todos os códigos 10 e depois todos os 20 embaralharia o polígono: o teste
  // usa um L, cuja forma denuncia a troca.
  const resultado = lerDxf(arquivo(secao("ENTITIES", [
    "0", "LWPOLYLINE", "8", "PAREDES", "90", "3", "70", "0",
    "10", "0", "20", "0", "10", "4000", "20", "0", "10", "4000", "20", "3000",
  ])), { unidade: "mm" });
  assert.deepEqual(tracos(resultado)[0].pontos, [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: -3000 }]);
});

test("polilinha fechada volta ao primeiro ponto", () => {
  const resultado = lerDxf(arquivo(secao("ENTITIES", [
    "0", "LWPOLYLINE", "8", "0", "90", "4", "70", "1",
    "10", "0", "20", "0", "10", "3000", "20", "0", "10", "3000", "20", "2000", "10", "0", "20", "2000",
  ])), { unidade: "mm" });
  const pontos = tracos(resultado)[0].pontos;
  assert.equal(pontos.length, 5);
  assert.deepEqual(pontos[4], pontos[0]);
});

test("círculo vira polígono fechado com o raio certo", () => {
  const resultado = lerDxf(arquivo(secao("ENTITIES",
    ["0", "CIRCLE", "8", "0", "10", "1000", "20", "1000", "40", "500"])), { unidade: "mm" });
  const pontos = tracos(resultado)[0].pontos;
  assert.ok(pontos.length > 12, "poucos segmentos deixariam o círculo poligonal à vista");
  for (const ponto of pontos) {
    const raio = Math.hypot(ponto.x - 1000, ponto.y + 1000);
    assert.ok(Math.abs(raio - 500) <= 1, `ponto a ${raio} mm do centro, fora da tolerância de 1 mm`);
  }
});

test("arco cobre só o trecho pedido", () => {
  const resultado = lerDxf(arquivo(secao("ENTITIES",
    ["0", "ARC", "8", "0", "10", "0", "20", "0", "40", "1000", "50", "0", "51", "90"])), { unidade: "mm" });
  const pontos = tracos(resultado)[0].pontos;
  assert.deepEqual(pontos[0], { x: 1000, y: 0 });
  // 90° no DXF é o topo; com o eixo invertido, y negativo.
  assert.equal(pontos[pontos.length - 1].x, 0);
  assert.equal(pontos[pontos.length - 1].y, -1000);
  assert.ok(pontos.every((ponto) => ponto.x >= -1 && ponto.y <= 1), "o arco vazou para fora do quadrante pedido");
});

test("texto entra com o conteúdo, a altura e o giro corrigido pelo eixo", () => {
  const resultado = lerDxf(arquivo(secao("ENTITIES",
    ["0", "TEXT", "8", "LEGENDA", "10", "500", "20", "800", "40", "250", "50", "90", "1", "SALA DE ESTAR"])), { unidade: "mm" });
  const [texto] = resultado.elementos.filter((elemento) => elemento.tipo === "texto");
  assert.equal(texto.texto, "SALA DE ESTAR");
  assert.equal(texto.alturaMm, 250);
  assert.deepEqual(texto.posicao, { x: 500, y: -800 });
  assert.equal(texto.rotacaoGraus, 270, "o giro acompanha a inversão do eixo");
});

test("MTEXT junta as partes e descarta a formatação", () => {
  const resultado = lerDxf(arquivo(secao("ENTITIES", [
    "0", "MTEXT", "8", "0", "10", "0", "20", "0", "40", "200",
    "3", "{\\fArial|b1;QUARTO ", "1", "PRINCIPAL}",
  ])), { unidade: "mm" });
  const [texto] = resultado.elementos.filter((elemento) => elemento.tipo === "texto");
  assert.equal(texto.texto, "QUARTO PRINCIPAL");
});

test("texto vazio não vira elemento fantasma", () => {
  const resultado = lerDxf(arquivo(secao("ENTITIES",
    ["0", "TEXT", "8", "0", "10", "0", "20", "0", "40", "250", "1", "   "])), { unidade: "mm" });
  assert.equal(resultado.elementos.length, 0);
});

test("bloco inserido é desenhado no lugar do INSERT, com a base descontada", () => {
  const resultado = lerDxf(arquivo(
    secao("BLOCKS",
      "0", "BLOCK", "2", "PORTA", "10", "0", "20", "0",
      linha(0, 0, 800, 0, "ESQUADRIAS"),
      "0", "ENDBLK"),
    secao("ENTITIES", ["0", "INSERT", "8", "0", "2", "PORTA", "10", "5000", "20", "2000"]),
  ), { unidade: "mm" });
  const [traco] = tracos(resultado);
  assert.deepEqual(traco.pontos, [{ x: 5000, y: -2000 }, { x: 5800, y: -2000 }]);
  assert.equal(resultado.camadas.find((camada) => camada.id === traco.camada).nome, "ESQUADRIAS",
    "a camada do desenho dentro do bloco é a que vale");
});

test("bloco com ponto-base deslocado entra alinhado ao INSERT", () => {
  const resultado = lerDxf(arquivo(
    secao("BLOCKS", "0", "BLOCK", "2", "PILAR", "10", "100", "20", "100", linha(100, 100, 400, 100), "0", "ENDBLK"),
    secao("ENTITIES", ["0", "INSERT", "8", "0", "2", "PILAR", "10", "1000", "20", "0"]),
  ), { unidade: "mm" });
  assert.deepEqual(tracos(resultado)[0].pontos, [{ x: 1000, y: 0 }, { x: 1300, y: 0 }]);
});

test("INSERT para bloco que não existe é declarado, não engolido", () => {
  const resultado = lerDxf(arquivo(secao("ENTITIES", ["0", "INSERT", "8", "0", "2", "FANTASMA", "10", "0", "20", "0"])), { unidade: "mm" });
  assert.equal(resultado.elementos.length, 0);
  assert.match(resultado.avisos.join(" "), /FANTASMA/);
});

test("bloco que se insere a si mesmo não derruba o servidor", () => {
  const resultado = lerDxf(arquivo(
    secao("BLOCKS",
      "0", "BLOCK", "2", "LOOP", "10", "0", "20", "0",
      linha(0, 0, 100, 0),
      ["0", "INSERT", "8", "0", "2", "LOOP", "10", "100", "20", "0"],
      "0", "ENDBLK"),
    secao("ENTITIES", ["0", "INSERT", "8", "0", "2", "LOOP", "10", "0", "20", "0"]),
  ), { unidade: "mm" });
  assert.ok(resultado.elementos.length > 0 && resultado.elementos.length < 100);
  assert.match(resultado.avisos.join(" "), /aninhado/i);
});

test("cada camada do arquivo vira camada da prancha, com a disciplina palpitada pelo nome", () => {
  const resultado = lerDxf(arquivo(secao("ENTITIES",
    linha(0, 0, 1, 0, "A-PAREDES"),
    linha(0, 0, 1, 0, "ELE-TOMADAS"),
    linha(0, 0, 1, 0, "ILUMINACAO"),
    linha(0, 0, 1, 0, "MOBILIARIO"),
    linha(0, 0, 1, 0, "COTAS"),
  )), { unidade: "mm" });
  const porNome = Object.fromEntries(resultado.camadas.map((camada) => [camada.nome, camada.disciplina]));
  assert.deepEqual(porNome, {
    "A-PAREDES": "layout", "ELE-TOMADAS": "eletrico", ILUMINACAO: "luminotecnico",
    MOBILIARIO: "mobiliario", COTAS: "anotacao",
  });
  assert.ok(resultado.camadas.every((camada) => camada.visivel && !camada.bloqueada));
  assert.equal(new Set(resultado.camadas.map((camada) => camada.id)).size, 5, "camadas não podem colidir de identificador");
});

test("camadas de nomes diferentes que limpam para o mesmo identificador não se fundem", () => {
  const resultado = lerDxf(arquivo(secao("ENTITIES",
    linha(0, 0, 1, 0, "A PAREDE"),
    linha(0, 0, 1, 0, "A-PAREDE"),
  )), { unidade: "mm" });
  assert.equal(resultado.camadas.length, 2);
  assert.equal(new Set(resultado.camadas.map((camada) => camada.id)).size, 2);
});

test("todo elemento devolvido passa pelo esquema da prancha", () => {
  const resultado = lerDxf(arquivo(cabecalho(4), secao("ENTITIES",
    linha(0, 0, 3000, 0, "PAREDES"),
    ["0", "CIRCLE", "8", "ELE", "10", "1000", "20", "1000", "40", "120"],
    ["0", "TEXT", "8", "COTAS", "10", "0", "20", "0", "40", "200", "1", "Norte"],
  )));
  assert.ok(resultado.elementos.length >= 3);
  for (const elemento of resultado.elementos) {
    assert.equal(elementoSchema.safeParse(elemento).success, true, `elemento inválido escapou: ${JSON.stringify(elemento)}`);
  }
  assert.equal(new Set(resultado.elementos.map((elemento) => elemento.id)).size, resultado.elementos.length);
});

test("entidade que o leitor não conhece é contada e dita pelo nome", () => {
  const resultado = lerDxf(arquivo(secao("ENTITIES",
    ["0", "HATCH", "8", "0", "10", "0", "20", "0"],
    ["0", "HATCH", "8", "0", "10", "0", "20", "0"],
    ["0", "SPLINE", "8", "0", "10", "0", "20", "0"],
    linha(0, 0, 1000, 0),
  )), { unidade: "mm" });
  assert.equal(resultado.ignorados.HATCH, 2);
  assert.equal(resultado.ignorados.SPLINE, 1);
  assert.match(resultado.avisos.join(" "), /2 × HATCH/);
  assert.equal(tracos(resultado).length, 1, "o que dava para ler foi lido mesmo assim");
});

test("arquivo sem geometria diz isso em vez de abrir uma prancha muda", () => {
  const resultado = lerDxf(arquivo(cabecalho(4), secao("ENTITIES")));
  assert.equal(resultado.elementos.length, 0);
  assert.match(resultado.avisos.join(" "), /Nenhuma geometria/i);
});

test("desenho grande demais é cortado com o corte declarado", () => {
  const muitas = [];
  for (let i = 0; i < 6100; i += 1) muitas.push(linha(i, 0, i + 1, 0));
  const resultado = lerDxf(arquivo(secao("ENTITIES", muitas)), { unidade: "mm" });
  assert.equal(resultado.truncado, true);
  assert.equal(resultado.elementos.length, 6000);
  assert.match(resultado.avisos.join(" "), /cortado/i);
});

test("polilinha enorme é partida sem abrir buraco no traço", () => {
  const pontos = [];
  for (let i = 0; i < 2500; i += 1) pontos.push("10", String(i * 10), "20", "0");
  const resultado = lerDxf(arquivo(secao("ENTITIES", ["0", "LWPOLYLINE", "8", "0", "90", "2500", "70", "0", ...pontos])), { unidade: "mm" });
  const partes = tracos(resultado);
  assert.equal(partes.length, 2);
  assert.ok(partes.every((parte) => parte.pontos.length <= 2000));
  assert.deepEqual(partes[0].pontos[partes[0].pontos.length - 1], partes[1].pontos[0], "a emenda precisa ser o mesmo ponto");
});

test("DXF binário é recusado com o caminho da solução", () => {
  assert.throws(() => lerDxf("AutoCAD Binary DXF\r\n qualquer coisa"), (erro) => {
    assert.ok(erro instanceof DxfInvalido);
    assert.match(erro.message, /ASCII/);
    return true;
  });
});

test("arquivo que não é DXF é recusado sem estourar", () => {
  assert.throws(() => lerDxf("isto aqui é um texto qualquer"), DxfInvalido);
  assert.throws(() => lerDxf(""), DxfInvalido);
});

test("a versão do DWG é lida do cabeçalho, para a mensagem dizer qual arquivo é", () => {
  const dwg = (codigo) => new Uint8Array([...codigo].map((letra) => letra.charCodeAt(0)).concat([0, 0, 0, 0]));
  assert.deepEqual(versaoDoDwg(dwg("AC1032")), { codigo: "AC1032", nome: "AutoCAD 2018 ou mais novo" });
  assert.equal(versaoDoDwg(dwg("AC1015")).nome, "AutoCAD 2000–2002");
  // Código plausível fora do catálogo continua sendo DWG: dizer "não catalogada" é
  // honesto, inventar um nome não seria.
  assert.equal(versaoDoDwg(dwg("AC1099")).nome, "versão não catalogada");
  assert.equal(versaoDoDwg(dwg("%PDF-1")), null);
  assert.equal(versaoDoDwg(new Uint8Array([1, 2])), null);
});
