// Linha de comando interativa do Editor CAD, no jeito do AutoCAD.
//
// Cada comando é um diálogo: pede um ponto, um número ou uma opção, recebe a resposta e
// pede a próxima coisa. Escrito como gerador, o diálogo fica na ordem em que se lê no
// AutoCAD ("Especifique o primeiro ponto:", "Especifique o próximo ponto ou
// [Fechar/Desfazer]:"…), e o editor só precisa entregar cliques e o que foi digitado.
//
// Nada aqui conhece React nem a tela. O editor fornece um `Ambiente` (documento atual,
// seleção, como aplicar uma alteração) e o intérprete devolve o `Pedido` corrente, que a
// tela usa para o prompt, a prévia e para saber o que um clique significa.

import { areaM2, camadaBloqueada, elementosVisiveis, limitesEmCache, perimetroM, pontosDoArco, type Documento, type Elemento } from "@/lib/prancheta";
import {
  apararElemento, encaixeLabels, espelhar, estenderElemento, lerMedida, limitesDeCorte, paralelaDe, quebrarElemento, resolverEntrada,
  type Ponto, type TipoEncaixe,
} from "@/lib/prancheta-cad";
import { camadaDoComando, transformed } from "@/lib/cad-commands";
import { nearestOnSegment, rotation, scaling } from "@/packages/cad-core";

export type Opcao = { chave: string; rotulo: string };
export type ModoPedido = "ponto" | "valor" | "texto" | "selecao" | "objeto";
export type Janela = { a: Ponto; b: Ponto };

/** O que o comando espera agora. */
export type Pedido = {
  modo: ModoPedido;
  prompt: string;
  opcoes?: Opcao[];
  /** Valor usado quando a resposta é só Enter; aparece entre < >. */
  padrao?: string;
  /** Ponto de partida: linha elástica, coordenada relativa (@), trava ortogonal e polar. */
  base?: Ponto;
  /** Desenho provisório a partir do cursor. */
  previa?: (cursor: Ponto) => Elemento[];
  /** Texto que não é coordenada nem opção chega ao comando (o ZOOM aceita "2x"). */
  aceitaTexto?: boolean;
  /** Seleção por janela cruzada que devolve as janelas usadas (ESTICAR). */
  janelas?: boolean;
  /** Canto oposto: a trava ortogonal e o polar não se aplicam (RETANGULO, ZOOM Janela). */
  livre?: boolean;
};

export type Resposta =
  | { tipo: "ponto"; ponto: Ponto }
  | { tipo: "numero"; valor: number }
  | { tipo: "opcao"; chave: string }
  | { tipo: "texto"; texto: string }
  | { tipo: "enter" }
  | { tipo: "selecao"; ids: string[]; janelas: Janela[] }
  | { tipo: "objeto"; elemento: Elemento; ponto: Ponto };

export type AcaoEditor =
  | { tipo: "zoom-extensao" } | { tipo: "zoom-janela"; a: Ponto; b: Ponto } | { tipo: "zoom-fator"; fator: number } | { tipo: "zoom-anterior" }
  | { tipo: "desfazer" } | { tipo: "refazer" } | { tipo: "ferramenta"; ferramenta: string };

export type Ambiente = {
  documento(): Documento;
  selecao(): string[];
  selecionar(ids: string[]): void;
  /** Aplica a alteração (com histórico e validação). Falso quando foi recusada. */
  aplicar(documento: Documento, selecao?: string[]): boolean;
  registrar(texto: string): void;
  acao(acao: AcaoEditor): void;
  novoId(): string;
  camadaEscolhida(): string | undefined;
};

type Fluxo<T = void> = Generator<Pedido, T, Resposta>;
type Memoria = {
  raio?: number; distancia?: number; angulo: number; fator: number; raioConcordancia: number;
  chanfro: [number, number]; alturaTexto: number; lados: number; fimDaLinha?: Ponto;
  linhasMatriz: number; colunasMatriz: number; itensPolar: number;
};
type Contexto = { amb: Ambiente; memoria: Memoria };

export type DefinicaoComando = { nome: string; atalhos: string[]; descricao: string; executar: (ctx: Contexto) => Fluxo };

// ## Utilidades

const EPS = 1e-9;
const distancia = (a: Ponto, b: Ponto) => Math.hypot(b.x - a.x, b.y - a.y);
const normalizarGraus = (graus: number) => ((graus % 360) + 360) % 360;
/** Ângulo do desenho técnico: 0° à direita, anti-horário positivo (o Y da tela desce). */
const anguloDe = (de: Ponto, para: Ponto) => normalizarGraus(Math.atan2(-(para.y - de.y), para.x - de.x) * 180 / Math.PI);
const polar = (origem: Ponto, comprimento: number, graus: number): Ponto => ({
  x: origem.x + comprimento * Math.cos(graus * Math.PI / 180), y: origem.y - comprimento * Math.sin(graus * Math.PI / 180),
});
const limpo = (p: Ponto): Ponto => ({ x: Math.abs(p.x) < 1e-9 ? 0 : Math.round(p.x * 1e6) / 1e6, y: Math.abs(p.y) < 1e-9 ? 0 : Math.round(p.y * 1e6) / 1e6 });
const numero = (valor: number, casas = 2) => valor.toLocaleString("pt-BR", { maximumFractionDigits: casas, useGrouping: false });
const semAcento = (texto: string) => texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
const PREVIA = "previa";

/** Linha do prompt como o AutoCAD mostra: texto, [opções] e <padrão>. */
export function textoDoPedido(pedido: Pedido): string {
  const opcoes = pedido.opcoes?.length ? ` [${pedido.opcoes.map((opcao) => opcao.rotulo).join("/")}]` : "";
  const padrao = pedido.padrao !== undefined ? ` <${pedido.padrao}>` : "";
  return `${pedido.prompt}${opcoes}${padrao}:`;
}

function acharOpcao(opcoes: Opcao[] | undefined, texto: string) {
  const t = semAcento(texto.trim());
  if (!t || !opcoes) return undefined;
  return opcoes.find((opcao) => semAcento(opcao.chave) === t)
    ?? opcoes.find((opcao) => semAcento(opcao.rotulo) === t || (t.length >= 2 && semAcento(opcao.rotulo).startsWith(t)));
}

function camada(ctx: Contexto, padrao: "layout" | "anotacao") {
  return camadaDoComando(ctx.amb.documento(), ctx.amb.camadaEscolhida(), padrao);
}

function traco(ctx: Contexto, pontos: Ponto[]): Elemento {
  return { id: ctx.amb.novoId(), camada: camada(ctx, "layout"), tipo: "traco", pontos: pontos.map(limpo), espessuraMm: 25 };
}
const previaTraco = (pontos: Ponto[]): Elemento => ({ id: PREVIA, camada: PREVIA, tipo: "traco", pontos, espessuraMm: 1 });
const previaArco = (centro: Ponto, raioMm: number, inicioGraus = 0, varreduraGraus = 360): Elemento[] =>
  raioMm >= 1 ? [{ id: PREVIA, camada: PREVIA, tipo: "arco", centro, raioMm, inicioGraus: normalizarGraus(inicioGraus), varreduraGraus: Math.min(360, Math.max(0.01, varreduraGraus)), espessuraMm: 1 }] : [];

function acrescentar(ctx: Contexto, novos: Elemento[], selecao?: string[]) {
  const documento = ctx.amb.documento();
  return ctx.amb.aplicar({ ...documento, elementos: [...documento.elementos, ...novos] }, selecao);
}

/** Troca cada elemento do mapa pelos pedaços indicados (lista vazia apaga), no lugar. */
function substituir(ctx: Contexto, trocas: Map<string, Elemento[]>, novos: Elemento[] = [], selecao?: string[]) {
  const documento = ctx.amb.documento();
  const elementos = documento.elementos.flatMap((elemento) => trocas.get(elemento.id) ?? [elemento]);
  return ctx.amb.aplicar({ ...documento, elementos: [...elementos, ...novos] }, selecao);
}

function selecionados(documento: Documento, ids: readonly string[]) {
  const conjunto = new Set(ids);
  return documento.elementos.filter((elemento) => conjunto.has(elemento.id) && !camadaBloqueada(documento, elemento.camada));
}

/** A prévia de um comando de edição mostra no máximo algumas centenas de objetos: o
 *  suficiente para ver o gesto sem pesar o cursor numa planta inteira. */
const LIMITE_PREVIA = 300;

// ## Diálogos básicos

function* pedirPonto(prompt: string, o: { base?: Ponto; opcoes?: Opcao[]; padrao?: string; previa?: (c: Ponto) => Elemento[]; aceitaTexto?: boolean; livre?: boolean } = {}): Fluxo<Ponto | string | null> {
  const r = yield { modo: "ponto", prompt, ...o };
  if (r.tipo === "ponto") return r.ponto;
  if (r.tipo === "opcao") return r.chave;
  if (r.tipo === "texto") return `texto:${r.texto}`;
  return null;
}

function* pedirNumero(ctx: Contexto, prompt: string, o: {
  padrao?: number; base?: Ponto; doPonto?: (p: Ponto) => number; validar?: (n: number) => string | null;
  opcoes?: Opcao[]; previa?: (c: Ponto) => Elemento[]; inteiro?: boolean; mostrarPadrao?: string;
} = {}): Fluxo<number | string | null> {
  while (true) {
    const r = yield {
      modo: "valor", prompt, base: o.base, opcoes: o.opcoes, previa: o.previa,
      padrao: o.mostrarPadrao ?? (o.padrao !== undefined ? numero(o.padrao, 4) : undefined),
    };
    let valor: number;
    if (r.tipo === "opcao") return r.chave;
    if (r.tipo === "enter") { if (o.padrao === undefined) return null; valor = o.padrao; }
    else if (r.tipo === "numero") valor = r.valor;
    else if (r.tipo === "ponto" && o.doPonto) valor = o.doPonto(r.ponto);
    else { ctx.amb.registrar("Digite um número."); continue; }
    if (o.inteiro && !Number.isInteger(valor)) { ctx.amb.registrar("Digite um número inteiro."); continue; }
    const erro = o.validar?.(valor);
    if (erro) { ctx.amb.registrar(erro); continue; }
    return valor;
  }
}

function* pedirObjeto(ctx: Contexto, prompt: string, aceita: (e: Elemento) => string | null, o: { opcoes?: Opcao[]; padrao?: string } = {}): Fluxo<{ elemento: Elemento; ponto: Ponto } | string | null> {
  while (true) {
    const r = yield { modo: "objeto", prompt, ...o };
    if (r.tipo === "opcao") return r.chave;
    if (r.tipo === "enter") return null;
    if (r.tipo !== "objeto") { ctx.amb.registrar("Clique em cima de um objeto."); continue; }
    if (camadaBloqueada(ctx.amb.documento(), r.elemento.camada)) { ctx.amb.registrar("O objeto está numa camada travada."); continue; }
    const erro = aceita(r.elemento);
    if (erro) { ctx.amb.registrar(erro); continue; }
    return { elemento: r.elemento, ponto: r.ponto };
  }
}

/** "Selecione objetos": usa a seleção feita antes do comando, como o AutoCAD
 *  (PICKFIRST), ou pede uma nova. */
function* obterSelecao(ctx: Contexto, o: { janelas?: boolean; prompt?: string } = {}): Fluxo<{ ids: string[]; janelas: Janela[] } | null> {
  const documento = ctx.amb.documento();
  if (!o.janelas) {
    const antes = selecionados(documento, ctx.amb.selecao()).map((e) => e.id);
    if (antes.length) return { ids: antes, janelas: [] };
  } else ctx.amb.selecionar([]);
  const r = yield { modo: "selecao", prompt: o.prompt ?? (o.janelas ? "Selecione objetos por janela cruzada (arraste da direita para a esquerda)" : "Selecione objetos"), janelas: o.janelas };
  if (r.tipo !== "selecao") return null;
  const ids = selecionados(ctx.amb.documento(), r.ids).map((e) => e.id);
  if (!ids.length) { ctx.amb.registrar("Nenhum objeto selecionado."); return null; }
  return { ids, janelas: r.janelas };
}

function previaDe(elementos: Elemento[], transformar: (e: Elemento) => Elemento | null) {
  const saida: Elemento[] = [];
  for (const elemento of elementos.slice(0, LIMITE_PREVIA)) {
    const novo = transformar(elemento);
    if (novo) saida.push({ ...novo, id: PREVIA } as Elemento);
  }
  return saida;
}

const deslocar = (elemento: Elemento, dx: number, dy: number) => transformed(elemento, [1, 0, 0, 1, dx, dy]);
const girar = (elemento: Elemento, graus: number, centro: Ponto) => transformed(elemento, rotation(graus, centro), 1, graus);
const escalar = (elemento: Elemento, fator: number, centro: Ponto) => transformed(elemento, scaling(fator, centro), fator);

/** Ponto base e ponto de destino, com as opções do MOVE/COPY. Devolve o deslocamento. */
function* pedirBase(): Fluxo<{ base: Ponto } | { deslocamento: Ponto } | null> {
  const r = yield* pedirPonto("Especifique o ponto base", { opcoes: [{ chave: "D", rotulo: "Deslocamento" }], padrao: "Deslocamento" });
  if (r && typeof r === "object") return { base: r };
  if (r === "D" || r === null) {
    const d = yield* pedirPonto("Especifique o deslocamento", { padrao: "0,0" });
    if (d === null) return { deslocamento: { x: 0, y: 0 } };
    if (typeof d === "object") return { deslocamento: d };
    return null;
  }
  return null;
}

// ## Desenho

function* linha(ctx: Contexto): Fluxo {
  let inicio = yield* pedirPonto("Especifique o primeiro ponto");
  if (inicio === null && ctx.memoria.fimDaLinha) inicio = ctx.memoria.fimDaLinha;
  if (!inicio || typeof inicio !== "object") return;
  const pontos: Ponto[] = [inicio];
  const antes: Documento[] = [];
  while (true) {
    const ultimo = pontos.at(-1)!;
    const opcoes = pontos.length >= 3 ? [{ chave: "F", rotulo: "Fechar" }, { chave: "D", rotulo: "Desfazer" }] : [{ chave: "D", rotulo: "Desfazer" }];
    const r = yield* pedirPonto("Especifique o próximo ponto", { base: ultimo, opcoes, previa: (c) => [previaTraco([ultimo, c])] });
    if (r === null) return;
    if (r === "D") {
      if (!antes.length) { ctx.amb.registrar("Todos os segmentos já foram desfeitos."); if (pontos.length === 1) return; continue; }
      ctx.amb.aplicar(antes.pop()!);
      pontos.pop();
      continue;
    }
    const destino = r === "F" ? pontos[0] : typeof r === "object" ? r : null;
    if (!destino) continue;
    if (distancia(ultimo, destino) < EPS) { ctx.amb.registrar("Ponto repetido: marque outro."); continue; }
    const documento = ctx.amb.documento();
    if (acrescentar(ctx, [traco(ctx, [ultimo, destino])])) {
      antes.push(documento);
      pontos.push(destino);
      ctx.memoria.fimDaLinha = destino;
    }
    if (r === "F") return;
  }
}

function* polilinha(ctx: Contexto): Fluxo {
  const inicio = yield* pedirPonto("Especifique o ponto inicial");
  if (!inicio || typeof inicio !== "object") return;
  const pontos: Ponto[] = [inicio];
  while (true) {
    const ultimo = pontos.at(-1)!;
    const opcoes = [...(pontos.length >= 3 ? [{ chave: "F", rotulo: "Fechar" }] : []), { chave: "D", rotulo: "Desfazer" }];
    const r = yield* pedirPonto("Especifique o próximo ponto", { base: ultimo, opcoes, previa: (c) => [previaTraco([...pontos, c])] });
    if (r === null || r === "F") {
      const fechar = r === "F";
      if (pontos.length < 2) return;
      acrescentar(ctx, [traco(ctx, fechar ? [...pontos, pontos[0]] : pontos)]);
      return;
    }
    if (r === "D") { if (pontos.length > 1) pontos.pop(); else ctx.amb.registrar("Nada a desfazer."); continue; }
    if (typeof r !== "object") continue;
    if (distancia(ultimo, r) < EPS) { ctx.amb.registrar("Ponto repetido: marque outro."); continue; }
    if (pontos.length >= 1999) { ctx.amb.registrar("Limite de vértices atingido. Tecle Enter para concluir."); continue; }
    pontos.push(r);
  }
}

const retanguloEntre = (a: Ponto, b: Ponto) => [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a];

function* retangulo(ctx: Contexto): Fluxo {
  const a = yield* pedirPonto("Especifique o primeiro canto");
  if (!a || typeof a !== "object") return;
  while (true) {
    const r = yield* pedirPonto("Especifique o outro canto", { base: a, livre: true, opcoes: [{ chave: "D", rotulo: "Dimensões" }], previa: (c) => [previaTraco(retanguloEntre(a, c))] });
    if (r === null) return;
    let b: Ponto | null = typeof r === "object" ? r : null;
    if (r === "D") {
      const largura = yield* pedirNumero(ctx, "Especifique o comprimento do retângulo", { padrao: 1000, validar: (n) => n > 0 ? null : "Use um valor positivo." });
      if (typeof largura !== "number") return;
      const altura = yield* pedirNumero(ctx, "Especifique a largura do retângulo", { padrao: 500, validar: (n) => n > 0 ? null : "Use um valor positivo." });
      if (typeof altura !== "number") return;
      const lado = yield* pedirPonto("Indique o lado do outro canto", { base: a, livre: true, previa: (c) => [previaTraco(retanguloEntre(a, { x: a.x + Math.sign(c.x - a.x || 1) * largura, y: a.y + Math.sign(c.y - a.y || -1) * altura }))] });
      if (!lado || typeof lado !== "object") return;
      b = { x: a.x + Math.sign(lado.x - a.x || 1) * largura, y: a.y + Math.sign(lado.y - a.y || -1) * altura };
    }
    if (!b) continue;
    if (Math.abs(b.x - a.x) < EPS || Math.abs(b.y - a.y) < EPS) { ctx.amb.registrar("O retângulo precisa de comprimento e largura."); continue; }
    acrescentar(ctx, [traco(ctx, retanguloEntre(a, b))]);
    return;
  }
}

/** Círculo que passa por três pontos; nulo quando estão alinhados. */
function circuloPor3(a: Ponto, b: Ponto, c: Ponto): { centro: Ponto; raio: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const centro = { x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d };
  return { centro, raio: distancia(centro, a) };
}

function arcoElemento(ctx: Contexto, centro: Ponto, raio: number, inicio: number, varredura: number): Elemento {
  return { id: ctx.amb.novoId(), camada: camada(ctx, "layout"), tipo: "arco", centro: limpo(centro), raioMm: raio, inicioGraus: Math.round(normalizarGraus(inicio) * 1e9) / 1e9 % 360, varreduraGraus: Math.min(360, varredura), espessuraMm: 25 };
}

function* circulo(ctx: Contexto): Fluxo {
  const r = yield* pedirPonto("Especifique o centro do círculo", { opcoes: [{ chave: "3P", rotulo: "3P" }, { chave: "2P", rotulo: "2P" }] });
  if (r === "3P") {
    const a = yield* pedirPonto("Especifique o primeiro ponto do círculo");
    if (!a || typeof a !== "object") return;
    const b = yield* pedirPonto("Especifique o segundo ponto do círculo", { base: a });
    if (!b || typeof b !== "object") return;
    const c = yield* pedirPonto("Especifique o terceiro ponto do círculo", { base: b, previa: (p) => { const k = circuloPor3(a, b, p); return k ? previaArco(k.centro, k.raio) : []; } });
    if (!c || typeof c !== "object") return;
    const k = circuloPor3(a, b, c);
    if (!k) throw new Error("Os três pontos estão alinhados: não há círculo que passe por eles.");
    acrescentar(ctx, [arcoElemento(ctx, k.centro, k.raio, 0, 360)]);
    ctx.memoria.raio = k.raio;
    return;
  }
  if (r === "2P") {
    const a = yield* pedirPonto("Especifique a primeira extremidade do diâmetro");
    if (!a || typeof a !== "object") return;
    const b = yield* pedirPonto("Especifique a segunda extremidade do diâmetro", { base: a, previa: (p) => previaArco({ x: (a.x + p.x) / 2, y: (a.y + p.y) / 2 }, distancia(a, p) / 2) });
    if (!b || typeof b !== "object") return;
    if (distancia(a, b) < 2) throw new Error("O diâmetro precisa de dois pontos diferentes.");
    acrescentar(ctx, [arcoElemento(ctx, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distancia(a, b) / 2, 0, 360)]);
    ctx.memoria.raio = distancia(a, b) / 2;
    return;
  }
  if (!r || typeof r !== "object") return;
  const centro = r;
  const valido = (n: number) => n >= 1 ? null : "O raio precisa ser de pelo menos 1 mm.";
  let raio = yield* pedirNumero(ctx, "Especifique o raio do círculo", {
    padrao: ctx.memoria.raio, base: centro, doPonto: (p) => distancia(centro, p), validar: valido,
    opcoes: [{ chave: "D", rotulo: "Diâmetro" }], previa: (c) => previaArco(centro, distancia(centro, c)),
  });
  if (raio === "D") {
    const diametro = yield* pedirNumero(ctx, "Especifique o diâmetro do círculo", {
      padrao: ctx.memoria.raio ? ctx.memoria.raio * 2 : undefined, base: centro, doPonto: (p) => distancia(centro, p),
      validar: (n) => n >= 2 ? null : "O diâmetro precisa ser de pelo menos 2 mm.", previa: (c) => previaArco(centro, distancia(centro, c) / 2),
    });
    raio = typeof diametro === "number" ? diametro / 2 : null;
  }
  if (typeof raio !== "number") return;
  acrescentar(ctx, [arcoElemento(ctx, centro, raio, 0, 360)]);
  ctx.memoria.raio = raio;
}

/** Arco por três pontos, do primeiro ao terceiro passando pelo segundo. */
function arcoPor3(a: Ponto, b: Ponto, c: Ponto) {
  const k = circuloPor3(a, b, c);
  if (!k) return null;
  const aa = anguloDe(k.centro, a), ab = anguloDe(k.centro, b), ac = anguloDe(k.centro, c);
  const varredura = normalizarGraus(ac - aa), meio = normalizarGraus(ab - aa);
  return meio <= varredura
    ? { centro: k.centro, raio: k.raio, inicio: aa, varredura: varredura || 360 }
    : { centro: k.centro, raio: k.raio, inicio: ac, varredura: 360 - varredura };
}

function* arco(ctx: Contexto): Fluxo {
  const r = yield* pedirPonto("Especifique o ponto inicial do arco", { opcoes: [{ chave: "C", rotulo: "Centro" }] });
  if (r === "C") {
    const centro = yield* pedirPonto("Especifique o centro do arco");
    if (!centro || typeof centro !== "object") return;
    const inicio = yield* pedirPonto("Especifique o ponto inicial do arco", { base: centro, previa: (p) => previaArco(centro, distancia(centro, p)) });
    if (!inicio || typeof inicio !== "object") return;
    const raio = distancia(centro, inicio);
    if (raio < 1) throw new Error("O raio precisa ser de pelo menos 1 mm.");
    const a0 = anguloDe(centro, inicio);
    const fim = yield* pedirPonto("Especifique o ponto final do arco (anti-horário)", {
      base: centro, opcoes: [{ chave: "A", rotulo: "Ângulo" }],
      previa: (p) => previaArco(centro, raio, a0, normalizarGraus(anguloDe(centro, p) - a0) || 360),
    });
    let varredura: number | null = null;
    if (fim === "A") {
      const incluso = yield* pedirNumero(ctx, "Especifique o ângulo incluído", { validar: (n) => n !== 0 && Math.abs(n) <= 360 ? null : "Use um ângulo entre -360 e 360, diferente de zero." });
      if (typeof incluso !== "number") return;
      if (incluso < 0) { acrescentar(ctx, [arcoElemento(ctx, centro, raio, a0 + incluso, -incluso)]); return; }
      varredura = incluso;
    } else if (fim && typeof fim === "object") varredura = normalizarGraus(anguloDe(centro, fim) - a0) || 360;
    if (varredura === null) return;
    acrescentar(ctx, [arcoElemento(ctx, centro, raio, a0, varredura)]);
    return;
  }
  if (!r || typeof r !== "object") return;
  const a = r;
  const b = yield* pedirPonto("Especifique o segundo ponto do arco", { base: a });
  if (!b || typeof b !== "object") return;
  const c = yield* pedirPonto("Especifique o ponto final do arco", { base: b, previa: (p) => { const k = arcoPor3(a, b, p); return k ? previaArco(k.centro, k.raio, k.inicio, k.varredura) : [previaTraco([a, b, p])]; } });
  if (!c || typeof c !== "object") return;
  const k = arcoPor3(a, b, c);
  if (!k || k.raio < 1) throw new Error("Os três pontos estão alinhados: não há arco que passe por eles.");
  acrescentar(ctx, [arcoElemento(ctx, k.centro, k.raio, k.inicio, k.varredura)]);
}

function verticesDoPoligono(centro: Ponto, raio: number, lados: number, graus: number) {
  const pontos = Array.from({ length: lados }, (_, i) => limpo(polar(centro, raio, graus + 360 * i / lados)));
  return [...pontos, pontos[0]];
}

function* poligono(ctx: Contexto): Fluxo {
  const lados = yield* pedirNumero(ctx, "Digite o número de lados", { padrao: ctx.memoria.lados, inteiro: true, validar: (n) => n >= 3 && n <= 1024 ? null : "Use de 3 a 1024 lados." });
  if (typeof lados !== "number") return;
  ctx.memoria.lados = lados;
  const r = yield* pedirPonto("Especifique o centro do polígono", { opcoes: [{ chave: "A", rotulo: "Aresta" }] });
  if (r === "A") {
    const a = yield* pedirPonto("Especifique a primeira extremidade da aresta");
    if (!a || typeof a !== "object") return;
    const construir = (b: Ponto) => {
      const lado = distancia(a, b);
      const raio = lado / (2 * Math.sin(Math.PI / lados));
      const meio = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const apotema = raio * Math.cos(Math.PI / lados);
      // O polígono fica à esquerda de quem vai de a para b, como no AutoCAD.
      const graus = anguloDe(a, b) + 90;
      const centro = polar(meio, apotema, graus);
      return verticesDoPoligono(centro, raio, lados, anguloDe(centro, a));
    };
    const b = yield* pedirPonto("Especifique a segunda extremidade da aresta", { base: a, previa: (p) => distancia(a, p) > EPS ? [previaTraco(construir(p))] : [] });
    if (!b || typeof b !== "object") return;
    if (distancia(a, b) < 1) throw new Error("A aresta precisa de dois pontos diferentes.");
    acrescentar(ctx, [traco(ctx, construir(b))]);
    return;
  }
  if (!r || typeof r !== "object") return;
  const centro = r;
  const tipo = yield* pedirPonto("Digite uma opção", { opcoes: [{ chave: "I", rotulo: "Inscrito no círculo" }, { chave: "C", rotulo: "Circunscrito ao círculo" }], padrao: "I" });
  const inscrito = tipo !== "C";
  if (tipo !== null && tipo !== "I" && tipo !== "C") return;
  const construir = (raioCirculo: number, graus: number) => {
    const raio = inscrito ? raioCirculo : raioCirculo / Math.cos(Math.PI / lados);
    // Circunscrito: o ponto indicado é o meio de uma aresta, não um vértice.
    return verticesDoPoligono(centro, raio, lados, inscrito ? graus : graus + 180 / lados);
  };
  let graus = 90;
  const raio = yield* pedirNumero(ctx, "Especifique o raio do círculo", {
    base: centro, doPonto: (p) => { graus = anguloDe(centro, p); return distancia(centro, p); },
    validar: (n) => n >= 1 ? null : "O raio precisa ser de pelo menos 1 mm.",
    previa: (c) => distancia(centro, c) >= 1 ? [previaTraco(construir(distancia(centro, c), anguloDe(centro, c)))] : [],
  });
  if (typeof raio !== "number") return;
  acrescentar(ctx, [traco(ctx, construir(raio, graus))]);
}

function pontosDaElipse(centro: Ponto, eixo: Ponto, outroSemieixo: number) {
  const a = distancia(centro, eixo), giro = anguloDe(centro, eixo) * Math.PI / 180, b = outroSemieixo;
  const pontos = Array.from({ length: 128 }, (_, i) => {
    const t = 2 * Math.PI * i / 128;
    const x = a * Math.cos(t), y = b * Math.sin(t);
    return limpo({ x: centro.x + x * Math.cos(giro) - y * Math.sin(giro), y: centro.y - (x * Math.sin(giro) + y * Math.cos(giro)) });
  });
  return [...pontos, pontos[0]];
}

function* elipse(ctx: Contexto): Fluxo {
  const r = yield* pedirPonto("Especifique a extremidade do eixo da elipse", { opcoes: [{ chave: "C", rotulo: "Centro" }] });
  let centro: Ponto, eixo: Ponto;
  if (r === "C") {
    const c = yield* pedirPonto("Especifique o centro da elipse");
    if (!c || typeof c !== "object") return;
    const e = yield* pedirPonto("Especifique a extremidade do eixo", { base: c, previa: (p) => [previaTraco([c, p])] });
    if (!e || typeof e !== "object") return;
    centro = c; eixo = e;
  } else {
    if (!r || typeof r !== "object") return;
    const a = r;
    const b = yield* pedirPonto("Especifique a outra extremidade do eixo", { base: a, previa: (p) => [previaTraco([a, p])] });
    if (!b || typeof b !== "object") return;
    centro = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; eixo = b;
  }
  if (distancia(centro, eixo) < 1) throw new Error("O eixo precisa ter comprimento.");
  const outro = yield* pedirNumero(ctx, "Especifique a distância até o outro eixo", {
    base: centro, doPonto: (p) => distancia(centro, p), validar: (n) => n >= 1 ? null : "Use pelo menos 1 mm.",
    previa: (c) => distancia(centro, c) >= 1 ? [previaTraco(pontosDaElipse(centro, eixo, distancia(centro, c)))] : [],
  });
  if (typeof outro !== "number") return;
  acrescentar(ctx, [traco(ctx, pontosDaElipse(centro, eixo, outro))]);
  ctx.amb.registrar("Elipse aproximada por 128 segmentos.");
}

// ## Edição

function* mover(ctx: Contexto, copiar: boolean): Fluxo {
  const selecao = yield* obterSelecao(ctx);
  if (!selecao) return;
  const alvos = selecionados(ctx.amb.documento(), selecao.ids);
  const base = yield* pedirBase();
  if (!base) return;
  const aplicarDelta = (d: Ponto) => {
    if (!d.x && !d.y) { ctx.amb.registrar("Deslocamento nulo: nada mudou."); return false; }
    if (copiar) {
      const copias = alvos.map((elemento) => ({ ...deslocar(elemento, d.x, d.y), id: ctx.amb.novoId() }) as Elemento);
      return acrescentar(ctx, copias, []);
    }
    return substituir(ctx, new Map(alvos.map((elemento) => [elemento.id, [deslocar(elemento, d.x, d.y)]])), [], []);
  };
  if ("deslocamento" in base) {
    const d = { x: base.deslocamento.x, y: base.deslocamento.y };
    aplicarDelta(d);
    return;
  }
  const origem = base.base;
  let primeira = true;
  const desfazer: Documento[] = [];
  while (true) {
    const opcoes = copiar && !primeira ? [{ chave: "D", rotulo: "Desfazer" }, { chave: "S", rotulo: "Sair" }] : undefined;
    const r = yield* pedirPonto(primeira ? "Especifique o segundo ponto" : "Especifique o segundo ponto", {
      base: origem, opcoes, padrao: primeira ? "usar o primeiro ponto como deslocamento" : copiar ? "Sair" : undefined,
      previa: (c) => previaDe(alvos, (e) => deslocar(e, c.x - origem.x, c.y - origem.y)),
    });
    if (r === "S") return;
    if (r === "D") { if (desfazer.length) ctx.amb.aplicar(desfazer.pop()!); else ctx.amb.registrar("Nada a desfazer."); continue; }
    if (r === null) {
      if (primeira) aplicarDelta(origem);
      return;
    }
    if (typeof r !== "object") continue;
    const antes = ctx.amb.documento();
    if (aplicarDelta({ x: r.x - origem.x, y: r.y - origem.y })) desfazer.push(antes);
    primeira = false;
    if (!copiar) return;
  }
}

function* rotacionar(ctx: Contexto): Fluxo {
  const selecao = yield* obterSelecao(ctx);
  if (!selecao) return;
  const alvos = selecionados(ctx.amb.documento(), selecao.ids);
  const base = yield* pedirPonto("Especifique o ponto base");
  if (!base || typeof base !== "object") return;
  let copiar = false;
  while (true) {
    const r = yield* pedirNumero(ctx, "Especifique o ângulo de rotação", {
      padrao: ctx.memoria.angulo, base, doPonto: (p) => anguloDe(base, p),
      opcoes: [{ chave: "C", rotulo: "Cópia" }, { chave: "R", rotulo: "Referência" }],
      previa: (c) => previaDe(alvos, (e) => girar(e, anguloDe(base, c), base)),
    });
    if (r === "C") { copiar = !copiar; ctx.amb.registrar(copiar ? "Girando uma cópia dos objetos." : "Girando os próprios objetos."); continue; }
    let angulo: number;
    if (r === "R") {
      const referencia = yield* pedirNumero(ctx, "Especifique o ângulo de referência", { padrao: 0, base, doPonto: (p) => anguloDe(base, p) });
      if (typeof referencia !== "number") return;
      const novo = yield* pedirNumero(ctx, "Especifique o novo ângulo", {
        base, doPonto: (p) => anguloDe(base, p), previa: (c) => previaDe(alvos, (e) => girar(e, anguloDe(base, c) - referencia, base)),
      });
      if (typeof novo !== "number") return;
      angulo = novo - referencia;
    } else if (typeof r === "number") angulo = r;
    else return;
    ctx.memoria.angulo = angulo;
    if (normalizarGraus(angulo) === 0) { ctx.amb.registrar("Ângulo nulo: nada mudou."); return; }
    const girados = alvos.map((elemento) => girar(elemento, angulo, base));
    if (copiar) acrescentar(ctx, girados.map((e) => ({ ...e, id: ctx.amb.novoId() }) as Elemento), []);
    else substituir(ctx, new Map(girados.map((e) => [e.id, [e]])), [], []);
    return;
  }
}

function* escala(ctx: Contexto): Fluxo {
  const selecao = yield* obterSelecao(ctx);
  if (!selecao) return;
  const alvos = selecionados(ctx.amb.documento(), selecao.ids);
  const base = yield* pedirPonto("Especifique o ponto base");
  if (!base || typeof base !== "object") return;
  let copiar = false;
  const positivo = (n: number) => n > 0 && Number.isFinite(n) ? null : "O fator precisa ser positivo.";
  while (true) {
    const r = yield* pedirNumero(ctx, "Especifique o fator de escala", { padrao: ctx.memoria.fator, validar: positivo, opcoes: [{ chave: "C", rotulo: "Cópia" }, { chave: "R", rotulo: "Referência" }] });
    let fator: number | null = typeof r === "number" ? r : null;
    if (r === "C") { copiar = !copiar; ctx.amb.registrar(copiar ? "Escalando uma cópia dos objetos." : "Escalando os próprios objetos."); continue; }
    if (r === "R") {
      const ref = yield* pedirNumero(ctx, "Especifique o comprimento de referência", { padrao: 1, validar: positivo });
      if (typeof ref !== "number") return;
      const novo = yield* pedirNumero(ctx, "Especifique o novo comprimento", {
        base, doPonto: (p) => distancia(base, p), validar: positivo,
        previa: (c) => distancia(base, c) > 0 ? previaDe(alvos, (e) => escalar(e, distancia(base, c) / ref, base)) : [],
      });
      if (typeof novo !== "number") return;
      fator = novo / ref;
    }
    if (fator === null) return;
    ctx.memoria.fator = fator;
    if (fator === 1) { ctx.amb.registrar("Fator 1: nada mudou."); return; }
    const f = fator;
    const escalados = alvos.map((elemento) => escalar(elemento, f, base));
    if (copiar) acrescentar(ctx, escalados.map((e) => ({ ...e, id: ctx.amb.novoId() }) as Elemento), []);
    else substituir(ctx, new Map(escalados.map((e) => [e.id, [e]])), [], []);
    return;
  }
}

function* espelharComando(ctx: Contexto): Fluxo {
  const selecao = yield* obterSelecao(ctx);
  if (!selecao) return;
  const alvos = selecionados(ctx.amb.documento(), selecao.ids);
  const a = yield* pedirPonto("Especifique o primeiro ponto da linha de espelho");
  if (!a || typeof a !== "object") return;
  const b = yield* pedirPonto("Especifique o segundo ponto da linha de espelho", {
    base: a, previa: (c) => distancia(a, c) > EPS ? [previaTraco([a, c]), ...previaDe(alvos, (e) => espelhar(e, a, c))] : [],
  });
  if (!b || typeof b !== "object") return;
  if (distancia(a, b) < EPS) throw new Error("A linha de espelho precisa de dois pontos diferentes.");
  const apagar = yield* pedirPonto("Apagar os objetos de origem", { opcoes: [{ chave: "S", rotulo: "Sim" }, { chave: "N", rotulo: "Não" }], padrao: "Não" });
  if (apagar !== null && apagar !== "S" && apagar !== "N") return;
  const espelhados = alvos.map((elemento) => espelhar(elemento, a, b));
  if (espelhados.some((e) => !e)) throw new Error("Algum objeto não pôde ser espelhado.");
  if (apagar === "S") substituir(ctx, new Map(espelhados.map((e) => [e!.id, [e!]])), [], []);
  else acrescentar(ctx, espelhados.map((e) => ({ ...e!, id: ctx.amb.novoId() }) as Elemento), []);
}

/** Menor distância de um ponto ao traço do elemento. */
export function distanciaAoElemento(elemento: Elemento, p: Ponto): number {
  const pontos = elemento.tipo === "parede" || elemento.tipo === "cota" ? [elemento.a, elemento.b]
    : elemento.tipo === "traco" ? elemento.pontos
      : elemento.tipo === "comodo" ? [...elemento.pontos, elemento.pontos[0]]
        : elemento.tipo === "arco" ? pontosDoArco(elemento)
          : elemento.tipo === "hachura" ? elemento.aneis.flatMap((anel) => [...anel, anel[0]])
            : [elemento.posicao];
  if (elemento.tipo === "arco" && elemento.varreduraGraus >= 360) return Math.abs(distancia(elemento.centro, p) - elemento.raioMm);
  if (pontos.length === 1) return distancia(pontos[0], p);
  let menor = Infinity;
  for (let i = 1; i < pontos.length; i += 1) menor = Math.min(menor, distancia(nearestOnSegment(p, pontos[i - 1], pontos[i]), p));
  return menor;
}

function paralelaNoLado(elemento: Elemento, distanciaMm: number, lado: Ponto): Elemento | null {
  const candidatos = [paralelaDe(elemento, distanciaMm), paralelaDe(elemento, -distanciaMm)].filter((e): e is Elemento => !!e);
  if (!candidatos.length) return null;
  return candidatos.reduce((melhor, candidato) => distanciaAoElemento(candidato, lado) < distanciaAoElemento(melhor, lado) ? candidato : melhor);
}

function* paralela(ctx: Contexto): Fluxo {
  const d = yield* pedirNumero(ctx, "Especifique a distância de deslocamento", {
    padrao: ctx.memoria.distancia, mostrarPadrao: ctx.memoria.distancia === undefined ? "Através" : undefined,
    opcoes: [{ chave: "A", rotulo: "Através" }], validar: (n) => n > 0 ? null : "A distância precisa ser positiva.",
  });
  // Enter sem distância anterior é o Através, que é o padrão mostrado.
  const atraves = d === "A" || d === null;
  if (!atraves && typeof d !== "number") return;
  let valor = typeof d === "number" ? d : 0;
  if (typeof d === "number") ctx.memoria.distancia = d;
  const aceita = (e: Elemento) => ["parede", "traco", "comodo", "arco"].includes(e.tipo) ? null : "Este objeto não tem paralela: use parede, linha, polilinha, cômodo, arco ou círculo.";
  const desfazer: Documento[] = [];
  while (true) {
    const alvo = yield* pedirObjeto(ctx, "Selecione o objeto a deslocar", aceita, { opcoes: [{ chave: "S", rotulo: "Sair" }, { chave: "D", rotulo: "Desfazer" }], padrao: "Sair" });
    if (alvo === null || alvo === "S") return;
    if (alvo === "D") { if (desfazer.length) ctx.amb.aplicar(desfazer.pop()!); else ctx.amb.registrar("Nada a desfazer."); continue; }
    if (typeof alvo !== "object") continue;
    const elemento = alvo.elemento;
    const lado = yield* pedirPonto(atraves ? "Especifique o ponto de passagem" : "Especifique o ponto do lado a deslocar", {
      opcoes: [{ chave: "S", rotulo: "Sair" }],
      previa: (c) => { const dist = atraves ? distanciaAoElemento(elemento, c) : valor; const nova = dist > 0 ? paralelaNoLado(elemento, dist, c) : null; return nova ? [{ ...nova, id: PREVIA } as Elemento] : []; },
    });
    if (lado === null || lado === "S" || typeof lado !== "object") return;
    if (atraves) valor = distanciaAoElemento(elemento, lado);
    if (valor <= 0) { ctx.amb.registrar("O ponto está sobre o objeto."); continue; }
    const nova = paralelaNoLado(elemento, valor, lado);
    if (!nova) { ctx.amb.registrar("Não foi possível deslocar este objeto a essa distância."); continue; }
    const antes = ctx.amb.documento();
    if (acrescentar(ctx, [{ ...nova, id: ctx.amb.novoId() } as Elemento])) desfazer.push(antes);
  }
}

function* apararOuEstender(ctx: Contexto, modo: "aparar" | "estender"): Fluxo {
  const desfazer: Documento[] = [];
  const aceita = (e: Elemento) => (modo === "aparar" ? ["parede", "traco", "arco"] : ["parede", "traco"]).includes(e.tipo) ? null
    : modo === "aparar" ? "Aparar vale para parede, linha, polilinha, arco e círculo." : "Estender vale para parede, linha e polilinha aberta.";
  while (true) {
    const alvo = yield* pedirObjeto(ctx, modo === "aparar" ? "Selecione o objeto a aparar" : "Selecione o objeto a estender", aceita, {
      opcoes: [...(modo === "aparar" ? [{ chave: "A", rotulo: "Apagar" }] : []), { chave: "D", rotulo: "Desfazer" }],
    });
    if (alvo === null) return;
    if (alvo === "D") { if (desfazer.length) ctx.amb.aplicar(desfazer.pop()!); else ctx.amb.registrar("Nada a desfazer."); continue; }
    if (alvo === "A") {
      const apagar = yield* pedirObjeto(ctx, "Selecione o objeto a apagar", () => null);
      if (apagar && typeof apagar === "object") {
        const antes = ctx.amb.documento();
        if (substituir(ctx, new Map([[apagar.elemento.id, []]]), [], [])) desfazer.push(antes);
      }
      continue;
    }
    if (typeof alvo !== "object") continue;
    const documento = ctx.amb.documento();
    const limites = limitesDeCorte(documento, alvo.elemento.id);
    if (modo === "estender") {
      const esticado = estenderElemento(alvo.elemento, limites, alvo.ponto);
      if (!esticado) { ctx.amb.registrar("Nenhum limite no caminho desta ponta."); continue; }
      if (substituir(ctx, new Map([[alvo.elemento.id, [esticado]]]))) desfazer.push(documento);
      continue;
    }
    const pedacos = apararElemento(alvo.elemento, limites, alvo.ponto);
    // Como no modo rápido do AutoCAD: o que nada cruza é apagado inteiro.
    const novos = pedacos ? pedacos.map((pedaco, i) => ({ ...pedaco, id: i === 0 ? alvo.elemento.id : ctx.amb.novoId() }) as Elemento) : [];
    if (!pedacos) ctx.amb.registrar("Nada cruza o objeto: ele foi apagado.");
    if (substituir(ctx, new Map([[alvo.elemento.id, novos]]), [], [])) desfazer.push(documento);
  }
}

// ### Concordância e chanfro

type Extremidade = { elemento: Elemento; fixo: Ponto; clique: Ponto; trocar: (ponta: Ponto, fixo?: Ponto) => Elemento; ponta: Ponto; livre: boolean };

/** O trecho reto do objeto perto do clique que pode ter uma ponta trocada. */
function extremidadeDe(elemento: Elemento, clique: Ponto): Extremidade | null {
  if (elemento.tipo === "parede") {
    return { elemento, fixo: elemento.b, ponta: elemento.a, clique, livre: true, trocar: (ponta, fixo) => ({ ...elemento, a: ponta, b: fixo ?? elemento.b }) };
  }
  if (elemento.tipo !== "traco") return null;
  const pontos = elemento.pontos;
  const n = pontos.length;
  if (n === 2) return { elemento, fixo: pontos[1], ponta: pontos[0], clique, livre: true, trocar: (ponta, fixo) => ({ ...elemento, pontos: [ponta, fixo ?? pontos[1]] }) };
  const fechado = pontos[0].x === pontos[n - 1].x && pontos[0].y === pontos[n - 1].y;
  if (fechado) return null;
  let indice = 0, menor = Infinity;
  for (let i = 1; i < n; i += 1) {
    const d = distancia(nearestOnSegment(clique, pontos[i - 1], pontos[i]), clique);
    if (d < menor) { menor = d; indice = i; }
  }
  if (indice === 1) return { elemento, fixo: pontos[1], ponta: pontos[0], clique, livre: false, trocar: (ponta) => ({ ...elemento, pontos: [ponta, ...pontos.slice(1)] }) };
  if (indice === n - 1) return { elemento, fixo: pontos[n - 2], ponta: pontos[n - 1], clique, livre: false, trocar: (ponta) => ({ ...elemento, pontos: [...pontos.slice(0, -1), ponta] }) };
  return null;
}

function cruzamentoDasRetas(a1: Ponto, b1: Ponto, a2: Ponto, b2: Ponto): Ponto | null {
  const r = { x: b1.x - a1.x, y: b1.y - a1.y }, s = { x: b2.x - a2.x, y: b2.y - a2.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9 * Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y)) return null;
  const t = ((a2.x - a1.x) * s.y - (a2.y - a1.y) * s.x) / den;
  return { x: a1.x + t * r.x, y: a1.y + t * r.y };
}

/** Lado que fica de cada objeto: o do clique em relação ao cruzamento. */
function ladoQueFica(e: Extremidade, x: Ponto) {
  const d = { x: e.fixo.x - e.ponta.x, y: e.fixo.y - e.ponta.y };
  const t = (p: Ponto) => (p.x - e.ponta.x) * d.x + (p.y - e.ponta.y) * d.y;
  if (!e.livre) {
    // Polilinha: só a ponta da extremidade muda; o resto da polilinha fica.
    if (distancia(x, e.fixo) < EPS) return null;
    return { longe: e.fixo, montar: (ponta: Ponto) => e.trocar(limpo(ponta)) };
  }
  // Linha solta: fica a ponta do lado do clique; a outra vai para o canto.
  return t(e.clique) >= t(x)
    ? { longe: e.fixo, montar: (ponta: Ponto) => e.trocar(limpo(ponta), e.fixo) }
    : { longe: e.ponta, montar: (ponta: Ponto) => e.trocar(limpo(ponta), e.ponta) };
}

export function concordar(um: { elemento: Elemento; ponto: Ponto }, outro: { elemento: Elemento; ponto: Ponto }, raio: number, novoId: () => string):
  { trocas: Map<string, Elemento[]>; novos: Elemento[] } {
  return cantoEntre(um, outro, novoId, { raio });
}

export function chanfrar(um: { elemento: Elemento; ponto: Ponto }, outro: { elemento: Elemento; ponto: Ponto }, d1: number, d2: number, novoId: () => string) {
  return cantoEntre(um, outro, novoId, { chanfro: [d1, d2] });
}

function cantoEntre(um: { elemento: Elemento; ponto: Ponto }, outro: { elemento: Elemento; ponto: Ponto }, novoId: () => string, o: { raio?: number; chanfro?: [number, number] }) {
  if (um.elemento.id === outro.elemento.id) throw new Error("Selecione dois objetos diferentes.");
  const e1 = extremidadeDe(um.elemento, um.ponto), e2 = extremidadeDe(outro.elemento, outro.ponto);
  if (!e1 || !e2) throw new Error("Selecione linhas, paredes ou a ponta de uma polilinha aberta.");
  const x = cruzamentoDasRetas(e1.ponta, e1.fixo, e2.ponta, e2.fixo);
  if (!x) throw new Error("Os objetos são paralelos: não há canto entre eles.");
  const l1 = ladoQueFica(e1, x), l2 = ladoQueFica(e2, x);
  if (!l1 || !l2) throw new Error("O canto cai sobre um vértice da polilinha.");
  const u1 = { x: (l1.longe.x - x.x) / distancia(x, l1.longe), y: (l1.longe.y - x.y) / distancia(x, l1.longe) };
  const u2 = { x: (l2.longe.x - x.x) / distancia(x, l2.longe), y: (l2.longe.y - x.y) / distancia(x, l2.longe) };
  const cos = Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y));
  const theta = Math.acos(cos);
  const trocas = new Map<string, Elemento[]>();
  const novos: Elemento[] = [];
  const raio = o.raio ?? 0;
  const [d1, d2] = o.chanfro ?? [0, 0];
  if ((!o.chanfro && raio <= 0) || (o.chanfro && d1 <= 0 && d2 <= 0)) {
    trocas.set(e1.elemento.id, [l1.montar(x)]);
    trocas.set(e2.elemento.id, [l2.montar(x)]);
    return { trocas, novos };
  }
  if (theta < 1e-6 || Math.PI - theta < 1e-6) throw new Error("Os objetos estão alinhados.");
  const t1 = o.chanfro ? d1 : raio / Math.tan(theta / 2), t2 = o.chanfro ? d2 : raio / Math.tan(theta / 2);
  if (t1 > distancia(x, l1.longe) + EPS || t2 > distancia(x, l2.longe) + EPS) throw new Error(o.chanfro ? "Distância de chanfro grande demais para estes objetos." : "Raio grande demais para estes objetos.");
  if (!o.chanfro && (e1.elemento.tipo === "parede" || e2.elemento.tipo === "parede")) throw new Error("Parede só aceita concordância com raio 0.");
  const p1 = { x: x.x + u1.x * t1, y: x.y + u1.y * t1 }, p2 = { x: x.x + u2.x * t2, y: x.y + u2.y * t2 };
  trocas.set(e1.elemento.id, [l1.montar(p1)]);
  trocas.set(e2.elemento.id, [l2.montar(p2)]);
  const estilo = { camada: e1.elemento.camada, ...(e1.elemento.cor ? { cor: e1.elemento.cor } : {}), ...(e1.elemento.tipoLinha ? { tipoLinha: e1.elemento.tipoLinha } : {}) };
  const espessura = "espessuraMm" in e1.elemento && e1.elemento.tipo === "traco" ? e1.elemento.espessuraMm : 25;
  if (o.chanfro) {
    if (distancia(p1, p2) > EPS) novos.push({ id: novoId(), ...estilo, tipo: "traco", pontos: [limpo(p1), limpo(p2)], espessuraMm: espessura });
    return { trocas, novos };
  }
  const bissetriz = { x: u1.x + u2.x, y: u1.y + u2.y };
  const modulo = Math.hypot(bissetriz.x, bissetriz.y);
  const centro = { x: x.x + bissetriz.x / modulo * raio / Math.sin(theta / 2), y: x.y + bissetriz.y / modulo * raio / Math.sin(theta / 2) };
  const a1 = anguloDe(centro, p1), a2 = anguloDe(centro, p2);
  let inicio = a1, varredura = normalizarGraus(a2 - a1);
  if (varredura > 180) { inicio = a2; varredura = 360 - varredura; }
  novos.push({ id: novoId(), ...estilo, tipo: "arco", centro: limpo(centro), raioMm: raio, inicioGraus: Math.round(inicio * 1e9) / 1e9 % 360, varreduraGraus: varredura, espessuraMm: espessura });
  return { trocas, novos };
}

function* cantos(ctx: Contexto, modo: "concordar" | "chanfrar"): Fluxo {
  const aceita = (e: Elemento) => e.tipo === "parede" || e.tipo === "traco" ? null : "Selecione uma linha, polilinha ou parede.";
  const desfazer: Documento[] = [];
  while (true) {
    const atual = modo === "concordar" ? `raio = ${numero(ctx.memoria.raioConcordancia)}` : `distâncias = ${numero(ctx.memoria.chanfro[0])} e ${numero(ctx.memoria.chanfro[1])}`;
    const um = yield* pedirObjeto(ctx, `Selecione o primeiro objeto (${atual})`, aceita, {
      opcoes: [modo === "concordar" ? { chave: "R", rotulo: "Raio" } : { chave: "D", rotulo: "Distância" }, { chave: "U", rotulo: "Desfazer" }],
    });
    if (um === null) return;
    if (um === "U") { if (desfazer.length) ctx.amb.aplicar(desfazer.pop()!); else ctx.amb.registrar("Nada a desfazer."); continue; }
    if (um === "R") {
      const raio = yield* pedirNumero(ctx, "Especifique o raio de concordância", { padrao: ctx.memoria.raioConcordancia, validar: (n) => n >= 0 ? null : "O raio não pode ser negativo." });
      if (typeof raio === "number") ctx.memoria.raioConcordancia = raio;
      continue;
    }
    if (um === "D") {
      const d1 = yield* pedirNumero(ctx, "Especifique a primeira distância do chanfro", { padrao: ctx.memoria.chanfro[0], validar: (n) => n >= 0 ? null : "Use um valor positivo." });
      if (typeof d1 !== "number") continue;
      const d2 = yield* pedirNumero(ctx, "Especifique a segunda distância do chanfro", { padrao: d1, validar: (n) => n >= 0 ? null : "Use um valor positivo." });
      if (typeof d2 === "number") ctx.memoria.chanfro = [d1, d2];
      continue;
    }
    if (typeof um !== "object") continue;
    const outro = yield* pedirObjeto(ctx, "Selecione o segundo objeto", aceita);
    if (!outro || typeof outro !== "object") return;
    try {
      const resultado = modo === "concordar"
        ? concordar(um, outro, ctx.memoria.raioConcordancia, ctx.amb.novoId)
        : chanfrar(um, outro, ctx.memoria.chanfro[0], ctx.memoria.chanfro[1], ctx.amb.novoId);
      const antes = ctx.amb.documento();
      if (substituir(ctx, resultado.trocas, resultado.novos, [])) desfazer.push(antes);
    } catch (erro) {
      ctx.amb.registrar(erro instanceof Error ? erro.message : "Não foi possível fazer o canto.");
    }
    // O AutoCAD encerra depois de um canto; a opção Múltiplo seria a exceção.
    return;
  }
}

// ### Explodir, unir, quebrar, esticar, matriz, apagar

export function explodir(elemento: Elemento, novoId: () => string): Elemento[] | null {
  const estilo = { camada: elemento.camada, ...(elemento.cor ? { cor: elemento.cor } : {}), ...(elemento.tipoLinha ? { tipoLinha: elemento.tipoLinha } : {}) };
  if (elemento.tipo === "traco" && elemento.pontos.length > 2) {
    return elemento.pontos.slice(1).map((p, i) => ({ id: i === 0 ? elemento.id : novoId(), ...estilo, tipo: "traco", pontos: [elemento.pontos[i], p], espessuraMm: elemento.espessuraMm }) as Elemento)
      .filter((e) => e.tipo === "traco" && distancia(e.pontos[0], e.pontos[1]) > EPS);
  }
  if (elemento.tipo === "comodo") {
    const pontos = elemento.pontos;
    return pontos.map((p, i) => ({ id: i === 0 ? elemento.id : novoId(), ...estilo, tipo: "traco", pontos: [p, pontos[(i + 1) % pontos.length]], espessuraMm: 25 }) as Elemento);
  }
  return null;
}

export function unir(elementos: Elemento[], tolerancia = 1e-3): { trocas: Map<string, Elemento[]>; unidos: number; resultado: number } {
  const perto = (a: Ponto, b: Ponto) => distancia(a, b) <= tolerancia;
  const abertos = elementos.filter((e): e is Extract<Elemento, { tipo: "traco" }> => e.tipo === "traco" && !perto(e.pontos[0], e.pontos.at(-1)!));
  const trocas = new Map<string, Elemento[]>();
  let unidos = 0, resultado = 0;
  const restantes = [...abertos];
  while (restantes.length) {
    const primeiro = restantes.shift()!;
    let pontos = [...primeiro.pontos];
    const usados: string[] = [];
    let cresceu = true;
    while (cresceu) {
      cresceu = false;
      for (let i = 0; i < restantes.length; i += 1) {
        const outro = restantes[i].pontos;
        if (pontos.length + outro.length > 2000) continue;
        if (perto(pontos.at(-1)!, outro[0])) pontos = [...pontos, ...outro.slice(1)];
        else if (perto(pontos.at(-1)!, outro.at(-1)!)) pontos = [...pontos, ...[...outro].reverse().slice(1)];
        else if (perto(pontos[0], outro.at(-1)!)) pontos = [...outro, ...pontos.slice(1)];
        else if (perto(pontos[0], outro[0])) pontos = [...[...outro].reverse(), ...pontos.slice(1)];
        else continue;
        usados.push(restantes[i].id);
        restantes.splice(i, 1);
        cresceu = true;
        break;
      }
    }
    if (!usados.length) continue;
    if (perto(pontos[0], pontos.at(-1)!)) pontos[pontos.length - 1] = { ...pontos[0] };
    trocas.set(primeiro.id, [{ ...primeiro, pontos }]);
    for (const id of usados) trocas.set(id, []);
    unidos += usados.length + 1;
    resultado += 1;
  }
  return { trocas, unidos, resultado };
}

export function esticar(elemento: Elemento, dentro: (p: Ponto) => boolean, dx: number, dy: number): Elemento {
  const mover = (p: Ponto) => dentro(p) ? limpo({ x: p.x + dx, y: p.y + dy }) : p;
  const caixa = limitesEmCache(elemento);
  if (dentro({ x: caixa.x1, y: caixa.y1 }) && dentro({ x: caixa.x2, y: caixa.y2 })) return deslocar(elemento, dx, dy);
  switch (elemento.tipo) {
    case "parede": case "cota": return { ...elemento, a: mover(elemento.a), b: mover(elemento.b) };
    case "traco": case "comodo": return { ...elemento, pontos: elemento.pontos.map(mover) };
    case "hachura": return { ...elemento, aneis: elemento.aneis.map((anel) => anel.map(mover)) };
    case "arco": return dentro(elemento.centro) ? deslocar(elemento, dx, dy) : elemento;
    default: return dentro(elemento.posicao) ? deslocar(elemento, dx, dy) : elemento;
  }
}

function* matriz(ctx: Contexto): Fluxo {
  const selecao = yield* obterSelecao(ctx);
  if (!selecao) return;
  const alvos = selecionados(ctx.amb.documento(), selecao.ids);
  const tipo = yield* pedirPonto("Digite o tipo de matriz", { opcoes: [{ chave: "R", rotulo: "Retangular" }, { chave: "P", rotulo: "Polar" }], padrao: "Retangular" });
  if (tipo !== null && tipo !== "R" && tipo !== "P") return;
  const limite = (copias: number) => copias * alvos.length > 20000 ? "Cópias demais: a matriz passaria de 20 mil objetos." : null;
  const copias: Elemento[] = [];
  if (tipo === "P") {
    const centro = yield* pedirPonto("Especifique o centro da matriz");
    if (!centro || typeof centro !== "object") return;
    const itens = yield* pedirNumero(ctx, "Digite o número de itens da matriz", { padrao: ctx.memoria.itensPolar, inteiro: true, validar: (n) => n >= 2 ? limite(n - 1) : "Use pelo menos 2 itens." });
    if (typeof itens !== "number") return;
    ctx.memoria.itensPolar = itens;
    const preencher = yield* pedirNumero(ctx, "Especifique o ângulo a preencher (+ anti-horário, − horário)", { padrao: 360, validar: (n) => n !== 0 && Math.abs(n) <= 360 ? null : "Use um ângulo entre -360 e 360, diferente de zero." });
    if (typeof preencher !== "number") return;
    const girarItens = yield* pedirPonto("Girar os objetos ao copiar", { opcoes: [{ chave: "S", rotulo: "Sim" }, { chave: "N", rotulo: "Não" }], padrao: "Sim" });
    if (girarItens !== null && girarItens !== "S" && girarItens !== "N") return;
    const passo = preencher / (Math.abs(preencher) === 360 ? itens : itens - 1);
    for (let i = 1; i < itens; i += 1) {
      for (const elemento of alvos) {
        const graus = passo * i;
        if (girarItens === "N") {
          const caixa = limitesEmCache(elemento);
          const referencia = { x: (caixa.x1 + caixa.x2) / 2, y: (caixa.y1 + caixa.y2) / 2 };
          const destino = girar({ id: "p", camada: "p", tipo: "traco", pontos: [referencia, referencia], espessuraMm: 1 }, graus, centro) as Extract<Elemento, { tipo: "traco" }>;
          copias.push({ ...deslocar(elemento, destino.pontos[0].x - referencia.x, destino.pontos[0].y - referencia.y), id: ctx.amb.novoId() } as Elemento);
        } else copias.push({ ...girar(elemento, graus, centro), id: ctx.amb.novoId() } as Elemento);
      }
    }
  } else {
    const linhas = yield* pedirNumero(ctx, "Digite o número de linhas (---)", { padrao: ctx.memoria.linhasMatriz, inteiro: true, validar: (n) => n >= 1 ? null : "Use pelo menos 1 linha." });
    if (typeof linhas !== "number") return;
    const colunas = yield* pedirNumero(ctx, "Digite o número de colunas (|||)", { padrao: ctx.memoria.colunasMatriz, inteiro: true, validar: (n) => n >= 1 ? (linhas * n < 2 ? "A matriz precisa de pelo menos 2 itens." : limite(linhas * n - 1)) : "Use pelo menos 1 coluna." });
    if (typeof colunas !== "number") return;
    ctx.memoria.linhasMatriz = linhas; ctx.memoria.colunasMatriz = colunas;
    let entreLinhas = 0, entreColunas = 0;
    if (linhas > 1) {
      const d = yield* pedirNumero(ctx, "Digite a distância entre as linhas (positivo sobe)", { validar: (n) => n !== 0 ? null : "A distância não pode ser zero." });
      if (typeof d !== "number") return;
      entreLinhas = d;
    }
    if (colunas > 1) {
      const d = yield* pedirNumero(ctx, "Especifique a distância entre as colunas (positivo à direita)", { validar: (n) => n !== 0 ? null : "A distância não pode ser zero." });
      if (typeof d !== "number") return;
      entreColunas = d;
    }
    for (let l = 0; l < linhas; l += 1) for (let c = 0; c < colunas; c += 1) {
      if (!l && !c) continue;
      for (const elemento of alvos) copias.push({ ...deslocar(elemento, c * entreColunas, -l * entreLinhas), id: ctx.amb.novoId() } as Elemento);
    }
  }
  if (acrescentar(ctx, copias, [])) ctx.amb.registrar(`${copias.length.toLocaleString("pt-BR")} cópia(s) criadas.`);
}

// ## Consulta

function descrever(documento: Documento, elemento: Elemento) {
  const camadaNome = documento.camadas.find((c) => c.id === elemento.camada)?.nome ?? elemento.camada;
  const comprimento = (pontos: Ponto[]) => pontos.slice(1).reduce((soma, p, i) => soma + distancia(pontos[i], p), 0);
  const m = (mm: number) => `${numero(mm / 1000, 3)} m`;
  switch (elemento.tipo) {
    case "parede": return `Parede · camada ${camadaNome} · comprimento ${m(distancia(elemento.a, elemento.b))} · espessura ${numero(elemento.espessuraMm)} mm`;
    case "traco": return `${elemento.pontos.length > 2 ? `Polilinha (${elemento.pontos.length} vértices)` : "Linha"} · camada ${camadaNome} · comprimento ${m(comprimento(elemento.pontos))}`;
    case "arco": return elemento.varreduraGraus >= 360
      ? `Círculo · camada ${camadaNome} · raio ${numero(elemento.raioMm)} mm · centro ${numero(elemento.centro.x)}, ${numero(-elemento.centro.y)}`
      : `Arco · camada ${camadaNome} · raio ${numero(elemento.raioMm)} mm · início ${numero(elemento.inicioGraus)}° · ângulo ${numero(elemento.varreduraGraus)}°`;
    case "comodo": return `Cômodo ${elemento.nome} · camada ${camadaNome} · área ${numero(areaM2(elemento.pontos))} m² · perímetro ${numero(perimetroM(elemento.pontos))} m`;
    case "texto": return `Texto "${elemento.texto.slice(0, 40)}" · camada ${camadaNome} · altura ${numero(elemento.alturaMm)} mm`;
    case "cota": return `Cota · camada ${camadaNome} · ${m(distancia(elemento.a, elemento.b))}`;
    case "hachura": return `Hachura${elemento.solida ? " sólida" : ""} · camada ${camadaNome} · ${elemento.aneis.length} contorno(s)`;
    default: return `${elemento.tipo === "abertura" ? elemento.especie : elemento.tipo} · camada ${camadaNome} · posição ${numero(elemento.posicao.x)}, ${numero(-elemento.posicao.y)}`;
  }
}

function areaDoObjeto(elemento: Elemento): { area: number; perimetro: number } | null {
  if (elemento.tipo === "comodo") return { area: areaM2(elemento.pontos), perimetro: perimetroM(elemento.pontos) };
  if (elemento.tipo === "traco") {
    const pontos = elemento.pontos;
    if (pontos.length < 4 || distancia(pontos[0], pontos.at(-1)!) > 1e-6) return null;
    return { area: areaM2(pontos.slice(0, -1)), perimetro: perimetroM(pontos.slice(0, -1)) };
  }
  if (elemento.tipo === "arco" && elemento.varreduraGraus >= 360) return { area: Math.PI * elemento.raioMm ** 2 / 1e6, perimetro: 2 * Math.PI * elemento.raioMm / 1000 };
  if (elemento.tipo === "hachura") return { area: Math.max(0, areaM2(elemento.aneis[0]) - elemento.aneis.slice(1).reduce((s, anel) => s + areaM2(anel), 0)), perimetro: elemento.aneis.reduce((s, anel) => s + perimetroM(anel), 0) };
  return null;
}

// ## Anotação

function* texto(ctx: Contexto): Fluxo {
  let ancora: { ancoraH?: "meio" | "fim"; ancoraV?: "meio" } = {};
  let posicao: Ponto | null = null;
  while (!posicao) {
    const r = yield* pedirPonto("Especifique o ponto inicial do texto", { opcoes: [{ chave: "J", rotulo: "Justificar" }] });
    if (r === "J") {
      const j = yield* pedirPonto("Digite uma opção", { opcoes: [{ chave: "E", rotulo: "Esquerda" }, { chave: "C", rotulo: "Centro" }, { chave: "D", rotulo: "Direita" }, { chave: "M", rotulo: "Meio" }], padrao: "Esquerda" });
      ancora = j === "C" ? { ancoraH: "meio" } : j === "D" ? { ancoraH: "fim" } : j === "M" ? { ancoraH: "meio", ancoraV: "meio" } : {};
      continue;
    }
    if (!r || typeof r !== "object") return;
    posicao = r;
  }
  const inicio = posicao;
  const altura = yield* pedirNumero(ctx, "Especifique a altura", { padrao: ctx.memoria.alturaTexto, base: inicio, doPonto: (p) => distancia(inicio, p), validar: (n) => n >= 0.5 && n <= 50000 ? null : "Use uma altura entre 0,5 e 50.000 mm." });
  if (typeof altura !== "number") return;
  ctx.memoria.alturaTexto = altura;
  const angulo = yield* pedirNumero(ctx, "Especifique o ângulo de rotação do texto", { padrao: 0, base: inicio, doPonto: (p) => anguloDe(inicio, p) });
  if (typeof angulo !== "number") return;
  let atual = inicio;
  while (true) {
    const r = yield { modo: "texto", prompt: "Digite o texto (Enter vazio encerra)" };
    if (r.tipo !== "texto" || !r.texto.trim()) return;
    const elemento: Elemento = {
      id: ctx.amb.novoId(), camada: camada(ctx, "anotacao"), tipo: "texto", posicao: limpo(atual), texto: r.texto.slice(0, 500), alturaMm: altura,
      rotacaoGraus: normalizarGraus(-angulo), ...ancora,
    };
    acrescentar(ctx, [elemento]);
    // A próxima linha começa abaixo, como no TEXT do AutoCAD.
    atual = polar(atual, altura * 5 / 3, angulo - 90);
  }
}

function* cota(ctx: Contexto): Fluxo {
  const r = yield* pedirPonto("Especifique a origem da primeira linha de chamada", { padrao: "selecionar objeto" });
  let a: Ponto, b: Ponto;
  if (r === null) {
    const alvo = yield* pedirObjeto(ctx, "Selecione o objeto a cotar", (e) => e.tipo === "parede" || (e.tipo === "traco" && e.pontos.length === 2) ? null : "Selecione uma linha ou parede.");
    if (!alvo || typeof alvo !== "object") return;
    const e = alvo.elemento as Extract<Elemento, { tipo: "parede" | "traco" }>;
    [a, b] = e.tipo === "parede" ? [e.a, e.b] : [e.pontos[0], e.pontos[1]];
  } else {
    if (typeof r !== "object") return;
    const inicio = r;
    const segundo = yield* pedirPonto("Especifique a origem da segunda linha de chamada", { base: inicio });
    if (!segundo || typeof segundo !== "object") return;
    a = inicio; b = segundo;
  }
  if (distancia(a, b) < EPS) throw new Error("A cota precisa de dois pontos diferentes.");
  const meio = (a.y + b.y) / 2;
  const deslocamento = (p: Ponto) => Math.max(-5000, Math.min(5000, p.y - meio));
  const posicao = yield* pedirPonto("Especifique a posição da linha de cota", {
    previa: (c) => [{ id: PREVIA, camada: PREVIA, tipo: "cota", a, b, deslocamentoMm: deslocamento(c) }],
  });
  if (!posicao || typeof posicao !== "object") return;
  acrescentar(ctx, [{ id: ctx.amb.novoId(), camada: camada(ctx, "anotacao"), tipo: "cota", a: limpo(a), b: limpo(b), deslocamentoMm: deslocamento(posicao) }]);
  ctx.amb.registrar(`Texto da cota = ${numero(distancia(a, b))} mm`);
}

// ## Registro

const ferramenta = (id: string, nome: string, atalhos: string[], descricao: string): DefinicaoComando => ({
  nome, atalhos, descricao,
  *executar(ctx) { ctx.amb.acao({ tipo: "ferramenta", ferramenta: id }); },
});

export const COMANDOS: DefinicaoComando[] = [
  { nome: "LINHA", atalhos: ["L", "LINE"], descricao: "Linhas por pontos; cada trecho é um objeto", executar: linha },
  { nome: "POLILINHA", atalhos: ["PL", "PLINE"], descricao: "Polilinha: um objeto só com vários vértices", executar: polilinha },
  { nome: "RETANGULO", atalhos: ["REC", "RECTANG", "RET"], descricao: "Retângulo por cantos opostos ou dimensões", executar: retangulo },
  { nome: "CIRCULO", atalhos: ["C", "CIRCLE"], descricao: "Círculo por centro e raio, 2 ou 3 pontos", executar: circulo },
  { nome: "ARCO", atalhos: ["A", "ARC"], descricao: "Arco por 3 pontos ou por centro", executar: arco },
  { nome: "POLIGONO", atalhos: ["POL", "POLYGON"], descricao: "Polígono regular inscrito, circunscrito ou por aresta", executar: poligono },
  { nome: "ELIPSE", atalhos: ["EL", "ELLIPSE"], descricao: "Elipse por eixo ou centro", executar: elipse },
  { nome: "MOVER", atalhos: ["M", "MOVE"], descricao: "Move objetos de um ponto base a outro", executar: (ctx) => mover(ctx, false) },
  { nome: "COPIAR", atalhos: ["CO", "CP", "COPY"], descricao: "Copia objetos, várias vezes seguidas", executar: (ctx) => mover(ctx, true) },
  { nome: "ROTACIONAR", atalhos: ["RO", "ROTATE", "GIRAR"], descricao: "Gira objetos em torno de um ponto base", executar: rotacionar },
  { nome: "ESCALA", atalhos: ["SC", "SCALE"], descricao: "Escala objetos por fator ou referência", executar: escala },
  { nome: "ESPELHAR", atalhos: ["MI", "MIRROR"], descricao: "Espelha objetos por uma linha", executar: espelharComando },
  { nome: "DESLOCAMENTO", atalhos: ["O", "OFFSET", "PARALELA"], descricao: "Paralela a uma distância ou por um ponto", executar: paralela },
  { nome: "APARAR", atalhos: ["TR", "TRIM"], descricao: "Apaga o trecho clicado entre as linhas que o cruzam", executar: (ctx) => apararOuEstender(ctx, "aparar") },
  { nome: "ESTENDER", atalhos: ["EX", "EXTEND"], descricao: "Estende a ponta clicada até a próxima linha", executar: (ctx) => apararOuEstender(ctx, "estender") },
  { nome: "CONCORDAR", atalhos: ["F", "FILLET"], descricao: "Une duas linhas num canto vivo ou arredondado", executar: (ctx) => cantos(ctx, "concordar") },
  { nome: "CHANFRAR", atalhos: ["CHA", "CHAMFER"], descricao: "Corta o canto entre duas linhas", executar: (ctx) => cantos(ctx, "chanfrar") },
  {
    nome: "EXPLODIR", atalhos: ["X", "EXPLODE"], descricao: "Separa polilinhas e cômodos em linhas", *executar(ctx) {
      const selecao = yield* obterSelecao(ctx);
      if (!selecao) return;
      const trocas = new Map<string, Elemento[]>();
      let ignorados = 0;
      for (const elemento of selecionados(ctx.amb.documento(), selecao.ids)) {
        const partes = explodir(elemento, ctx.amb.novoId);
        if (partes) trocas.set(elemento.id, partes); else ignorados += 1;
      }
      if (trocas.size) substituir(ctx, trocas, [], []);
      ctx.amb.registrar(`${trocas.size} objeto(s) explodido(s)${ignorados ? `; ${ignorados} não pode(m) ser explodido(s)` : ""}.`);
    },
  },
  {
    nome: "UNIR", atalhos: ["J", "JOIN"], descricao: "Une linhas e polilinhas que se tocam nas pontas", *executar(ctx) {
      const selecao = yield* obterSelecao(ctx);
      if (!selecao) return;
      const { trocas, unidos, resultado } = unir(selecionados(ctx.amb.documento(), selecao.ids));
      if (!unidos) { ctx.amb.registrar("Nenhum objeto pôde ser unido: as pontas precisam coincidir."); return; }
      substituir(ctx, trocas, [], []);
      ctx.amb.registrar(`${unidos} objeto(s) unido(s) em ${resultado} polilinha(s).`);
    },
  },
  {
    nome: "QUEBRAR", atalhos: ["BR", "BREAK"], descricao: "Tira o trecho entre dois pontos de um objeto", *executar(ctx) {
      const alvo = yield* pedirObjeto(ctx, "Selecione o objeto", (e) => ["parede", "traco", "arco"].includes(e.tipo) ? null : "Quebrar vale para parede, linha, polilinha, arco e círculo.");
      if (!alvo || typeof alvo !== "object") return;
      let primeiro = alvo.ponto;
      let segundo = yield* pedirPonto("Especifique o segundo ponto de quebra", { opcoes: [{ chave: "P", rotulo: "Primeiro ponto" }] });
      if (segundo === "P") {
        const p = yield* pedirPonto("Especifique o primeiro ponto de quebra");
        if (!p || typeof p !== "object") return;
        primeiro = p;
        segundo = yield* pedirPonto("Especifique o segundo ponto de quebra", { base: p });
      }
      if (!segundo || typeof segundo !== "object") return;
      const pedacos = quebrarElemento(alvo.elemento, primeiro, segundo);
      if (!pedacos) throw new Error("Não há o que quebrar entre esses pontos.");
      substituir(ctx, new Map([[alvo.elemento.id, pedacos.map((p, i) => ({ ...p, id: i === 0 ? alvo.elemento.id : ctx.amb.novoId() }) as Elemento)]]), [], []);
    },
  },
  {
    nome: "ESTICAR", atalhos: ["S", "STRETCH"], descricao: "Move os vértices dentro de uma janela cruzada", *executar(ctx) {
      const selecao = yield* obterSelecao(ctx, { janelas: true });
      if (!selecao) return;
      if (!selecao.janelas.length) throw new Error("Esticar precisa de uma janela cruzada: arraste da direita para a esquerda.");
      const janelas = selecao.janelas.map((j) => ({ x1: Math.min(j.a.x, j.b.x), x2: Math.max(j.a.x, j.b.x), y1: Math.min(j.a.y, j.b.y), y2: Math.max(j.a.y, j.b.y) }));
      const dentro = (p: Ponto) => janelas.some((j) => p.x >= j.x1 && p.x <= j.x2 && p.y >= j.y1 && p.y <= j.y2);
      const alvos = selecionados(ctx.amb.documento(), selecao.ids);
      const base = yield* pedirBase();
      if (!base) return;
      let d: Ponto;
      if ("deslocamento" in base) d = base.deslocamento;
      else {
        const origem = base.base;
        const r = yield* pedirPonto("Especifique o segundo ponto", { base: origem, padrao: "usar o primeiro ponto como deslocamento", previa: (c) => previaDe(alvos, (e) => esticar(e, dentro, c.x - origem.x, c.y - origem.y)) });
        if (r === null) d = origem;
        else if (typeof r === "object") d = { x: r.x - origem.x, y: r.y - origem.y };
        else return;
      }
      substituir(ctx, new Map(alvos.map((e) => [e.id, [esticar(e, dentro, d.x, d.y)]])), [], []);
    },
  },
  { nome: "MATRIZ", atalhos: ["AR", "ARRAY"], descricao: "Cópias em linhas e colunas ou em volta de um centro", executar: matriz },
  {
    nome: "APAGAR", atalhos: ["E", "ERASE", "DEL"], descricao: "Apaga os objetos selecionados", *executar(ctx) {
      const selecao = yield* obterSelecao(ctx);
      if (!selecao) return;
      substituir(ctx, new Map(selecao.ids.map((id) => [id, []])), [], []);
      ctx.amb.registrar(`${selecao.ids.length} objeto(s) apagado(s).`);
    },
  },
  {
    nome: "FECHAR", atalhos: ["CLOSE"], descricao: "Fecha a polilinha selecionada", *executar(ctx) {
      const alvo = yield* pedirObjeto(ctx, "Selecione a polilinha", (e) => e.tipo === "traco" && e.pontos.length >= 3 && distancia(e.pontos[0], e.pontos.at(-1)!) > EPS ? null : "Selecione uma polilinha aberta com pelo menos três pontos.");
      if (!alvo || typeof alvo !== "object" || alvo.elemento.tipo !== "traco") return;
      substituir(ctx, new Map([[alvo.elemento.id, [{ ...alvo.elemento, pontos: [...alvo.elemento.pontos, alvo.elemento.pontos[0]] }]]]));
    },
  },
  {
    nome: "DIST", atalhos: ["DI", "DISTANCIA"], descricao: "Mede distância e ângulo entre dois pontos", *executar(ctx) {
      const a = yield* pedirPonto("Especifique o primeiro ponto");
      if (!a || typeof a !== "object") return;
      const b = yield* pedirPonto("Especifique o segundo ponto", { base: a, previa: (c) => [previaTraco([a, c])] });
      if (!b || typeof b !== "object") return;
      ctx.amb.registrar(`Distância = ${numero(distancia(a, b))} mm · ângulo ${numero(anguloDe(a, b))}° · ΔX = ${numero(b.x - a.x)} · ΔY = ${numero(a.y - b.y)}`);
    },
  },
  {
    nome: "AREA", atalhos: ["AA"], descricao: "Área e perímetro por pontos ou de um objeto", *executar(ctx) {
      const r = yield* pedirPonto("Especifique o primeiro canto", { opcoes: [{ chave: "O", rotulo: "Objeto" }], padrao: "Objeto" });
      if (r === null || r === "O") {
        const alvo = yield* pedirObjeto(ctx, "Selecione o objeto", (e) => areaDoObjeto(e) ? null : "Selecione um cômodo, polilinha fechada, círculo ou hachura.");
        if (!alvo || typeof alvo !== "object") return;
        const medida = areaDoObjeto(alvo.elemento)!;
        ctx.amb.registrar(`Área = ${numero(medida.area, 4)} m² · perímetro = ${numero(medida.perimetro, 3)} m`);
        return;
      }
      if (typeof r !== "object") return;
      const pontos: Ponto[] = [r];
      while (true) {
        const p = yield* pedirPonto("Especifique o próximo ponto", { base: pontos.at(-1), opcoes: [{ chave: "D", rotulo: "Desfazer" }], padrao: "Total", previa: (c) => [previaTraco([...pontos, c, pontos[0]])] });
        if (p === "D") { if (pontos.length > 1) pontos.pop(); continue; }
        if (p === null) break;
        if (typeof p === "object") pontos.push(p);
      }
      if (pontos.length < 3) throw new Error("A área precisa de pelo menos três pontos.");
      ctx.amb.registrar(`Área = ${numero(areaM2(pontos), 4)} m² · perímetro = ${numero(perimetroM(pontos), 3)} m`);
    },
  },
  {
    nome: "ID", atalhos: ["IDPONTO"], descricao: "Mostra as coordenadas de um ponto", *executar(ctx) {
      const p = yield* pedirPonto("Especifique o ponto");
      if (p && typeof p === "object") ctx.amb.registrar(`X = ${numero(p.x, 3)} · Y = ${numero(-p.y, 3)}`);
    },
  },
  {
    nome: "LISTAR", atalhos: ["LI", "LS", "LIST"], descricao: "Descreve os objetos selecionados", *executar(ctx) {
      const selecao = yield* obterSelecao(ctx);
      if (!selecao) return;
      const documento = ctx.amb.documento();
      const alvos = selecionados(documento, selecao.ids);
      for (const elemento of alvos.slice(0, 20)) ctx.amb.registrar(descrever(documento, elemento));
      if (alvos.length > 20) ctx.amb.registrar(`… e mais ${alvos.length - 20} objeto(s).`);
    },
  },
  {
    nome: "PINCEL", atalhos: ["MA", "MATCHPROP"], descricao: "Copia camada, cor e tipo de linha de um objeto para outros", *executar(ctx) {
      const origem = yield* pedirObjeto(ctx, "Selecione o objeto de origem", () => null);
      if (!origem || typeof origem !== "object") return;
      const fonte = origem.elemento;
      while (true) {
        const destino = yield* pedirObjeto(ctx, "Selecione o objeto de destino", () => null);
        if (!destino || typeof destino !== "object") return;
        const { cor: _cor, tipoLinha: _tipo, ...resto } = destino.elemento;
        void _cor; void _tipo;
        const novo = { ...resto, camada: fonte.camada, ...(fonte.cor ? { cor: fonte.cor } : {}), ...(fonte.tipoLinha ? { tipoLinha: fonte.tipoLinha } : {}) } as Elemento;
        if ("espessuraMm" in novo && "espessuraMm" in fonte && novo.tipo === fonte.tipo) (novo as { espessuraMm: number }).espessuraMm = fonte.espessuraMm;
        if (novo.tipo === "texto" && fonte.tipo === "texto") novo.alturaMm = fonte.alturaMm;
        substituir(ctx, new Map([[destino.elemento.id, [novo]]]));
      }
    },
  },
  {
    nome: "ZOOM", atalhos: ["Z"], descricao: "Aproxima por janela, fator, extensão ou volta à vista anterior", *executar(ctx) {
      const r = yield* pedirPonto("Especifique o canto da janela, digite um fator (nX) ou", {
        opcoes: [{ chave: "T", rotulo: "Tudo" }, { chave: "E", rotulo: "Extensão" }, { chave: "A", rotulo: "Anterior" }, { chave: "J", rotulo: "Janela" }],
        padrao: "tempo real", aceitaTexto: true,
      });
      if (r === null) { ctx.amb.registrar("Use a roda do mouse para aproximar e o botão do meio para deslocar."); return; }
      if (r === "T" || r === "E") { ctx.amb.acao({ tipo: "zoom-extensao" }); return; }
      if (r === "A") { ctx.amb.acao({ tipo: "zoom-anterior" }); return; }
      if (typeof r === "string" && r.startsWith("texto:")) {
        const fator = Number(r.slice(6).trim().replace(/x$/i, "").replace(",", "."));
        if (!(fator > 0) || !Number.isFinite(fator)) throw new Error("Fator inválido. Exemplo: 2x aproxima duas vezes.");
        ctx.amb.acao({ tipo: "zoom-fator", fator });
        return;
      }
      let a: Ponto | string | null = r;
      if (r === "J") a = yield* pedirPonto("Especifique o primeiro canto");
      if (!a || typeof a !== "object") return;
      const canto = a;
      const b = yield* pedirPonto("Especifique o canto oposto", { base: canto, livre: true, previa: (c) => [previaTraco(retanguloEntre(canto, c))] });
      if (!b || typeof b !== "object") return;
      if (Math.abs(b.x - canto.x) < EPS || Math.abs(b.y - canto.y) < EPS) throw new Error("A janela precisa de largura e altura.");
      ctx.amb.acao({ tipo: "zoom-janela", a: canto, b });
    },
  },
  { nome: "TEXTO", atalhos: ["T", "DT", "TEXT", "DTEXT"], descricao: "Texto de uma linha, com altura e rotação", executar: texto },
  { nome: "COTA", atalhos: ["DIM", "DLI", "DIMLINEAR"], descricao: "Cota entre dois pontos ou de uma linha", executar: cota },
  { nome: "DESFAZER", atalhos: ["U", "UNDO"], descricao: "Desfaz a última operação", *executar(ctx) { ctx.amb.acao({ tipo: "desfazer" }); } },
  { nome: "REFAZER", atalhos: ["REDO"], descricao: "Refaz o que foi desfeito", *executar(ctx) { ctx.amb.acao({ tipo: "refazer" }); } },
  ferramenta("parede", "PAREDE", ["WALL"], "Paredes com espessura, encadeadas"),
  ferramenta("comodo", "COMODO", ["ROOM"], "Cômodo com nome e área"),
  ferramenta("porta", "PORTA", ["DOOR"], "Coloca porta"),
  ferramenta("janela", "JANELA", ["WINDOW"], "Coloca janela"),
  ferramenta("passagem", "PASSAGEM", ["VAO"], "Coloca passagem sem folha"),
  ferramenta("simbolo", "SIMBOLO", ["PONTO"], "Ponto elétrico ou luminária"),
  ferramenta("mobilia", "MOVEL", ["MOBILIA"], "Coloca mobília"),
  ferramenta("imagem", "IMAGEM", ["IMAGE"], "Imagem da biblioteca"),
  ferramenta("traco", "TRACOLIVRE", ["SKETCH", "ESBOCO"], "Traço à mão livre"),
];

const PORNOME = new Map<string, DefinicaoComando>();
for (const comando of COMANDOS) for (const nome of [comando.nome, ...comando.atalhos]) PORNOME.set(nome, comando);

export function acharComando(texto: string): DefinicaoComando | undefined {
  return PORNOME.get(semAcento(texto.trim().replace(/^[_.'-]+/, "")));
}

/** Nomes que começam com o que foi digitado, para completar na linha de comando. */
export function sugerirComandos(texto: string, limite = 8): DefinicaoComando[] {
  const t = semAcento(texto.trim());
  if (!t) return [];
  const saida: DefinicaoComando[] = [];
  const exato = acharComando(t);
  if (exato) saida.push(exato);
  for (const comando of COMANDOS) {
    if (saida.length >= limite) break;
    if (saida.includes(comando)) continue;
    if ([comando.nome, ...comando.atalhos].some((nome) => nome.startsWith(t))) saida.push(comando);
  }
  return saida;
}

/** Encaixe pontual digitado no meio de um comando, como END ou MID no AutoCAD. */
const ENCAIXES_DIGITADOS: Record<string, TipoEncaixe> = {
  END: "extremo", EXT: "extremo", MID: "meio", MEI: "meio", CEN: "centro", INT: "interseccao", PER: "perpendicular",
  QUA: "quadrante", TAN: "tangente", NEA: "proximo", PRO: "proximo",
};

// ## Intérprete

export class Interprete {
  private fluxo: Fluxo | null = null;
  private definicao: DefinicaoComando | null = null;
  private memoria: Memoria = { angulo: 0, fator: 1, raioConcordancia: 0, chanfro: [0, 0], alturaTexto: 250, lados: 4, linhasMatriz: 1, colunasMatriz: 3, itensPolar: 6 };
  private janelas: Janela[] = [];
  pedido: Pedido | null = null;
  ultimoComando: string | null = null;
  ultimoPonto: Ponto = { x: 0, y: 0 };
  /** Encaixe pedido só para o próximo ponto (END, MID…). */
  encaixeUnico: TipoEncaixe | null = null;

  constructor(private amb: Ambiente) {}

  get ativo() { return this.fluxo !== null; }
  get nome() { return this.definicao?.nome ?? null; }

  iniciar(texto: string): boolean {
    const definicao = acharComando(texto);
    if (!definicao) { this.amb.registrar(`Comando desconhecido: "${texto.trim().toUpperCase()}".`); return false; }
    this.cancelar(true);
    this.definicao = definicao;
    this.ultimoComando = definicao.nome;
    this.amb.registrar(`Comando: ${definicao.nome}`);
    this.fluxo = definicao.executar({ amb: this.amb, memoria: this.memoria });
    this.avancar(null);
    return true;
  }

  private avancar(resposta: Resposta | null) {
    const fluxo = this.fluxo;
    if (!fluxo) return;
    try {
      const passo = resposta ? fluxo.next(resposta) : fluxo.next();
      if (this.fluxo !== fluxo) return;
      if (passo.done) this.encerrar();
      else {
        this.pedido = passo.value;
        if (passo.value.modo === "selecao") this.janelas = [];
      }
    } catch (erro) {
      if (this.fluxo !== fluxo) return;
      this.amb.registrar(erro instanceof Error ? erro.message : "Não foi possível concluir o comando.");
      this.encerrar();
    }
  }

  private encerrar() {
    this.fluxo = null; this.definicao = null; this.pedido = null; this.encaixeUnico = null; this.janelas = [];
  }

  responder(resposta: Resposta) {
    if (!this.fluxo || !this.pedido) return;
    if (resposta.tipo === "ponto") { this.ultimoPonto = resposta.ponto; this.encaixeUnico = null; }
    this.avancar(resposta);
  }

  /** Janela usada na seleção em curso (ESTICAR precisa dela). */
  anotarJanela(janela: Janela) { if (this.pedido?.modo === "selecao") this.janelas.push(janela); }

  cancelar(silencioso = false) {
    const fluxo = this.fluxo;
    if (!fluxo) return;
    this.encerrar();
    try { fluxo.return(undefined); } catch { /* o comando já terminou */ }
    if (!silencioso) this.amb.registrar("*Cancelar*");
  }

  /** Enter (ou Espaço, ou clique direito): conclui o passo; sem comando, repete o último. */
  enter() {
    if (!this.fluxo) { if (this.ultimoComando) this.iniciar(this.ultimoComando); return; }
    if (this.pedido?.modo === "selecao") { this.responder({ tipo: "selecao", ids: this.amb.selecao(), janelas: [...this.janelas] }); return; }
    this.responder({ tipo: "enter" });
  }

  /** O que foi digitado na linha de comando. `cursor` dá a direção da distância direta. */
  digitar(texto: string, cursor?: Ponto | null) {
    const t = texto.trim();
    if (!this.fluxo) { if (t) this.iniciar(t); else this.enter(); return; }
    const pedido = this.pedido!;
    if (pedido.modo === "texto") { if (t) this.responder({ tipo: "texto", texto: texto.replace(/^\s+|\s+$/g, "") }); else this.enter(); return; }
    if (!t) { this.enter(); return; }
    if (pedido.modo === "ponto" || pedido.modo === "valor") {
      const encaixe = ENCAIXES_DIGITADOS[semAcento(t).slice(0, 3)];
      if (encaixe && /^[a-z]{3,}$/i.test(t) && !acharOpcao(pedido.opcoes, t)) {
        this.encaixeUnico = encaixe;
        this.amb.registrar(`Encaixe só no próximo ponto: ${encaixeLabels[encaixe]}.`);
        return;
      }
    }
    const opcao = acharOpcao(pedido.opcoes, t);
    if (opcao) { this.responder({ tipo: "opcao", chave: opcao.chave }); return; }
    if (pedido.modo === "selecao") {
      if (/^(T|TODOS|ALL)$/i.test(t)) {
        const documento = this.amb.documento();
        const ids = elementosVisiveis(documento).filter((e) => !camadaBloqueada(documento, e.camada)).map((e) => e.id);
        this.amb.selecionar(ids);
        this.responder({ tipo: "selecao", ids, janelas: [] });
        return;
      }
      this.amb.registrar("Clique nos objetos ou arraste uma janela; Enter conclui. TODOS seleciona tudo.");
      return;
    }
    if (pedido.modo === "objeto") { this.amb.registrar("Clique em cima de um objeto."); return; }
    if (pedido.modo === "valor") {
      const valor = lerMedida(t);
      if (valor !== null) { this.responder({ tipo: "numero", valor }); return; }
    }
    const ponto = this.lerPonto(t, pedido.base, cursor);
    if (ponto) { this.responder({ tipo: "ponto", ponto }); return; }
    if (pedido.aceitaTexto) { this.responder({ tipo: "texto", texto: t }); return; }
    this.amb.registrar(pedido.modo === "valor"
      ? "Valor inválido."
      : "Ponto inválido. Use x,y · @dx,dy · distância<ângulo · ou só a distância na direção do cursor.");
  }

  /** Coordenada digitada: x,y absoluto; @dx,dy e @d<a relativos ao último ponto; d<a e
   *  distância pura relativos ao ponto base, como na entrada dinâmica do AutoCAD. */
  lerPonto(texto: string, base?: Ponto, cursor?: Ponto | null): Ponto | null {
    const t = texto.replace(/\s+/g, "");
    if (t === "@") return this.ultimoPonto;
    if (t.startsWith("@")) return resolverEntrada(base ?? this.ultimoPonto, t, cursor)?.ponto ?? null;
    const absoluto = t.startsWith("#") ? t.slice(1) : t;
    if (absoluto.includes("<")) return resolverEntrada(t.startsWith("#") || !base ? { x: 0, y: 0 } : base, absoluto, cursor)?.ponto ?? null;
    const partes = absoluto.split(/[;,]/);
    if (partes.length === 2 && partes.every(Boolean)) {
      const x = lerMedida(partes[0]), y = lerMedida(partes[1]);
      if (x === null || y === null) return null;
      return { x: x || 0, y: -y || 0 };
    }
    if (base && !t.startsWith("#") && lerMedida(t) !== null) return resolverEntrada(base, t, cursor)?.ponto ?? null;
    return null;
  }
}
