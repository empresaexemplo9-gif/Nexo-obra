import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { installDom, stubFetch, findByText } from './dom-harness.mjs';
const dom = installDom();
const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { PranchetaEditor } = await vite.ssrLoadModule('/components/prancheta-editor.tsx');
const { documentoVazio } = await vite.ssrLoadModule('/lib/prancheta.ts');
after(async () => { await vite.close(); dom.cleanup(); });
globalThis.DOMPoint = class { constructor(x,y) { this.x=x; this.y=y; } matrixTransform() { return this; } };
const line = (id,y) => ({ id, camada: 'layout', tipo: 'traco', pontos: [{ x: 1000.25, y }, { x: 3000.75, y }], espessuraMm: 1 });
async function editor(elementos = [], canEdit = true, save) {
  const container = document.createElement('div'); document.body.append(container);
  const reactRoot = createRoot(container);
  const prancha = { id: 'p', nome: 'Teste CAD', especie: 'planta', revisao: 1, projectId: null, projectName: null, atualizadoEm: '2026-09-22', autor: null,
    documento: { ...documentoVazio(), malhaMm: 1, elementos } };
  const calls = stubFetch({ '/api/studio/assets': { itens: [] }, '/api/studio/p': save ?? (({ body }) => ({ prancha: { ...prancha, ...body, revisao: body.revisao + 1 } })) });
  await act(async () => reactRoot.render(React.createElement(PranchetaEditor, { prancha, canEdit, onVoltar() {}, onSalvo() {} })));
  const svg = container.querySelector('svg[role="application"]');
  svg.getScreenCTM = () => ({ inverse: () => ({}) });
  svg.getBoundingClientRect = () => ({ width: 24000, height: 14880 });
  const click = async name => { const button = container.querySelector(`button[aria-label="${name}"]`) ?? findByText(container, name, 'button'); assert.ok(button, name); await act(async () => button.click()); };
  const pointer = async (type,x,y,shiftKey=false) => act(async () => svg.dispatchEvent(new dom.window.MouseEvent(type, { bubbles:true, button:0, buttons:type==='pointerup'?0:1, clientX:x,clientY:y,shiftKey })));
  const point = async (x,y,shift=false) => { await pointer('pointerdown',x,y,shift); await pointer('pointerup',x,y,shift); };
  const input = async (selector,value) => { const el=container.querySelector(selector); assert.ok(el,selector); await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(el,value); el.dispatchEvent(new dom.window.Event('input',{bubbles:true})); }); };
  const command = async value => { await input('#cad-command',value); await act(async () => container.querySelector('#cad-command').closest('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}))); };
  const saved = () => calls.filter(c=>c.method==='PUT').at(-1)?.body.documento;
  return { container, svg, click, pointer, point, input, command, saved, calls, async close(){ await act(async()=>reactRoot.unmount()); container.remove(); } };
}

test('retângulo e polilinha pela linha de comando, com cliques e medidas, e desfazer após gravar', async () => {
  const e = await editor();
  try {
    await e.click('Retângulo (REC)'); await e.point(100.25,100.75);
    assert.match(e.container.textContent,/Especifique o outro canto \[Dimensões\]:/);
    await e.command('@3000.5,2000.25');
    await e.click('Polilinha (PL)'); await e.point(5000,0); await e.point(6000,0); await e.point(6000,1000); await e.click('Fechar');
    await e.click('Gravar');
    const doc=e.saved(); assert.equal(doc.elementos.length,2);
    assert.deepEqual(doc.elementos[0].pontos[2], {x:3100.75,y:-1899.5});
    assert.deepEqual(doc.elementos[1].pontos[0], doc.elementos[1].pontos.at(-1));
    await e.click('Desfazer'); await e.click('Gravar'); assert.equal(e.saved().elementos.length,1);
    await e.click('Refazer'); await e.click('Gravar'); assert.equal(e.saved().elementos.length,2);
  } finally { await e.close(); }
});

test('Shift seleciona em grupo, arrasto conserva frações e desfaz em uma etapa', async () => {
  const e=await editor([line('a',1000.25),line('b',2000.25)]);
  try {
    await e.point(2000,1000.25); await e.point(2000,2000.25,true);
    assert.match(e.container.textContent,/2 elemento\(s\) selecionado/);
    await e.pointer('pointerdown',2000,1000.25); await e.pointer('pointermove',2100.125,1100.625); await e.pointer('pointermove',2200.25,1200.75); await e.pointer('pointerup',2200.25,1200.75);
    await e.click('Gravar'); const doc=e.saved();
    assert.deepEqual(doc.elementos[0].pontos[0],{x:1200.5,y:1200.75});
    assert.deepEqual(doc.elementos[1].pontos[0],{x:1200.5,y:2200.75});
    await e.click('Desfazer'); await e.click('Gravar'); assert.deepEqual(e.saved().elementos,[line('a',1000.25),line('b',2000.25)]);
  } finally { await e.close(); }
});

test('janela da esquerda para a direita e comandos em grupo copiam e excluem juntos', async()=>{
  const e=await editor([line('a',1000),line('b',2000)]);
  try {
    await e.pointer('pointerdown',0,0); await e.pointer('pointermove',4000,3000); await e.pointer('pointerup',4000,3000);
    assert.match(e.container.textContent,/2 elemento\(s\) selecionado/);
    await e.command('CO @100,100'); await e.click('Gravar'); assert.equal(e.saved().elementos.length,4);
    await e.command('E'); await e.click('Gravar'); assert.equal(e.saved().elementos.length,2);
  } finally { await e.close(); }
});

test('paralela aceita distância própria e deixa o original intacto',async()=>{
  const e=await editor([line('a',1000)]);
  try {
    await e.point(2000,1000); assert.equal(e.container.querySelector('#distancia-paralela').disabled,false);
    await e.input('#distancia-paralela','0.125'); await e.click('Um lado'); await e.click('Gravar');
    assert.equal(e.saved().elementos.length,2);
    assert.equal(Math.abs(e.saved().elementos[1].pontos[0].y-1000),0.125);
  }finally{await e.close();}
});

test('edição durante salvamento continua marcada e usa a próxima revisão',async()=>{
  let release; let count=0;
  const e=await editor([],true,async({body})=>{ count++; if(count===1) await new Promise(r=>{release=r;}); return {prancha:{...body,id:'p',revisao:body.revisao+1}}; });
  try {
    await e.command('L 0,0 1000,0'); await e.click('Gravar');
    await e.command('L 0,1000 1000,1000');
    await act(async()=>release());
    assert.match(e.container.textContent,/alterações não gravadas/);
    await e.click('Gravar'); assert.equal(e.calls.filter(c=>c.method==='PUT').at(-1).body.revisao,2);
    assert.equal(e.saved().elementos.length,2);
  }finally{await e.close();}
});

test('somente leitura não modifica geometria nem executa comandos',async()=>{
  const e=await editor([line('a',1000)],false);
  try{
    await e.point(2000,1000); await e.pointer('pointerdown',2000,1000); await e.pointer('pointermove',3000,2000); await e.pointer('pointerup',3000,2000);
    assert.equal(e.container.querySelector('#cad-command').disabled,true);
    assert.equal(e.calls.filter(c=>c.method==='PUT').length,0);
    assert.equal(e.svg.querySelector('polyline').getAttribute('points'),'1000.25,1000 3000.75,1000');
  }finally{await e.close();}
});

test('linha de comando como no AutoCAD: digitar em qualquer lugar, prompts, Enter repete, Esc cancela e janela cruzada', async () => {
  const e = await editor([line('a',1000), line('b',2000)]);
  const tecla = async (key) => act(async () => { dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
  const enviar = async () => act(async () => e.container.querySelector('#cad-command').closest('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
  try {
    await tecla('l');
    assert.equal(e.container.querySelector('#cad-command').value, 'l', 'a tecla vai para a linha de comando');
    await enviar();
    assert.match(e.container.textContent, /Comando: LINHA/);
    assert.match(e.container.textContent, /Especifique o primeiro ponto:/);
    await e.point(0,5000); await e.point(3000,5000);
    assert.match(e.container.textContent, /Especifique o próximo ponto \[Desfazer\]:/);
    await tecla('Enter');
    assert.match(e.container.textContent, /Comando:(?! LINHA)/);
    await tecla('Enter');
    assert.equal(e.container.textContent.match(/Comando: LINHA/g).length, 2, 'Enter sem comando repete o último');
    await tecla('Escape');
    assert.match(e.container.textContent, /\*Cancelar\*/);
    await e.pointer('pointerdown',2000,2500); await e.pointer('pointermove',1500,500); await e.pointer('pointerup',1500,500);
    assert.match(e.container.textContent,/2 elemento\(s\) selecionado/, 'janela cruzada pega o que ela toca');
    await tecla('Delete');
    await tecla('F8');
    assert.equal(e.container.querySelector('button[title="Orto (F8)"]').getAttribute('aria-pressed'), 'true');
    await e.click('Gravar');
    assert.equal(e.saved().elementos.length, 1);
    assert.deepEqual(e.saved().elementos[0].pontos, [{ x: 0, y: 5000 }, { x: 3000, y: 5000 }]);
  } finally { await e.close(); }
});

test('comando de edição usa a seleção feita antes e a opção clicada no prompt', async () => {
  const e = await editor([line('a',1000)]);
  try {
    await e.point(2000,1000);
    await e.click('Espelhar (MI)');
    await e.point(0,0); await e.point(1000,0);
    assert.match(e.container.textContent, /Apagar os objetos de origem \[Sim\/Não\] <Não>:/);
    await e.click('Sim');
    await e.click('Gravar');
    assert.equal(e.saved().elementos.length, 1);
    assert.deepEqual(e.saved().elementos[0].pontos.map((p) => p.y), [-1000, -1000]);
  } finally { await e.close(); }
});

async function abrirComArquivo(importar) {
  const container = document.createElement('div'); document.body.append(container);
  const reactRoot = createRoot(container);
  const prancha = { id: 'p', nome: 'Importada', especie: 'planta', revisao: 1, projectId: null, projectName: null, atualizadoEm: '2026-09-25', autor: null, documento: { ...documentoVazio(), malhaMm: 1, elementos: [] } };
  const calls = stubFetch({ '/api/studio/assets': { itens: [] }, '/api/studio/importar': importar,
    '/api/studio/p': ({ body }) => ({ prancha: { ...prancha, ...body, revisao: body.revisao + 1 } }) });
  await act(async () => reactRoot.render(React.createElement(PranchetaEditor, { prancha, canEdit: true, onVoltar() {}, onSalvo() {}, importarDaBiblioteca: { id: 'arq-1', nome: 'planta.dwg' } })));
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return { container, calls, async close() { await act(async () => reactRoot.unmount()); container.remove(); } };
}

test('arquivo aberto numa prancha vazia entra direto e fica gravado, sem esperar confirmação', async () => {
  const lido = { nomeArquivo: 'planta.dwg', unidade: 'mm', unidadeDeclarada: true, truncado: false, avisos: [],
    camadas: [{ id: 'dwg-paredes', nome: 'PAREDES', disciplina: 'layout', visivel: true, bloqueada: false }],
    elementos: [{ id: 'd1', camada: 'dwg-paredes', tipo: 'traco', pontos: [{ x: 500000, y: 7400000 }, { x: 503000, y: 7400000 }], espessuraMm: 1 }] };
  const e = await abrirComArquivo(lido);
  try {
    const importacao = e.calls.find((c) => c.path === '/api/studio/importar');
    assert.equal(importacao.body.fileId, 'arq-1');
    const gravacao = e.calls.filter((c) => c.method === 'PUT').at(-1);
    assert.ok(gravacao, 'grava sozinho depois de importar');
    assert.equal(gravacao.body.documento.elementos.length, 1);
    assert.ok(gravacao.body.documento.camadas.some((c) => c.nome === 'PAREDES'));
    assert.match(e.container.textContent, /planta\.dwg entrou na prancha: 1 elemento/);
    assert.equal(e.container.querySelector('section[aria-label="Revisão da importação"]'), null);
    const [x] = e.container.querySelector('svg[role="application"]').getAttribute('viewBox').split(' ').map(Number);
    assert.ok(x > 400000, 'a vista vai até o desenho, mesmo longe da origem');
  } finally { await e.close(); }
});

test('falha ao ler o arquivo aparece na tela com opção de tentar de novo', async () => {
  let tentativas = 0;
  const e = await abrirComArquivo(() => { tentativas += 1; return { __status: 422, error: 'O DWG está corrompido.' }; });
  try {
    assert.match(e.container.querySelector('[role="alert"][aria-label="Falha na importação"]').textContent, /O DWG está corrompido/);
    await act(async () => { findByText(e.container, 'Tentar de novo', 'button').click(); await new Promise((r) => setTimeout(r, 20)); });
    assert.equal(tentativas, 2);
    assert.equal(e.calls.filter((c) => c.method === 'PUT').length, 0, 'nada é gravado quando a leitura falha');
  } finally { await e.close(); }
});
