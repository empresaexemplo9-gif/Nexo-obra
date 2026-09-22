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

test('retângulo e polilinha funcionam por cliques e medidas, com desfazer após gravar', async () => {
  const e = await editor();
  try {
    await e.click('Retângulo (Q)'); await e.point(100.25,100.75);
    await e.input('#prancheta-medida','@3000.5,2000.25');
    await act(async()=>e.container.querySelector('#prancheta-medida').closest('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
    await e.click('Polilinha (W)'); await e.point(5000,0); await e.point(6000,0); await e.point(6000,1000); await e.click('Fechar polilinha');
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

test('janela e comandos em grupo copiam e excluem juntos', async()=>{
  const e=await editor([line('a',1000),line('b',2000)]);
  try {
    await e.click('Selecionar por janela (B)'); await e.pointer('pointerdown',0,0); await e.pointer('pointermove',4000,3000); await e.pointer('pointerup',4000,3000);
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
