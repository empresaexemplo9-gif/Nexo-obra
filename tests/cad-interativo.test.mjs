// Linha de comando interativa do Editor CAD: o diálogo do AutoCAD, passo a passo.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ configFile: false, appType: "custom", root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const { Interprete, textoDoPedido, acharComando, sugerirComandos, concordar, chanfrar, unir, explodir, esticar, distanciaAoElemento } = await vite.ssrLoadModule("/lib/cad-interativo.ts");
const { documentoVazio, validarAlteracao } = await vite.ssrLoadModule("/lib/prancheta.ts");
const { quebrarElemento } = await vite.ssrLoadModule("/lib/prancheta-cad.ts");
after(() => vite.close());

const linha = (id, a, b, extra = {}) => ({ id, camada: "layout", tipo: "traco", pontos: [a, b], espessuraMm: 25, ...extra });

/** Editor de mentira: guarda documento, seleção, histórico e o que foi registrado. */
function montar(elementos = [], selecao = []) {
  let n = 0;
  const estado = { documento: { ...documentoVazio(), malhaMm: 1, elementos }, selecao, log: [], acoes: [], historico: [] };
  const amb = {
    documento: () => estado.documento,
    selecao: () => estado.selecao,
    selecionar: (ids) => { estado.selecao = ids; },
    aplicar: (documento, novaSelecao) => {
      if (!validarAlteracao(estado.documento, documento)) return false;
      estado.historico.push(estado.documento);
      estado.documento = documento;
      if (novaSelecao) estado.selecao = novaSelecao;
      return true;
    },
    registrar: (texto) => estado.log.push(texto),
    acao: (acao) => estado.acoes.push(acao),
    novoId: () => `n${++n}`,
    camadaEscolhida: () => undefined,
  };
  const interprete = new Interprete(amb);
  const clique = (x, y) => interprete.responder({ tipo: "ponto", ponto: { x, y } });
  const objeto = (id, x, y) => interprete.responder({ tipo: "objeto", elemento: estado.documento.elementos.find((e) => e.id === id), ponto: { x, y } });
  return { estado, interprete, clique, objeto, elementos: () => estado.documento.elementos };
}

test("LINHA cria um objeto por trecho, desfaz o último e fecha", () => {
  const { interprete, clique, elementos, estado } = montar();
  interprete.digitar("l");
  assert.equal(interprete.nome, "LINHA");
  assert.equal(textoDoPedido(interprete.pedido), "Especifique o primeiro ponto:");
  clique(0, 0);
  assert.equal(textoDoPedido(interprete.pedido), "Especifique o próximo ponto [Desfazer]:");
  interprete.digitar("@1000,0");
  interprete.digitar("@0,1000");
  assert.equal(elementos().length, 2);
  assert.deepEqual(elementos()[1].pontos, [{ x: 1000, y: 0 }, { x: 1000, y: -1000 }]);
  interprete.digitar("d");
  assert.equal(elementos().length, 1, "Desfazer tira só o último trecho");
  interprete.digitar("@0,500");
  interprete.digitar("f");
  assert.equal(elementos().length, 3);
  assert.deepEqual(elementos()[2].pontos.at(-1), { x: 0, y: 0 });
  assert.equal(interprete.ativo, false);
  assert.ok(estado.log.includes("Comando: LINHA"));
});

test("Enter sem comando repete o último; Esc cancela sem deixar resto", () => {
  const { interprete, clique, elementos, estado } = montar();
  interprete.digitar("LINE");
  clique(0, 0); clique(500, 0);
  interprete.enter();
  assert.equal(interprete.ativo, false);
  interprete.enter();
  assert.equal(interprete.nome, "LINHA", "Enter repete o último comando");
  clique(0, 100);
  interprete.cancelar();
  assert.equal(interprete.ativo, false);
  assert.equal(estado.log.at(-1), "*Cancelar*");
  assert.equal(elementos().length, 1);
});

test("distância direta segue a direção do cursor e d<a parte do ponto base", () => {
  const { interprete, clique, elementos } = montar();
  interprete.digitar("L");
  clique(100, 100);
  interprete.digitar("2500", { x: 100, y: -5000 });
  assert.deepEqual(elementos()[0].pontos[1], { x: 100, y: -2400 });
  interprete.digitar("1000<0");
  assert.deepEqual(elementos()[1].pontos[1], { x: 1100, y: -2400 });
  interprete.digitar("3000,2000");
  assert.deepEqual(elementos()[2].pontos[1], { x: 3000, y: -2000 });
  interprete.digitar("xyz");
  assert.equal(elementos().length, 3, "texto inválido não cria nada");
  assert.ok(interprete.ativo);
});

test("POLILINHA fecha e o círculo lembra o raio anterior", () => {
  const { interprete, clique, elementos } = montar();
  interprete.digitar("pl");
  clique(0, 0); clique(1000, 0); clique(1000, 1000);
  interprete.digitar("Fechar");
  assert.equal(elementos().length, 1);
  assert.equal(elementos()[0].pontos.length, 4);
  interprete.digitar("c"); clique(0, 0); interprete.digitar("750");
  interprete.digitar("c"); clique(5000, 0);
  assert.match(textoDoPedido(interprete.pedido), /<750>:$/);
  interprete.enter();
  assert.equal(elementos().at(-1).raioMm, 750);
  interprete.digitar("c"); interprete.digitar("2p"); clique(0, 0); clique(0, 600);
  assert.equal(elementos().at(-1).raioMm, 300);
});

test("RETANGULO por cantos e ARCO por três pontos", () => {
  const { interprete, clique, elementos } = montar();
  interprete.digitar("rec"); clique(0, 0); interprete.digitar("@3000,2000");
  assert.deepEqual(elementos()[0].pontos[2], { x: 3000, y: -2000 });
  interprete.digitar("a"); clique(1000, 0); clique(0, -1000); clique(-1000, 0);
  const arco = elementos()[1];
  assert.equal(arco.tipo, "arco");
  assert.ok(Math.abs(arco.raioMm - 1000) < 1e-6);
  assert.ok(Math.abs(arco.inicioGraus) < 1e-6 && Math.abs(arco.varreduraGraus - 180) < 1e-6);
});

test("MOVER usa a seleção prévia, ponto base e segundo ponto; Enter usa o deslocamento", () => {
  const { interprete, clique, elementos, estado } = montar([linha("a", { x: 0, y: 0 }, { x: 1000, y: 0 })], ["a"]);
  interprete.digitar("m");
  assert.equal(interprete.pedido.modo, "ponto", "com seleção prévia não pede objetos");
  clique(0, 0); clique(500, 500);
  assert.deepEqual(elementos()[0].pontos[0], { x: 500, y: 500 });
  assert.deepEqual(estado.selecao, []);
  estado.selecao = ["a"];
  interprete.digitar("m"); interprete.enter();
  assert.equal(textoDoPedido(interprete.pedido), "Especifique o deslocamento <0,0>:");
  interprete.digitar("100,100");
  assert.deepEqual(elementos()[0].pontos[0], { x: 600, y: 400 });
  estado.selecao = ["a"];
  interprete.digitar("m"); interprete.digitar("@100,100"); interprete.enter();
  assert.deepEqual(elementos()[0].pontos[0], { x: 800, y: 200 }, "@ parte do último ponto, como o LASTPOINT do AutoCAD");
});

test("sem seleção prévia o comando pede objetos e Enter conclui a seleção", () => {
  const { interprete, clique, elementos, estado } = montar([linha("a", { x: 0, y: 0 }, { x: 1000, y: 0 }), linha("b", { x: 0, y: 500 }, { x: 1000, y: 500 })]);
  interprete.digitar("co");
  assert.equal(interprete.pedido.modo, "selecao");
  assert.equal(textoDoPedido(interprete.pedido), "Selecione objetos:");
  estado.selecao = ["a", "b"];
  interprete.enter();
  clique(0, 0); clique(0, 2000); clique(0, 4000);
  interprete.digitar("d");
  interprete.enter();
  assert.equal(elementos().length, 4, "duas cópias de duas linhas, a segunda desfeita");
});

test("ROTACIONAR com cópia e ESCALA por referência", () => {
  const { interprete, clique, elementos, estado } = montar([linha("a", { x: 0, y: 0 }, { x: 1000, y: 0 })], ["a"]);
  interprete.digitar("ro"); clique(0, 0); interprete.digitar("c"); interprete.digitar("90");
  assert.equal(elementos().length, 2);
  const girada = elementos()[1].pontos[1];
  assert.ok(Math.abs(girada.x) < 1e-9 && Math.abs(girada.y + 1000) < 1e-9, "90° anti-horário sobe");
  estado.selecao = ["a"];
  interprete.digitar("sc"); clique(0, 0); interprete.digitar("r"); interprete.digitar("1000"); interprete.digitar("2500");
  assert.ok(Math.abs(elementos()[0].pontos[1].x - 2500) < 1e-9);
});

test("ESPELHAR pergunta se apaga a origem", () => {
  const { interprete, clique, elementos, estado } = montar([linha("a", { x: 100, y: 0 }, { x: 1000, y: 0 })], ["a"]);
  interprete.digitar("mi"); clique(0, 0); clique(0, 1000);
  assert.match(textoDoPedido(interprete.pedido), /\[Sim\/Não\] <Não>:$/);
  interprete.enter();
  assert.equal(elementos().length, 2);
  estado.selecao = ["a"];
  interprete.digitar("mi"); clique(0, 0); clique(0, 1000); interprete.digitar("s");
  assert.equal(elementos().length, 2);
  assert.deepEqual(elementos()[0].pontos.map((p) => p.x), [-1000, -100]);
});

test("DESLOCAMENTO cria paralela do lado indicado e repete até Enter", () => {
  const { interprete, clique, objeto, elementos } = montar([linha("a", { x: 0, y: 0 }, { x: 1000, y: 0 })]);
  interprete.digitar("o"); interprete.digitar("200");
  objeto("a", 500, 0); clique(500, 900);
  objeto("a", 500, 0); clique(500, -900);
  interprete.enter();
  assert.equal(elementos().length, 3);
  assert.equal(elementos()[1].pontos[0].y, 200);
  assert.equal(elementos()[2].pontos[0].y, -200);
  interprete.digitar("o"); interprete.enter();
  assert.match(textoDoPedido(interprete.pedido), /Selecione o objeto a deslocar/);
});

test("APARAR corta entre as linhas e apaga o que nada cruza; ESTENDER vai até o limite", () => {
  const { interprete, objeto, elementos } = montar([
    linha("h", { x: 0, y: 0 }, { x: 3000, y: 0 }),
    linha("v", { x: 1000, y: -500 }, { x: 1000, y: 500 }),
    linha("s", { x: 5000, y: 5000 }, { x: 6000, y: 5000 }),
    linha("c", { x: 0, y: 1000 }, { x: 500, y: 1000 }),
    linha("m", { x: 2000, y: 800 }, { x: 2000, y: 1200 }),
  ]);
  interprete.digitar("tr");
  objeto("h", 2500, 0);
  assert.deepEqual(elementos().find((e) => e.id === "h").pontos, [{ x: 0, y: 0 }, { x: 1000, y: 0 }]);
  objeto("s", 5500, 5000);
  assert.equal(elementos().some((e) => e.id === "s"), false);
  interprete.digitar("d");
  assert.equal(elementos().some((e) => e.id === "s"), true, "Desfazer dentro do comando");
  interprete.enter();
  interprete.digitar("ex"); objeto("c", 400, 1000); interprete.enter();
  assert.deepEqual(elementos().find((e) => e.id === "c").pontos[1], { x: 2000, y: 1000 });
});

test("CONCORDAR com raio 0 faz canto vivo e com raio cria o arco tangente", () => {
  const a = linha("a", { x: 0, y: 0 }, { x: 900, y: 0 }), b = linha("b", { x: 1000, y: -100 }, { x: 1000, y: -1000 });
  const canto = concordar({ elemento: a, ponto: { x: 100, y: 0 } }, { elemento: b, ponto: { x: 1000, y: -900 } }, 0, () => "x");
  assert.deepEqual(canto.trocas.get("a")[0].pontos, [{ x: 1000, y: 0 }, { x: 0, y: 0 }]);
  assert.deepEqual(canto.trocas.get("b")[0].pontos, [{ x: 1000, y: 0 }, { x: 1000, y: -1000 }]);
  const redondo = concordar({ elemento: a, ponto: { x: 100, y: 0 } }, { elemento: b, ponto: { x: 1000, y: -900 } }, 200, () => "arco");
  const arco = redondo.novos[0];
  assert.equal(arco.tipo, "arco");
  assert.deepEqual(arco.centro, { x: 800, y: -200 });
  assert.ok(Math.abs(arco.varreduraGraus - 90) < 1e-9);
  assert.deepEqual(redondo.trocas.get("a")[0].pontos[0], { x: 800, y: 0 });
  const chanfro = chanfrar({ elemento: a, ponto: { x: 100, y: 0 } }, { elemento: b, ponto: { x: 1000, y: -900 } }, 100, 300, () => "c");
  assert.deepEqual(chanfro.novos[0].pontos, [{ x: 900, y: 0 }, { x: 1000, y: -300 }]);
  assert.throws(() => concordar({ elemento: a, ponto: { x: 0, y: 0 } }, { elemento: linha("p", { x: 0, y: 50 }, { x: 900, y: 50 }), ponto: { x: 0, y: 50 } }, 0, () => "x"), /paralelos/);
});

test("CONCORDAR pelo comando usa o raio definido na opção", () => {
  const { interprete, objeto, elementos } = montar([linha("a", { x: 0, y: 0 }, { x: 900, y: 0 }), linha("b", { x: 1000, y: -100 }, { x: 1000, y: -1000 })]);
  interprete.digitar("f"); interprete.digitar("r"); interprete.digitar("200");
  assert.match(textoDoPedido(interprete.pedido), /raio = 200/);
  objeto("a", 100, 0); objeto("b", 1000, -900);
  assert.equal(elementos().length, 3);
  assert.equal(interprete.ativo, false);
});

test("UNIR encadeia linhas soltas e EXPLODIR separa a polilinha", () => {
  const r = unir([linha("a", { x: 0, y: 0 }, { x: 100, y: 0 }), linha("b", { x: 200, y: 0 }, { x: 100, y: 0 }), linha("c", { x: 200, y: 0 }, { x: 200, y: 100 }), linha("z", { x: 900, y: 0 }, { x: 950, y: 0 })]);
  assert.equal(r.unidos, 3); assert.equal(r.resultado, 1);
  assert.deepEqual(r.trocas.get("a")[0].pontos, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }]);
  assert.deepEqual(r.trocas.get("b"), []);
  assert.equal(r.trocas.has("z"), false);
  let n = 0;
  const partes = explodir({ id: "p", camada: "layout", tipo: "traco", pontos: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], espessuraMm: 5 }, () => `e${++n}`);
  assert.equal(partes.length, 2);
  assert.equal(partes[0].id, "p");
  assert.equal(partes[1].espessuraMm, 5);
});

test("QUEBRAR tira o trecho entre dois pontos; ESTICAR move só os vértices da janela", () => {
  const pedacos = quebrarElemento(linha("a", { x: 0, y: 0 }, { x: 1000, y: 0 }), { x: 300, y: 0 }, { x: 600, y: 0 });
  assert.deepEqual(pedacos.map((p) => p.pontos), [[{ x: 0, y: 0 }, { x: 300, y: 0 }], [{ x: 600, y: 0 }, { x: 1000, y: 0 }]]);
  const circulo = { id: "c", camada: "layout", tipo: "arco", centro: { x: 0, y: 0 }, raioMm: 100, inicioGraus: 0, varreduraGraus: 360, espessuraMm: 1 };
  const [arco] = quebrarElemento(circulo, { x: 100, y: 0 }, { x: 0, y: -100 });
  assert.equal(arco.inicioGraus, 90); assert.equal(arco.varreduraGraus, 270);
  const esticada = esticar(linha("e", { x: 0, y: 0 }, { x: 1000, y: 0 }), (p) => p.x > 500, 200, 0);
  assert.deepEqual(esticada.pontos, [{ x: 0, y: 0 }, { x: 1200, y: 0 }]);
  assert.equal(distanciaAoElemento(circulo, { x: 300, y: 0 }), 200);
});

test("ESTICAR pelo comando exige janela cruzada", () => {
  const { interprete, clique, elementos } = montar([linha("a", { x: 0, y: 0 }, { x: 1000, y: 0 })], ["a"]);
  interprete.digitar("s");
  assert.equal(interprete.pedido.modo, "selecao", "esticar ignora a seleção prévia");
  interprete.anotarJanela({ a: { x: 1200, y: -100 }, b: { x: 800, y: 100 } });
  interprete.responder({ tipo: "selecao", ids: ["a"], janelas: [{ a: { x: 1200, y: -100 }, b: { x: 800, y: 100 } }] });
  clique(0, 0); clique(500, 0);
  assert.deepEqual(elementos()[0].pontos, [{ x: 0, y: 0 }, { x: 1500, y: 0 }]);
});

test("MATRIZ retangular com linhas para cima e APAGAR", () => {
  const { interprete, elementos, estado } = montar([linha("a", { x: 0, y: 0 }, { x: 100, y: 0 })], ["a"]);
  interprete.digitar("ar"); interprete.enter(); interprete.digitar("2"); interprete.digitar("3"); interprete.digitar("500"); interprete.digitar("1000");
  assert.equal(elementos().length, 6);
  assert.ok(elementos().some((e) => e.pontos[0].x === 2000 && e.pontos[0].y === -500));
  estado.selecao = elementos().map((e) => e.id);
  interprete.digitar("e");
  assert.equal(elementos().length, 0);
});

test("consultas DIST, ID, AREA e LISTAR escrevem no histórico", () => {
  const { interprete, clique, estado } = montar([{ id: "q", camada: "layout", tipo: "comodo", nome: "Sala", pontos: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: -3000 }, { x: 0, y: -3000 }] }], ["q"]);
  interprete.digitar("di"); clique(0, 0); clique(3000, -4000);
  assert.match(estado.log.at(-1), /Distância = 5000 mm/);
  interprete.digitar("id"); clique(1000, -2000);
  assert.equal(estado.log.at(-1), "X = 1000 · Y = 2000");
  interprete.digitar("area"); clique(0, 0); clique(1000, 0); clique(1000, -1000); interprete.enter();
  assert.match(estado.log.at(-1), /Área = 0,5 m²/);
  interprete.digitar("li");
  assert.match(estado.log.at(-1), /Cômodo Sala .* área 12 m²/);
});

test("ZOOM, DESFAZER e ferramentas de arquitetura viram ações do editor", () => {
  const { interprete, estado } = montar();
  interprete.digitar("z"); interprete.digitar("e");
  interprete.digitar("z"); interprete.digitar("2x");
  interprete.digitar("u");
  interprete.digitar("parede");
  assert.deepEqual(estado.acoes, [{ tipo: "zoom-extensao" }, { tipo: "zoom-fator", fator: 2 }, { tipo: "desfazer" }, { tipo: "ferramenta", ferramenta: "parede" }]);
});

test("TEXTO aceita espaços, desce a cada linha e COTA mede", () => {
  const { interprete, clique, elementos } = montar();
  interprete.digitar("t"); clique(0, 0); interprete.digitar("300"); interprete.enter();
  interprete.digitar("Sala de estar"); interprete.digitar("Piso vinílico"); interprete.enter();
  assert.deepEqual(elementos().map((e) => e.texto), ["Sala de estar", "Piso vinílico"]);
  assert.equal(elementos()[1].posicao.y, 500);
  interprete.digitar("dim"); clique(0, 0); clique(3000, 0); clique(1500, -600);
  assert.equal(elementos().at(-1).tipo, "cota");
  assert.equal(elementos().at(-1).deslocamentoMm, -600);
});

test("encaixe digitado vale só para o próximo ponto e opções aceitam o nome inteiro", () => {
  const { interprete, clique } = montar();
  interprete.digitar("l"); interprete.digitar("end");
  assert.equal(interprete.encaixeUnico, "extremo");
  clique(0, 0);
  assert.equal(interprete.encaixeUnico, null);
  interprete.cancelar();
  interprete.digitar("c");
  interprete.digitar("3p");
  assert.equal(textoDoPedido(interprete.pedido), "Especifique o primeiro ponto do círculo:");
});

test("nomes em português e inglês, com sugestões para completar", () => {
  assert.equal(acharComando("aparar").nome, "APARAR");
  assert.equal(acharComando("TRIM").nome, "APARAR");
  assert.equal(acharComando("rotacionar").nome, "ROTACIONAR");
  assert.equal(acharComando("círculo").nome, "CIRCULO");
  assert.equal(acharComando("nada-disso"), undefined);
  assert.ok(sugerirComandos("ES").some((c) => c.nome === "ESPELHAR"));
  const { interprete, estado } = montar();
  interprete.digitar("xpto");
  assert.match(estado.log.at(-1), /Comando desconhecido/);
});

test("camada travada interrompe o comando com mensagem, sem alterar o desenho", () => {
  const { interprete, clique, elementos, estado } = montar();
  estado.documento = { ...estado.documento, camadas: estado.documento.camadas.map((c) => ({ ...c, bloqueada: true })) };
  interprete.digitar("l"); clique(0, 0); clique(100, 0);
  assert.equal(elementos().length, 0);
  assert.equal(interprete.ativo, false);
  assert.match(estado.log.at(-1), /travada|bloqueada/);
});
