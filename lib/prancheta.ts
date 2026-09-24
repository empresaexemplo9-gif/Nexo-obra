import { z } from "zod";

import { corNaTela, TIPOS_LINHA, tracejadoPara } from "@/lib/cad-cores";

// Prancheta: desenho técnico e composição de projeto dentro da plataforma.
//
// Duas decisões moldam tudo aqui.
//
// 1. Coordenadas em milímetros de precisão dupla. Arquivos existentes com medidas
//    inteiras continuam válidos; comandos CAD também preservam frações de milímetro.
//
// 2. Elemento pertence a uma CAMADA, e camada tem disciplina. É o que permite entregar a
//    mesma planta como layout, elétrico, luminotécnico ou mobiliário sem desenhar quatro
//    vezes: liga e desliga o que interessa. É também como o arquiteto já pensa.

export const DISCIPLINAS = ["layout", "eletrico", "luminotecnico", "mobiliario", "anotacao"] as const;
export type Disciplina = typeof DISCIPLINAS[number];

export const disciplinaLabels: Record<Disciplina, string> = {
  layout: "Layout e arquitetura",
  eletrico: "Elétrico",
  luminotecnico: "Luminotécnico",
  mobiliario: "Mobiliário e interiores",
  anotacao: "Anotações e cotas",
};

// Símbolos por disciplina. A lista é fechada de propósito: cada família tem desenho
// próprio na tela, e aceitar nome livre produziria símbolo invisível no papel.
export const FAMILIAS_SIMBOLO = {
  eletrico: ["tomada-baixa", "tomada-media", "tomada-alta", "interruptor-simples", "interruptor-paralelo", "quadro", "tv", "rede", "telefone"],
  luminotecnico: ["plafon", "spot", "pendente", "arandela", "fita-led", "sanca", "poste", "refletor"],
} as const;

export const simboloLabels: Record<string, string> = {
  "tomada-baixa": "Tomada baixa (30 cm)", "tomada-media": "Tomada média (1,10 m)", "tomada-alta": "Tomada alta (2,10 m)",
  "interruptor-simples": "Interruptor simples", "interruptor-paralelo": "Interruptor paralelo",
  quadro: "Quadro de distribuição", tv: "Ponto de TV", rede: "Ponto de rede", telefone: "Ponto de telefone",
  plafon: "Plafon", spot: "Spot embutido", pendente: "Pendente", arandela: "Arandela",
  "fita-led": "Fita de LED", sanca: "Sanca iluminada", poste: "Poste", refletor: "Refletor",
};

const mm = z.number().finite();
const coordenada = z.number().finite().min(-2_000_000_000).max(2_000_000_000);
const ponto = z.object({ x: coordenada, y: coordenada }).strict();
const idSchema = z.string().min(1).max(64);

const corHex = z.string().regex(/^#[0-9a-f]{6}$/i);

// Cada elemento carrega a camada a que pertence. Sem isso não há como ligar e desligar
// disciplina, que é a razão de a ferramenta existir. Cor e tipo de linha próprios são
// opcionais: sem eles vale o da camada, como o "por camada" do AutoCAD.
const base = { id: idSchema, camada: idSchema, cor: corHex.optional(), tipoLinha: z.enum(TIPOS_LINHA).optional() };

export const elementoSchema = z.discriminatedUnion("tipo", [
  // Parede: o traço estrutural. A espessura entra no desenho porque o arquiteto cota a
  // face, não o eixo.
  z.object({ ...base, tipo: z.literal("parede"), a: ponto, b: ponto, espessuraMm: mm.min(20).max(1000) }).strict(),
  // Cômodo: polígono fechado com nome. A área é derivada do polígono, nunca digitada —
  // número digitado à mão e desenho divergem em silêncio.
  z.object({ ...base, tipo: z.literal("comodo"), pontos: z.array(ponto).min(3).max(200), nome: z.string().max(60) }).strict(),
  z.object({ ...base, tipo: z.literal("abertura"), especie: z.enum(["porta", "janela", "passagem"]), posicao: ponto, larguraMm: mm.min(100).max(10000), rotacaoGraus: z.number().finite().min(0).lt(360) }).strict(),
  z.object({ ...base, tipo: z.literal("simbolo"), familia: z.string().min(1).max(40), posicao: ponto, rotacaoGraus: z.number().finite().min(0).lt(360), rotulo: z.string().max(40).optional() }).strict(),
  // Mobília e imagem: o interior. `chave` aponta para o arquivo cifrado no armazenamento.
  z.object({ ...base, tipo: z.literal("mobilia"), posicao: ponto, larguraMm: mm.min(10).max(50000), alturaMm: mm.min(10).max(50000), rotacaoGraus: z.number().finite().min(0).lt(360), rotulo: z.string().max(60), chave: z.string().max(400).optional() }).strict(),
  z.object({ ...base, tipo: z.literal("imagem"), posicao: ponto, larguraMm: mm.min(10).max(200000), alturaMm: mm.min(10).max(200000), rotacaoGraus: z.number().finite().min(0).lt(360), chave: z.string().min(1).max(400), rotulo: z.string().max(60).optional() }).strict(),
  // Âncora: onde a posição fica no texto. Sem âncora, é o começo da linha de base — o
  // padrão do TEXT do AutoCAD. Texto centrado ou alinhado à direita no DWG entra no lugar
  // certo só com ela.
  z.object({
    ...base, tipo: z.literal("texto"), posicao: ponto, texto: z.string().min(1).max(500), alturaMm: mm.min(0.5).max(50000),
    rotacaoGraus: z.number().finite().min(0).lt(360),
    ancoraH: z.enum(["inicio", "meio", "fim"]).optional(), ancoraV: z.enum(["base", "meio", "topo"]).optional(),
  }).strict(),
  z.object({ ...base, tipo: z.literal("cota"), a: ponto, b: ponto, deslocamentoMm: mm.min(-5000).max(5000) }).strict(),
  z.object({ ...base, tipo: z.literal("traco"), pontos: z.array(ponto).min(2).max(2000), espessuraMm: mm.min(1).max(200) }).strict(),
  // Arco guardado por centro, raio, ângulo de partida e VARREDURA — não por ângulo final.
  // Ângulo final deixaria "de 0° a 0°" ambíguo entre nada e a circunferência inteira, e é
  // a circunferência inteira que se desenha o tempo todo. Varredura 360 é o círculo, e
  // tudo continua inteiro: nada de fração acumulando erro a cada edição.
  z.object({
    ...base, tipo: z.literal("arco"), centro: ponto,
    raioMm: mm.min(1).max(1_000_000),
    inicioGraus: z.number().finite().min(0).lt(360),
    varreduraGraus: z.number().finite().gt(0).max(360),
    espessuraMm: mm.min(1).max(1000),
  }).strict(),
  // Hachura: área preenchida, com furos (anéis internos pela regra par-ímpar). Sólida é a
  // pintura cheia (pilar, parede em corte); com padrão, é o tom do padrão sobre a área.
  z.object({
    ...base, tipo: z.literal("hachura"),
    aneis: z.array(z.array(ponto).min(3).max(4000)).min(1).max(200),
    solida: z.boolean(), padrao: z.string().max(40).optional(),
  }).strict(),
]);
export type Elemento = z.infer<typeof elementoSchema>;

export const LIMITE_CAMADAS = 1000;
export const LIMITE_ELEMENTOS = 80_000;

export const camadaSchema = z.object({
  id: idSchema,
  nome: z.string().min(1).max(255),
  disciplina: z.enum(DISCIPLINAS),
  visivel: z.boolean(),
  bloqueada: z.boolean(),
  /** Cor da camada; sem cor é a tinta (preta no papel, branca no fundo escuro). */
  cor: corHex.optional(),
  tipoLinha: z.enum(TIPOS_LINHA).optional(),
}).strict();
export type Camada = z.infer<typeof camadaSchema>;

export const documentoSchema = z.object({
  // Folha em milímetros: A1 deitado por padrão, que é a prancha usual de arquitetura.
  folhaLarguraMm: mm.min(100).max(5_000_000),
  folhaAlturaMm: mm.min(100).max(5_000_000),
  // Escala de apresentação: 50 significa 1:50. Não altera a geometria, só a leitura.
  escala: z.number().int().min(1).max(5000),
  // Malha de encaixe em milímetros. 100 mm = 10 cm, o passo com que se desenha planta.
  malhaMm: mm.min(1).max(10000),
  // Um DWG de arquitetura tem centenas de camadas e dezenas de milhares de entidades
  // depois de explodidos os blocos; os limites cabem uma planta real inteira.
  camadas: z.array(camadaSchema).min(1).max(LIMITE_CAMADAS),
  elementos: z.array(elementoSchema).max(LIMITE_ELEMENTOS),
  // Fundo de traçado: PDF ou imagem por cima do qual se desenha. O DWG fica como anexo,
  // porque não existe leitor livre confiável do formato — fingir que abre seria pior.
  fundo: z.object({ chave: z.string().min(1).max(400), nome: z.string().max(200), larguraMm: mm, alturaMm: mm, opacidade: z.number().int().min(5).max(100) }).nullable(),
}).strict();
export type Documento = z.infer<typeof documentoSchema>;

export const CAMADAS_PADRAO: Camada[] = [
  { id: "layout", nome: "Layout e arquitetura", disciplina: "layout", visivel: true, bloqueada: false },
  { id: "eletrico", nome: "Elétrico", disciplina: "eletrico", visivel: true, bloqueada: false },
  { id: "luminotecnico", nome: "Luminotécnico", disciplina: "luminotecnico", visivel: true, bloqueada: false },
  { id: "mobiliario", nome: "Mobiliário e interiores", disciplina: "mobiliario", visivel: true, bloqueada: false },
  { id: "anotacao", nome: "Anotações e cotas", disciplina: "anotacao", visivel: true, bloqueada: false },
];

export function documentoVazio(): Documento {
  return {
    folhaLarguraMm: 841, // A1 deitado: 841 × 594 mm
    folhaAlturaMm: 594,
    escala: 50,
    malhaMm: 100,
    camadas: CAMADAS_PADRAO.map((camada) => ({ ...camada })),
    elementos: [],
    fundo: null,
  };
}

/** Encaixe na malha. Desenhar à mão livre e depois cotar não fecha: o encaixe é o que faz
 *  parede encontrar parede. Malha 1 desliga o encaixe sem caso especial. */
export function encaixar(valor: number, malhaMm: number): number {
  if (malhaMm <= 1) return valor;
  return Math.round(valor / malhaMm) * malhaMm;
}

/** Área do polígono pelo método do cadarço, em metros quadrados.
 *  Derivada do desenho, nunca digitada: número à mão e planta divergem em silêncio. */
export function areaM2(pontos: { x: number; y: number }[]): number {
  if (pontos.length < 3) return 0;
  let dobro = 0;
  for (let i = 0; i < pontos.length; i += 1) {
    const atual = pontos[i];
    const proximo = pontos[(i + 1) % pontos.length];
    dobro += atual.x * proximo.y - proximo.x * atual.y;
  }
  return Math.abs(dobro) / 2 / 1_000_000;
}

/** O arco em pontos. Uma tessellation só, compartilhada pela tela, pelo arquivo exportado,
 *  pela caixa de limites e pelo encaixe — arco que muda de forma entre o que se vê e o que
 *  se imprime não é arco, é engano.
 *
 *  O passo sai da flecha: com 1 mm de desvio máximo, a curva no papel não se distingue de
 *  uma curva de verdade e o desenho não incha com mil pontos por circunferência.
 *
 *  O ângulo é o do desenho técnico — 0° à direita, crescendo no anti-horário. Na tela o Y
 *  aponta para baixo, e é por isso que ele entra negativo aqui. */
export function pontosDoArco(arco: Extract<Elemento, { tipo: "arco" }>): { x: number; y: number }[] {
  const passos = Math.min(360, Math.max(8, Math.ceil(Math.PI / Math.acos(Math.max(-1, Math.min(1, 1 - 1 / arco.raioMm))))));
  const quantos = Math.max(2, Math.ceil(passos * arco.varreduraGraus / 360));
  const pontos: { x: number; y: number }[] = [];
  for (let i = 0; i <= quantos; i += 1) {
    const graus = arco.inicioGraus + arco.varreduraGraus * i / quantos;
    const radianos = graus * Math.PI / 180;
    const cos = Math.cos(radianos), sin = Math.sin(radianos);
    pontos.push({
      x: arco.centro.x + arco.raioMm * (Math.abs(cos) < 1e-14 ? 0 : cos),
      y: arco.centro.y - arco.raioMm * (Math.abs(sin) < 1e-14 ? 0 : sin),
    });
  }
  if (arco.varreduraGraus === 360) pontos[pontos.length - 1] = { ...pontos[0] };
  return pontos;
}

/** Comprimento em metros, para cota e para somar metragem de parede. */
export function comprimentoM(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y) / 1000;
}

/** Perímetro do polígono em metros — rodapé, sanca, pintura. */
export function perimetroM(pontos: { x: number; y: number }[]): number {
  if (pontos.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < pontos.length; i += 1) total += comprimentoM(pontos[i], pontos[(i + 1) % pontos.length]);
  return total;
}

/** Elementos que a tela deve desenhar: os de camada visível, na ordem das camadas.
 *  Elemento órfão — camada apagada — não é desenhado nem some do documento: sumir calado
 *  destruiria trabalho que a pessoa ainda pode recuperar religando a camada. */
// Índice das camadas por lista: perguntar "esta camada está visível / travada?" para cada
// um de 60 mil elementos varrendo mil camadas eram 60 milhões de comparações por
// pergunta — o editor travava. A lista de camadas só muda quando alguém mexe nela.
const indicesDeCamadas = new WeakMap<Camada[], { total: number; ordem: Map<string, number>; porId: Map<string, Camada> }>();
function indiceDeCamadas(camadas: Camada[]) {
  let indice = indicesDeCamadas.get(camadas);
  if (!indice || indice.total !== camadas.length) {
    indice = { total: camadas.length, ordem: new Map(camadas.map((camada, i) => [camada.id, i])), porId: new Map(camadas.map((camada) => [camada.id, camada])) };
    indicesDeCamadas.set(camadas, indice);
  }
  return indice;
}

// Guardado junto com as listas de onde saiu: se o documento ganhar outra lista de camadas
// ou de elementos (ou a mesma lista mudar de tamanho), a resposta é refeita.
const visiveisPorDocumento = new WeakMap<Documento, { camadas: Camada[]; elementos: Elemento[]; total: number; visiveis: Elemento[] }>();
export function elementosVisiveis(documento: Documento): Elemento[] {
  const pronto = visiveisPorDocumento.get(documento);
  if (pronto && pronto.camadas === documento.camadas && pronto.elementos === documento.elementos && pronto.total === documento.elementos.length) return pronto.visiveis;
  const { ordem, porId } = indiceDeCamadas(documento.camadas);
  const visiveis = documento.elementos
    .filter((elemento) => porId.get(elemento.camada)?.visivel)
    .sort((um, outro) => (ordem.get(um.camada) ?? 0) - (ordem.get(outro.camada) ?? 0));
  visiveisPorDocumento.set(documento, { camadas: documento.camadas, elementos: documento.elementos, total: documento.elementos.length, visiveis });
  return visiveis;
}

export function camadaBloqueada(documento: Documento, camadaId: string): boolean {
  return indiceDeCamadas(documento.camadas).porId.get(camadaId)?.bloqueada ?? true;
}

/**
 * Valida só o que mudou entre duas versões do documento. Validar o desenho inteiro a
 * cada gesto — mover uma linha num DWG de 60 mil elementos — levava quase um segundo, e
 * o editor parecia travado. Elemento que é o mesmo objeto da versão anterior já foi
 * validado; o resto (novos, alterados, camadas, folha) passa pelo esquema.
 */
export function validarAlteracao(anterior: Documento, proximo: Documento): boolean {
  if (proximo.elementos.length > LIMITE_ELEMENTOS) return false;
  const { elementos: _novos, ...restoProximo } = proximo;
  const { elementos: _antigos, ...restoAnterior } = anterior;
  void _novos; void _antigos;
  if (restoProximo.camadas !== restoAnterior.camadas || restoProximo.fundo !== restoAnterior.fundo
    || restoProximo.escala !== restoAnterior.escala || restoProximo.malhaMm !== restoAnterior.malhaMm
    || restoProximo.folhaLarguraMm !== restoAnterior.folhaLarguraMm || restoProximo.folhaAlturaMm !== restoAnterior.folhaAlturaMm) {
    if (!documentoSchema.omit({ elementos: true }).safeParse(restoProximo).success) return false;
  }
  const conhecidos = new Set(anterior.elementos);
  const ids = new Set<string>();
  for (const elemento of proximo.elementos) {
    if (ids.has(elemento.id)) return false;
    ids.add(elemento.id);
    if (!conhecidos.has(elemento) && !elementoSchema.safeParse(elemento).success) return false;
  }
  return true;
}

/** Resumo quantitativo do desenho. É o que liga a prancheta ao orçamento: metragem de
 *  parede, área por cômodo e contagem de pontos saem do desenho, não de digitação. */
export type Quantitativo = {
  areaTotalM2: number;
  comodos: { nome: string; areaM2: number; perimetroM: number }[];
  paredesM: number;
  porDisciplina: { disciplina: Disciplina; simbolos: Record<string, number>; total: number }[];
};

export function quantitativo(documento: Documento): Quantitativo {
  const porCamada = new Map(documento.camadas.map((camada) => [camada.id, camada.disciplina]));
  const comodos = documento.elementos
    .filter((elemento): elemento is Extract<Elemento, { tipo: "comodo" }> => elemento.tipo === "comodo")
    .map((elemento) => ({
      nome: elemento.nome || "Sem nome",
      areaM2: Math.round(areaM2(elemento.pontos) * 100) / 100,
      perimetroM: Math.round(perimetroM(elemento.pontos) * 100) / 100,
    }));

  const paredes = documento.elementos
    .filter((elemento): elemento is Extract<Elemento, { tipo: "parede" }> => elemento.tipo === "parede")
    .reduce((soma, parede) => soma + comprimentoM(parede.a, parede.b), 0);

  const contagem = new Map<Disciplina, Record<string, number>>();
  for (const elemento of documento.elementos) {
    if (elemento.tipo !== "simbolo") continue;
    const disciplina = porCamada.get(elemento.camada);
    if (!disciplina) continue;
    const atual = contagem.get(disciplina) ?? {};
    atual[elemento.familia] = (atual[elemento.familia] ?? 0) + 1;
    contagem.set(disciplina, atual);
  }

  return {
    areaTotalM2: Math.round(comodos.reduce((soma, comodo) => soma + comodo.areaM2, 0) * 100) / 100,
    comodos,
    paredesM: Math.round(paredes * 100) / 100,
    porDisciplina: [...contagem.entries()].map(([disciplina, simbolos]) => ({
      disciplina,
      simbolos,
      total: Object.values(simbolos).reduce((soma, valor) => soma + valor, 0),
    })),
  };
}

/** Deslocamento de um elemento, com encaixe na malha. A tela move o desenho e o arquivo
 *  exportado precisam concordar até o milímetro, então a conta mora aqui e não no
 *  componente. Camada e identidade não mudam: mover não é recriar. */
export function moverElemento(elemento: Elemento, dx: number, dy: number, malhaMm: number): Elemento {
  // Snap the displacement once, not each vertex: snapping every vertex deforms
  // rotated geometry and destroys fractional measurements after a drag.
  const offsetX = malhaMm <= 1 ? dx : encaixar(dx, malhaMm);
  const offsetY = malhaMm <= 1 ? dy : encaixar(dy, malhaMm);
  const p = (ponto: { x: number; y: number }) => ({
    x: ponto.x + offsetX,
    y: ponto.y + offsetY,
  });
  switch (elemento.tipo) {
    case "parede":
    case "cota":
      return { ...elemento, a: p(elemento.a), b: p(elemento.b) };
    case "comodo":
    case "traco":
      return { ...elemento, pontos: elemento.pontos.map(p) };
    case "arco":
      // Mover o arco é mover o centro: raio e ângulos são a forma dele, não o lugar.
      return { ...elemento, centro: p(elemento.centro) };
    case "hachura":
      return { ...elemento, aneis: elemento.aneis.map((anel) => anel.map(p)) };
    default:
      return { ...elemento, posicao: p(elemento.posicao) };
  }
}

type Caixa = { x1: number; y1: number; x2: number; y2: number };

/** Caixa de uma lista de pontos, sem espalhar a lista como argumentos: `Math.min(...)`
 *  estoura a pilha numa hachura de milhares de vértices. */
function caixaDePontos(pontos: Iterable<{ x: number; y: number }>): Caixa {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of pontos) {
    if (p.x < x1) x1 = p.x; if (p.x > x2) x2 = p.x;
    if (p.y < y1) y1 = p.y; if (p.y > y2) y2 = p.y;
  }
  return { x1, y1, x2, y2 };
}

function* pontosDosAneis(aneis: { x: number; y: number }[][]) { for (const anel of aneis) yield* anel; }

/** Largura aproximada do texto: 0,65 do corpo por caractere, a média de fonte técnica. */
export const larguraDoTexto = (texto: string, alturaMm: number) => texto.length * alturaMm * 0.65;

/** Retângulo que contém o elemento, em milímetros. Serve para acertar o clique e para
 *  enquadrar o desenho na exportação. */
export function limitesDoElemento(elemento: Elemento): Caixa {
  if ("posicao" in elemento) {
    const centro = elemento.posicao;
    const largura = "larguraMm" in elemento ? elemento.larguraMm : elemento.tipo === "texto" ? larguraDoTexto(elemento.texto, elemento.alturaMm) : 800;
    const altura = "alturaMm" in elemento ? elemento.alturaMm : elemento.tipo === "abertura" ? (elemento.especie === "porta" ? elemento.larguraMm * 2 : 200) : 800;
    let x1 = -largura / 2, y1 = -altura / 2;
    if (elemento.tipo === "texto") {
      x1 = elemento.ancoraH === "meio" ? -largura / 2 : elemento.ancoraH === "fim" ? -largura : 0;
      y1 = elemento.ancoraV === "meio" ? -altura / 2 : elemento.ancoraV === "topo" ? 0 : -altura;
    }
    const x2 = x1 + largura, y2 = y1 + altura;
    const r = elemento.rotacaoGraus * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
    return caixaDePontos([[x1, y1], [x2, y1], [x2, y2], [x1, y2]].map(([x, y]) => ({ x: centro.x + x * cos - y * sin, y: centro.y + x * sin + y * cos })));
  }
  if (elemento.tipo === "cota") {
    const d = elemento.deslocamentoMm;
    return { x1: Math.min(elemento.a.x, elemento.b.x) - 100, x2: Math.max(elemento.a.x, elemento.b.x) + 100,
      y1: Math.min(elemento.a.y, elemento.b.y, elemento.a.y + d - 260, elemento.b.y + d - 260), y2: Math.max(elemento.a.y, elemento.b.y, elemento.a.y + d, elemento.b.y + d) + 100 };
  }
  const caixa = elemento.tipo === "parede" ? caixaDePontos([elemento.a, elemento.b])
    : elemento.tipo === "comodo" || elemento.tipo === "traco" ? caixaDePontos(elemento.pontos)
    // O arco pela tessellation: a caixa do centro mais o raio abraçaria o círculo inteiro
    // e um arco de 20° ficaria com uma área de clique vinte vezes maior do que o traço.
    : elemento.tipo === "arco" ? caixaDePontos(pontosDoArco(elemento))
    : elemento.tipo === "hachura" ? caixaDePontos(pontosDosAneis(elemento.aneis))
    : { x1: 0, y1: 0, x2: 0, y2: 0 };
  const folga = "espessuraMm" in elemento ? elemento.espessuraMm / 2 : 0;
  return { x1: caixa.x1 - folga, y1: caixa.y1 - folga, x2: caixa.x2 + folga, y2: caixa.y2 + folga };
}

/** Caixa guardada por elemento: o elemento é imutável no editor, então a caixa não muda.
 *  Clique, seleção por janela, encaixe e o canvas perguntam isso milhares de vezes. */
const caixasEmCache = new WeakMap<Elemento, Caixa>();
export function limitesEmCache(elemento: Elemento): Caixa {
  let caixa = caixasEmCache.get(elemento);
  if (!caixa) { caixa = limitesDoElemento(elemento); caixasEmCache.set(elemento, caixa); }
  return caixa;
}

export function limitesDoDesenho(elementos: Elemento[]) {
  if (!elementos.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const elemento of elementos) {
    const c = limitesDoElemento(elemento);
    if (c.x1 < x1) x1 = c.x1; if (c.y1 < y1) y1 = c.y1;
    if (c.x2 > x2) x2 = c.x2; if (c.y2 > y2) y2 = c.y2;
  }
  return { x1, y1, x2, y2 };
}

/** Desenho de cada família de símbolo, em milímetros e centrado na origem. O mesmo
 *  caminho serve a tela e o arquivo exportado — símbolo que muda de forma entre o que se
 *  vê e o que se imprime não é símbolo, é engano. */
export function glifoDoSimbolo(familia: string): { d: string; preenchido: boolean } {
  const circulo = (raio: number) => `M ${-raio} 0 a ${raio} ${raio} 0 1 0 ${raio * 2} 0 a ${raio} ${raio} 0 1 0 ${-raio * 2} 0`;
  switch (familia) {
    case "tomada-baixa": return { d: `${circulo(120)} M 0 -120 L 0 -260 M -90 -180 L 90 -180`, preenchido: false };
    case "tomada-media": return { d: `${circulo(120)} M 0 -120 L 0 -300 M -90 -200 L 90 -200 M -90 -260 L 90 -260`, preenchido: false };
    case "tomada-alta": return { d: `${circulo(120)} M 0 -120 L 0 -340 M -90 -180 L 90 -180 M -90 -240 L 90 -240 M -90 -300 L 90 -300`, preenchido: false };
    case "interruptor-simples": return { d: "M -150 0 L 150 0 M 0 0 L 160 -160", preenchido: false };
    case "interruptor-paralelo": return { d: "M -150 0 L 150 0 M 0 0 L 160 -160 M 0 0 L 40 -220", preenchido: false };
    case "quadro": return { d: "M -300 -200 L 300 -200 L 300 200 L -300 200 Z M -300 0 L 300 0", preenchido: false };
    case "tv": return { d: "M -200 -140 L 200 -140 L 200 140 L -200 140 Z M -60 140 L 60 140", preenchido: false };
    case "rede": return { d: `${circulo(130)} M -70 40 L 70 40 M -70 -20 L 70 -20`, preenchido: false };
    case "telefone": return { d: `${circulo(130)} M -80 -40 L 0 60 L 80 -40`, preenchido: false };
    case "plafon": return { d: `${circulo(180)} M -127 -127 L 127 127 M 127 -127 L -127 127`, preenchido: false };
    case "spot": return { d: circulo(110), preenchido: true };
    case "pendente": return { d: `M 0 -300 L 0 -80 M -180 80 L 180 80 L 110 -80 L -110 -80 Z`, preenchido: false };
    case "arandela": return { d: `M -180 -60 L 180 -60 M ${-110} -60 L 0 140 L 110 -60`, preenchido: false };
    case "fita-led": return { d: "M -400 0 L -260 -90 L -120 0 L 20 -90 L 160 0 L 300 -90 L 400 0", preenchido: false };
    case "sanca": return { d: "M -400 -100 L 400 -100 M -400 0 L 400 0 M -400 100 L 400 100", preenchido: false };
    case "poste": return { d: `M 0 300 L 0 -200 M ${-140} -200 L 140 -200 ${circulo(90).replace("M ", "M ")}`, preenchido: false };
    case "refletor": return { d: "M -200 -140 L 60 -140 L 200 0 L 60 140 L -200 140 Z", preenchido: false };
    default: return { d: circulo(120), preenchido: false };
  }
}

const escaparXml = (valor: string) => valor
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&apos;");

const numero = (valor: number) => Number.isInteger(valor) ? String(valor) : valor.toFixed(2);

/** Estilo do traço no papel: cor do elemento, senão da camada; tinta é preta no papel. */
type Estilo = { cor: string; tracejado?: string };

function estiloDo(elemento: Elemento, camadas: Map<string, Camada>, escala: number): Estilo {
  const camada = camadas.get(elemento.camada);
  const cor = corNaTela(elemento.cor ?? camada?.cor ?? null, false);
  return { cor, tracejado: tracejadoPara(elemento.tipoLinha ?? camada?.tipoLinha, escala) };
}

const ancoraSvg = { inicio: "start", meio: "middle", fim: "end" } as const;
const baseSvg = { base: "alphabetic", meio: "central", topo: "hanging" } as const;

export function caminhoDosAneis(aneis: { x: number; y: number }[][]) {
  return aneis.map((anel) => `M ${anel.map((p) => `${numero(p.x)} ${numero(p.y)}`).join(" L ")} Z`).join(" ");
}

function elementoParaSvg(elemento: Elemento, estilo: Estilo): string {
  const giro = "rotacaoGraus" in elemento && elemento.rotacaoGraus
    ? ` transform="rotate(${elemento.rotacaoGraus} ${numero(elemento.posicao.x)} ${numero(elemento.posicao.y)})"` : "";
  const traco = estilo.tracejado ? ` stroke-dasharray="${estilo.tracejado}"` : "";
  switch (elemento.tipo) {
    case "parede":
      return `<line x1="${numero(elemento.a.x)}" y1="${numero(elemento.a.y)}" x2="${numero(elemento.b.x)}" y2="${numero(elemento.b.y)}" stroke="${estilo.cor}" stroke-width="${elemento.espessuraMm}" stroke-linecap="square"/>`;
    case "comodo": {
      const pontos = elemento.pontos.map((p) => `${numero(p.x)},${numero(p.y)}`).join(" ");
      const centro = elemento.pontos.reduce((soma, p) => ({ x: soma.x + p.x / elemento.pontos.length, y: soma.y + p.y / elemento.pontos.length }), { x: 0, y: 0 });
      const area = areaM2(elemento.pontos).toFixed(2).replace(".", ",");
      const rotulo = elemento.nome
        ? `<text x="${numero(centro.x)}" y="${numero(centro.y)}" font-size="220" text-anchor="middle" fill="#38301B">${escaparXml(elemento.nome)}</text>`
        + `<text x="${numero(centro.x)}" y="${numero(centro.y + 260)}" font-size="170" text-anchor="middle" fill="#846100">${area} m²</text>`
        : "";
      return `<polygon points="${pontos}" fill="#B5B19E" fill-opacity="0.18" stroke="#846100" stroke-width="20"/>${rotulo}`;
    }
    case "abertura": {
      const meia = elemento.larguraMm / 2;
      const desenho = elemento.especie === "janela"
        ? `<line x1="${numero(elemento.posicao.x - meia)}" y1="${numero(elemento.posicao.y)}" x2="${numero(elemento.posicao.x + meia)}" y2="${numero(elemento.posicao.y)}" stroke="#38301B" stroke-width="60"/>`
        : elemento.especie === "porta"
        ? `<path d="M ${numero(elemento.posicao.x - meia)} ${numero(elemento.posicao.y)} l ${elemento.larguraMm} 0 m ${-elemento.larguraMm} 0 a ${elemento.larguraMm} ${elemento.larguraMm} 0 0 1 ${elemento.larguraMm} ${elemento.larguraMm}" fill="none" stroke="#38301B" stroke-width="40"/>`
        : `<line x1="${numero(elemento.posicao.x - meia)}" y1="${numero(elemento.posicao.y)}" x2="${numero(elemento.posicao.x + meia)}" y2="${numero(elemento.posicao.y)}" stroke="#38301B" stroke-width="40" stroke-dasharray="180 120"/>`;
      return `<g${giro}>${desenho}</g>`;
    }
    case "simbolo": {
      const glifo = glifoDoSimbolo(elemento.familia);
      return `<g${giro}><g transform="translate(${numero(elemento.posicao.x)} ${numero(elemento.posicao.y)})">`
        + `<path d="${glifo.d}" fill="${glifo.preenchido ? "#846100" : "none"}" stroke="#846100" stroke-width="35"/></g></g>`;
    }
    case "mobilia":
      return `<g${giro}><rect x="${numero(elemento.posicao.x - elemento.larguraMm / 2)}" y="${numero(elemento.posicao.y - elemento.alturaMm / 2)}" width="${elemento.larguraMm}" height="${elemento.alturaMm}" fill="#F4F2E9" stroke="#38301B" stroke-width="25" rx="40"/>`
        + `<text x="${numero(elemento.posicao.x)}" y="${numero(elemento.posicao.y + 60)}" font-size="150" text-anchor="middle" fill="#38301B">${escaparXml(elemento.rotulo)}</text></g>`;
    case "imagem":
      return `<g${giro}><image href="${escaparXml(elemento.chave)}" x="${numero(elemento.posicao.x - elemento.larguraMm / 2)}" y="${numero(elemento.posicao.y - elemento.alturaMm / 2)}" width="${elemento.larguraMm}" height="${elemento.alturaMm}" preserveAspectRatio="xMidYMid slice"/></g>`;
    case "texto":
      return `<g${giro}><text x="${numero(elemento.posicao.x)}" y="${numero(elemento.posicao.y)}" font-size="${numero(elemento.alturaMm)}" font-family="Arial, Helvetica, sans-serif" fill="${estilo.cor}" text-anchor="${ancoraSvg[elemento.ancoraH ?? "inicio"]}" dominant-baseline="${baseSvg[elemento.ancoraV ?? "base"]}">${escaparXml(elemento.texto)}</text></g>`;
    case "cota": {
      const medida = comprimentoM(elemento.a, elemento.b);
      const meio = { x: (elemento.a.x + elemento.b.x) / 2, y: (elemento.a.y + elemento.b.y) / 2 + elemento.deslocamentoMm };
      return `<g stroke="#846100" stroke-width="18" fill="none">`
        + `<line x1="${numero(elemento.a.x)}" y1="${numero(elemento.a.y + elemento.deslocamentoMm)}" x2="${numero(elemento.b.x)}" y2="${numero(elemento.b.y + elemento.deslocamentoMm)}"/>`
        + `<line x1="${numero(elemento.a.x)}" y1="${numero(elemento.a.y)}" x2="${numero(elemento.a.x)}" y2="${numero(elemento.a.y + elemento.deslocamentoMm)}"/>`
        + `<line x1="${numero(elemento.b.x)}" y1="${numero(elemento.b.y)}" x2="${numero(elemento.b.x)}" y2="${numero(elemento.b.y + elemento.deslocamentoMm)}"/></g>`
        + `<text x="${numero(meio.x)}" y="${numero(meio.y - 80)}" font-size="180" text-anchor="middle" fill="#846100">${medida.toFixed(2).replace(".", ",")} m</text>`;
    }
    case "traco":
      return `<polyline points="${elemento.pontos.map((p) => `${numero(p.x)},${numero(p.y)}`).join(" ")}" fill="none" stroke="${estilo.cor}" stroke-width="${numero(elemento.espessuraMm)}" stroke-linecap="round" stroke-linejoin="round"${traco}/>`;
    case "arco":
      return `<polyline points="${pontosDoArco(elemento).map((p) => `${numero(p.x)},${numero(p.y)}`).join(" ")}" fill="none" stroke="${estilo.cor}" stroke-width="${numero(elemento.espessuraMm)}" stroke-linecap="round" stroke-linejoin="round"${traco}/>`;
    case "hachura":
      return `<path d="${caminhoDosAneis(elemento.aneis)}" fill="${estilo.cor}" fill-opacity="${elemento.solida ? 1 : 0.28}" fill-rule="evenodd" stroke="none"/>`;
  }
}

/** Exportação para SVG. É o formato que abre em qualquer navegador, entra no Illustrator
 *  e imprime sem perder medida — e sai daqui sem dependência nova nem servidor.
 *
 *  A imagem enviada pela empresa referencia a rota autenticada dela. Fora da plataforma
 *  esse endereço não abre, então o arquivo exportado traz a moldura da imagem e não um
 *  quadro em branco silencioso. */
export function exportarSvg(documento: Documento, opcoes: { titulo?: string; origem?: string } = {}): string {
  const visiveis = elementosVisiveis(documento);
  const limites = limitesDoDesenho(visiveis) ?? { x1: 0, y1: 0, x2: documento.folhaLarguraMm * 10, y2: documento.folhaAlturaMm * 10 };
  const margem = 500;
  const largura = Math.max(1, limites.x2 - limites.x1) + margem * 2;
  const altura = Math.max(1, limites.y2 - limites.y1) + margem * 2;
  const camadas = new Map(documento.camadas.map((camada) => [camada.id, camada]));
  const corpo = visiveis.map((elemento) => {
    const desenhado = elementoParaSvg(elemento, estiloDo(elemento, camadas, documento.escala));
    if (elemento.tipo !== "imagem" || !opcoes.origem) return desenhado;
    return desenhado.replace(`href="${escaparXml(elemento.chave)}"`, `href="${escaparXml(`${opcoes.origem}${elemento.chave}`)}"`);
  }).join("\n  ");
  const titulo = opcoes.titulo ? `\n  <title>${escaparXml(opcoes.titulo)}</title>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${numero(largura / 10)}mm" height="${numero(altura / 10)}mm" viewBox="${numero(limites.x1 - margem)} ${numero(limites.y1 - margem)} ${numero(largura)} ${numero(altura)}">${titulo}
  <rect x="${numero(limites.x1 - margem)}" y="${numero(limites.y1 - margem)}" width="${numero(largura)}" height="${numero(altura)}" fill="#FFFFFF"/>
  ${corpo}
</svg>
`;
}
