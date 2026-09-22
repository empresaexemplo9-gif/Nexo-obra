import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, appType: 'custom', root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { documentoVazio, limitesDoElemento } = await vite.ssrLoadModule('/lib/prancheta.ts');
const { executarNaSelecao, selecionarNaJanela } = await vite.ssrLoadModule('/lib/cad-selection.ts');
const { paralelaDe, moverVertice, encaixePerto, matrizRetangular } = await vite.ssrLoadModule('/lib/prancheta-cad.ts');
const line = (id, y = 0) => ({ id, camada: 'layout', tipo: 'traco', pontos: [{ x: 0.25, y }, { x: 1000.75, y }], espessuraMm: 1 });
const doc = (...elementos) => ({ ...documentoVazio(), elementos });

test('transformação e cópia de grupo preservam distâncias e coordenadas fracionárias', () => {
  const input = doc(line('a'), line('b', 500.5));
  const moved = executarNaSelecao(input, 'M @0.25,0.75', ['a', 'b']);
  assert.deepEqual(moved.document.elementos[0].pontos[0], { x: 0.5, y: -0.75 });
  assert.deepEqual(moved.document.elementos[1].pontos[0], { x: 0.5, y: 499.75 });
  let n = 0;
  const copied = executarNaSelecao(moved.document, 'CO @100,200', ['a', 'b'], () => `copy-${++n}`);
  assert.equal(copied.document.elementos.length, 4);
  assert.equal(new Set(copied.document.elementos.map(e => e.id)).size, 4);
  assert.deepEqual(copied.selectedIds, ['copy-1', 'copy-2']);
  assert.equal(input.elementos[0].pontos[0].x, 0.25);
});

test('erro no segundo elemento recusa o grupo inteiro, inclusive apagar', () => {
  const input = doc(line('a'), { ...line('b'), camada: 'eletrico' });
  input.camadas.find(c => c.id === 'eletrico').bloqueada = true;
  const before = structuredClone(input);
  for (const command of ['M @10,10', 'CO @10,10', 'E', 'RO 90 0,0', 'SC 2 0,0']) {
    assert.throws(() => executarNaSelecao(input, command, ['a', 'b']), /bloqueada/);
    assert.deepEqual(input, before);
  }
});

test('janela seleciona somente elementos inteiros visíveis e editáveis', () => {
  const input = doc(line('a'), { ...line('b', 20), camada: 'eletrico' }, { ...line('c', 30), camada: 'anotacao' }, line('d', 2000));
  input.camadas.find(c => c.id === 'eletrico').bloqueada = true;
  input.camadas.find(c => c.id === 'anotacao').visivel = false;
  assert.deepEqual(selecionarNaJanela(input, { x: -10, y: -10 }, { x: 1100, y: 100 }), ['a']);
  assert.deepEqual(selecionarNaJanela(input, { x: 500, y: -10 }, { x: 1100, y: 100 }), []);
});

test('mover a alça inicial mantém a polilinha fechada', () => {
  const input = { ...line('a'), pontos: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 0 }] };
  const moved = moverVertice(input, 0, { x: 0.125, y: 0.75 });
  assert.deepEqual(moved.pontos[0], moved.pontos.at(-1));
  assert.equal(moved.pontos[0].x, 0.125);
});

test('paralela e matriz preservam frações e recusam cópias sobrepostas', () => {
  const input = line('a');
  assert.equal(Math.abs(paralelaDe(input, 0.125).pontos[0].y), 0.125);
  let n = 0;
  assert.equal(matrizRetangular(input, { colunas: 2, linhas: 1, passoXMm: 0.25, passoYMm: 0 }, () => `${++n}`)[0].pontos[0].x, 0.5);
  assert.deepEqual(matrizRetangular(input, { colunas: 2, linhas: 2, passoXMm: 0, passoYMm: 1 }, () => `${++n}`), []);
});

test('encaixe mais próximo em arco pertence à curva exata', () => {
  const input = doc({ id: 'a', camada: 'layout', tipo: 'arco', centro: { x: 0, y: 0 }, raioMm: 1000.25, inicioGraus: 0, varreduraGraus: 360, espessuraMm: 1 });
  const snap = encaixePerto(input, { x: 706, y: -703 }, { toleranciaMm: 30, ativos: ['proximo'] });
  assert.equal(snap.tipo, 'proximo');
  assert.ok(Math.abs(Math.hypot(snap.ponto.x, snap.ponto.y) - 1000.25) < 1e-9);
});

test('caixa de seleção acompanha a mobília girada e a cota afastada', () => {
  const box = limitesDoElemento({ id: 'm', camada: 'mobiliario', tipo: 'mobilia', posicao: { x: 0, y: 0 }, larguraMm: 2000, alturaMm: 500, rotacaoGraus: 90, rotulo: 'Mesa' });
  assert.ok(Math.abs(box.y2 - 1000) < 1e-9);
  assert.ok(Math.abs(box.x2 - 250) < 1e-9);
  const cota = limitesDoElemento({ id: 'c', camada: 'anotacao', tipo: 'cota', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, deslocamentoMm: 1500 });
  assert.ok(cota.y2 >= 1500);
});

test('paralela de retângulo mantém quatro cantos e o fechamento', () => {
  const input = { ...line('a'), pontos: [{x:0,y:0},{x:1000,y:0},{x:1000,y:1000},{x:0,y:1000},{x:0,y:0}] };
  const result = paralelaDe(input, 0.25);
  assert.equal(result.pontos.length, 5);
  assert.deepEqual(result.pontos[0], result.pontos[4]);
  assert.ok(result.pontos.slice(0,4).every(p => Math.abs(Math.abs(p.x) - 0.25) < 1e-9 || Math.abs(Math.abs(p.x - 1000) - 0.25) < 1e-9));
});
