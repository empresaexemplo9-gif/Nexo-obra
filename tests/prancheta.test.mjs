// Núcleo da prancheta. O que se testa aqui é o que não pode errar em silêncio: medida em
// milímetro inteiro, área derivada do desenho (nunca digitada) e camada como filtro de
// disciplina. Um erro de 1 mm aqui vira parede que não fecha na obra.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ configFile: false, appType: "custom", root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const prancheta = await vite.ssrLoadModule("/lib/prancheta.ts");
after(() => vite.close());

const {
  documentoVazio, documentoSchema, elementoSchema, encaixar, areaM2, comprimentoM,
  perimetroM, elementosVisiveis, camadaBloqueada, quantitativo, CAMADAS_PADRAO,
  DISCIPLINAS, FAMILIAS_SIMBOLO, simboloLabels, disciplinaLabels,
} = prancheta;

const doc = (partes = {}) => ({ ...documentoVazio(), ...partes });
const parede = (id, a, b, camada = "layout") => ({ id, camada, tipo: "parede", a, b, espessuraMm: 150 });
const comodo = (id, nome, pontos, camada = "layout") => ({ id, camada, tipo: "comodo", nome, pontos });
const simbolo = (id, familia, camada) => ({ id, camada, tipo: "simbolo", familia, posicao: { x: 0, y: 0 }, rotacaoGraus: 0 });

test("documento vazio é uma folha A1 deitada válida", () => {
  const documento = documentoVazio();
  assert.equal(documento.folhaLarguraMm, 841);
  assert.equal(documento.folhaAlturaMm, 594);
  assert.ok(documento.folhaLarguraMm > documento.folhaAlturaMm, "A1 deitado: largura maior que altura");
  assert.equal(documento.escala, 50);
  assert.equal(documento.malhaMm, 100);
  assert.equal(documento.fundo, null);
  documentoSchema.parse(documento);
});

test("documento vazio traz as cinco disciplinas, todas visíveis e destravadas", () => {
  const documento = documentoVazio();
  assert.deepEqual(documento.camadas.map((camada) => camada.disciplina), [...DISCIPLINAS]);
  assert.ok(documento.camadas.every((camada) => camada.visivel && !camada.bloqueada));
  for (const disciplina of DISCIPLINAS) assert.ok(disciplinaLabels[disciplina], `falta rótulo de ${disciplina}`);
});

test("documento vazio não compartilha camadas entre instâncias", () => {
  // Se `documentoVazio` devolvesse as mesmas referências de CAMADAS_PADRAO, esconder uma
  // camada em um projeto esconderia em todos os outros abertos na mesma sessão.
  const um = documentoVazio();
  const outro = documentoVazio();
  um.camadas[0].visivel = false;
  assert.equal(outro.camadas[0].visivel, true);
  assert.equal(CAMADAS_PADRAO[0].visivel, true);
});

test("encaixe leva o traço ao passo da malha", () => {
  assert.equal(encaixar(1234, 100), 1200);
  assert.equal(encaixar(1250, 100), 1300); // meio passo sobe, e sobe sempre para o mesmo lado
  assert.equal(encaixar(-1234, 100), -1200);
  assert.equal(encaixar(0, 100), 0);
  assert.equal(encaixar(37, 50), 50);
});

test("malha desligada preserva precisão submilimétrica", () => {
  assert.equal(encaixar(1234.7, 1), 1234.7);
  assert.equal(encaixar(1234.2, 0), 1234.2);
  assert.equal(encaixar(-999.5, 1), -999.5);
});

test("encaixe ativo devolve múltiplo do passo", () => {
  for (const malha of [10, 25, 50, 100, 250, 1000]) {
    for (const valor of [0, 3, 77.4, 1234.6, -812.3, 99999]) {
      assert.ok(Number.isInteger(encaixar(valor, malha)), `${valor} na malha ${malha} saiu fracionado`);
    }
  }
});

test("área sai do polígono em metros quadrados", () => {
  // Quarto de 3,00 × 4,00 m = 12 m², nos dois sentidos de desenho.
  const horario = [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 4000 }, { x: 0, y: 4000 }];
  assert.equal(areaM2(horario), 12);
  assert.equal(areaM2([...horario].reverse()), 12, "sentido do traço não muda a área");
});

test("área de polígono em L soma os dois retângulos", () => {
  // 4×4 m com um recorte de 2×2 m: 16 − 4 = 12 m².
  const forma = [
    { x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 2000 },
    { x: 2000, y: 2000 }, { x: 2000, y: 4000 }, { x: 0, y: 4000 },
  ];
  assert.equal(areaM2(forma), 12);
});

test("polígono aberto demais não vira área inventada", () => {
  assert.equal(areaM2([]), 0);
  assert.equal(areaM2([{ x: 0, y: 0 }]), 0);
  assert.equal(areaM2([{ x: 0, y: 0 }, { x: 3000, y: 0 }]), 0);
});

test("comprimento e perímetro em metros", () => {
  assert.equal(comprimentoM({ x: 0, y: 0 }, { x: 3150, y: 0 }), 3.15);
  assert.equal(comprimentoM({ x: 0, y: 0 }, { x: 3000, y: 4000 }), 5);
  assert.equal(comprimentoM({ x: 500, y: 500 }, { x: 500, y: 500 }), 0);
  const quarto = [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 4000 }, { x: 0, y: 4000 }];
  assert.equal(perimetroM(quarto), 14, "perímetro fecha o polígono: 3+4+3+4");
  assert.equal(perimetroM([{ x: 0, y: 0 }]), 0);
});

test("só desenha o que está em camada visível", () => {
  const documento = doc({ elementos: [parede("p1", { x: 0, y: 0 }, { x: 1000, y: 0 }, "layout"), simbolo("s1", "spot", "luminotecnico")] });
  assert.deepEqual(elementosVisiveis(documento).map((e) => e.id), ["p1", "s1"]);

  documento.camadas = documento.camadas.map((camada) => camada.id === "luminotecnico" ? { ...camada, visivel: false } : camada);
  assert.deepEqual(elementosVisiveis(documento).map((e) => e.id), ["p1"]);
});

test("elemento órfão fica escondido mas continua no documento", () => {
  // Camada apagada não pode levar o desenho junto: some da tela, permanece no arquivo.
  const documento = doc({ elementos: [parede("p1", { x: 0, y: 0 }, { x: 1000, y: 0 }, "layout"), simbolo("s1", "spot", "camada-apagada")] });
  assert.deepEqual(elementosVisiveis(documento).map((e) => e.id), ["p1"]);
  assert.equal(documento.elementos.length, 2);
  assert.ok(documento.elementos.some((e) => e.id === "s1"));
});

test("ordem de desenho segue a ordem das camadas, não a de inserção", () => {
  // O mobiliário tem que cair por cima da parede; se a ordem fosse a de inserção, mover um
  // móvel o mandaria para trás do desenho.
  const documento = doc({
    elementos: [
      { id: "m1", camada: "mobiliario", tipo: "mobilia", posicao: { x: 0, y: 0 }, larguraMm: 1800, alturaMm: 900, rotacaoGraus: 0, rotulo: "Sofá" },
      parede("p1", { x: 0, y: 0 }, { x: 1000, y: 0 }, "layout"),
    ],
  });
  assert.deepEqual(elementosVisiveis(documento).map((e) => e.id), ["p1", "m1"]);
});

test("camada travada bloqueia edição e camada inexistente é tratada como travada", () => {
  const documento = doc();
  assert.equal(camadaBloqueada(documento, "layout"), false);
  documento.camadas = documento.camadas.map((camada) => camada.id === "layout" ? { ...camada, bloqueada: true } : camada);
  assert.equal(camadaBloqueada(documento, "layout"), true);
  assert.equal(camadaBloqueada(documento, "nao-existe"), true, "sem camada conhecida, o seguro é não deixar editar");
});

test("quantitativo deriva área, perímetro e metragem de parede do desenho", () => {
  const documento = doc({
    elementos: [
      comodo("c1", "Sala", [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }]),
      comodo("c2", "Quarto", [{ x: 0, y: 3000 }, { x: 3000, y: 3000 }, { x: 3000, y: 6000 }, { x: 0, y: 6000 }]),
      parede("p1", { x: 0, y: 0 }, { x: 4000, y: 0 }),
      parede("p2", { x: 4000, y: 0 }, { x: 4000, y: 3000 }),
    ],
  });
  const resumo = quantitativo(documento);
  assert.equal(resumo.areaTotalM2, 21); // 12 + 9
  assert.equal(resumo.paredesM, 7); // 4 + 3
  assert.deepEqual(resumo.comodos, [
    { nome: "Sala", areaM2: 12, perimetroM: 14 },
    { nome: "Quarto", areaM2: 9, perimetroM: 12 },
  ]);
});

test("quantitativo conta símbolos por disciplina", () => {
  const documento = doc({
    elementos: [
      simbolo("s1", "tomada-media", "eletrico"),
      simbolo("s2", "tomada-media", "eletrico"),
      simbolo("s3", "interruptor-simples", "eletrico"),
      simbolo("s4", "spot", "luminotecnico"),
    ],
  });
  const resumo = quantitativo(documento);
  const eletrico = resumo.porDisciplina.find((linha) => linha.disciplina === "eletrico");
  assert.deepEqual(eletrico.simbolos, { "tomada-media": 2, "interruptor-simples": 1 });
  assert.equal(eletrico.total, 3);
  assert.equal(resumo.porDisciplina.find((linha) => linha.disciplina === "luminotecnico").total, 1);
});

test("quantitativo ignora símbolo órfão em vez de somar em disciplina errada", () => {
  const resumo = quantitativo(doc({ elementos: [simbolo("s1", "spot", "camada-apagada")] }));
  assert.deepEqual(resumo.porDisciplina, []);
});

test("quantitativo conta camada escondida: esconder é visualização, não exclusão", () => {
  // Apagar a luz da tela para imprimir o layout não pode apagar os pontos do orçamento.
  const documento = doc({ elementos: [simbolo("s1", "spot", "luminotecnico")] });
  documento.camadas = documento.camadas.map((camada) => camada.id === "luminotecnico" ? { ...camada, visivel: false } : camada);
  assert.equal(quantitativo(documento).porDisciplina.find((linha) => linha.disciplina === "luminotecnico").total, 1);
});

test("quantitativo de documento vazio não inventa número", () => {
  const resumo = quantitativo(documentoVazio());
  assert.deepEqual(resumo, { areaTotalM2: 0, comodos: [], paredesM: 0, porDisciplina: [] });
});

test("cômodo sem nome aparece identificado, não some do resumo", () => {
  const resumo = quantitativo(doc({ elementos: [comodo("c1", "", [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }])] }));
  assert.equal(resumo.comodos.length, 1);
  assert.equal(resumo.comodos[0].nome, "Sem nome");
});

test("coordenada CAD preserva fração de milímetro e recusa valores não finitos", () => {
  const fracionaria = parede("p1", { x: 0.5, y: 0 }, { x: 1000, y: 0 });
  assert.equal(elementoSchema.safeParse(fracionaria).success, true);
  assert.equal(elementoSchema.safeParse(parede("p1", { x: Infinity, y: 0 }, { x: 1000, y: 0 })).success, false);
  assert.equal(elementoSchema.safeParse(parede("p1", { x: 0, y: 0 }, { x: 1000, y: 0 })).success, true);
});

test("elemento recusa campo desconhecido e tipo inexistente", () => {
  const extra = { ...parede("p1", { x: 0, y: 0 }, { x: 1000, y: 0 }), cor: "#000" };
  assert.equal(elementoSchema.safeParse(extra).success, false);
  assert.equal(elementoSchema.safeParse({ id: "x", camada: "layout", tipo: "hachura" }).success, false);
});

test("medidas fora de faixa física são recusadas", () => {
  assert.equal(elementoSchema.safeParse({ ...parede("p1", { x: 0, y: 0 }, { x: 1000, y: 0 }), espessuraMm: 5 }).success, false);
  assert.equal(elementoSchema.safeParse({ ...parede("p1", { x: 0, y: 0 }, { x: 1000, y: 0 }), espessuraMm: 2000 }).success, false);
  const giroInvalido = { ...simbolo("s1", "spot", "luminotecnico"), rotacaoGraus: 360 };
  assert.equal(elementoSchema.safeParse(giroInvalido).success, false);
  assert.equal(elementoSchema.safeParse({ ...simbolo("s1", "spot", "luminotecnico"), rotacaoGraus: 359 }).success, true);
});

test("cômodo exige polígono fechável", () => {
  const doisPontos = { id: "c1", camada: "layout", tipo: "comodo", nome: "Sala", pontos: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] };
  assert.equal(elementoSchema.safeParse(doisPontos).success, false);
  assert.equal(elementoSchema.safeParse(comodo("c1", "Sala", [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }])).success, true);
});

test("imagem exige a chave do arquivo armazenado", () => {
  const base = { id: "i1", camada: "mobiliario", tipo: "imagem", posicao: { x: 0, y: 0 }, larguraMm: 1000, alturaMm: 1000, rotacaoGraus: 0 };
  assert.equal(elementoSchema.safeParse(base).success, false, "imagem sem arquivo é elemento vazio na tela");
  assert.equal(elementoSchema.safeParse({ ...base, chave: "org/1/plantas/abc" }).success, true);
});

test("documento recusa folha de tamanho impossível e escala zero", () => {
  assert.equal(documentoSchema.safeParse(doc({ folhaLarguraMm: 0 })).success, false);
  assert.equal(documentoSchema.safeParse(doc({ escala: 0 })).success, false);
  assert.equal(documentoSchema.safeParse(doc({ malhaMm: 0 })).success, false);
  assert.equal(documentoSchema.safeParse(doc({ camadas: [] })).success, false, "documento sem camada não recebe elemento");
});

test("fundo de traçado é opcional mas completo quando existe", () => {
  const fundo = { chave: "org/1/fundo/planta.pdf", nome: "planta.pdf", larguraMm: 841, alturaMm: 594, opacidade: 40 };
  assert.equal(documentoSchema.safeParse(doc({ fundo })).success, true);
  assert.equal(documentoSchema.safeParse(doc({ fundo: { ...fundo, chave: "" } })).success, false);
  assert.equal(documentoSchema.safeParse(doc({ fundo: { ...fundo, opacidade: 0 } })).success, false, "fundo invisível confunde mais que ajuda");
});

test("toda família de símbolo tem rótulo em português", () => {
  for (const [disciplina, familias] of Object.entries(FAMILIAS_SIMBOLO)) {
    for (const familia of familias) {
      assert.ok(simboloLabels[familia], `família ${familia} de ${disciplina} entraria na paleta sem nome legível`);
    }
  }
});

const { moverElemento, limitesDoElemento, limitesDoDesenho, glifoDoSimbolo, exportarSvg } = prancheta;

test("mover preserva identidade e camada e encaixa na malha", () => {
  const original = parede("p1", { x: 0, y: 0 }, { x: 3000, y: 0 });
  const movido = moverElemento(original, 137, 260, 100);
  assert.equal(movido.id, "p1");
  assert.equal(movido.camada, "layout");
  assert.equal(movido.tipo, "parede");
  assert.deepEqual(movido.a, { x: 100, y: 300 });
  assert.deepEqual(movido.b, { x: 3100, y: 300 });
  assert.equal(original.a.x, 0, "o elemento original não é alterado no lugar");
});

test("mover não deforma: a peça inteira anda junto", () => {
  // Arredondar cada ponta por conta própria encolheria a parede a cada arrasto.
  const antes = parede("p1", { x: 1000, y: 0 }, { x: 4150, y: 0 });
  const comprimentoAntes = comprimentoM(antes.a, antes.b);
  const depois = moverElemento(antes, 500, 0, 50);
  assert.equal(comprimentoM(depois.a, depois.b), comprimentoAntes);
});

test("mover funciona em todos os tipos de elemento", () => {
  const amostras = [
    parede("p", { x: 0, y: 0 }, { x: 1000, y: 0 }),
    comodo("c", "Sala", [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }]),
    simbolo("s", "spot", "luminotecnico"),
    { id: "t", camada: "anotacao", tipo: "traco", pontos: [{ x: 0, y: 0 }, { x: 500, y: 500 }], espessuraMm: 20 },
    { id: "k", camada: "anotacao", tipo: "cota", a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, deslocamentoMm: 300 },
    { id: "x", camada: "anotacao", tipo: "texto", posicao: { x: 0, y: 0 }, texto: "Norte", alturaMm: 200, rotacaoGraus: 0 },
  ];
  for (const elemento of amostras) {
    const movido = moverElemento(elemento, 1000, 1000, 100);
    assert.equal(elementoSchema.safeParse(movido).success, true, `mover quebrou o elemento ${elemento.tipo}`);
    assert.notDeepEqual(movido, elemento, `o elemento ${elemento.tipo} não se moveu`);
  }
});

test("limites contêm o elemento e crescem com a espessura", () => {
  const caixa = limitesDoElemento(parede("p1", { x: 1000, y: 2000 }, { x: 4000, y: 2000 }));
  assert.ok(caixa.x1 < 1000 && caixa.x2 > 4000);
  assert.ok(caixa.y1 < 2000 && caixa.y2 > 2000, "parede horizontal precisa de altura: é por ela que o clique acerta");
});

test("limites do desenho abraçam todos os elementos e somem quando não há nenhum", () => {
  const caixa = limitesDoDesenho([
    parede("p1", { x: 0, y: 0 }, { x: 1000, y: 0 }),
    simbolo("s1", "spot", "luminotecnico"),
    comodo("c1", "Sala", [{ x: 5000, y: 5000 }, { x: 8000, y: 5000 }, { x: 8000, y: 8000 }]),
  ]);
  assert.ok(caixa.x2 >= 8000 && caixa.y2 >= 8000);
  assert.ok(caixa.x1 <= 0 && caixa.y1 <= 0);
  assert.equal(limitesDoDesenho([]), null);
});

test("todo símbolo tem desenho próprio, e não o genérico", () => {
  const generico = glifoDoSimbolo("familia-que-nao-existe").d;
  for (const familias of Object.values(FAMILIAS_SIMBOLO)) {
    for (const familia of familias) {
      const glifo = glifoDoSimbolo(familia);
      assert.ok(glifo.d.length > 0, `${familia} saiu sem caminho`);
      assert.notEqual(glifo.d, generico, `${familia} cairia no desenho genérico e ficaria igual a outro símbolo`);
    }
  }
});

test("exportação traz o desenho visível e declara a medida em milímetros", () => {
  const documento = doc({
    elementos: [
      comodo("c1", "Sala", [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }]),
      parede("p1", { x: 0, y: 0 }, { x: 4000, y: 0 }),
    ],
  });
  const svg = exportarSvg(documento, { titulo: "Residência Laranjeiras" });
  assert.match(svg, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(svg, /<svg [^>]*width="\d+(\.\d+)?mm"/, "sem unidade, o arquivo imprime no tamanho que o programa achar");
  assert.match(svg, /viewBox="/);
  assert.ok(svg.includes("<polygon"), "o cômodo não saiu no arquivo");
  assert.ok(svg.includes("<line"), "a parede não saiu no arquivo");
  assert.ok(svg.includes("Residência Laranjeiras"));
  assert.ok(svg.includes("12,00 m²"), "a área sai calculada do polígono, em português");
});

test("exportação não leva o que está em camada escondida", () => {
  const documento = doc({ elementos: [simbolo("s1", "spot", "luminotecnico"), parede("p1", { x: 0, y: 0 }, { x: 1000, y: 0 })] });
  documento.camadas = documento.camadas.map((camada) => camada.id === "luminotecnico" ? { ...camada, visivel: false } : camada);
  const svg = exportarSvg(documento);
  assert.ok(svg.includes("<line"));
  assert.ok(!svg.includes("#846100\" stroke-width=\"35\""), "o símbolo da camada escondida foi parar no arquivo");
});

test("exportação escapa texto do usuário em vez de montar XML quebrado", () => {
  const documento = doc({
    elementos: [{ id: "t1", camada: "anotacao", tipo: "texto", posicao: { x: 0, y: 0 }, texto: '<script>&"fim"', alturaMm: 200, rotacaoGraus: 0 }],
  });
  const svg = exportarSvg(documento);
  assert.ok(!svg.includes("<script>"), "texto do usuário entrou como marcação no arquivo");
  assert.ok(svg.includes("&lt;script&gt;"));
  assert.ok(svg.includes("&amp;"));
});

test("exportação de documento vazio ainda é um SVG válido", () => {
  const svg = exportarSvg(documentoVazio());
  assert.match(svg, /<svg [^>]*viewBox="[-\d. ]+"/);
  assert.match(svg, /<\/svg>/);
});

test("a imagem exportada aponta para a origem informada, e não para um caminho relativo mudo", () => {
  const documento = doc({
    elementos: [{ id: "i1", camada: "mobiliario", tipo: "imagem", posicao: { x: 0, y: 0 }, larguraMm: 2000, alturaMm: 1000, rotacaoGraus: 0, chave: "/api/studio/assets/abc" }],
  });
  assert.ok(exportarSvg(documento, { origem: "https://exemplo.com" }).includes('href="https://exemplo.com/api/studio/assets/abc"'));
});
