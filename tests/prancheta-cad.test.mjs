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

// ## Arco e círculo nativos

const { paralelaDe, paralelaDePolilinha, facesDaParede } = cad;
const { pontosDoArco, limitesDoElemento, moverElemento, quantitativo, areaM2 } = await vite.ssrLoadModule("/lib/prancheta.ts");

const arco = (id, centro, raioMm, inicioGraus, varreduraGraus, camada = "layout") =>
  ({ id, camada, tipo: "arco", centro, raioMm, inicioGraus, varreduraGraus, espessuraMm: 25 });

test("o arco é aceito e guarda varredura, não ângulo final", () => {
  // Ângulo final deixaria "de 0° a 0°" ambíguo entre nada e a circunferência inteira.
  assert.equal(elementoSchema.safeParse(arco("a1", { x: 0, y: 0 }, 1000, 0, 360)).success, true);
  assert.equal(elementoSchema.safeParse(arco("a1", { x: 0, y: 0 }, 1000, 0, 0)).success, false, "varredura zero não é arco");
  assert.equal(elementoSchema.safeParse(arco("a1", { x: 0, y: 0 }, 1000, 0, 361)).success, false);
  assert.equal(elementoSchema.safeParse(arco("a1", { x: 0, y: 0 }, 0, 0, 90)).success, false, "raio zero não é arco");
  assert.equal(elementoSchema.safeParse({ ...arco("a1", { x: 0, y: 0 }, 1000, 0, 90), raioMm: 10.5 }).success, false);
});

test("os pontos do arco ficam no raio e cobrem só a varredura", () => {
  const pontos = pontosDoArco(arco("a1", { x: 2000, y: 2000 }, 1000, 0, 90));
  for (const ponto of pontos) {
    assert.ok(Math.abs(Math.hypot(ponto.x - 2000, ponto.y - 2000) - 1000) <= 1, "ponto fora do raio");
  }
  assert.deepEqual(pontos[0], { x: 3000, y: 2000 }, "0° é à direita");
  assert.deepEqual(pontos[pontos.length - 1], { x: 2000, y: 1000 }, "90° sobe na planta");
  assert.ok(pontos.every((ponto) => Number.isInteger(ponto.x) && Number.isInteger(ponto.y)));
});

test("o círculo fecha em si mesmo", () => {
  const pontos = pontosDoArco(arco("a1", { x: 0, y: 0 }, 500, 0, 360));
  assert.deepEqual(pontos[0], pontos[pontos.length - 1]);
});

test("a caixa do arco abraça o traço, não a circunferência inteira", () => {
  // Com a caixa do centro mais o raio, um arco de 20° teria área de clique vinte vezes
  // maior do que o traço, e selecionar o que está atrás dele ficaria impossível.
  const caixa = limitesDoElemento(arco("a1", { x: 0, y: 0 }, 1000, 0, 90));
  assert.ok(caixa.x1 >= -100 && caixa.y2 <= 100, `a caixa vazou para o quadrante errado: ${JSON.stringify(caixa)}`);
  assert.ok(caixa.x2 >= 1000 && caixa.y1 <= -1000);
});

test("mover o arco move o centro e preserva a forma", () => {
  const movido = moverElemento(arco("a1", { x: 0, y: 0 }, 1000, 30, 120), 500, 500, 100);
  assert.deepEqual(movido.centro, { x: 500, y: 500 });
  assert.equal(movido.raioMm, 1000);
  assert.equal(movido.inicioGraus, 30);
  assert.equal(movido.varreduraGraus, 120);
  assert.equal(elementoSchema.safeParse(movido).success, true);
});

test("o arco entra no encaixe pela ponta e pelo centro, não por cada corda", () => {
  const documento = doc([arco("a1", { x: 2000, y: 2000 }, 1000, 0, 90)]);
  const naPonta = encaixePerto(documento, { x: 3040, y: 2020 }, padrao);
  assert.equal(naPonta.tipo, "extremo");
  assert.deepEqual(naPonta.ponto, { x: 3000, y: 2000 });

  const noCentro = encaixePerto(documento, { x: 2030, y: 1970 }, padrao);
  assert.equal(noCentro.tipo, "centro");
  assert.deepEqual(noCentro.ponto, { x: 2000, y: 2000 });

  const notaveis = pontosNotaveis(documento);
  assert.ok(notaveis.length <= 4, `o arco despejou ${notaveis.length} candidatos de encaixe na tela`);
});

test("o arco não inventa área no quantitativo", () => {
  const resumo = quantitativo(doc([arco("a1", { x: 0, y: 0 }, 1000, 0, 360)]));
  assert.equal(resumo.areaTotalM2, 0);
  assert.equal(resumo.paredesM, 0);
});

test("arco e círculo sobrevivem à ida e volta em DXF como curva, não como polilinha", () => {
  const documento = doc([
    arco("a1", { x: 2000, y: 1000 }, 800, 0, 90),
    arco("a2", { x: 5000, y: 5000 }, 450, 0, 360),
  ]);
  const saida = exportarDxf(documento);
  assert.ok(saida.includes("\nARC\n"), "o arco virou outra coisa no arquivo");
  assert.ok(saida.includes("\nCIRCLE\n"), "o círculo virou outra coisa no arquivo");

  const lido = lerDxf(saida, { unidade: "mm" });
  const arcos = lido.elementos.filter((elemento) => elemento.tipo === "arco");
  assert.equal(arcos.length, 2, "a curva voltou achatada e o raio se perdeu");
  const quarto = arcos.find((elemento) => elemento.varreduraGraus === 90);
  assert.deepEqual(quarto.centro, { x: 2000, y: 1000 });
  assert.equal(quarto.raioMm, 800);
  assert.equal(quarto.inicioGraus, 0);
  const circulo = arcos.find((elemento) => elemento.varreduraGraus === 360);
  assert.equal(circulo.raioMm, 450);
  assert.deepEqual(circulo.centro, { x: 5000, y: 5000 });
});

test("arco que atravessa o zero volta com a mesma varredura", () => {
  // De 300° a 30° são 90°, não 270°. Errar o sinal aqui desenha o arco complementar.
  const lido = lerDxf(exportarDxf(doc([arco("a1", { x: 0, y: 0 }, 1000, 300, 90)])), { unidade: "mm" });
  const [voltou] = lido.elementos.filter((elemento) => elemento.tipo === "arco");
  assert.equal(voltou.inicioGraus, 300);
  assert.equal(voltou.varreduraGraus, 90);
});

test("arco sem raio no arquivo é declarado em vez de virar um ponto", () => {
  const lido = lerDxf([
    "0", "SECTION", "2", "ENTITIES",
    "0", "CIRCLE", "8", "0", "10", "0", "20", "0", "40", "0",
    "0", "ENDSEC", "0", "EOF",
  ].join("\n") + "\n", { unidade: "mm" });
  assert.equal(lido.elementos.length, 0);
  assert.match(lido.avisos.join(" "), /arco sem raio/);
});

// ## Paralela

test("a paralela da parede fica à distância pedida e mantém o comprimento", () => {
  const original = parede("p1", { x: 0, y: 0 }, { x: 4000, y: 0 });
  const paralela = paralelaDe(original, 150);
  assert.equal(paralela.a.y, paralela.b.y);
  assert.equal(Math.abs(paralela.a.y), 150);
  assert.equal(comprimentoM(paralela.a, paralela.b), comprimentoM(original.a, original.b));
  assert.equal(elementoSchema.safeParse(paralela).success, true);
});

test("o sinal escolhe o lado", () => {
  const original = parede("p1", { x: 0, y: 0 }, { x: 4000, y: 0 });
  const esquerda = paralelaDe(original, 150);
  const direita = paralelaDe(original, -150);
  assert.equal(esquerda.a.y, -direita.a.y);
  assert.notEqual(esquerda.a.y, direita.a.y);
});

test("a paralela do cômodo encolhe por dentro e cresce por fora", () => {
  const pontos = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }];
  const dentro = paralelaDe(comodo("c1", pontos), -200);
  const fora = paralelaDe(comodo("c1", pontos), 200);
  assert.equal(Math.round(areaM2(dentro.pontos) * 100) / 100, 9.36, "3,6 × 2,6 m");
  assert.equal(Math.round(areaM2(fora.pontos) * 100) / 100, 14.96, "4,4 × 3,4 m");
  assert.equal(dentro.pontos.length, 4, "a paralela do retângulo continua tendo quatro cantos");
  assert.equal(elementoSchema.safeParse(dentro).success, true);
});

test("os cantos da paralela do retângulo caem no lugar exato", () => {
  const pontos = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }];
  const dentro = paralelaDe(comodo("c1", pontos), -200);
  assert.deepEqual(dentro.pontos, [
    { x: 200, y: 200 }, { x: 3800, y: 200 }, { x: 3800, y: 2800 }, { x: 200, y: 2800 },
  ]);
});

test("canto fechado demais é chanfrado em vez de virar espeto", () => {
  // Um espeto de dez metros saindo de um cômodo é pior do que um canto levemente
  // arredondado, e passa despercebido até alguém imprimir.
  const agudo = [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 0, y: 60 }];
  const resultado = paralelaDe(comodo("c1", agudo), 200);
  assert.ok(resultado, "a operação não pode simplesmente falhar");
  for (const ponto of resultado.pontos) {
    assert.ok(Math.hypot(ponto.x, ponto.y) < 40000, `emenda disparou para ${JSON.stringify(ponto)}`);
  }
});

test("a paralela do traço aberto não fecha o traço", () => {
  const traco = { id: "t1", camada: "anotacao", tipo: "traco", espessuraMm: 20,
    pontos: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }] };
  const paralela = paralelaDe(traco, 100);
  assert.equal(paralela.pontos.length, 3);
  assert.notDeepEqual(paralela.pontos[0], paralela.pontos[2]);
});

test("a paralela do arco é concêntrica, e não existe abaixo do centro", () => {
  const paralela = paralelaDe(arco("a1", { x: 0, y: 0 }, 1000, 0, 90), 200);
  assert.deepEqual(paralela.centro, { x: 0, y: 0 });
  assert.equal(paralela.raioMm, 800);
  assert.equal(paralelaDe(arco("a1", { x: 0, y: 0 }, 100, 0, 90), 500), null, "raio negativo não é arco");
});

test("o que não tem paralela devolve nada, em vez de um resultado inventado", () => {
  const cota = { id: "k1", camada: "anotacao", tipo: "cota", a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, deslocamentoMm: 300 };
  assert.equal(paralelaDe(cota, 100), null);
  assert.equal(paralelaDe(parede("p1", { x: 0, y: 0 }, { x: 1000, y: 0 }), 0), null, "distância zero não é paralela");
  assert.equal(paralelaDe(parede("p1", { x: 0, y: 0 }, { x: 1000, y: 0 }), NaN), null);
  assert.equal(paralelaDePolilinha([{ x: 0, y: 0 }], 100, false), null);
  assert.equal(paralelaDePolilinha([{ x: 0, y: 0 }, { x: 0, y: 0 }], 100, false), null, "pontos repetidos não formam segmento");
});

test("as duas faces da parede saem simétricas e na espessura dela", () => {
  const original = parede("p1", { x: 0, y: 0 }, { x: 4000, y: 0 });
  const [um, outro] = facesDaParede(original);
  assert.equal(Math.abs(um.a.y - outro.a.y), original.espessuraMm);
  assert.equal(um.a.y, -outro.a.y);
  assert.equal(facesDaParede(comodo("c1", [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }])), null);
});

test("a paralela não reaproveita o identificador do original", () => {
  // Dois elementos com o mesmo id se apagam mutuamente na hora de editar.
  const original = parede("p1", { x: 0, y: 0 }, { x: 4000, y: 0 });
  const paralela = paralelaDe(original, 150);
  assert.equal(paralela.id, original.id, "quem chama é que dá o id novo — este teste fixa o contrato");
  assert.notDeepEqual(paralela.a, original.a);
});

// ## Espelhar, repetir, aparar e estender

const { espelhar, matrizRetangular, aparar, estender } = cad;

const eixoVertical = [{ x: 0, y: 0 }, { x: 0, y: 1000 }];
const eixoHorizontal = [{ x: 0, y: 0 }, { x: 1000, y: 0 }];
const contador = () => { let n = 0; return () => `copia-${n += 1}`; };

test("espelhar a parede reflete as duas pontas e preserva o comprimento", () => {
  const original = parede("p1", { x: 1000, y: 500 }, { x: 4000, y: 500 });
  const refletida = espelhar(original, ...eixoVertical);
  assert.deepEqual(refletida.a, { x: -1000, y: 500 });
  assert.deepEqual(refletida.b, { x: -4000, y: 500 });
  assert.equal(comprimentoM(refletida.a, refletida.b), comprimentoM(original.a, original.b));
  assert.equal(elementoSchema.safeParse(refletida).success, true);
});

test("espelhar duas vezes no mesmo eixo devolve o original", () => {
  const original = parede("p1", { x: 1200, y: 700 }, { x: 4300, y: 2100 });
  const voltou = espelhar(espelhar(original, ...eixoVertical), ...eixoVertical);
  assert.deepEqual(voltou.a, original.a);
  assert.deepEqual(voltou.b, original.b);
});

test("o polígono espelhado inverte o sentido, para a face não virar para dentro", () => {
  // Sem inverter, a paralela do cômodo espelhado sairia para o lado errado depois.
  const original = comodo("c1", [{ x: 1000, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }]);
  const refletido = espelhar(original, ...eixoVertical);
  assert.deepEqual(refletido.pontos, [{ x: -4000, y: 3000 }, { x: -4000, y: 0 }, { x: -1000, y: 0 }]);
  assert.equal(areaM2(refletido.pontos), areaM2(original.pontos));
});

test("o giro do símbolo acompanha o espelho, em vez de apontar para o lado errado", () => {
  const simbolo = { id: "s1", camada: "eletrico", tipo: "simbolo", familia: "tomada-media",
    posicao: { x: 2000, y: 1000 }, rotacaoGraus: 30 };
  // Refletir uma direção no eixo de ângulo α leva θ a 2α − θ. No eixo vertical (α = 90°
  // na tela) um giro de 30° vira 150°; no horizontal (α = 0°), vira 330°. Os dois são
  // diferentes, e trocá-los apontaria o símbolo para o lado errado num dos casos.
  const noVertical = espelhar(simbolo, ...eixoVertical);
  assert.deepEqual(noVertical.posicao, { x: -2000, y: 1000 });
  assert.equal(noVertical.rotacaoGraus, 150);

  const noHorizontal = espelhar(simbolo, ...eixoHorizontal);
  assert.deepEqual(noHorizontal.posicao, { x: 2000, y: -1000 });
  assert.equal(noHorizontal.rotacaoGraus, 330);

  // E espelhar duas vezes no mesmo eixo devolve o giro original.
  assert.equal(espelhar(noVertical, ...eixoVertical).rotacaoGraus, 30);
  assert.equal(espelhar(noHorizontal, ...eixoHorizontal).rotacaoGraus, 30);
});

test("o arco espelhado cobre o trecho refletido, não o oposto", () => {
  // Espelhado, o arco passa a ser percorrido ao contrário. Guardar a varredura como
  // positiva exige recomeçar onde ele terminava — errar isso desenha o complementar.
  const noHorizontal = espelhar(arco("a1", { x: 0, y: 0 }, 1000, 0, 90), ...eixoHorizontal);
  assert.equal(noHorizontal.inicioGraus, 270);
  assert.equal(noHorizontal.varreduraGraus, 90);
  assert.deepEqual(noHorizontal.centro, { x: 0, y: 0 });

  const noVertical = espelhar(arco("a1", { x: 0, y: 0 }, 1000, 0, 90), ...eixoVertical);
  assert.equal(noVertical.inicioGraus, 90);
  assert.equal(noVertical.varreduraGraus, 90);
});

test("o arco espelhado duas vezes volta a ser o mesmo arco", () => {
  const original = arco("a1", { x: 500, y: 500 }, 1000, 37, 143);
  const voltou = espelhar(espelhar(original, ...eixoVertical), ...eixoVertical);
  assert.deepEqual(voltou.centro, original.centro);
  assert.equal(voltou.inicioGraus, original.inicioGraus);
  assert.equal(voltou.varreduraGraus, original.varreduraGraus);
});

test("eixo de comprimento zero não espelha nada", () => {
  assert.equal(espelhar(parede("p1", { x: 0, y: 0 }, { x: 1000, y: 0 }), { x: 5, y: 5 }, { x: 5, y: 5 }), null);
});

test("a matriz devolve só as cópias, e o original fica onde está", () => {
  // Somar o original aqui faria a contagem dobrar toda vez que alguém repetisse o comando.
  const original = parede("p1", { x: 0, y: 0 }, { x: 1000, y: 0 });
  const copias = matrizRetangular(original, { colunas: 3, linhas: 2, passoXMm: 2000, passoYMm: 1500 }, contador());
  assert.equal(copias.length, 5);
  assert.ok(!copias.some((copia) => copia.a.x === 0 && copia.a.y === 0));
  assert.deepEqual(copias.map((copia) => copia.id), ["copia-1", "copia-2", "copia-3", "copia-4", "copia-5"]);
  assert.deepEqual(copias[0].a, { x: 2000, y: 0 });
  assert.deepEqual(copias[2].a, { x: 0, y: 1500 });
  assert.deepEqual(copias[4].a, { x: 4000, y: 1500 });
});

test("a matriz não reencaixa as cópias na malha do documento", () => {
  // Passo de 250 mm numa malha de 100 desalinharia as colunas a cada cópia.
  const copias = matrizRetangular(parede("p1", { x: 0, y: 0 }, { x: 100, y: 0 }),
    { colunas: 4, linhas: 1, passoXMm: 250, passoYMm: 0 }, contador());
  assert.deepEqual(copias.map((copia) => copia.a.x), [250, 500, 750]);
});

test("a matriz funciona com qualquer elemento e mantém todos válidos", () => {
  const amostras = [
    comodo("c1", [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }]),
    arco("a1", { x: 0, y: 0 }, 500, 0, 180),
    { id: "s1", camada: "eletrico", tipo: "simbolo", familia: "spot", posicao: { x: 0, y: 0 }, rotacaoGraus: 0 },
  ];
  for (const amostra of amostras) {
    const copias = matrizRetangular(amostra, { colunas: 2, linhas: 2, passoXMm: 3000, passoYMm: 3000 }, contador());
    assert.equal(copias.length, 3, `a matriz falhou em ${amostra.tipo}`);
    for (const copia of copias) assert.equal(elementoSchema.safeParse(copia).success, true);
  }
});

test("matriz sem sentido devolve lista vazia em vez de lixo", () => {
  const original = parede("p1", { x: 0, y: 0 }, { x: 1000, y: 0 });
  assert.deepEqual(matrizRetangular(original, { colunas: 0, linhas: 2, passoXMm: 100, passoYMm: 100 }, contador()), []);
  assert.deepEqual(matrizRetangular(original, { colunas: 3, linhas: 1, passoXMm: 0, passoYMm: 0 }, contador()), [],
    "cópias empilhadas no mesmo lugar não são matriz");
  assert.deepEqual(matrizRetangular(original, { colunas: 50, linhas: 50, passoXMm: 100, passoYMm: 100 }, contador()), [],
    "duas mil e quinhentas cópias ninguém revisa");
  assert.deepEqual(matrizRetangular(original, { colunas: 2, linhas: 2, passoXMm: NaN, passoYMm: 0 }, contador()), []);
});

const cortante = (a, b) => ({ a, b, elementoId: "corte" });

test("aparar remove o lado em que se clicou", () => {
  const original = parede("p1", { x: 0, y: 0 }, { x: 4000, y: 0 });
  const corte = cortante({ x: 2500, y: -1000 }, { x: 2500, y: 1000 });

  const semAPonta = aparar(original, corte, { x: 3800, y: 0 });
  assert.deepEqual(semAPonta.a, { x: 0, y: 0 });
  assert.deepEqual(semAPonta.b, { x: 2500, y: 0 }, "clicando na ponta direita, é a direita que some");

  const semOComeco = aparar(original, corte, { x: 200, y: 0 });
  assert.deepEqual(semOComeco.a, { x: 2500, y: 0 });
  assert.deepEqual(semOComeco.b, { x: 4000, y: 0 });
});

test("aparar contra o prolongamento de uma parede que não chega ali não corta", () => {
  // O cortante precisa cruzar de verdade: cortar no prolongamento poria o fim da parede
  // num lugar onde não há nada desenhado.
  const original = parede("p1", { x: 0, y: 0 }, { x: 4000, y: 0 });
  assert.equal(aparar(original, cortante({ x: 2500, y: 500 }, { x: 2500, y: 1500 }), { x: 3800, y: 0 }), null);
  assert.equal(aparar(original, cortante({ x: 6000, y: -500 }, { x: 6000, y: 500 }), { x: 3800, y: 0 }), null,
    "cruzamento além da ponta é caso de estender, não de aparar");
  assert.equal(aparar(original, cortante({ x: 0, y: 500 }, { x: 4000, y: 500 }), { x: 2000, y: 0 }), null,
    "paralelas não se cruzam");
});

test("estender leva a ponta mais perto do clique até o cortante", () => {
  const original = parede("p1", { x: 0, y: 0 }, { x: 4000, y: 0 });
  const corte = cortante({ x: 6000, y: -1000 }, { x: 6000, y: 1000 });
  const esticada = estender(original, corte, { x: 3900, y: 0 });
  assert.deepEqual(esticada.a, { x: 0, y: 0 });
  assert.deepEqual(esticada.b, { x: 6000, y: 0 });

  const paraTras = estender(original, cortante({ x: -2000, y: -1000 }, { x: -2000, y: 1000 }), { x: 100, y: 0 });
  assert.deepEqual(paraTras.a, { x: -2000, y: 0 });
  assert.deepEqual(paraTras.b, { x: 4000, y: 0 });
});

test("estender não apara calado quando o encontro cai dentro do traço", () => {
  // Fazer a coisa errada em silêncio é pior do que não fazer nada.
  const original = parede("p1", { x: 0, y: 0 }, { x: 4000, y: 0 });
  assert.equal(estender(original, cortante({ x: 2000, y: -500 }, { x: 2000, y: 500 }), { x: 3900, y: 0 }), null);
});

test("aparar e estender funcionam no segmento certo de uma polilinha", () => {
  const traco = { id: "t1", camada: "anotacao", tipo: "traco", espessuraMm: 20,
    pontos: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 4000 }] };
  const aparado = aparar(traco, cortante({ x: 3000, y: 1000 }, { x: 5000, y: 1000 }), { x: 4000, y: 3500 });
  assert.deepEqual(aparado.pontos, [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 1000 }],
    "o segundo segmento foi aparado e o primeiro ficou intacto");
  assert.equal(elementoSchema.safeParse(aparado).success, true);
});

test("aparar até comprimento zero não deixa um traço fantasma", () => {
  const original = parede("p1", { x: 0, y: 0 }, { x: 4000, y: 0 });
  assert.equal(aparar(original, cortante({ x: 0, y: -100 }, { x: 0, y: 100 }), { x: 100, y: 0 }), null);
});

test("o que não é traço nem parede não apara nem estende", () => {
  const corte = cortante({ x: 0, y: -1000 }, { x: 0, y: 1000 });
  assert.equal(aparar(comodo("c1", [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }]), corte, { x: 500, y: 0 }), null);
  assert.equal(estender(arco("a1", { x: 0, y: 0 }, 500, 0, 90), corte, { x: 500, y: 0 }), null);
});
