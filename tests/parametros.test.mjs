// Parâmetros normativos e a conferência do desenho contra eles.
//
// O que se testa aqui é a CONTA da norma. Trocar um arredondamento muda quantas tomadas
// a plataforma exige de cada cômodo — para menos, e aí ela aprova um projeto fora da
// norma; para mais, e aí infla o quadro de cargas. Os dois erram calados.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ configFile: false, appType: "custom", root, resolve: { alias: { "@": root } }, server: { middlewareMode: true, hmr: false } });
const {
  FONTES, PARAMETROS, parametro, especieDoComodo, dentroDoPoligono, exigenciaDoComodo, conferir,
} = await vite.ssrLoadModule("/lib/parametros.ts");
const {
  assinaturaDaPagina, conferirFonte, conferirTodas, precisamDeAtencao,
} = await vite.ssrLoadModule("/lib/parametros-vigilancia.ts");
const { documentoVazio } = await vite.ssrLoadModule("/lib/prancheta.ts");
after(() => vite.close());

const retangulo = (largura, altura, x = 0, y = 0) => [
  { x, y }, { x: x + largura, y }, { x: x + largura, y: y + altura }, { x, y: y + altura },
];
const comodo = (id, nome, pontos) => ({ id, camada: "layout", tipo: "comodo", nome, pontos });
const simbolo = (id, familia, posicao, camada = "eletrico") => ({ id, camada, tipo: "simbolo", familia, posicao, rotacaoGraus: 0 });
const doc = (elementos) => ({ ...documentoVazio(), elementos });

test("todo parâmetro aponta para uma fonte existente e cita o item da norma", () => {
  // Sem o item, o parâmetro vira número mágico — e número mágico num orçamento ninguém
  // consegue defender na frente do cliente.
  const ids = new Set(FONTES.map((fonte) => fonte.id));
  for (const item of PARAMETROS) {
    assert.ok(ids.has(item.fonteId), `${item.id} aponta para fonte inexistente`);
    assert.match(item.item, /\d/, `${item.id} não cita item da norma`);
    assert.ok(item.descricao.length > 10, `${item.id} sem descrição legível`);
    assert.ok(Number.isFinite(item.valor) && item.valor > 0, `${item.id} sem valor`);
  }
  assert.equal(new Set(PARAMETROS.map((item) => item.id)).size, PARAMETROS.length, "identificadores repetidos");
  for (const fonte of FONTES) {
    assert.match(fonte.url, /^https:\/\//, `${fonte.id} sem URL de fonte`);
    assert.ok(fonte.revisao.length > 0, `${fonte.id} sem a revisão em uso`);
  }
});

test("o cômodo é classificado pelo nome, e o que não se reconhece é dito", () => {
  assert.equal(especieDoComodo("Cozinha"), "molhado");
  assert.equal(especieDoComodo("Área de Serviço"), "molhado");
  assert.equal(especieDoComodo("area de servico"), "molhado", "sem acento também precisa cair certo");
  assert.equal(especieDoComodo("Copa"), "molhado");
  assert.equal(especieDoComodo("Banheiro Social"), "banheiro");
  assert.equal(especieDoComodo("Lavabo"), "banheiro");
  assert.equal(especieDoComodo("Sala de Estar"), "comum");
  assert.equal(especieDoComodo("Quarto"), "comum");
  assert.equal(especieDoComodo(""), "indefinido");
});

test("cômodo de até 6 m² pede um ponto de tomada", () => {
  const exigencia = exigenciaDoComodo("Quarto", 4, 8);
  assert.equal(exigencia.tomadasMinimas, 1, "NBR 5410 9.5.2.2.1 a)");
  assert.equal(exigencia.cargaIluminacaoVa, 100);
  assert.equal(exigencia.cargaTomadasVa, 100);
});

test("acima de 6 m², um ponto a cada 5 m de perímetro OU FRAÇÃO", () => {
  // A fração conta. Arredondar para baixo aprovaria um cômodo com menos tomada do que a
  // norma exige, e a conferência passaria a mentir a favor de quem desenhou.
  const sala = exigenciaDoComodo("Sala", 13.02, 14.6);
  assert.equal(sala.tomadasMinimas, 3, "14,6 m ÷ 5 = 2,92 → 3");
  assert.equal(exigenciaDoComodo("Sala", 12, 15).tomadasMinimas, 3, "15 m exatos são 3, não 4");
  assert.equal(exigenciaDoComodo("Sala", 12, 15.1).tomadasMinimas, 4);
});

test("cozinha e área de serviço usam o passo de 3,5 m", () => {
  const cozinha = exigenciaDoComodo("Cozinha", 12, 14);
  assert.equal(cozinha.especie, "molhado");
  assert.equal(cozinha.tomadasMinimas, 4, "14 m ÷ 3,5 = 4");
  // 600 VA nos três primeiros, 100 VA no excedente.
  assert.equal(cozinha.cargaTomadasVa, 3 * 600 + 100);
});

test("banheiro pede um ponto junto ao lavatório, e ele vale 600 VA", () => {
  const banheiro = exigenciaDoComodo("Banheiro", 4.5, 8.6);
  assert.equal(banheiro.tomadasMinimas, 1, "NBR 5410 9.5.2.2.1 d)");
  assert.equal(banheiro.cargaTomadasVa, 600);
});

test("a carga de iluminação acrescenta a cada 4 m² INTEIROS", () => {
  // Inteiros, por isso é piso. Trocar por teto inflaria o quadro de cargas de toda casa.
  assert.equal(exigenciaDoComodo("Sala", 6, 10).cargaIluminacaoVa, 100);
  assert.equal(exigenciaDoComodo("Sala", 9.9, 12).cargaIluminacaoVa, 100, "3,9 m² excedentes ainda não completam 4");
  assert.equal(exigenciaDoComodo("Sala", 10, 13).cargaIluminacaoVa, 160);
  assert.equal(exigenciaDoComodo("Sala", 13.9, 15).cargaIluminacaoVa, 160);
  assert.equal(exigenciaDoComodo("Sala", 14, 16).cargaIluminacaoVa, 220);
});

test("todo cômodo exige pelo menos um ponto de luz no teto", () => {
  for (const nome of ["Sala", "Cozinha", "Banheiro", "Quarto"]) {
    assert.equal(exigenciaDoComodo(nome, 10, 13).pontosDeLuzMinimos, 1, `${nome} ficou sem ponto de luz`);
  }
});

test("o ponto dentro do polígono é o que amarra a tomada ao cômodo", () => {
  const sala = retangulo(4000, 3000);
  assert.equal(dentroDoPoligono({ x: 2000, y: 1500 }, sala), true);
  assert.equal(dentroDoPoligono({ x: 5000, y: 1500 }, sala), false);
  assert.equal(dentroDoPoligono({ x: -100, y: 1500 }, sala), false);
  // Em L, o recorte precisa ficar de fora.
  const ele = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 2000 }, { x: 2000, y: 2000 }, { x: 2000, y: 4000 }, { x: 0, y: 4000 }];
  assert.equal(dentroDoPoligono({ x: 1000, y: 3000 }, ele), true);
  assert.equal(dentroDoPoligono({ x: 3000, y: 3000 }, ele), false, "o recorte do L não é o cômodo");
});

test("a conferência acusa tomada faltando, com o número que a norma pede", () => {
  const sala = retangulo(4200, 3100);
  const resultado = conferir(doc([
    comodo("c1", "Sala", sala),
    simbolo("s1", "tomada-media", { x: 500, y: 200 }),
    simbolo("s2", "plafon", { x: 2100, y: 1550 }, "luminotecnico"),
  ]));
  const linha = resultado.comodos[0];
  assert.equal(linha.tomadasMinimas, 3, "perímetro 14,60 m");
  assert.equal(linha.tomadasDesenhadas, 1);
  assert.equal(linha.pontosDeLuzDesenhados, 1);

  const falta = resultado.achados.find((achado) => achado.severidade === "falta");
  assert.ok(falta, "a falta de tomada precisa aparecer");
  assert.match(falta.mensagem, /3 ponto\(s\) de tomada no mínimo; 1 desenhado/);
  assert.equal(falta.item, "9.5.2.2.1");
});

test("cômodo completo não gera achado de falta", () => {
  const resultado = conferir(doc([
    comodo("c1", "Quarto", retangulo(2400, 2400)),
    simbolo("s1", "tomada-media", { x: 500, y: 500 }),
    simbolo("s2", "plafon", { x: 1200, y: 1200 }, "luminotecnico"),
  ]));
  assert.equal(resultado.achados.filter((achado) => achado.severidade === "falta").length, 0,
    JSON.stringify(resultado.achados));
});

test("a tomada do cômodo vizinho não conta para este", () => {
  // Sem o teste de ponto no polígono, uma casa inteira passaria com as tomadas da sala
  // cobrindo os quartos.
  const resultado = conferir(doc([
    comodo("c1", "Quarto A", retangulo(2400, 2400, 0, 0)),
    comodo("c2", "Quarto B", retangulo(2400, 2400, 3000, 0)),
    simbolo("s1", "tomada-media", { x: 1200, y: 1200 }),
    simbolo("s2", "plafon", { x: 1200, y: 600 }, "luminotecnico"),
  ]));
  const b = resultado.comodos.find((linha) => linha.nome === "Quarto B");
  assert.equal(b.tomadasDesenhadas, 0);
  assert.ok(resultado.achados.some((achado) => achado.comodo === "Quarto B" && achado.severidade === "falta"));
});

test("cômodo sem nome é conferido como comum, e isso é dito", () => {
  const resultado = conferir(doc([comodo("c1", "", retangulo(3000, 3000))]));
  const aviso = resultado.achados.find((achado) => achado.severidade === "atencao");
  assert.ok(aviso);
  assert.match(aviso.mensagem, /nomeie o cômodo/i);
});

test("desenho sem cômodo diz isso, em vez de devolver tudo certo sobre nada", () => {
  const resultado = conferir(doc([simbolo("s1", "tomada-media", { x: 0, y: 0 })]));
  assert.equal(resultado.comodos.length, 0);
  assert.ok(resultado.achados.some((achado) => /Nenhum cômodo desenhado/.test(achado.mensagem)));
  assert.equal(resultado.cargaTotalVa, 0);
});

test("porta estreita demais é acusada pela NBR 9050", () => {
  const resultado = conferir(doc([
    comodo("c1", "Quarto", retangulo(2400, 2400)),
    simbolo("s1", "tomada-media", { x: 500, y: 500 }),
    simbolo("s2", "plafon", { x: 1200, y: 1200 }, "luminotecnico"),
    { id: "a1", camada: "layout", tipo: "abertura", especie: "porta", posicao: { x: 1200, y: 0 }, larguraMm: 700, rotacaoGraus: 0 },
  ]));
  const achado = resultado.achados.find((item) => item.parametroId === "acessibilidade.vao-porta");
  assert.ok(achado);
  assert.equal(achado.item, "6.11.2.3");
  assert.match(achado.mensagem, /800 mm/);
  assert.equal(parametro("acessibilidade.vao-porta").valor, 800);
});

test("janela não é conferida como porta", () => {
  const resultado = conferir(doc([
    { id: "a1", camada: "layout", tipo: "abertura", especie: "janela", posicao: { x: 0, y: 0 }, larguraMm: 600, rotacaoGraus: 0 },
  ]));
  assert.equal(resultado.achados.filter((achado) => achado.parametroId === "acessibilidade.vao-porta").length, 0);
});

test("camada escondida sai da conferência", () => {
  const documento = doc([
    comodo("c1", "Sala", retangulo(4200, 3100)),
    simbolo("s1", "tomada-media", { x: 500, y: 200 }),
  ]);
  documento.camadas = documento.camadas.map((camada) => camada.id === "layout" ? { ...camada, visivel: false } : camada);
  const resultado = conferir(documento);
  assert.equal(resultado.comodos.length, 0);
});

test("a carga total soma iluminação e tomadas de todos os cômodos", () => {
  const resultado = conferir(doc([
    comodo("c1", "Quarto", retangulo(2400, 2400)),
    comodo("c2", "Banheiro", retangulo(1500, 2000, 3000, 0)),
  ]));
  // Quarto 5,76 m²: 100 VA de luz + 100 VA de tomada. Banheiro: 100 + 600.
  assert.equal(resultado.cargaTotalVa, 100 + 100 + 100 + 600);
});

// ## Vigilância das fontes

const paginaAbnt = (ano, extra = "") => `
  <html><head><style>.x{color:red}</style></head><body>
  <div class="topo"><img src="/logo.png"></div>
  <h1>ABNT NBR 5410</h1><p>Instalações elétricas de baixa tensão</p>
  <p>Versão: ${ano}</p>${extra}
  <script>analytics('${Math.random()}')</script>
  </body></html>`;

test("a assinatura ignora layout e script, e enxerga o ano", () => {
  // Comparar a página inteira acusaria mudança toda semana, e alarme falso é o que faz
  // ninguém olhar o alarme.
  const um = assinaturaDaPagina(paginaAbnt(2004), "nbr-5410");
  const outro = assinaturaDaPagina(paginaAbnt(2004).replace('class="topo"', 'class="cabecalho novo"'), "nbr-5410");
  assert.equal(um, outro, "mudança de layout não pode acusar revisão de norma");

  assert.notEqual(um, assinaturaDaPagina(paginaAbnt(2026), "nbr-5410"), "o ano mudou e a assinatura não");
  assert.notEqual(um, assinaturaDaPagina(paginaAbnt(2004, "<p>EM REVISÃO</p>"), "nbr-5410"));
  assert.notEqual(um, assinaturaDaPagina(paginaAbnt(2004), "nbr-9050"), "fontes diferentes não compartilham assinatura");
});

const fonte = { id: "nbr-5410", nome: "NBR 5410", url: "https://exemplo.test/5410", revisao: "2004", ritmo: "anos" };
const respondendo = (corpo) => async () => ({ ok: true, status: 200, corpo });
const falhando = (status) => async () => ({ ok: false, status, corpo: "" });

test("a primeira conferência registra a assinatura sem alarmar", () => {
  return conferirFonte(fonte, null, respondendo(paginaAbnt(2004)), 1000).then((veredito) => {
    assert.equal(veredito.estado, "primeira");
    assert.ok(veredito.assinatura);
    assert.equal(veredito.conferidoEm, 1000);
  });
});

test("página igual não vira aviso; página mudada vira", async () => {
  const anterior = { fonteId: "nbr-5410", assinatura: assinaturaDaPagina(paginaAbnt(2004), "nbr-5410"), conferidoEm: 1, falha: null };
  assert.equal((await conferirFonte(fonte, anterior, respondendo(paginaAbnt(2004)))).estado, "igual");

  const mudou = await conferirFonte(fonte, anterior, respondendo(paginaAbnt(2027)));
  assert.equal(mudou.estado, "mudou");
  assert.match(mudou.detalhe, /precisam ser revistos à mão/, "a rotina não altera parâmetro sozinha");
  assert.match(mudou.detalhe, /2004/, "o aviso precisa dizer o que está em uso hoje");
});

test("fonte fora do ar não vira mudança, e a assinatura anterior é preservada", async () => {
  // Tratar indisponibilidade como mudança encheria a tela de alarme falso toda vez que um
  // site oficial saísse do ar.
  const assinatura = assinaturaDaPagina(paginaAbnt(2004), "nbr-5410");
  const anterior = { fonteId: "nbr-5410", assinatura, conferidoEm: 1, falha: null };

  const fora = await conferirFonte(fonte, anterior, falhando(503));
  assert.equal(fora.estado, "inalcancavel");
  assert.equal(fora.assinatura, assinatura);
  assert.match(fora.detalhe, /503/);

  const semRede = await conferirFonte(fonte, anterior, falhando(0));
  assert.equal(semRede.estado, "inalcancavel");
  assert.equal(semRede.assinatura, assinatura);

  const vazia = await conferirFonte(fonte, anterior, respondendo("   "));
  assert.equal(vazia.estado, "inalcancavel", "corpo vazio não é página");
});

test("a conferência cobre todas as fontes declaradas e conta as que pedem atenção", async () => {
  const vereditos = await conferirTodas([], respondendo(paginaAbnt(2004)));
  assert.equal(vereditos.length, FONTES.length);
  assert.deepEqual(vereditos.map((veredito) => veredito.fonteId).sort(), FONTES.map((f) => f.id).sort());
  assert.equal(precisamDeAtencao(vereditos), 0, "primeira conferência não é alarme");

  const anteriores = FONTES.map((f) => ({ fonteId: f.id, assinatura: "diferente", conferidoEm: 1, falha: null }));
  const depois = await conferirTodas(anteriores, respondendo(paginaAbnt(2004)));
  assert.equal(precisamDeAtencao(depois), FONTES.length);
});

test("nenhum caminho da vigilância altera um parâmetro", async () => {
  // A garantia central: a rotina levanta a mão, quem muda valor é uma pessoa.
  const antes = JSON.stringify(PARAMETROS);
  await conferirTodas([], respondendo(paginaAbnt(2027)));
  await conferirTodas(FONTES.map((f) => ({ fonteId: f.id, assinatura: "x", conferidoEm: 1, falha: null })), respondendo(paginaAbnt(2027)));
  assert.equal(JSON.stringify(PARAMETROS), antes);
});
