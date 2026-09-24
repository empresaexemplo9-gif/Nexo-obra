import { z } from "zod";

import { itemDoCatalogo, materialLabels, MATERIAIS } from "@/lib/layout-catalogo";

// Documento do criador de layout. Tudo em milímetro, com o Y da planta crescendo para baixo
// (o mesmo da tela). Na prévia 3D, o X e o Y da planta viram X e Z do chão.
//
// O documento é o que o servidor guarda e valida: nada de imagem, só geometria e escolhas.
// A imagem da proposta é gerada a partir dele, sempre, então nunca fica desatualizada.

const coord = z.number().finite().min(-200_000).max(200_000);
const ponto = z.object({ x: coord, y: coord }).strict();
const id = z.string().min(1).max(40);
const cor = z.string().regex(/^#[0-9a-f]{6}$/i);

export const PISOS = ["madeira", "porcelanato", "ceramica", "cimento", "grama", "pedra", "carpete", "deck"] as const;
export type Piso = typeof PISOS[number];
export const pisoLabels: Record<Piso, string> = {
  madeira: "Madeira", porcelanato: "Porcelanato", ceramica: "Cerâmica", cimento: "Cimento queimado",
  grama: "Grama", pedra: "Pedra", carpete: "Carpete", deck: "Deck",
};
export const corDoPiso: Record<Piso, string> = {
  madeira: "#b08559", porcelanato: "#e4ddd1", ceramica: "#d9d4ca", cimento: "#a9a7a1",
  grama: "#6f9a4f", pedra: "#b8b1a4", carpete: "#8f8578", deck: "#8b6443",
};

export const TIPOS_ABERTURA = ["porta", "janela", "portao", "vao"] as const;
export type TipoAbertura = typeof TIPOS_ABERTURA[number];
export const aberturaLabels: Record<TipoAbertura, string> = { porta: "Porta", janela: "Janela", portao: "Portão de garagem", vao: "Vão livre" };
export const ABERTURA_PADRAO: Record<TipoAbertura, { largura: number; altura: number; peitoril: number }> = {
  porta: { largura: 800, altura: 2100, peitoril: 0 },
  janela: { largura: 1200, altura: 1200, peitoril: 1000 },
  portao: { largura: 2800, altura: 2300, peitoril: 0 },
  vao: { largura: 900, altura: 2100, peitoril: 0 },
};

export const paredeSchema = z.object({
  id, a: ponto, b: ponto,
  espessura: z.number().min(50).max(600),
  altura: z.number().min(500).max(8000),
}).strict();

export const aberturaSchema = z.object({
  id, paredeId: id, tipo: z.enum(TIPOS_ABERTURA),
  /** Distância do início da parede (ponto a) até o centro da abertura. */
  posicao: z.number().min(0).max(400_000),
  largura: z.number().min(300).max(8000),
  altura: z.number().min(300).max(7000),
  peitoril: z.number().min(0).max(5000),
  inverter: z.boolean().default(false),
}).strict();

export const comodoSchema = z.object({
  id, nome: z.string().trim().max(60).default(""),
  pontos: z.array(ponto).min(3).max(64),
  piso: z.enum(PISOS),
}).strict();

export const itemSchema = z.object({
  id, catalogo: z.string().min(1).max(40),
  x: coord, y: coord,
  rotacao: z.number().min(-360).max(360),
  largura: z.number().min(50).max(20_000),
  profundidade: z.number().min(50).max(20_000),
  altura: z.number().min(1).max(20_000),
  cor,
  rotulo: z.string().trim().max(60).default(""),
  /** Acabamento escolhido entre os que o item do catálogo aceita. */
  material: z.enum(MATERIAIS).optional(),
}).strict();

export const layoutConteudoSchema = z.object({
  versao: z.literal(1),
  paredes: z.array(paredeSchema).max(600),
  aberturas: z.array(aberturaSchema).max(300),
  comodos: z.array(comodoSchema).max(120),
  itens: z.array(itemSchema).max(1500),
}).strict().superRefine((doc, ctx) => {
  const paredes = new Map(doc.paredes.map((parede) => [parede.id, parede]));
  const ids = [...doc.paredes, ...doc.aberturas, ...doc.comodos, ...doc.itens].map((item) => item.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Identificadores repetidos no layout." });
  for (const abertura of doc.aberturas) {
    const parede = paredes.get(abertura.paredeId);
    if (!parede) { ctx.addIssue({ code: "custom", message: "Abertura em parede que não existe." }); continue; }
    const comprimento = comprimentoDaParede(parede);
    if (abertura.posicao - abertura.largura / 2 < -1 || abertura.posicao + abertura.largura / 2 > comprimento + 1) {
      ctx.addIssue({ code: "custom", message: `${aberturaLabels[abertura.tipo]} maior que a parede.` });
    }
    if (abertura.peitoril + abertura.altura > parede.altura + 1) ctx.addIssue({ code: "custom", message: `${aberturaLabels[abertura.tipo]} mais alta que a parede.` });
  }
  for (const item of doc.itens) {
    const base = itemDoCatalogo(item.catalogo);
    if (!base) { ctx.addIssue({ code: "custom", message: `Item de catálogo desconhecido: ${item.catalogo}.` }); continue; }
    if (item.material && !base.materiais?.includes(item.material)) ctx.addIssue({ code: "custom", message: `${base.nome} não tem acabamento em ${materialLabels[item.material].toLowerCase()}.` });
  }
});

export type LayoutConteudo = z.infer<typeof layoutConteudoSchema>;
export type Parede = z.infer<typeof paredeSchema>;
export type Abertura = z.infer<typeof aberturaSchema>;
export type Comodo = z.infer<typeof comodoSchema>;
export type ItemLayout = z.infer<typeof itemSchema>;
export type Ponto = z.infer<typeof ponto>;

export const layoutVazio = (): LayoutConteudo => ({ versao: 1, paredes: [], aberturas: [], comodos: [], itens: [] });

export function novoId(prefixo: string) {
  return `${prefixo}-${crypto.randomUUID().slice(0, 12)}`;
}

export function comprimentoDaParede(parede: Pick<Parede, "a" | "b">) {
  return Math.hypot(parede.b.x - parede.a.x, parede.b.y - parede.a.y);
}

export function areaM2(pontos: Ponto[]) {
  let soma = 0;
  for (let i = 0; i < pontos.length; i += 1) {
    const a = pontos[i], b = pontos[(i + 1) % pontos.length];
    soma += a.x * b.y - b.x * a.y;
  }
  return Math.abs(soma) / 2 / 1_000_000;
}

export function centroide(pontos: Ponto[]) {
  const x = pontos.reduce((s, p) => s + p.x, 0) / pontos.length;
  const y = pontos.reduce((s, p) => s + p.y, 0) / pontos.length;
  return { x, y };
}

/** Ponto da parede a `distancia` mm do início. */
export function pontoNaParede(parede: Pick<Parede, "a" | "b">, distancia: number) {
  const comprimento = comprimentoDaParede(parede) || 1;
  const t = distancia / comprimento;
  return { x: parede.a.x + (parede.b.x - parede.a.x) * t, y: parede.a.y + (parede.b.y - parede.a.y) * t };
}

/** Projeção de um ponto sobre a parede: distância ao longo dela e afastamento. */
export function projetarNaParede(parede: Pick<Parede, "a" | "b">, alvo: Ponto) {
  const dx = parede.b.x - parede.a.x, dy = parede.b.y - parede.a.y;
  const comprimento2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((alvo.x - parede.a.x) * dx + (alvo.y - parede.a.y) * dy) / comprimento2));
  const px = parede.a.x + dx * t, py = parede.a.y + dy * t;
  return { distancia: t * Math.sqrt(comprimento2), afastamento: Math.hypot(alvo.x - px, alvo.y - py) };
}

/**
 * Pedaços sólidos de uma parede, descontadas as aberturas: do chão ao topo entre as
 * aberturas, acima de cada abertura (verga) e abaixo da janela (peitoril). É o que a
 * prévia 3D levanta. Aberturas sobrepostas contam como uma só.
 */
export function pedacosDaParede(parede: Parede, aberturas: Abertura[]) {
  const comprimento = comprimentoDaParede(parede);
  const vaos = aberturas.filter((a) => a.paredeId === parede.id)
    .map((a) => ({ inicio: Math.max(0, a.posicao - a.largura / 2), fim: Math.min(comprimento, a.posicao + a.largura / 2), base: a.peitoril, topo: Math.min(parede.altura, a.peitoril + a.altura) }))
    .filter((a) => a.fim > a.inicio)
    .sort((x, y) => x.inicio - y.inicio);
  const pedacos: Array<{ inicio: number; fim: number; base: number; topo: number }> = [];
  let cursor = 0;
  for (const vao of vaos) {
    if (vao.inicio > cursor) pedacos.push({ inicio: cursor, fim: vao.inicio, base: 0, topo: parede.altura });
    const inicio = Math.max(vao.inicio, cursor);
    if (vao.fim > inicio) {
      if (vao.base > 0) pedacos.push({ inicio, fim: vao.fim, base: 0, topo: vao.base });
      if (vao.topo < parede.altura) pedacos.push({ inicio, fim: vao.fim, base: vao.topo, topo: parede.altura });
    }
    cursor = Math.max(cursor, vao.fim);
  }
  if (cursor < comprimento) pedacos.push({ inicio: cursor, fim: comprimento, base: 0, topo: parede.altura });
  return pedacos.filter((p) => p.fim - p.inicio > 0.5 && p.topo - p.base > 0.5);
}

export function limitesDoLayout(doc: LayoutConteudo) {
  const xs: number[] = [], ys: number[] = [];
  for (const parede of doc.paredes) { xs.push(parede.a.x, parede.b.x); ys.push(parede.a.y, parede.b.y); }
  for (const comodo of doc.comodos) for (const p of comodo.pontos) { xs.push(p.x); ys.push(p.y); }
  for (const item of doc.itens) {
    const r = Math.hypot(item.largura, item.profundidade) / 2;
    xs.push(item.x - r, item.x + r); ys.push(item.y - r, item.y + r);
  }
  if (!xs.length) return null;
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** Quatro paredes fechando um retângulo e o piso dele: o gesto mais comum de quem desenha. */
export function comodoRetangular(x1: number, y1: number, x2: number, y2: number, opcoes: { nome?: string; piso?: Piso; espessura?: number; altura?: number } = {}) {
  const [minX, maxX] = [Math.min(x1, x2), Math.max(x1, x2)];
  const [minY, maxY] = [Math.min(y1, y2), Math.max(y1, y2)];
  const cantos = [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }];
  const espessura = opcoes.espessura ?? 150, altura = opcoes.altura ?? 2800;
  const paredes: Parede[] = cantos.map((a, i) => ({ id: novoId("pa"), a, b: cantos[(i + 1) % 4], espessura, altura }));
  const comodo: Comodo = { id: novoId("co"), nome: opcoes.nome ?? "", pontos: cantos, piso: opcoes.piso ?? "porcelanato" };
  return { paredes, comodo };
}

/** Item do catálogo com as medidas de mercado, pronto para entrar na planta. */
export function itemNovo(catalogoId: string, x: number, y: number): ItemLayout {
  const base = itemDoCatalogo(catalogoId);
  if (!base) throw new Error("Item de catálogo desconhecido.");
  return { id: novoId("it"), catalogo: base.id, x, y, rotacao: 0, largura: base.largura, profundidade: base.profundidade, altura: base.altura, cor: base.cor, rotulo: "", ...(base.material ? { material: base.material } : {}) };
}

/**
 * Acrescenta paredes sem duplicar a divisa entre cômodos vizinhos: o trecho que já existe
 * numa parede colinear é descontado. Duas paredes no mesmo lugar piscariam na prévia 3D e
 * contariam em dobro no quantitativo.
 */
export function adicionarParedes(doc: LayoutConteudo, novas: Parede[]) {
  for (const nova of novas) {
    const comprimento = comprimentoDaParede(nova);
    if (comprimento < 1) continue;
    const ux = (nova.b.x - nova.a.x) / comprimento, uy = (nova.b.y - nova.a.y) / comprimento;
    const cruz = (p: Ponto) => (p.x - nova.a.x) * uy - (p.y - nova.a.y) * ux;
    const ao = (p: Ponto) => (p.x - nova.a.x) * ux + (p.y - nova.a.y) * uy;
    const cobertos = doc.paredes
      .filter((existente) => Math.abs(cruz(existente.a)) < 1 && Math.abs(cruz(existente.b)) < 1)
      .map((existente) => [Math.max(0, Math.min(ao(existente.a), ao(existente.b))), Math.min(comprimento, Math.max(ao(existente.a), ao(existente.b)))] as const)
      .filter(([inicio, fim]) => fim - inicio > 1)
      .sort((x, y) => x[0] - y[0]);
    let cursor = 0;
    const livres: Array<[number, number]> = [];
    for (const [inicio, fim] of cobertos) {
      if (inicio > cursor) livres.push([cursor, inicio]);
      cursor = Math.max(cursor, fim);
    }
    if (cursor < comprimento) livres.push([cursor, comprimento]);
    for (const [inicio, fim] of livres) {
      if (fim - inicio < 10) continue;
      doc.paredes.push({ ...nova, id: livres.length === 1 && inicio === 0 && fim === comprimento ? nova.id : novoId("pa"), a: pontoNaParede(nova, inicio), b: pontoNaParede(nova, fim) });
    }
  }
  return doc;
}

/** A parede que passa pelo ponto (dentro da espessura), ou nula. */
export function paredeNoPonto(doc: LayoutConteudo, alvo: Ponto, folga = 0) {
  let melhor: { parede: Parede; distancia: number; afastamento: number } | null = null;
  for (const parede of doc.paredes) {
    const projecao = projetarNaParede(parede, alvo);
    if (projecao.afastamento > parede.espessura / 2 + folga) continue;
    if (!melhor || projecao.afastamento < melhor.afastamento) melhor = { parede, ...projecao };
  }
  return melhor;
}

/** Porta, janela ou portão centrado no ponto, na parede que passa por ele. */
export function abrirNoPonto(doc: LayoutConteudo, alvo: Ponto, tipo: TipoAbertura, largura?: number): Abertura | null {
  const achada = paredeNoPonto(doc, alvo, 60);
  if (!achada) return null;
  const padrao = ABERTURA_PADRAO[tipo];
  const comprimento = comprimentoDaParede(achada.parede);
  const l = Math.min(largura ?? padrao.largura, comprimento);
  const posicao = Math.min(Math.max(achada.distancia, l / 2), comprimento - l / 2);
  const altura = Math.min(padrao.altura, achada.parede.altura - padrao.peitoril);
  return { id: novoId("ab"), paredeId: achada.parede.id, tipo, posicao, largura: l, altura, peitoril: padrao.peitoril, inverter: false };
}

/**
 * Pontos de partida para uma proposta. São desenhos-modelo, não dado de ninguém: a pessoa
 * parte deles e ajusta à obra.
 */
export const MODELOS = [
  { id: "vazio", nome: "Em branco", descricao: "Comece desenhando as paredes." },
  { id: "casa-garagem", nome: "Casa térrea com garagem", descricao: "Sala e cozinha integradas, 2 quartos, banheiro e garagem para 2 carros." },
  { id: "apartamento", nome: "Apartamento compacto", descricao: "Sala, cozinha americana, 1 quarto, banheiro e área de serviço." },
] as const;

export function layoutDoModelo(modelo: typeof MODELOS[number]["id"]): LayoutConteudo {
  const doc = layoutVazio();
  if (modelo === "vazio") return doc;
  const comodo = (x1: number, y1: number, x2: number, y2: number, nome: string, piso: Piso) => {
    const r = comodoRetangular(x1, y1, x2, y2, { nome, piso });
    adicionarParedes(doc, r.paredes); doc.comodos.push(r.comodo);
  };
  const abrir = (x: number, y: number, tipo: TipoAbertura, largura?: number) => {
    const abertura = abrirNoPonto(doc, { x, y }, tipo, largura);
    if (!abertura) throw new Error(`Modelo sem parede em ${x},${y}.`);
    doc.aberturas.push(abertura);
  };
  // Rotação 0: a frente do item olha para baixo na planta (+Y); 180, para cima.
  const item = (catalogo: string, x: number, y: number, rotacao = 0) => { const novo = itemNovo(catalogo, x, y); novo.rotacao = rotacao; doc.itens.push(novo); };
  if (modelo === "casa-garagem") {
    comodo(0, 0, 7000, 5000, "Sala e cozinha", "porcelanato");
    comodo(0, 5000, 3500, 8500, "Quarto 1", "madeira");
    comodo(3500, 5000, 7000, 8500, "Quarto 2", "madeira");
    comodo(7000, 5000, 9000, 8500, "Banheiro", "ceramica");
    comodo(7000, -1000, 13000, 5000, "Garagem", "cimento");
    abrir(2000, 0, "porta", 900); abrir(4800, 0, "janela", 2000); abrir(0, 2500, "janela", 1500);
    abrir(1750, 5000, "porta"); abrir(1750, 8500, "janela"); abrir(5250, 5000, "porta"); abrir(5250, 8500, "janela");
    abrir(7000, 6200, "porta", 700); abrir(9000, 6750, "janela", 600);
    abrir(10000, 5000, "portao", 5000); abrir(7000, 2500, "porta", 900);
    item("sofa-3", 1800, 1300); item("tapete", 1800, 2500); item("mesa-centro", 1800, 2500); item("rack-tv", 1800, 4700, 180);
    item("mesa-4", 4600, 1500); item("bancada-pia", 5300, 4625, 180); item("geladeira", 6550, 4550, 180); item("fogao-4", 4200, 4625, 180);
    item("cama-queen", 1750, 7400, 180); item("criado", 600, 8025, 180); item("guarda-roupa", 1750, 5400);
    item("cama-solteiro", 4300, 7475, 180); item("escrivaninha", 6575, 6200, 90);
    item("vaso", 8600, 6000, 90); item("lavatorio", 7300, 7300, 270); item("box", 8425, 7825);
    item("carro-seda", 8600, 2000); item("carro-suv", 11400, 2000);
    item("arvore", -2500, 1500); item("planta", 6500, 500);
  } else {
    comodo(0, 0, 6000, 4000, "Sala e cozinha", "porcelanato");
    comodo(0, 4000, 3500, 7200, "Quarto", "madeira");
    comodo(3500, 4000, 6000, 5800, "Banheiro", "ceramica");
    comodo(3500, 5800, 6000, 7200, "Área de serviço", "ceramica");
    abrir(3000, 0, "porta", 900); abrir(0, 2000, "janela", 2000);
    abrir(2800, 4000, "porta"); abrir(0, 5600, "janela", 1500);
    abrir(4400, 4000, "porta", 700); abrir(3500, 6500, "porta", 700); abrir(6000, 6500, "janela", 800);
    item("sofa-2", 1500, 1100); item("rack-tv", 1500, 3700, 180); item("poltrona", 550, 2300, 270);
    item("bancada-pia", 4800, 375); item("geladeira", 5550, 1400, 90); item("cooktop", 4700, 1700, 180); item("mesa-redonda", 4200, 3000);
    item("cama-casal", 1750, 5100); item("criado", 600, 4300); item("guarda-roupa", 1750, 6825, 180);
    item("vaso", 5600, 4350, 90); item("lavatorio", 3800, 5300, 270); item("box", 5425, 5150);
    item("maquina-lavar", 5575, 6800, 180); item("tanque", 4800, 6825, 180);
  }
  return layoutConteudoSchema.parse(doc);
}
