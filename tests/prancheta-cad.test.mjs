// Encaixe, entrada por teclado e ida e volta em DXF. É o que separa desenhar de chutar:
// sem encaixe a parede encosta perto do canto, e perto não fecha.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ configFile: false, appType: "custom", root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const cad = await vite.ssrLoadModule("/lib/prancheta-cad.ts");
const { documentoVazio, elementoSchema, comprimentoM } = await vite.ssrLoadModule("/lib/prancheta.ts");
const { exportarDxf, lerDxf } = await vite.ssrLoadModule("/lib/integrations/dxf.ts");
after(() => vite.close());

const {
  encaixePerto, segmentosDo, pontosNotaveis, interseccao, pePerpendicular, ortogonal,
  lerMedida, resolverEntrada, moverVertice, verticesDe, TIPOS_ENCAIXE, encaixeLabels,
} = cad;

const doc = (elementos = [], mudanca = {}) => ({ ...documentoVazio(), elementos, ...mudanca });
const parede = (id, a, b, camada = "layout") => ({ id, camada, tipo: "parede", a, b, espessuraMm: 150 });
const comodo = (id, pontos, camada = "layout") => ({ id, camada, tipo: "comodo", nome: "Sala", pontos });
const padrao = { toleranciaMm: 200 };

test("sem nada por perto o cursor cai na malha, como antes", () => {
  const encaixe = encaixePerto(doc(), { x: 1234, y: 5678 }, padrao);
  assert.equal(encaixe.tipo, "malha");
  assert.deepEqual(encaixe.ponto, { x: 1200, y: 5700 });
});

test("o extremo da parede captura o cursor que passa perto", () => {
  const documento = doc([parede("p1", { x: 0, y: 0 }, { x: 4000, y: 0 })]);
  const encaixe = encaixePerto(documento, { x: 4080, y: 60 }, padrao);
  assert.equal(encaixe.tipo, "extremo");
  assert.deepEqual(encaixe.ponto, { x: 4000, y: 0 });
  assert.equal(encaixe.elementoId, "p1");
});

test("fora do raio de captura nada é forçado", () => {
  const documento = doc([parede("p1", { x: 0, y: 0 }, { x: 4000, y: 0 })]);
  const encaixe = encaixePerto(documento, { x: 4600, y: 900 }, padrao);
  assert.equal(encaixe.tipo, "malha");
});

test("o extremo vence o meio mesmo estando mais longe", () => {
  // É no extremo que parede encontra parede. Um meio a 2 mm não pode ganhar de um
  // extremo a 4 mm, senão a junção nunca fecha.
  const documento = doc([parede("p1", { x: 0, y: 0 }, { x: 1000, y: 0 })]);
  const encaixe = encaixePerto(documento, { x: 502, y: 0 }, { toleranciaMm: 600 });
  assert.equal(encaixe.tipo, "extremo");
  assert.deepEqual(encaixe.ponto, { x: 1000, y: 0 });
});

test("o meio do segmento é oferecido quando nenhum extremo está perto", () => {
  const documento = doc([parede("p1", { x: 0, y: 0 }, { x: 4000, y: 0 })]);
  const encaixe = encaixePerto(documento, { x: 2030, y: 40 }, padrao);
  assert.equal(encaixe.tipo, "meio");
  assert.deepEqual(encaixe.ponto, { x: 2000, y: 0 });
});

test("o centro de símbolo e mobília também captura", () => {
  const documento = doc([
    { id: "s1", camada: "eletrico", tipo: "simbolo", familia: "spot", posicao: { x: 1500, y: 1500 }, rotacaoGraus: 0 },
  ]);
  const encaixe = encaixePerto(documento, { x: 1560, y: 1450 }, padrao);
  assert.equal(encaixe.tipo, "centro");
  assert.deepEqual(encaixe.ponto, { x: 1500, y: 1500 });
});

test("duas paredes cruzadas oferecem a interseção", () => {
  const documento = doc([
    parede("p1", { x: 0, y: 1000 }, { x: 4000, y: 1000 }),
    parede("p2", { x: 2000, y: -1000 }, { x: 2000, y: 3000 }),
  ]);
  const encaixe = encaixePerto(documento, { x: 2050, y: 1050 }, padrao);
  assert.equal(encaixe.tipo, "interseccao");
  assert.deepEqual(encaixe.ponto, { x: 2000, y: 1000 });
});

test("o cruzamento fora dos dois segmentos não existe", () => {
  // Retas se cruzam no prolongamento; segmentos, não. Encaixar no prolongamento poria a
  // parede num lugar onde não há nada desenhado.
  const cruzamento = interseccao(
    { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, elementoId: "a" },
    { a: { x: 3000, y: -500 }, b: { x: 3000, y: 500 }, elementoId: "b" },
  );
  assert.equal(cruzamento, null);
  assert.equal(interseccao(
    { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, elementoId: "a" },
    { a: { x: 0, y: 500 }, b: { x: 1000, y: 500 }, elementoId: "b" },
  ), null, "paralelas não têm ponto único");
});

test("a perpendicular só aparece quando há um ponto de origem", () => {
  const documento = doc([parede("p1", { x: 0, y: 2000 }, { x: 4000, y: 2000 })]);
  const semOrigem = encaixePerto(documento, { x: 1500, y: 1900 }, { toleranciaMm: 150, ativos: ["perpendicular"] });
  assert.equal(semOrigem.tipo, "malha");
  const comOrigem = encaixePerto(documento, { x: 1500, y: 1900 }, {
    toleranciaMm: 150, ativos: ["perpendicular"], origem: { x: 1500, y: 0 },
  });
  assert.equal(comOrigem.tipo, "perpendicular");
  assert.deepEqual(comOrigem.ponto, { x: 1500, y: 2000 });
});

test("o pé da perpendicular fora do segmento não conta", () => {
  const segmento = { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, elementoId: "p" };
  assert.deepEqual(pePerpendicular({ x: 400, y: 900 }, segmento), { x: 400, y: 0 });
  assert.equal(pePerpendicular({ x: 5000, y: 900 }, segmento), null);
  assert.equal(pePerpendicular({ x: 0, y: 100 }, { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, elementoId: "p" }), null);
});

test("camada escondida ou travada não encaixa: perseguir o que não se vê é armadilha", () => {
  const base = doc([parede("p1", { x: 0, y: 0 }, { x: 4000, y: 0 })]);
  assert.equal(encaixePerto(base, { x: 4050, y: 0 }, padrao).tipo, "extremo");

  const escondida = { ...base, camadas: base.camadas.map((c) => c.id === "layout" ? { ...c, visivel: false } : c) };
  assert.equal(encaixePerto(escondida, { x: 4050, y: 0 }, padrao).tipo, "malha");

  const travada = { ...base, camadas: base.camadas.map((c) => c.id === "layout" ? { ...c, bloqueada: true } : c) };
  assert.equal(encaixePerto(travada, { x: 4050, y: 0 }, padrao).tipo, "malha");
});

test("desligar um tipo de encaixe o tira da disputa sem tirar os outros", () => {
  const documento = doc([parede("p1", { x: 0, y: 0 }, { x: 4000, y: 0 })]);
  const semExtremo = encaixePerto(documento, { x: 4020, y: 0 }, { toleranciaMm: 2500, ativos: ["meio", "malha"] });
  assert.equal(semExtremo.tipo, "meio");
  assert.equal(encaixePerto(documento, { x: 4020, y: 0 }, { toleranciaMm: 200, ativos: [] }).tipo, "malha");
});

test("todo tipo de encaixe tem rótulo em português", () => {
  for (const tipo of TIPOS_ENCAIXE) assert.ok(encaixeLabels[tipo], `falta rótulo de ${tipo}`);
});

test("o cômodo fecha o polígono nos segmentos, o traço não", () => {
  const fechado = segmentosDo(doc([comodo("c1", [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }])]));
  assert.equal(fechado.length, 3, "o cômodo precisa do segmento de volta ao primeiro ponto");
  const aberto = segmentosDo(doc([
    { id: "t1", camada: "anotacao", tipo: "traco", pontos: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }], espessuraMm: 20 },
  ]));
  assert.equal(aberto.length, 2);
});

test("pontos notáveis não inventam coordenada fracionária", () => {
  const notaveis = pontosNotaveis(doc([parede("p1", { x: 0, y: 0 }, { x: 1001, y: 999 })]));
  for (const notavel of notaveis) {
    assert.ok(Number.isInteger(notavel.ponto.x) && Number.isInteger(notavel.ponto.y),
      `${notavel.tipo} saiu fracionado`);
  }
});

test("a trava ortogonal prende no eixo mais próximo", () => {
  const origem = { x: 1000, y: 1000 };
  assert.deepEqual(ortogonal(origem, { x: 4000, y: 1200 }), { x: 4000, y: 1000 });
  assert.deepEqual(ortogonal(origem, { x: 1200, y: 4000 }), { x: 1000, y: 4000 });
});

test("medida aceita unidade e vírgula decimal", () => {
  assert.equal(lerMedida("3150"), 3150);
  assert.equal(lerMedida("3,15m"), 3150);
  assert.equal(lerMedida("3.15 m"), 3150);
  assert.equal(lerMedida("315cm"), 3150);
  assert.equal(lerMedida("-800"), -800);
  assert.equal(lerMedida(""), null);
  assert.equal(lerMedida("abc"), null);
  assert.equal(lerMedida("3,15km"), null, "unidade que não é de obra não passa calada");
});

test("digitar só o comprimento segue a direção do cursor", () => {
  const origem = { x: 0, y: 0 };
  const resultado = resolverEntrada(origem, "3150", { x: 500, y: 0 });
  assert.deepEqual(resultado.ponto, { x: 3150, y: 0 });
  assert.equal(resultado.comprimentoMm, 3150);
  assert.equal(resultado.anguloGraus, 0);
});

test("comprimento com ângulo usa a convenção do desenho técnico", () => {
  // 90° é para cima no desenho; na tela o Y cresce para baixo, então y fica negativo.
  const noventa = resolverEntrada({ x: 0, y: 0 }, "2000<90");
  assert.deepEqual(noventa.ponto, { x: 0, y: -2000 });
  assert.equal(noventa.anguloGraus, 90);

  const cento = resolverEntrada({ x: 0, y: 0 }, "1000<180");
  assert.deepEqual(cento.ponto, { x: -1000, y: 0 });

  const menos = resolverEntrada({ x: 0, y: 0 }, "1000<-90");
  assert.deepEqual(menos.ponto, { x: 0, y: 1000 });
  assert.equal(menos.anguloGraus, 270);
});

test("deslocamento relativo respeita o eixo do desenho", () => {
  const resultado = resolverEntrada({ x: 1000, y: 1000 }, "@3000,1500");
  assert.deepEqual(resultado.ponto, { x: 4000, y: -500 }, "y positivo no comando sobe na planta");
  assert.equal(resultado.comprimentoMm, Math.round(Math.hypot(3000, 1500)));
});

test("a entrada devolve inteiro e nunca zero negativo", () => {
  const resultado = resolverEntrada({ x: 0, y: 0 }, "1000<0");
  assert.ok(Object.is(resultado.ponto.y, 0), "zero negativo vira falso conflito na comparação de versões");
  assert.ok(Number.isInteger(resolverEntrada({ x: 0, y: 0 }, "1234<37").ponto.x));
});

test("entrada sem sentido não move nada", () => {
  for (const texto of ["", "   ", "abc", "@1000", "@a,b", "1000<xyz", "@1,2,3"]) {
    assert.equal(resolverEntrada({ x: 0, y: 0 }, texto), null, `"${texto}" deveria ser recusado`);
  }
});

test("sem direção utilizável o traço sai para a direita, em vez de não sair", () => {
  const parado = resolverEntrada({ x: 500, y: 500 }, "2000", { x: 500, y: 500 });
  assert.deepEqual(parado.ponto, { x: 2500, y: 500 });
  assert.deepEqual(resolverEntrada({ x: 0, y: 0 }, "2000").ponto, { x: 2000, y: 0 });
});

test("mover um vértice não mexe nos outros e mantém o elemento válido", () => {
  const original = comodo("c1", [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }]);
  const movido = moverVertice(original, 2, { x: 5000, y: 3500 });
  assert.deepEqual(movido.pontos, [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 5000, y: 3500 }, { x: 0, y: 3000 }]);
  assert.equal(elementoSchema.safeParse(movido).success, true);
  assert.deepEqual(original.pontos[2], { x: 4000, y: 3000 }, "o original não é alterado no lugar");
  assert.deepEqual(moverVertice(original, 9, { x: 0, y: 0 }), original, "índice fora da lista não faz nada");
  assert.deepEqual(verticesDe(original).map((v) => v.indice), [0, 1, 2, 3]);
  assert.deepEqual(verticesDe(parede("p", { x: 0, y: 0 }, { x: 1, y: 0 })), [], "parede não tem vértice de arrastar");
});

// ## Ida e volta em DXF
//
// O teste que importa: exportar e reler tem que devolver a mesma medida. Um exportador
// que escreve algo "parecido" só é descoberto quando o cliente abre o arquivo.

test("uma parede exportada e relida mantém as coordenadas", () => {
  const documento = doc([parede("p1", { x: 0, y: 0 }, { x: 3150, y: 0 })]);
  const lido = lerDxf(exportarDxf(documento), { unidade: "mm" });
  const traco = lido.elementos.find((elemento) => elemento.tipo === "traco");
  assert.deepEqual(traco.pontos, [{ x: 0, y: 0 }, { x: 3150, y: 0 }]);
});

test("a planta não volta espelhada da ida e volta", () => {
  // A leitura inverte o Y; a escrita desfaz. Se só uma das duas fizesse, cada exportação
  // devolveria a planta de cabeça para baixo para quem a mandou.
  const documento = doc([parede("p1", { x: 0, y: 0 }, { x: 0, y: 3000 })]);
  const lido = lerDxf(exportarDxf(documento), { unidade: "mm" });
  assert.deepEqual(lido.elementos[0].pontos, [{ x: 0, y: 0 }, { x: 0, y: 3000 }]);
});

test("o arquivo exportado declara milímetro, e a releitura obedece sem ninguém dizer", () => {
  const saida = exportarDxf(doc([parede("p1", { x: 0, y: 0 }, { x: 1000, y: 0 })]));
  assert.match(saida, /\$INSUNITS/);
  const lido = lerDxf(saida);
  assert.equal(lido.unidade, "mm");
  assert.equal(lido.unidadeDeclarada, true);
  assert.equal(lido.avisos.length, 0);
});

test("o cômodo volta como polígono fechado, com a mesma área", () => {
  const pontos = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }];
  const lido = lerDxf(exportarDxf(doc([comodo("c1", pontos)])), { unidade: "mm" });
  const traco = lido.elementos.find((elemento) => elemento.tipo === "traco");
  assert.equal(traco.pontos.length, 5, "a polilinha fechada volta com o ponto de retorno");
  assert.deepEqual(traco.pontos.slice(0, 4), pontos);
  assert.deepEqual(traco.pontos[4], pontos[0]);
});

test("o texto volta com conteúdo, altura e posição", () => {
  const documento = doc([
    { id: "t1", camada: "anotacao", tipo: "texto", posicao: { x: 500, y: 800 }, texto: "SALA", alturaMm: 250, rotacaoGraus: 0 },
  ]);
  const lido = lerDxf(exportarDxf(documento), { unidade: "mm" });
  const texto = lido.elementos.find((elemento) => elemento.tipo === "texto");
  assert.equal(texto.texto, "SALA");
  assert.equal(texto.alturaMm, 250);
  assert.deepEqual(texto.posicao, { x: 500, y: 800 });
});

test("a mobília sai como o retângulo que ela ocupa, girada", () => {
  const documento = doc([
    { id: "m1", camada: "mobiliario", tipo: "mobilia", posicao: { x: 2000, y: 2000 }, larguraMm: 1800, alturaMm: 900, rotacaoGraus: 90, rotulo: "Sofá" },
  ]);
  const lido = lerDxf(exportarDxf(documento), { unidade: "mm" });
  const traco = lido.elementos.find((elemento) => elemento.tipo === "traco");
  const xs = traco.pontos.map((ponto) => ponto.x);
  const ys = traco.pontos.map((ponto) => ponto.y);
  // Girado 90°, o que media 1800 na largura passa a medir 1800 na outra direção.
  assert.equal(Math.round(Math.max(...ys) - Math.min(...ys)), 1800);
  assert.equal(Math.round(Math.max(...xs) - Math.min(...xs)), 900);
});

test("o nome da camada vai sem acento e sem colisão, porque o DXF R12 não os aceita", () => {
  const documento = doc([parede("p1", { x: 0, y: 0 }, { x: 1000, y: 0 })], {
    camadas: [
      { id: "layout", nome: "Luminotécnico", disciplina: "layout", visivel: true, bloqueada: false },
      { id: "outra", nome: "Luminotecnico", disciplina: "layout", visivel: true, bloqueada: false },
    ],
  });
  const saida = exportarDxf(documento);
  assert.ok(!/[ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç]/.test(saida), "acento no nome faz o CAD recusar o arquivo");
  const lido = lerDxf(saida, { unidade: "mm" });
  assert.equal(lido.camadas[0].nome, "LUMINOTECNICO");
  const nomes = [...saida.matchAll(/^2\nLUMINOTECNICO.*$/gm)].map((casado) => casado[0]);
  assert.equal(new Set(nomes).size, nomes.length, "duas camadas não podem virar o mesmo nome");
});

test("só o que está em camada visível é exportado", () => {
  const documento = doc([
    parede("p1", { x: 0, y: 0 }, { x: 1000, y: 0 }, "layout"),
    { id: "s1", camada: "luminotecnico", tipo: "simbolo", familia: "spot", posicao: { x: 500, y: 500 }, rotacaoGraus: 0 },
  ]);
  const escondida = {
    ...documento,
    camadas: documento.camadas.map((c) => c.id === "luminotecnico" ? { ...c, visivel: false } : c),
  };
  const visiveis = escondida.elementos.filter((elemento) => elemento.camada !== "luminotecnico");
  const saida = exportarDxf(escondida, { visiveis });
  assert.ok(!saida.includes("CIRCLE"), "o símbolo da camada escondida foi parar no arquivo");
  assert.ok(saida.includes("LINE"));
});

test("documento vazio gera um DXF que o leitor abre sem erro", () => {
  const saida = exportarDxf(documentoVazio());
  assert.match(saida, /^0\nSECTION/);
  assert.match(saida, /0\nEOF\n$/);
  const lido = lerDxf(saida, { unidade: "mm" });
  assert.equal(lido.elementos.length, 0);
});

test("uma planta inteira sobrevive à ida e volta com a metragem intacta", () => {
  const pontos = [{ x: 0, y: 0 }, { x: 4200, y: 0 }, { x: 4200, y: 3100 }, { x: 0, y: 3100 }];
  const documento = doc([
    comodo("c1", pontos),
    parede("p1", { x: 0, y: 0 }, { x: 4200, y: 0 }),
    parede("p2", { x: 4200, y: 0 }, { x: 4200, y: 3100 }),
    { id: "s1", camada: "eletrico", tipo: "simbolo", familia: "tomada-media", posicao: { x: 1000, y: 200 }, rotacaoGraus: 0 },
    { id: "t1", camada: "anotacao", tipo: "texto", posicao: { x: 2100, y: 1550 }, texto: "SALA", alturaMm: 220, rotacaoGraus: 0 },
  ]);
  const lido = lerDxf(exportarDxf(documento), { unidade: "mm" });
  assert.equal(lido.avisos.length, 0, `avisos inesperados: ${lido.avisos.join(" | ")}`);

  const tracos = lido.elementos.filter((elemento) => elemento.tipo === "traco");
  const paredes = tracos.filter((traco) => traco.pontos.length === 2);
  const metragem = paredes.reduce((soma, traco) => soma + comprimentoM(traco.pontos[0], traco.pontos[1]), 0);
  assert.equal(Math.round(metragem * 100) / 100, 7.3, "4,2 m + 3,1 m de parede");
  assert.ok(lido.elementos.some((elemento) => elemento.tipo === "texto" && elemento.texto === "SALA"));
});
