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

test("círculo entra como círculo, com centro e raio preservados", () => {
  // Antes virava polilinha, e uma vez achatado o raio não voltava mais: quem recebesse o
  // arquivo de volta não teria como cotá-lo nem prolongá-lo.
  const resultado = lerDxf(arquivo(secao("ENTITIES",
    ["0", "CIRCLE", "8", "0", "10", "1000", "20", "1000", "40", "500"])), { unidade: "mm" });
  const [circulo] = resultado.elementos.filter((elemento) => elemento.tipo === "arco");
  assert.deepEqual(circulo.centro, { x: 1000, y: -1000 }, "o centro acompanha a inversão do eixo");
  assert.equal(circulo.raioMm, 500);
  assert.equal(circulo.varreduraGraus, 360);
});

test("o raio do círculo é convertido pela unidade do desenho", () => {
  const resultado = lerDxf(arquivo(cabecalho(6), secao("ENTITIES",
    ["0", "CIRCLE", "8", "0", "10", "0", "20", "0", "40", "1.5"])));
  assert.equal(resultado.elementos[0].raioMm, 1500);
});

test("arco guarda o trecho pedido, e não o complementar", () => {
  const resultado = lerDxf(arquivo(secao("ENTITIES",
    ["0", "ARC", "8", "0", "10", "0", "20", "0", "40", "1000", "50", "0", "51", "90"])), { unidade: "mm" });
  const [arco] = resultado.elementos.filter((elemento) => elemento.tipo === "arco");
  assert.equal(arco.inicioGraus, 0);
  assert.equal(arco.varreduraGraus, 90);
  assert.equal(arco.raioMm, 1000);
});

test("arco que atravessa o zero não vira o arco de 270°", () => {
  // De 300° a 30° são 90°. Subtrair sem normalizar daria -270, e o desenho sairia com
  // tudo menos o trecho que o arquivo pedia.
  const resultado = lerDxf(arquivo(secao("ENTITIES",
    ["0", "ARC", "8", "0", "10", "0", "20", "0", "40", "1000", "50", "300", "51", "30"])), { unidade: "mm" });
  const [arco] = resultado.elementos.filter((elemento) => elemento.tipo === "arco");
  assert.equal(arco.inicioGraus, 300);
  assert.equal(arco.varreduraGraus, 90);
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
    ["0", "REGION", "8", "0", "70", "1"],
    ["0", "REGION", "8", "0", "70", "1"],
    ["0", "3DSOLID", "8", "0", "70", "1"],
    linha(0, 0, 1000, 0),
  )), { unidade: "mm" });
  assert.equal(resultado.ignorados.REGION, 2);
  assert.equal(resultado.ignorados["3DSOLID"], 1);
  assert.match(resultado.avisos.join(" "), /2 × REGION/);
  assert.equal(tracos(resultado).length, 1, "o que dava para ler foi lido mesmo assim");
});

test("arquivo sem geometria diz isso em vez de abrir uma prancha muda", () => {
  const resultado = lerDxf(arquivo(cabecalho(4), secao("ENTITIES")));
  assert.equal(resultado.elementos.length, 0);
  assert.match(resultado.avisos.join(" "), /Nenhuma geometria/i);
});

test("desenho grande demais é cortado com o corte declarado", () => {
  const muitas = [];
  for (let i = 0; i < 130; i += 1) muitas.push(linha(i, 0, i + 1, 0));
  const resultado = lerDxf(arquivo(secao("ENTITIES", muitas)), { unidade: "mm", limiteElementos: 100 });
  assert.equal(resultado.truncado, true);
  assert.equal(resultado.elementos.length, 100);
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

// ## Leitura completa de DWG/DXF: camadas, blocos transformados e entidades de planta real

const tabelaDeCamadas = (...camadas) => secao("TABLES", "0", "TABLE", "2", "LAYER", "70", String(camadas.length), ...camadas.flat(), "0", "ENDTAB");
const camadaDxf = (nome, cor, { flags = 0, linha = "CONTINUOUS", rgb } = {}) =>
  ["0", "LAYER", "2", nome, "70", String(flags), "62", String(cor), "6", linha, ...(rgb !== undefined ? ["420", String(rgb)] : [])];

test("todas as camadas da tabela entram, inclusive vazias, com cor, tipo de linha e estado", () => {
  const resultado = lerDxf(arquivo(
    tabelaDeCamadas(
      camadaDxf("0", 7),
      camadaDxf("A-PAREDE", 1),
      camadaDxf("A-EIXO", 4, { linha: "CENTER" }),
      camadaDxf("HIDDEN-LINES", 3, { linha: "HIDDEN" }),
      camadaDxf("DESLIGADA", -2),
      camadaDxf("CONGELADA", 5, { flags: 1 }),
      camadaDxf("TRAVADA", 6, { flags: 4 }),
      camadaDxf("RGB", 7, { rgb: 0x3366cc }),
      camadaDxf("VAZIA", 30),
    ),
    secao("ENTITIES", linha(0, 0, 1000, 0, "A-PAREDE")),
  ), { unidade: "mm" });
  const porNome = Object.fromEntries(resultado.camadas.map((c) => [c.nome, c]));
  assert.deepEqual(resultado.camadas.map((c) => c.nome), ["0", "A-PAREDE", "A-EIXO", "HIDDEN-LINES", "DESLIGADA", "CONGELADA", "TRAVADA", "RGB", "VAZIA"]);
  assert.equal(porNome["0"].cor, undefined, "cor 7 é a tinta, que muda com o fundo");
  assert.equal(porNome["A-PAREDE"].cor, "#ff0000");
  assert.equal(porNome["A-EIXO"].tipoLinha, "traco-ponto");
  assert.equal(porNome["HIDDEN-LINES"].tipoLinha, "tracejada");
  assert.equal(porNome.DESLIGADA.visivel, false);
  assert.equal(porNome.CONGELADA.visivel, false);
  assert.equal(porNome.TRAVADA.bloqueada, true);
  assert.equal(porNome.RGB.cor, "#3366cc");
  assert.ok(porNome.VAZIA.cor, "a camada vazia vem com a cor da paleta");
  assert.match(resultado.avisos.join(" "), /2 camada\(s\) vieram desligadas ou congeladas/);
});

test("bloco inserido com giro e escala sai no lugar e no tamanho certos", () => {
  const resultado = lerDxf(arquivo(
    secao("BLOCKS", "0", "BLOCK", "2", "PECA", "10", "0", "20", "0", linha(0, 0, 100, 0, "PECAS"), "0", "ENDBLK"),
    secao("ENTITIES", ["0", "INSERT", "8", "0", "2", "PECA", "10", "1000", "20", "0", "41", "2", "42", "2", "50", "90"]),
  ), { unidade: "mm" });
  assert.deepEqual(tracos(resultado)[0].pontos, [{ x: 1000, y: 0 }, { x: 1000, y: -200 }]);
});

test("bloco espelhado (escala negativa) mantém o arco como arco, virado para o outro lado", () => {
  const resultado = lerDxf(arquivo(
    secao("BLOCKS", "0", "BLOCK", "2", "PORTA", "10", "0", "20", "0",
      ["0", "ARC", "8", "0", "10", "0", "20", "0", "40", "800", "50", "0", "51", "90"], "0", "ENDBLK"),
    secao("ENTITIES", ["0", "INSERT", "8", "ESQUADRIAS", "2", "PORTA", "10", "0", "20", "0", "41", "-1", "42", "1"]),
  ), { unidade: "mm" });
  const [arco] = resultado.elementos.filter((e) => e.tipo === "arco");
  assert.equal(arco.raioMm, 800);
  assert.equal(arco.inicioGraus, 90);
  assert.equal(arco.varreduraGraus, 90);
  assert.equal(resultado.camadas.find((c) => c.id === arco.camada).nome, "ESQUADRIAS", "o que está na camada 0 herda a camada do INSERT");
});

test("arco com extrusão invertida (espelhado no AutoCAD) entra do lado certo", () => {
  const resultado = lerDxf(arquivo(secao("ENTITIES",
    ["0", "ARC", "8", "0", "10", "100", "20", "0", "40", "50", "50", "0", "51", "90", "210", "0", "220", "0", "230", "-1"])), { unidade: "mm" });
  const [arco] = resultado.elementos.filter((e) => e.tipo === "arco");
  assert.deepEqual(arco.centro, { x: -100, y: 0 });
  assert.equal(arco.inicioGraus, 90);
  assert.equal(arco.varreduraGraus, 90);
});

test("polilinha antiga (POLYLINE com VERTEX) não perde os vértices", () => {
  const vertice = (x, y) => ["0", "VERTEX", "8", "0", "10", String(x), "20", String(y)];
  const resultado = lerDxf(arquivo(secao("ENTITIES",
    ["0", "POLYLINE", "8", "0", "66", "1", "10", "0", "20", "0", "70", "1"],
    vertice(0, 0), vertice(3000, 0), vertice(3000, 2000), vertice(0, 2000),
    ["0", "SEQEND", "8", "0"],
  )), { unidade: "mm" });
  assert.deepEqual(tracos(resultado)[0].pontos, [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: -2000 }, { x: 0, y: -2000 }, { x: 0, y: 0 }]);
});

test("trecho curvo de polilinha (bulge) vira curva, não reta", () => {
  const resultado = lerDxf(arquivo(secao("ENTITIES", [
    "0", "LWPOLYLINE", "8", "0", "90", "2", "70", "0", "10", "0", "20", "0", "42", "1", "10", "1000", "20", "0",
  ])), { unidade: "mm" });
  const pontos = tracos(resultado)[0].pontos;
  assert.ok(pontos.length > 10);
  assert.ok(pontos.some((p) => Math.abs(p.x - 500) < 0.01 && Math.abs(p.y - 500) < 0.01), "o meio do semicírculo passa a 500 mm da corda, do lado certo");
});

test("cor por bloco herda do INSERT e cor própria só aparece quando difere da camada", () => {
  const resultado = lerDxf(arquivo(
    tabelaDeCamadas(camadaDxf("0", 7), camadaDxf("MOB", 3)),
    secao("BLOCKS", "0", "BLOCK", "2", "CAMA", "10", "0", "20", "0",
      ["0", "LINE", "8", "0", "62", "0", "10", "0", "20", "0", "11", "10", "21", "0"],
      ["0", "LINE", "8", "0", "10", "0", "20", "10", "11", "10", "21", "10"],
      "0", "ENDBLK"),
    secao("ENTITIES", ["0", "INSERT", "8", "MOB", "62", "1", "2", "CAMA", "10", "0", "20", "0"]),
  ), { unidade: "mm" });
  const [porBloco, porCamada] = tracos(resultado);
  assert.equal(porBloco.cor, "#ff0000");
  assert.equal(porCamada.cor, undefined, "por camada segue a camada");
  assert.equal(resultado.camadas.find((c) => c.id === porCamada.camada).nome, "MOB");
});

test("texto alinhado ao centro usa o ponto de alinhamento e a âncora", () => {
  const resultado = lerDxf(arquivo(secao("ENTITIES",
    ["0", "TEXT", "8", "0", "10", "0", "20", "0", "40", "200", "1", "SALA", "72", "1", "11", "2000", "21", "1000", "73", "2"])), { unidade: "mm" });
  const [texto] = resultado.elementos.filter((e) => e.tipo === "texto");
  assert.deepEqual(texto.posicao, { x: 2000, y: -1000 });
  assert.equal(texto.ancoraH, "meio");
  assert.equal(texto.ancoraV, "meio");
});

test("MTEXT em várias linhas vira uma linha por texto, com acentos e símbolos", () => {
  const resultado = lerDxf(arquivo(secao("ENTITIES", [
    "0", "MTEXT", "8", "0", "10", "0", "20", "0", "40", "100", "71", "1",
    "1", "{\\fArial|b0;\\U+00C1REA ÚTIL}\\PPISO %%c10\\P\\S1/2;",
  ])), { unidade: "mm" });
  const textos = resultado.elementos.filter((e) => e.tipo === "texto");
  assert.deepEqual(textos.map((t) => t.texto), ["ÁREA ÚTIL", "PISO Ø10", "1/2"]);
  assert.ok(textos.every((t) => t.ancoraV === "topo"));
  assert.ok(textos[1].posicao.y > textos[0].posicao.y, "a segunda linha fica abaixo da primeira");
});

test("hachura sólida vira área preenchida com o contorno do arquivo", () => {
  const resultado = lerDxf(arquivo(secao("ENTITIES", [
    "0", "HATCH", "8", "PILARES", "10", "0", "20", "0", "30", "0", "2", "SOLID", "70", "1", "71", "0", "91", "1",
    "92", "2", "72", "0", "73", "1", "93", "4", "10", "0", "20", "0", "10", "200", "20", "0", "10", "200", "20", "300", "10", "0", "20", "300",
    "97", "0", "75", "0", "76", "1", "98", "1", "10", "100", "20", "100",
  ])), { unidade: "mm" });
  const [area] = resultado.elementos.filter((e) => e.tipo === "hachura");
  assert.equal(area.solida, true);
  assert.deepEqual(area.aneis, [[{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: -300 }, { x: 0, y: -300 }]]);
});

test("spline, elipse e sólido entram como geometria", () => {
  const resultado = lerDxf(arquivo(secao("ENTITIES",
    ["0", "SPLINE", "8", "0", "70", "8", "71", "2", "72", "6", "73", "3", "40", "0", "40", "0", "40", "0", "40", "1", "40", "1", "40", "1",
      "10", "0", "20", "0", "10", "500", "20", "1000", "10", "1000", "20", "0"],
    ["0", "ELLIPSE", "8", "0", "10", "0", "20", "0", "11", "1000", "21", "0", "40", "0.5", "41", "0", "42", String(2 * Math.PI)],
    ["0", "SOLID", "8", "0", "10", "0", "20", "0", "11", "100", "21", "0", "12", "0", "22", "100", "13", "100", "23", "100"],
  )), { unidade: "mm" });
  const [spline, elipse] = tracos(resultado);
  assert.deepEqual(spline.pontos[0], { x: 0, y: 0 });
  assert.deepEqual(spline.pontos.at(-1), { x: 1000, y: 0 });
  assert.ok(spline.pontos.some((p) => Math.abs(p.x - 500) < 1 && Math.abs(p.y + 500) < 1), "o meio da parábola passa a 500 mm");
  assert.ok(elipse.pontos.some((p) => Math.abs(p.y + 500) < 1) && elipse.pontos.some((p) => Math.abs(p.x - 1000) < 1));
  const [solido] = resultado.elementos.filter((e) => e.tipo === "hachura");
  assert.deepEqual(solido.aneis[0], [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: -100 }, { x: 0, y: -100 }], "a ordem 1-2-4-3 do SOLID vira o quadrado");
});

test("cota é desenhada pelo bloco do próprio arquivo, e o espaço de papel fica de fora", () => {
  const resultado = lerDxf(arquivo(
    secao("BLOCKS", "0", "BLOCK", "2", "*D1", "10", "0", "20", "0", linha(0, 500, 3000, 500), "0", "ENDBLK"),
    secao("ENTITIES",
      ["0", "DIMENSION", "8", "COTAS", "2", "*D1", "10", "0", "20", "500", "13", "0", "23", "0", "14", "3000", "24", "0"],
      ["0", "LINE", "8", "0", "67", "1", "10", "0", "20", "0", "11", "1", "21", "1"]),
  ), { unidade: "mm" });
  const [cota] = tracos(resultado);
  assert.deepEqual(cota.pontos, [{ x: 0, y: -500 }, { x: 3000, y: -500 }]);
  assert.equal(resultado.camadas.find((c) => c.id === cota.camada).nome, "COTAS");
  assert.match(resultado.avisos.join(" "), /espaço de papel/);
});

test("arquivo com todas as camadas desenhadas desligadas entra visível, com aviso", () => {
  const resultado = lerDxf(arquivo(
    tabelaDeCamadas(camadaDxf("0", -7), camadaDxf("PAREDES", -1)),
    secao("ENTITIES", linha(0, 0, 1000, 0, "PAREDES")),
  ), { unidade: "mm" });
  assert.ok(resultado.camadas.every((c) => c.visivel));
  assert.match(resultado.avisos.join(" "), /todas as camadas com desenho como desligadas/);
});

test("a paleta do AutoCAD dá as cores certas, e a 7 é a tinta", async () => {
  const { corAci, aciMaisProximo, corVerdadeira } = await vite.ssrLoadModule("/lib/cad-cores.ts");
  assert.equal(corAci(1), "#ff0000");
  assert.equal(corAci(7), null);
  assert.equal(corAci(10), "#ff0000");
  assert.equal(corAci(11), "#ff8080");
  assert.equal(corAci(30), "#ff8000");
  assert.equal(corAci(12), "#a50000");
  assert.equal(corAci(250), "#333333");
  assert.equal(aciMaisProximo("#ff0000"), 1);
  assert.equal(aciMaisProximo(null), 7);
  assert.equal(corVerdadeira(0x3366cc), "#3366cc");
  assert.equal(corVerdadeira(0xffffff), null);
});
