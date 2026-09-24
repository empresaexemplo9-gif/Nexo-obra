import { Documento, Elemento, camadaBloqueada, elementosVisiveis, encaixar, limitesEmCache, moverElemento, pontosDoArco } from "@/lib/prancheta";
import { nearestOnSegment, tangentPoints } from "@/packages/cad-core";

// O que separa desenhar de chutar.
//
// Com só a malha, a parede nova encosta perto do canto da anterior — perto, não no canto.
// Cinco milímetros de folga em vinte junções viram uma planta que não fecha, e o erro só
// aparece quando alguém tenta cotar. Encaixe em entidade resolve isso: o cursor pousa no
// extremo, no meio, no cruzamento ou na perpendicular de algo que já existe.
//
// A outra metade é digitar. Ninguém desenha parede de 3,15 m arrastando o mouse até
// acertar; digita 3150 e a direção. É assim em todo CAD, e é o que torna o desenho
// rápido em vez de laborioso.

export type Ponto = { x: number; y: number };
export type Segmento = { a: Ponto; b: Ponto; elementoId: string };

// A ordem aqui é a ordem de preferência, e ela importa: com dois candidatos à mesma
// distância, o extremo vence o meio, porque é nele que paredes se encontram.
export const TIPOS_ENCAIXE = ["extremo", "interseccao", "perpendicular", "meio", "centro", "quadrante", "tangente", "proximo", "malha"] as const;
export type TipoEncaixe = typeof TIPOS_ENCAIXE[number];

export const encaixeLabels: Record<TipoEncaixe, string> = {
  extremo: "Extremo",
  interseccao: "Interseção",
  perpendicular: "Perpendicular",
  meio: "Meio",
  centro: "Centro",
  malha: "Malha",
  quadrante: "Quadrante",
  tangente: "Tangente",
  proximo: "Mais próximo",
};

export type Encaixe = { tipo: TipoEncaixe; ponto: Ponto; elementoId?: string };

const distancia = (um: Ponto, outro: Ponto) => Math.hypot(outro.x - um.x, outro.y - um.y);
// Remove apenas resíduos numéricos próximos de zero, sem quantizar a geometria.
const preciso = (ponto: Ponto): Ponto => ({ x: Math.abs(ponto.x) < 1e-10 ? 0 : ponto.x, y: Math.abs(ponto.y) < 1e-10 ? 0 : ponto.y });

/** Segmentos de tudo que está desenhado e pode ser encaixado. Camada escondida ou travada
 *  fica de fora: encaixar no que não se vê é perseguir fantasma. */
export function segmentosDo(documento: Documento): Segmento[] {
  const saida: Segmento[] = [];
  for (const elemento of elementosVisiveis(documento)) {
    if (camadaBloqueada(documento, elemento.camada)) continue;
    if (elemento.tipo === "parede" || elemento.tipo === "cota") {
      saida.push({ a: elemento.a, b: elemento.b, elementoId: elemento.id });
      continue;
    }
    if (elemento.tipo === "comodo" || elemento.tipo === "traco" || elemento.tipo === "arco") {
      // O arco entra pela mesma tessellation que a tela desenha, então o encaixe cai onde
      // o traço de fato está — e não numa curva ideal que ninguém vê.
      const pontos = elemento.tipo === "arco" ? pontosDoArco(elemento) : elemento.pontos;
      const fechado = elemento.tipo === "comodo";
      const quantos = fechado ? pontos.length : pontos.length - 1;
      for (let i = 0; i < quantos; i += 1) {
        saida.push({ a: pontos[i], b: pontos[(i + 1) % pontos.length], elementoId: elemento.id });
      }
    }
  }
  return saida;
}

/** Pontos notáveis do desenho: extremo, meio e centro. */
export function pontosNotaveis(documento: Documento): Encaixe[] {
  const saida: Encaixe[] = [];
  // Um arco vira dezenas de cordas na tessellation. Oferecer extremo e meio de cada uma
  // encheria a tela de candidatos falsos: no arco, o que se usa é a ponta e o centro.
  const doArco = new Set(documento.elementos.filter((elemento) => elemento.tipo === "arco").map((elemento) => elemento.id));
  const porElemento = new Map<string, Segmento[]>();
  for (const segmento of segmentosDo(documento)) {
    if (doArco.has(segmento.elementoId)) {
      const lista = porElemento.get(segmento.elementoId) ?? [];
      lista.push(segmento);
      porElemento.set(segmento.elementoId, lista);
      continue;
    }
    saida.push({ tipo: "extremo", ponto: segmento.a, elementoId: segmento.elementoId });
    saida.push({ tipo: "extremo", ponto: segmento.b, elementoId: segmento.elementoId });
    saida.push({
      tipo: "meio",
      ponto: preciso({ x: (segmento.a.x + segmento.b.x) / 2, y: (segmento.a.y + segmento.b.y) / 2 }),
      elementoId: segmento.elementoId,
    });
  }
  for (const [elementoId, cordas] of porElemento) {
    saida.push({ tipo: "extremo", ponto: cordas[0].a, elementoId });
    saida.push({ tipo: "extremo", ponto: cordas[cordas.length - 1].b, elementoId });
    saida.push({ tipo: "meio", ponto: cordas[Math.floor(cordas.length / 2)].a, elementoId });
  }
  for (const elemento of elementosVisiveis(documento)) {
    if (camadaBloqueada(documento, elemento.camada)) continue;
    if (elemento.tipo === "arco") saida.push({ tipo: "centro", ponto: elemento.centro, elementoId: elemento.id });
    else if ("posicao" in elemento) saida.push({ tipo: "centro", ponto: elemento.posicao, elementoId: elemento.id });
  }
  return saida;
}

/** Onde dois segmentos se cruzam de verdade — dentro dos dois, não no prolongamento. */
export function interseccao(um: Segmento, outro: Segmento): Ponto | null {
  const r = { x: um.b.x - um.a.x, y: um.b.y - um.a.y };
  const s = { x: outro.b.x - outro.a.x, y: outro.b.y - outro.a.y };
  const denominador = r.x * s.y - r.y * s.x;
  if (denominador === 0) return null; // Paralelos ou colineares: não há ponto único.
  const diferenca = { x: outro.a.x - um.a.x, y: outro.a.y - um.a.y };
  const t = (diferenca.x * s.y - diferenca.y * s.x) / denominador;
  const u = (diferenca.x * r.y - diferenca.y * r.x) / denominador;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return preciso({ x: um.a.x + t * r.x, y: um.a.y + t * r.y });
}

/** Pé da perpendicular baixada de um ponto sobre o segmento. É o que faz uma parede nova
 *  encontrar a existente em ângulo reto sem ninguém calcular nada. */
export function pePerpendicular(origem: Ponto, segmento: Segmento): Ponto | null {
  const r = { x: segmento.b.x - segmento.a.x, y: segmento.b.y - segmento.a.y };
  const comprimentoQuadrado = r.x * r.x + r.y * r.y;
  if (comprimentoQuadrado === 0) return null;
  const t = ((origem.x - segmento.a.x) * r.x + (origem.y - segmento.a.y) * r.y) / comprimentoQuadrado;
  if (t < 0 || t > 1) return null;
  return preciso({ x: segmento.a.x + t * r.x, y: segmento.a.y + t * r.y });
}

export type OpcoesEncaixe = {
  /** Raio de captura em milímetros de desenho. Vem do zoom: o que vale é a distância na
   *  tela, senão o encaixe fica impossível de acertar afastado e agressivo demais perto. */
  toleranciaMm: number;
  /** Ponto de onde o traço está saindo, quando há um. Só com ele existe perpendicular. */
  origem?: Ponto | null;
  ativos?: readonly TipoEncaixe[];
  /** Falso desliga o encaixe na malha (F9 do AutoCAD): sem objeto perto, vale o ponto cru. */
  malha?: boolean;
};

type ArcoDoc = Extract<Elemento, { tipo: "arco" }>;
type Caixa = { x1: number; y1: number; x2: number; y2: number };
type Contribuicao = { segmentos: Segmento[]; notaveis: Encaixe[]; arco: ArcoDoc | null };

/** O que um elemento oferece ao encaixe — as mesmas regras de `segmentosDo` e
 *  `pontosNotaveis`, por elemento. Guardado por objeto: elemento que não mudou não é
 *  recalculado (o arco, por exemplo, precisa ser tessellado). */
const contribuicoes = new WeakMap<Elemento, Contribuicao>();
function contribuicaoDe(elemento: Elemento): Contribuicao {
  let pronta = contribuicoes.get(elemento);
  if (pronta) return pronta;
  const segmentos: Segmento[] = [];
  const notaveis: Encaixe[] = [];
  if (elemento.tipo === "parede" || elemento.tipo === "cota") segmentos.push({ a: elemento.a, b: elemento.b, elementoId: elemento.id });
  else if (elemento.tipo === "comodo" || elemento.tipo === "traco" || elemento.tipo === "arco") {
    const pontos = elemento.tipo === "arco" ? pontosDoArco(elemento) : elemento.pontos;
    const quantos = elemento.tipo === "comodo" ? pontos.length : pontos.length - 1;
    for (let i = 0; i < quantos; i += 1) segmentos.push({ a: pontos[i], b: pontos[(i + 1) % pontos.length], elementoId: elemento.id });
  }
  if (elemento.tipo === "arco") {
    if (segmentos.length) {
      notaveis.push({ tipo: "extremo", ponto: segmentos[0].a, elementoId: elemento.id });
      notaveis.push({ tipo: "extremo", ponto: segmentos[segmentos.length - 1].b, elementoId: elemento.id });
      notaveis.push({ tipo: "meio", ponto: segmentos[Math.floor(segmentos.length / 2)].a, elementoId: elemento.id });
    }
    notaveis.push({ tipo: "centro", ponto: elemento.centro, elementoId: elemento.id });
  } else {
    for (const segmento of segmentos) {
      notaveis.push({ tipo: "extremo", ponto: segmento.a, elementoId: elemento.id });
      notaveis.push({ tipo: "extremo", ponto: segmento.b, elementoId: elemento.id });
      notaveis.push({ tipo: "meio", ponto: preciso({ x: (segmento.a.x + segmento.b.x) / 2, y: (segmento.a.y + segmento.b.y) / 2 }), elementoId: elemento.id });
    }
    if ("posicao" in elemento) notaveis.push({ tipo: "centro", ponto: elemento.posicao, elementoId: elemento.id });
  }
  pronta = { segmentos, notaveis, arco: elemento.tipo === "arco" ? elemento : null };
  contribuicoes.set(elemento, pronta);
  return pronta;
}

const caixaDoElemento = (elemento: Elemento): Caixa => limitesEmCache(elemento);

/**
 * Índice do desenho para o encaixe: os ELEMENTOS numa grade pela caixa de cada um.
 *
 * O encaixe roda a cada movimento do mouse. Varrer o desenho inteiro servia para uma
 * planta desenhada à mão; num DWG importado são centenas de milhares de segmentos. O
 * índice guarda só as caixas (montado em milissegundos a cada versão do documento), e os
 * segmentos e pontos de cada elemento são calculados quando o cursor passa perto dele.
 */
class IndiceEncaixe {
  private readonly elementos: Elemento[];
  private celula = 1;
  private grade: Map<number, number[]> | null = null;
  private grandes: number[] = [];
  private todos: { segmentos: Segmento[]; notaveis: Encaixe[]; arcos: ArcoDoc[] } | null = null;
  private idsDeArco: Set<string> | null = null;
  get arcoIds() { return (this.idsDeArco ??= new Set(this.elementos.filter((e) => e.tipo === "arco").map((e) => e.id))); }

  constructor(documento: Documento) {
    // Hachura não oferece encaixe: o contorno dela repete as linhas que a cercam.
    this.elementos = elementosVisiveis(documento).filter((elemento) => elemento.tipo !== "hachura" && !camadaBloqueada(documento, elemento.camada));
    if (this.elementos.length < 1500) return; // desenho pequeno: a varredura direta basta
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const caixas = this.elementos.map((elemento) => {
      const c = caixaDoElemento(elemento);
      if (Number.isFinite(c.x1)) { x1 = Math.min(x1, c.x1); y1 = Math.min(y1, c.y1); x2 = Math.max(x2, c.x2); y2 = Math.max(y2, c.y2); }
      return c;
    });
    this.celula = Math.max(10, Math.max(x2 - x1, y2 - y1, 1) / 256);
    const grade = new Map<number, number[]>();
    caixas.forEach((c, k) => {
      if (!Number.isFinite(c.x1)) return;
      const i1 = Math.floor(c.x1 / this.celula), i2 = Math.floor(c.x2 / this.celula);
      const j1 = Math.floor(c.y1 / this.celula), j2 = Math.floor(c.y2 / this.celula);
      if ((i2 - i1 + 1) * (j2 - j1 + 1) > 64) { this.grandes.push(k); return; }
      for (let i = i1; i <= i2; i += 1) for (let j = j1; j <= j2; j += 1) {
        const chave = (i + 1_000_000) * 2_097_152 + (j + 1_000_000);
        const lista = grade.get(chave);
        if (lista) lista.push(k); else grade.set(chave, [k]);
      }
    });
    this.grade = grade;
  }

  private juntar(elementos: Iterable<Elemento>) {
    const segmentos: Segmento[] = [], notaveis: Encaixe[] = [], arcos: ArcoDoc[] = [];
    for (const elemento of elementos) {
      const c = contribuicaoDe(elemento);
      for (const s of c.segmentos) segmentos.push(s);
      for (const n of c.notaveis) notaveis.push(n);
      if (c.arco) arcos.push(c.arco);
    }
    return { segmentos, notaveis, arcos };
  }

  /** O que está a até `raio` do alvo (por caixa): candidatos, não resposta final. */
  perto(alvo: Ponto, raio: number) {
    const todos = () => (this.todos ??= this.juntar(this.elementos));
    if (!this.grade) return todos();
    const i1 = Math.floor((alvo.x - raio) / this.celula), i2 = Math.floor((alvo.x + raio) / this.celula);
    const j1 = Math.floor((alvo.y - raio) / this.celula), j2 = Math.floor((alvo.y + raio) / this.celula);
    const escolhidos = new Set<number>(this.grandes);
    if ((i2 - i1 + 1) * (j2 - j1 + 1) > 4096) {
      // Raio enorme (desenho muito afastado): vale a caixa de cada elemento.
      this.elementos.forEach((elemento, k) => {
        const c = caixaDoElemento(elemento);
        if (c.x1 - raio <= alvo.x && c.x2 + raio >= alvo.x && c.y1 - raio <= alvo.y && c.y2 + raio >= alvo.y) escolhidos.add(k);
      });
    } else {
      for (let i = i1; i <= i2; i += 1) for (let j = j1; j <= j2; j += 1) {
        const lista = this.grade.get((i + 1_000_000) * 2_097_152 + (j + 1_000_000));
        if (lista) for (const k of lista) escolhidos.add(k);
      }
    }
    let lista = [...escolhidos];
    // Com o desenho muito afastado, o raio abraça a planta inteira. Os 300 elementos cuja
    // caixa está mais perto do cursor bastam: o encaixe só aceita pontos dentro do raio.
    if (lista.length > 300) {
      const distanciaCaixa = (k: number) => {
        const c = caixaDoElemento(this.elementos[k]);
        const dx = Math.max(c.x1 - alvo.x, 0, alvo.x - c.x2), dy = Math.max(c.y1 - alvo.y, 0, alvo.y - c.y2);
        return dx * dx + dy * dy;
      };
      lista = lista.map((k) => [k, distanciaCaixa(k)] as const).sort((a, b) => a[1] - b[1]).slice(0, 300).map(([k]) => k);
    }
    return this.juntar(lista.sort((a, b) => a - b).map((k) => this.elementos[k]));
  }
}

// Só o índice da versão em uso fica guardado. Guardar um por versão prendia na memória o
// índice de cada passo do histórico de desfazer — dezenas de megabytes por passo numa
// planta grande —, e depois de alguns minutos o navegador travava.
let ultimoIndice: { documento: Documento; camadas: Documento["camadas"]; elementos: Documento["elementos"]; indice: IndiceEncaixe } | null = null;
function indiceDe(documento: Documento) {
  if (ultimoIndice && ultimoIndice.documento === documento && ultimoIndice.camadas === documento.camadas && ultimoIndice.elementos === documento.elementos) return ultimoIndice.indice;
  const indice = new IndiceEncaixe(documento);
  ultimoIndice = { documento, camadas: documento.camadas, elementos: documento.elementos, indice };
  return indice;
}

/**
 * O encaixe escolhido para uma posição do cursor.
 *
 * Nunca devolve nada: quando não há entidade por perto, cai na malha, que é o
 * comportamento anterior. Assim a ferramenta funciona igual em desenho vazio.
 * `ignorar` tira elementos da disputa (o que está sendo arrastado não encaixa em si).
 */
export function encaixePerto(documento: Documento, alvo: Ponto, opcoes: OpcoesEncaixe & { ignorar?: ReadonlySet<string> }): Encaixe {
  const ativos = opcoes.ativos ?? TIPOS_ENCAIXE;
  const tolerancia = Math.max(1, opcoes.toleranciaMm);
  const naMalha: Encaixe = opcoes.malha === false ? { tipo: "malha", ponto: alvo } : {
    tipo: "malha",
    ponto: { x: encaixar(alvo.x, documento.malhaMm), y: encaixar(alvo.y, documento.malhaMm) },
  };
  if (!ativos.length) return naMalha;

  const indice = indiceDe(documento);
  const ignorar = opcoes.ignorar;
  const vale = (id?: string) => !ignorar || !id || !ignorar.has(id);
  const vizinhanca = indice.perto(alvo, tolerancia);
  const candidatos: Encaixe[] = [];
  const perto = (ponto: Ponto) => distancia(ponto, alvo) <= tolerancia;

  for (const candidato of vizinhanca.notaveis) {
    if (!perto(candidato.ponto) || !ativos.includes(candidato.tipo) || !vale(candidato.elementoId)) continue;
    candidatos.push(candidato);
  }

  // Interseção e perpendicular custam mais, então só se olha o que passa perto do alvo —
  // e no máximo os 48 segmentos mais próximos. Com o desenho afastado, o raio de captura
  // abraça milhares de linhas, e cruzar todas com todas a cada movimento travava a tela.
  const proximos = vizinhanca.segmentos
    .filter((segmento) => vale(segmento.elementoId)
      && Math.min(segmento.a.x, segmento.b.x) - tolerancia <= alvo.x
      && Math.max(segmento.a.x, segmento.b.x) + tolerancia >= alvo.x
      && Math.min(segmento.a.y, segmento.b.y) - tolerancia <= alvo.y
      && Math.max(segmento.a.y, segmento.b.y) + tolerancia >= alvo.y)
    .map((segmento) => ({ segmento, d: distancia(nearestOnSegment(alvo, segmento.a, segmento.b), alvo) }))
    .filter((item) => item.d <= tolerancia)
    .sort((x, y) => x.d - y.d)
    .slice(0, 48)
    .map((item) => item.segmento);

  if (ativos.includes("interseccao")) {
    for (let i = 0; i < proximos.length; i += 1) {
      for (let j = i + 1; j < proximos.length; j += 1) {
        if (proximos[i].elementoId === proximos[j].elementoId) continue;
        const cruzamento = interseccao(proximos[i], proximos[j]);
        if (cruzamento && perto(cruzamento)) {
          candidatos.push({ tipo: "interseccao", ponto: cruzamento, elementoId: proximos[i].elementoId });
        }
      }
    }
  }

  if (ativos.includes("perpendicular") && opcoes.origem) {
    for (const segmento of proximos) {
      const pe = pePerpendicular(opcoes.origem, segmento);
      if (pe && perto(pe)) candidatos.push({ tipo: "perpendicular", ponto: pe, elementoId: segmento.elementoId });
    }
  }

  if (ativos.includes("proximo")) {
    for (const segment of proximos) {
      if (indice.arcoIds.has(segment.elementoId)) continue;
      const point = nearestOnSegment(alvo, segment.a, segment.b);
      if (perto(point)) candidatos.push({ tipo: "proximo", ponto: point, elementoId: segment.elementoId });
    }
  }
  for (const element of vizinhanca.arcos) {
    if (!vale(element.id)) continue;
    // Todo ponto que o arco oferece (quadrante, tangente, mais próximo) está no círculo;
    // se o círculo passa longe do cursor, nenhum deles serve.
    if (Math.abs(distancia(element.centro, alvo) - element.raioMm) > tolerancia) continue;
    const onArc = (p: Ponto) => {
      const angle = ((Math.atan2(element.centro.y - p.y, p.x - element.centro.x) * 180 / Math.PI - element.inicioGraus) % 360 + 360) % 360;
      return angle <= element.varreduraGraus + 1e-9;
    };
    const add = (tipo: TipoEncaixe, point: Ponto) => { if (onArc(point) && perto(point)) candidatos.push({ tipo, ponto: point, elementoId: element.id }); };
    if (ativos.includes("quadrante")) {
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) add("quadrante", { x: element.centro.x + dx * element.raioMm, y: element.centro.y + dy * element.raioMm });
    }
    if (ativos.includes("tangente") && opcoes.origem) for (const point of tangentPoints(opcoes.origem, element.centro, element.raioMm)) add("tangente", point);
    if (ativos.includes("proximo")) {
      const dx = alvo.x - element.centro.x, dy = alvo.y - element.centro.y, length = Math.hypot(dx, dy);
      if (length) add("proximo", { x: element.centro.x + dx / length * element.raioMm, y: element.centro.y + dy / length * element.raioMm });
    }
  }

  if (!candidatos.length) return naMalha;
  // Prioridade primeiro, distância como desempate: o extremo a 4 mm vence o meio a 2 mm,
  // porque é no extremo que a parede precisa fechar.
  candidatos.sort((um, outro) => {
    const ordem = TIPOS_ENCAIXE.indexOf(um.tipo) - TIPOS_ENCAIXE.indexOf(outro.tipo);
    return ordem !== 0 ? ordem : distancia(um.ponto, alvo) - distancia(outro.ponto, alvo);
  });
  return candidatos[0];
}

/** Trava ortogonal: prende o traço no horizontal ou no vertical, o que estiver mais
 *  perto. Parede quase reta é parede torta, e ninguém percebe olhando a tela. */
export function ortogonal(origem: Ponto, alvo: Ponto): Ponto {
  return Math.abs(alvo.x - origem.x) >= Math.abs(alvo.y - origem.y)
    ? { x: alvo.x, y: origem.y }
    : { x: origem.x, y: alvo.y };
}

// ## Entrada por teclado
//
// Quatro formas, todas as que se usa na prática:
//
//   3150          comprimento na direção em que o cursor está
//   3150<90       comprimento e ângulo em graus
//   @3000,1500    deslocamento relativo, em x e y
//   3,15m         qualquer das anteriores aceita unidade e vírgula decimal
//
// O ângulo é o do desenho técnico: 0° para a direita, crescendo no sentido anti-horário.
// Na tela o eixo Y aponta para baixo, então 90° sobe — a conversão fica aqui, uma vez só.

const FATOR: Record<string, number> = { mm: 1, cm: 10, m: 1000, "": 1 };

export function lerMedida(texto: string): number | null {
  const limpo = texto.trim().toLowerCase().replace(/\s+/g, "");
  const casado = /^(-?\d+(?:[.,]\d+)?)(mm|cm|m)?$/.exec(limpo);
  if (!casado) return null;
  const numero = Number.parseFloat(casado[1].replace(",", "."));
  if (!Number.isFinite(numero)) return null;
  return numero * FATOR[casado[2] ?? ""];
}

export type EntradaResolvida = { ponto: Ponto; comprimentoMm: number; anguloGraus: number };

/**
 * Converte o que foi digitado no ponto de destino, a partir da origem do traço.
 *
 * `direcao` é para onde o cursor está apontando e só é usada quando a pessoa digita
 * apenas o comprimento — é o atalho mais usado: apontar e dizer quanto.
 */
export function resolverEntrada(origem: Ponto, texto: string, direcao?: Ponto | null): EntradaResolvida | null {
  const limpo = texto.trim().toLowerCase().replace(/\s+/g, "");
  if (!limpo) return null;

  const montar = (destino: Ponto): EntradaResolvida => {
    const ponto = preciso(destino);
    const dx = ponto.x - origem.x;
    const dy = ponto.y - origem.y;
    return {
      ponto,
      comprimentoMm: Math.hypot(dx, dy),
      // De volta ao ângulo do desenho técnico, com o eixo Y desinvertido.
      anguloGraus: ((Math.atan2(-dy, dx) * 180 / Math.PI % 360) + 360) % 360,
    };
  };

  if (limpo.startsWith("@")) {
    const partes = limpo.slice(1).split(/[;,]/);
    if (partes.length !== 2) return null;
    // Vírgula é separador aqui, então a decimal do par relativo é o ponto. Aceitar os
    // dois papéis para a vírgula na mesma expressão tornaria "@1,5,2" ambíguo.
    const dx = lerMedida(partes[0].replace(",", "."));
    const dy = lerMedida(partes[1].replace(",", "."));
    if (dx === null || dy === null) return null;
    return montar({ x: origem.x + dx, y: origem.y - dy });
  }

  const comAngulo = limpo.split("<");
  if (comAngulo.length === 2) {
    const comprimento = lerMedida(comAngulo[0]);
    const graus = Number(comAngulo[1].replace(",", "."));
    if (comprimento === null || !Number.isFinite(graus)) return null;
    const radianos = graus * Math.PI / 180;
    return montar({
      x: origem.x + comprimento * Math.cos(radianos),
      y: origem.y - comprimento * Math.sin(radianos),
    });
  }

  const comprimento = lerMedida(limpo);
  if (comprimento === null) return null;
  const dx = (direcao?.x ?? origem.x + 1) - origem.x;
  const dy = (direcao?.y ?? origem.y) - origem.y;
  const modulo = Math.hypot(dx, dy);
  // Sem direção utilizável, o traço sai para a direita: é o padrão de todo CAD e não
  // deixa a digitação sem resposta.
  if (modulo === 0) return montar({ x: origem.x + comprimento, y: origem.y });
  return montar({ x: origem.x + dx / modulo * comprimento, y: origem.y + dy / modulo * comprimento });
}

/** Move um vértice de um cômodo ou traço, sem tocar nos outros. Refazer o cômodo inteiro
 *  para corrigir um canto é o que faz ninguém corrigir o canto. */
export function moverVertice(elemento: Elemento, indice: number, destino: Ponto): Elemento {
  if (elemento.tipo === "parede" || elemento.tipo === "cota") {
    return indice === 0 ? { ...elemento, a: preciso(destino) } : indice === 1 ? { ...elemento, b: preciso(destino) } : elemento;
  }
  if (elemento.tipo !== "comodo" && elemento.tipo !== "traco") return elemento;
  if (indice < 0 || indice >= elemento.pontos.length) return elemento;
  const ultimo = elemento.pontos.length - 1;
  const fechado = elemento.tipo === "traco" && elemento.pontos[0].x === elemento.pontos[ultimo].x && elemento.pontos[0].y === elemento.pontos[ultimo].y;
  const pontos = elemento.pontos.map((ponto, i) => i === indice || (fechado && (indice === 0 || indice === ultimo) && (i === 0 || i === ultimo)) ? preciso(destino) : ponto);
  return { ...elemento, pontos };
}

/** Alças editáveis; o fechamento repetido de uma polilinha usa uma única alça. */
export function verticesDe(elemento: Elemento): { indice: number; ponto: Ponto }[] {
  if (elemento.tipo === "parede" || elemento.tipo === "cota") return [{ indice: 0, ponto: elemento.a }, { indice: 1, ponto: elemento.b }];
  if (elemento.tipo !== "comodo" && elemento.tipo !== "traco") return [];
  const pontos = elemento.pontos;
  const fechado = elemento.tipo === "traco" && pontos[0].x === pontos.at(-1)!.x && pontos[0].y === pontos.at(-1)!.y;
  return (fechado ? pontos.slice(0, -1) : pontos).map((ponto, indice) => ({ indice, ponto }));
}

// ## Paralela
//
// Desenhar a face interna de uma parede de 15 cm medindo 150 mm em cada canto é trabalho
// de escriba. A paralela resolve num comando, e é a operação que transforma um eixo de
// parede em parede com duas faces.
//
// O método é o clássico: desloca cada segmento pela normal e cruza as retas vizinhas para
// achar o canto novo. Em polígono bem-comportado — que é o que uma planta tem — sai
// exato. Em canto muito fechado a emenda dispara para longe, e aí ela é cortada: um
// espeto de dez metros saindo de um cômodo é pior do que um canto levemente arredondado.

const LIMITE_EMENDA = 6;

/** Normal unitária do segmento, apontando para a esquerda de quem caminha de `a` para
 *  `b`. Distância positiva vai para esse lado; negativa, para o outro. */
function normal(a: Ponto, b: Ponto): Ponto | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const modulo = Math.hypot(dx, dy);
  if (modulo === 0) return null;
  return { x: dy / modulo, y: -dx / modulo };
}

/** Cruzamento das RETAS que contêm os dois segmentos — inclusive no prolongamento.
 *  Diferente de `interseccao`, que só aceita o cruzamento dentro dos dois: aqui o
 *  prolongamento é exatamente o que forma o canto da paralela. */
function cruzamentoDeRetas(um: Segmento, outro: Segmento): Ponto | null {
  const r = { x: um.b.x - um.a.x, y: um.b.y - um.a.y };
  const s = { x: outro.b.x - outro.a.x, y: outro.b.y - outro.a.y };
  const denominador = r.x * s.y - r.y * s.x;
  if (Math.abs(denominador) < 1e-9) return null;
  const diferenca = { x: outro.a.x - um.a.x, y: outro.a.y - um.a.y };
  const t = (diferenca.x * s.y - diferenca.y * s.x) / denominador;
  return { x: um.a.x + t * r.x, y: um.a.y + t * r.y };
}

/** Polilinha deslocada. `fechada` liga o último ponto ao primeiro, como num cômodo. */
export function paralelaDePolilinha(pontos: Ponto[], distanciaMm: number, fechada: boolean): Ponto[] | null {
  const limpos = pontos.filter((ponto, i, todos) => i === 0 || ponto.x !== todos[i - 1].x || ponto.y !== todos[i - 1].y);
  if (limpos.length < 2 || distanciaMm === 0) return null;

  const deslocados: Segmento[] = [];
  const quantos = fechada ? limpos.length : limpos.length - 1;
  for (let i = 0; i < quantos; i += 1) {
    const a = limpos[i];
    const b = limpos[(i + 1) % limpos.length];
    const n = normal(a, b);
    if (!n) continue;
    deslocados.push({
      a: { x: a.x + n.x * distanciaMm, y: a.y + n.y * distanciaMm },
      b: { x: b.x + n.x * distanciaMm, y: b.y + n.y * distanciaMm },
      elementoId: "",
    });
  }
  if (!deslocados.length) return null;

  const saida: Ponto[] = [];
  const emenda = (anterior: Segmento, proximo: Segmento, recuo: Ponto) => {
    const cruzamento = cruzamentoDeRetas(anterior, proximo);
    // Canto fechado demais joga o cruzamento longe: aí vale mais cortar e aceitar o
    // pequeno chanfro do que deixar um espeto atravessando o desenho.
    if (!cruzamento || distancia(cruzamento, recuo) > Math.abs(distanciaMm) * LIMITE_EMENDA) return recuo;
    return cruzamento;
  };

  if (!fechada) saida.push(preciso(deslocados[0].a));
  for (let i = 0; i < deslocados.length; i += 1) {
    const atual = deslocados[i];
    const seguinte = deslocados[(i + 1) % deslocados.length];
    if (!fechada && i === deslocados.length - 1) { saida.push(preciso(atual.b)); break; }
    saida.push(preciso(emenda(atual, seguinte, atual.b)));
  }
  if (fechada && saida.length) {
    // No fechado o primeiro canto é o cruzamento do último com o primeiro, que acabou de
    // ser calculado: basta girar a lista para ela começar onde o original começa.
    saida.unshift(saida.pop()!);
  }
  return saida.length >= 2 ? saida : null;
}

/**
 * Paralela de um elemento, à distância dada em milímetros.
 *
 * O sinal escolhe o lado: positivo para a esquerda de quem percorre o desenho no sentido
 * em que ele foi feito, negativo para a direita. O `id` fica vazio — quem chama dá um
 * novo, porque dois elementos com o mesmo identificador se apagam mutuamente.
 *
 * Devolve `null` quando a operação não faz sentido para aquele tipo, em vez de inventar
 * um resultado: cota e texto não têm paralela.
 */
export function paralelaDe(elemento: Elemento, distanciaMm: number): Elemento | null {
  if (!Number.isFinite(distanciaMm) || distanciaMm === 0) return null;
  const distancia = distanciaMm;
  switch (elemento.tipo) {
    case "parede": {
      const n = normal(elemento.a, elemento.b);
      if (!n) return null;
      return {
        ...elemento,
        a: preciso({ x: elemento.a.x + n.x * distancia, y: elemento.a.y + n.y * distancia }),
        b: preciso({ x: elemento.b.x + n.x * distancia, y: elemento.b.y + n.y * distancia }),
      };
    }
    case "comodo": {
      const pontos = paralelaDePolilinha(elemento.pontos, distancia, true);
      return pontos && pontos.length >= 3 ? { ...elemento, pontos } : null;
    }
    case "traco": {
      const primeiro = elemento.pontos[0], ultimo = elemento.pontos.at(-1)!;
      const fechada = primeiro.x === ultimo.x && primeiro.y === ultimo.y;
      const pontos = paralelaDePolilinha(fechada ? elemento.pontos.slice(0, -1) : elemento.pontos, distancia, fechada);
      return pontos ? { ...elemento, pontos: fechada ? [...pontos, pontos[0]] : pontos } : null;
    }
    case "arco": {
      // Paralela de arco é arco concêntrico. O sinal segue a mesma convenção: positivo
      // para fora só quando o arco é percorrido no sentido anti-horário.
      const raioMm = elemento.raioMm - distancia;
      if (raioMm < 1) return null;
      return { ...elemento, raioMm };
    }
    default:
      return null;
  }
}

/** Dobra a parede: devolve as duas faces de uma parede desenhada pelo eixo. É o que
 *  transforma um traço de estudo em parede com espessura desenhada. */
export function facesDaParede(elemento: Elemento): [Elemento, Elemento] | null {
  if (elemento.tipo !== "parede") return null;
  const meia = elemento.espessuraMm / 2;
  const um = paralelaDe(elemento, meia);
  const outro = paralelaDe(elemento, -meia);
  return um && outro ? [um, outro] : null;
}

// ## Editar sem redesenhar
//
// Espelhar, repetir e aparar são o que faz um desenho crescer sem crescer o trabalho.
// Uma fachada simétrica desenhada duas vezes tem duas chances de erro; um pilar copiado
// vinte vezes à mão tem vinte. E parede que passa do canto é o defeito mais comum de
// planta feita às pressas — aparar existe para isso.

/** Reflexão de um ponto no eixo que passa por `a` e `b`. */
function refletir(ponto: Ponto, a: Ponto, b: Ponto): Ponto | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const modulo = Math.hypot(dx, dy);
  if (modulo === 0) return null;
  const ux = dx / modulo;
  const uy = dy / modulo;
  const vx = ponto.x - a.x;
  const vy = ponto.y - a.y;
  const projecao = vx * ux + vy * uy;
  return preciso({
    x: a.x + 2 * projecao * ux - vx,
    y: a.y + 2 * projecao * uy - vy,
  });
}

const normalizarGraus = (graus: number) => ((graus % 360) + 360) % 360;

/**
 * Espelha um elemento no eixo dado por dois pontos.
 *
 * O giro acompanha: espelhar inverte a mão do desenho, e um símbolo refletido que
 * mantivesse o mesmo ângulo apontaria para o lado errado. O `id` é o do original — quem
 * chama dá um novo, porque dois elementos com o mesmo identificador se apagam.
 */
export function espelhar(elemento: Elemento, a: Ponto, b: Ponto): Elemento | null {
  const espelho = (ponto: Ponto) => refletir(ponto, a, b);
  const anguloDoEixo = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  // O giro guardado é o da tela (horário, Y para baixo); o do eixo, calculado acima,
  // também. Refletir um ângulo no eixo é `2α − θ`, e as duas medidas precisam estar na
  // mesma convenção para essa conta valer.
  const giroEspelhado = (graus: number) => normalizarGraus(2 * anguloDoEixo - graus);

  switch (elemento.tipo) {
    case "parede":
    case "cota": {
      const pa = espelho(elemento.a);
      const pb = espelho(elemento.b);
      return pa && pb ? { ...elemento, a: pa, b: pb } : null;
    }
    case "comodo":
    case "traco": {
      const pontos = elemento.pontos.map(espelho);
      if (pontos.some((ponto) => !ponto)) return null;
      // A ordem inverte junto: espelhar um polígono sem inverter o sentido deixaria a
      // face dele virada para dentro, e a paralela sairia para o lado errado depois.
      return { ...elemento, pontos: (pontos as Ponto[]).reverse() };
    }
    case "arco": {
      const centro = espelho(elemento.centro);
      if (!centro) return null;
      // Espelhado, o arco passa a ser percorrido ao contrário. Para continuar guardado
      // como varredura positiva, ele recomeça onde terminava.
      return {
        ...elemento,
        centro,
        inicioGraus: normalizarGraus(-(2 * anguloDoEixo + elemento.inicioGraus + elemento.varreduraGraus)),
      };
    }
    case "hachura": {
      const aneis = elemento.aneis.map((anel) => anel.map(espelho));
      if (aneis.some((anel) => anel.some((ponto) => !ponto))) return null;
      return { ...elemento, aneis: aneis.map((anel) => (anel as Ponto[]).reverse()) };
    }
    case "texto": {
      // Texto espelhado continua legível (MIRRTEXT 0 do AutoCAD): a caixa do texto é
      // refletida, mas as letras não. Das duas direções da reta refletida vale a que lê da
      // esquerda para a direita; a âncora troca de lado para o texto ocupar a caixa
      // refletida, não a original.
      const posicao = espelho(elemento.posicao);
      if (!posicao) return null;
      const refletido = giroEspelhado(elemento.rotacaoGraus);
      const legivel = Math.cos(refletido * Math.PI / 180) > 1e-9 || (Math.abs(Math.cos(refletido * Math.PI / 180)) <= 1e-9 && Math.sin(refletido * Math.PI / 180) < 0);
      const rotacaoGraus = legivel ? refletido : normalizarGraus(refletido + 180);
      const { ancoraH: h, ancoraV: v, ...resto } = elemento;
      const ancoraH = legivel ? h : h === "fim" ? undefined : h === "meio" ? "meio" : "fim";
      const ancoraV = legivel ? (v === "topo" ? undefined : v === "meio" ? "meio" : "topo") : v;
      return { ...resto, posicao, rotacaoGraus, ...(ancoraH && ancoraH !== "inicio" ? { ancoraH } : {}), ...(ancoraV && ancoraV !== "base" ? { ancoraV } : {}) };
    }
    default: {
      const posicao = espelho(elemento.posicao);
      if (!posicao) return null;
      return { ...elemento, posicao, rotacaoGraus: giroEspelhado(elemento.rotacaoGraus) };
    }
  }
}

export type Matriz = { colunas: number; linhas: number; passoXMm: number; passoYMm: number };

/**
 * Cópias de um elemento em matriz retangular.
 *
 * Devolve SÓ as cópias — o original continua onde está, e somá-lo aqui faria a contagem
 * dobrar toda vez que alguém repetisse o comando. Cada cópia recebe o identificador que
 * `novoId` devolver; sem ele todas nasceriam com o mesmo e se apagariam entre si.
 */
export function matrizRetangular(elemento: Elemento, matriz: Matriz, novoId: () => string): Elemento[] {
  const colunas = Math.round(matriz.colunas);
  const linhas = Math.round(matriz.linhas);
  if (!Number.isFinite(colunas) || !Number.isFinite(linhas) || colunas < 1 || linhas < 1) return [];
  if (colunas * linhas > 400) return []; // Quatrocentas cópias já é o limite do que alguém revisa.
  const passoX = matriz.passoXMm;
  const passoY = matriz.passoYMm;
  if (!Number.isFinite(passoX) || !Number.isFinite(passoY)) return [];
  if (colunas > 1 && passoX === 0) return []; // Cópias empilhadas no mesmo lugar.
  if (linhas > 1 && passoY === 0) return [];

  const copias: Elemento[] = [];
  for (let linha = 0; linha < linhas; linha += 1) {
    for (let coluna = 0; coluna < colunas; coluna += 1) {
      if (linha === 0 && coluna === 0) continue;
      // Malha 1 no deslocamento: a matriz já é exata por construção, e reencaixar cada
      // cópia na malha do documento desalinharia as colunas quando o passo não fosse
      // múltiplo dela.
      copias.push({ ...moverElemento(elemento, coluna * passoX, linha * passoY, 1), id: novoId() });
    }
  }
  return copias;
}

// ## Aparar e estender
//
// Como no AutoCAD: aponta-se o PEDAÇO que deve sumir, e ele some entre os dois cortes
// mais próximos do clique (ou até a ponta, quando só há corte de um lado). Uma polilinha
// cortada no meio vira duas; um círculo cortado em dois pontos vira arco. O vizinho do
// trecho aparado não se mexe — antes, aparar perto de um vértice arrastava o segmento
// anterior junto.

/** Limite de corte: um segmento ou um arco (círculo com varredura 360). Ângulos na
 *  convenção do desenho técnico, como o elemento `arco`. */
export type Limite =
  | { tipo: "segmento"; a: Ponto; b: Ponto; elementoId: string }
  | { tipo: "arco"; centro: Ponto; raio: number; inicio: number; varredura: number; elementoId: string };

const EPS = 1e-6;
const grausDe = (centro: Ponto, p: Ponto) => ((Math.atan2(-(p.y - centro.y), p.x - centro.x) * 180 / Math.PI) % 360 + 360) % 360;
/** Posição angular dentro do arco, de 0 à varredura; fora dele, negativo. */
function noArco(limite: { inicio: number; varredura: number }, graus: number) {
  const relativo = ((graus - limite.inicio) % 360 + 360) % 360;
  if (limite.varredura >= 360) return relativo;
  return relativo <= limite.varredura + 1e-7 ? relativo : relativo >= 360 - 1e-7 ? 0 : -1;
}

/** Cruzamentos da reta a→b (parâmetro t: 0 em a, 1 em b) com um limite. `u` diz se caiu
 *  dentro do limite. */
function cruzamentosDaReta(a: Ponto, b: Ponto, limite: Limite): number[] {
  const r = { x: b.x - a.x, y: b.y - a.y };
  if (limite.tipo === "segmento") {
    const s = { x: limite.b.x - limite.a.x, y: limite.b.y - limite.a.y };
    const den = r.x * s.y - r.y * s.x;
    if (Math.abs(den) < 1e-12) return [];
    const d = { x: limite.a.x - a.x, y: limite.a.y - a.y };
    const t = (d.x * s.y - d.y * s.x) / den, u = (d.x * r.y - d.y * r.x) / den;
    return u >= -EPS && u <= 1 + EPS ? [t] : [];
  }
  const f = { x: a.x - limite.centro.x, y: a.y - limite.centro.y };
  const A = r.x * r.x + r.y * r.y, B = 2 * (f.x * r.x + f.y * r.y), C = f.x * f.x + f.y * f.y - limite.raio * limite.raio;
  const disc = B * B - 4 * A * C;
  if (A === 0 || disc < 0) return [];
  const raiz = Math.sqrt(disc);
  return [(-B - raiz) / (2 * A), (-B + raiz) / (2 * A)]
    .filter((t, i, lista) => i === 0 || Math.abs(t - lista[0]) > 1e-12)
    .filter((t) => noArco(limite, grausDe(limite.centro, { x: a.x + r.x * t, y: a.y + r.y * t })) >= 0);
}

/** Cruzamentos de um círculo (centro, raio) com um limite, em graus do desenho técnico. */
function cruzamentosDoCirculo(centro: Ponto, raio: number, limite: Limite): number[] {
  if (limite.tipo === "segmento") {
    const r = { x: limite.b.x - limite.a.x, y: limite.b.y - limite.a.y };
    const f = { x: limite.a.x - centro.x, y: limite.a.y - centro.y };
    const A = r.x * r.x + r.y * r.y, B = 2 * (f.x * r.x + f.y * r.y), C = f.x * f.x + f.y * f.y - raio * raio;
    const disc = B * B - 4 * A * C;
    if (A === 0 || disc < 0) return [];
    const raiz = Math.sqrt(disc);
    return [(-B - raiz) / (2 * A), (-B + raiz) / (2 * A)]
      .filter((t) => t >= -EPS && t <= 1 + EPS)
      .map((t) => grausDe(centro, { x: limite.a.x + r.x * t, y: limite.a.y + r.y * t }));
  }
  const dx = limite.centro.x - centro.x, dy = limite.centro.y - centro.y, d = Math.hypot(dx, dy);
  if (d < EPS || d > raio + limite.raio + EPS || d < Math.abs(raio - limite.raio) - EPS) return [];
  const a = (raio * raio - limite.raio * limite.raio + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, raio * raio - a * a));
  const m = { x: centro.x + dx * a / d, y: centro.y + dy * a / d };
  return [{ x: m.x + h * dy / d, y: m.y - h * dx / d }, { x: m.x - h * dy / d, y: m.y + h * dx / d }]
    .filter((p) => noArco(limite, grausDe(limite.centro, p)) >= 0)
    .map((p) => grausDe(centro, p));
}

/** Limites de corte do desenho: tudo que está visível, menos o próprio alvo. Texto,
 *  símbolo e hachura não cortam — no papel eles não são aresta. */
export function limitesDeCorte(documento: Documento, excetoId?: string): Limite[] {
  const saida: Limite[] = [];
  for (const elemento of elementosVisiveis(documento)) {
    if (elemento.id === excetoId) continue;
    if (elemento.tipo === "parede") saida.push({ tipo: "segmento", a: elemento.a, b: elemento.b, elementoId: elemento.id });
    else if (elemento.tipo === "traco" || elemento.tipo === "comodo") {
      const pontos = elemento.pontos;
      const n = elemento.tipo === "comodo" ? pontos.length : pontos.length - 1;
      for (let i = 0; i < n; i += 1) saida.push({ tipo: "segmento", a: pontos[i], b: pontos[(i + 1) % pontos.length], elementoId: elemento.id });
    } else if (elemento.tipo === "arco") {
      saida.push({ tipo: "arco", centro: elemento.centro, raio: elemento.raioMm, inicio: elemento.inicioGraus, varredura: elemento.varreduraGraus, elementoId: elemento.id });
    }
  }
  return saida;
}

type Caminho = { pontos: Ponto[]; fechado: boolean; acumulado: number[] };

function caminhoDe(elemento: Elemento): Caminho | null {
  const pontos = elemento.tipo === "parede" ? [elemento.a, elemento.b] : elemento.tipo === "traco" ? elemento.pontos : null;
  if (!pontos || pontos.length < 2) return null;
  const primeiro = pontos[0], ultimo = pontos.at(-1)!;
  const fechado = elemento.tipo === "traco" && pontos.length > 3 && primeiro.x === ultimo.x && primeiro.y === ultimo.y;
  const acumulado = [0];
  for (let i = 1; i < pontos.length; i += 1) acumulado.push(acumulado[i - 1] + distancia(pontos[i - 1], pontos[i]));
  return { pontos, fechado, acumulado };
}

function pontoNoCaminho(caminho: Caminho, s: number): Ponto {
  const { pontos, acumulado } = caminho;
  if (s <= 0) return pontos[0];
  for (let i = 1; i < pontos.length; i += 1) {
    if (s <= acumulado[i] + EPS) {
      const trecho = acumulado[i] - acumulado[i - 1] || 1;
      const t = Math.min(1, Math.max(0, (s - acumulado[i - 1]) / trecho));
      return preciso({ x: pontos[i - 1].x + (pontos[i].x - pontos[i - 1].x) * t, y: pontos[i - 1].y + (pontos[i].y - pontos[i - 1].y) * t });
    }
  }
  return pontos.at(-1)!;
}

/** Trecho do caminho entre dois comprimentos (de < ate), com os vértices do meio. */
function trechoDoCaminho(caminho: Caminho, de: number, ate: number): Ponto[] {
  const saida = [pontoNoCaminho(caminho, de)];
  for (let i = 1; i < caminho.pontos.length - 1; i += 1) if (caminho.acumulado[i] > de + EPS && caminho.acumulado[i] < ate - EPS) saida.push(caminho.pontos[i]);
  saida.push(pontoNoCaminho(caminho, ate));
  return saida.filter((p, i, l) => i === 0 || p.x !== l[i - 1].x || p.y !== l[i - 1].y);
}

function comprimentoNoClique(caminho: Caminho, clique: Ponto) {
  let melhor = 0, menor = Infinity;
  for (let i = 1; i < caminho.pontos.length; i += 1) {
    const a = caminho.pontos[i - 1], b = caminho.pontos[i];
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((clique.x - a.x) * dx + (clique.y - a.y) * dy) / l2)) : 0;
    const d = Math.hypot(a.x + dx * t - clique.x, a.y + dy * t - clique.y);
    if (d < menor) { menor = d; melhor = caminho.acumulado[i - 1] + Math.sqrt(l2) * t; }
  }
  return melhor;
}

function comPontos(elemento: Elemento, pontos: Ponto[]): Elemento | null {
  if (pontos.length < 2) return null;
  const total = pontos.slice(1).reduce((soma, p, i) => soma + distancia(pontos[i], p), 0);
  if (total < 1e-3) return null;
  if (elemento.tipo === "parede") return { ...elemento, a: pontos[0], b: pontos.at(-1)! };
  if (elemento.tipo === "traco") return { ...elemento, pontos };
  return null;
}

/**
 * Apara o trecho clicado entre os cortes vizinhos. Devolve os pedaços que ficam (um ou
 * dois; o primeiro mantém o identificador do original) ou `null` quando nada corta ali.
 */
export function apararElemento(elemento: Elemento, limites: Limite[], clique: Ponto): Elemento[] | null {
  if (elemento.tipo === "arco") return apararArco(elemento, limites, clique);
  const caminho = caminhoDe(elemento);
  if (!caminho) return null;
  const total = caminho.acumulado.at(-1)!;
  const cortes: number[] = [];
  for (let i = 1; i < caminho.pontos.length; i += 1) {
    const a = caminho.pontos[i - 1], b = caminho.pontos[i], trecho = caminho.acumulado[i] - caminho.acumulado[i - 1];
    if (!trecho) continue;
    for (const limite of limites) {
      if (limite.elementoId === elemento.id) continue;
      for (const t of cruzamentosDaReta(a, b, limite)) if (t >= -EPS && t <= 1 + EPS) cortes.push(caminho.acumulado[i - 1] + Math.max(0, Math.min(1, t)) * trecho);
    }
  }
  // Corte na própria ponta não divide nada: é onde o traço já termina.
  const uteis = cortes.filter((s) => (caminho.fechado || (s > 1e-3 && s < total - 1e-3))).sort((x, y) => x - y);
  if (!uteis.length) return null;
  const s = comprimentoNoClique(caminho, clique);
  const antes = uteis.filter((c) => c < s - EPS).at(-1), depois = uteis.find((c) => c > s + EPS);
  if (caminho.fechado) {
    if (uteis.length < 2) return null;
    // No fechado, o que sobra é o caminho do corte seguinte até o anterior, dando a volta.
    const de = depois ?? uteis[0], ate = antes ?? uteis.at(-1)!;
    const pontos = de < ate ? trechoDoCaminho(caminho, de, ate)
      : [...trechoDoCaminho(caminho, de, total), ...trechoDoCaminho(caminho, 0, ate).slice(1)];
    const resto = comPontos(elemento, pontos);
    return resto ? [resto] : [];
  }
  if (antes === undefined && depois === undefined) return null;
  const pedacos: Elemento[] = [];
  if (antes !== undefined) { const p = comPontos(elemento, trechoDoCaminho(caminho, 0, antes)); if (p) pedacos.push(p); }
  if (depois !== undefined) { const p = comPontos(elemento, trechoDoCaminho(caminho, depois, total)); if (p) pedacos.push(pedacos.length ? { ...p, id: "" } : p); }
  return pedacos;
}

function apararArco(arco: Extract<Elemento, { tipo: "arco" }>, limites: Limite[], clique: Ponto): Elemento[] | null {
  const cortes: number[] = [];
  for (const limite of limites) {
    if (limite.elementoId === arco.id) continue;
    for (const graus of cruzamentosDoCirculo(arco.centro, arco.raioMm, limite)) {
      const posicao = noArco({ inicio: arco.inicioGraus, varredura: arco.varreduraGraus }, graus);
      if (posicao >= 0) cortes.push(posicao);
    }
  }
  const circulo = arco.varreduraGraus >= 360;
  const uteis = [...new Set(cortes.map((c) => Math.round(c * 1e6) / 1e6))]
    .filter((c) => circulo || (c > 1e-6 && c < arco.varreduraGraus - 1e-6)).sort((x, y) => x - y);
  if (!uteis.length || (circulo && uteis.length < 2)) return null;
  const alvo = noArco({ inicio: arco.inicioGraus, varredura: arco.varreduraGraus }, grausDe(arco.centro, clique));
  const s = alvo < 0 ? 0 : alvo;
  const antes = uteis.filter((c) => c < s).at(-1), depois = uteis.find((c) => c > s);
  const novo = (de: number, varredura: number, id: string): Elemento | null => varredura < 1e-6 ? null
    : { ...arco, id, inicioGraus: normalizarGraus(Math.round((arco.inicioGraus + de) * 1e6) / 1e6) % 360, varreduraGraus: Math.min(360, Math.round(varredura * 1e6) / 1e6) };
  if (circulo) {
    const de = depois ?? uteis[0], ate = antes ?? uteis.at(-1)!;
    const resto = novo(de, ((ate - de) % 360 + 360) % 360, arco.id);
    return resto ? [resto] : [];
  }
  if (antes === undefined && depois === undefined) return null;
  const pedacos: Elemento[] = [];
  if (antes !== undefined) { const p = novo(0, antes, arco.id); if (p) pedacos.push(p); }
  if (depois !== undefined) { const p = novo(depois, arco.varreduraGraus - depois, pedacos.length ? "" : arco.id); if (p) pedacos.push(p); }
  return pedacos;
}

/** Estende a ponta mais perto do clique até o primeiro limite no caminho dela. */
export function estenderElemento(elemento: Elemento, limites: Limite[], clique: Ponto): Elemento | null {
  const caminho = caminhoDe(elemento);
  if (!caminho || caminho.fechado) return null;
  const pontos = caminho.pontos;
  const noFim = distancia(clique, pontos.at(-1)!) < distancia(clique, pontos[0]);
  const ponta = noFim ? pontos.at(-1)! : pontos[0], vizinho = noFim ? pontos.at(-2)! : pontos[1];
  if (ponta.x === vizinho.x && ponta.y === vizinho.y) return null;
  let melhor: number | null = null;
  for (const limite of limites) {
    if (limite.elementoId === elemento.id) continue;
    // Parâmetro da reta vizinho→ponta: 1 é a ponta; além de 1 é o prolongamento.
    for (const t of cruzamentosDaReta(vizinho, ponta, limite)) if (t > 1 + 1e-9 && (melhor === null || t < melhor)) melhor = t;
  }
  if (melhor === null) return null;
  const destino = preciso({ x: vizinho.x + (ponta.x - vizinho.x) * melhor, y: vizinho.y + (ponta.y - vizinho.y) * melhor });
  const novos = noFim ? [...pontos.slice(0, -1), destino] : [destino, ...pontos.slice(1)];
  return comPontos(elemento, novos);
}

/**
 * Quebra (BREAK do AutoCAD): tira o trecho entre dois pontos do elemento e devolve os
 * pedaços que ficam — o primeiro com o identificador do original, os outros com "".
 * Com os dois pontos iguais, divide ali sem tirar nada. No círculo e na polilinha
 * fechada some o trecho que vai do primeiro ao segundo ponto no sentido do traçado
 * (anti-horário no círculo), como no AutoCAD.
 */
export function quebrarElemento(elemento: Elemento, p1: Ponto, p2: Ponto): Elemento[] | null {
  if (elemento.tipo === "arco") {
    const limite = { inicio: elemento.inicioGraus, varredura: elemento.varreduraGraus };
    const circulo = elemento.varreduraGraus >= 360;
    const posicao = (p: Ponto) => {
      const s = noArco(limite, grausDe(elemento.centro, p));
      if (s >= 0) return s;
      // Fora do arco: vale a ponta mais perto do clique.
      const pontos = pontosDoArco(elemento);
      return distancia(p, pontos[0]) <= distancia(p, pontos.at(-1)!) ? 0 : elemento.varreduraGraus;
    };
    const novo = (de: number, varredura: number, id: string): Elemento | null => varredura < 1e-6 ? null
      : { ...elemento, id, inicioGraus: normalizarGraus(Math.round((elemento.inicioGraus + de) * 1e6) / 1e6) % 360, varreduraGraus: Math.min(360, Math.round(varredura * 1e6) / 1e6) };
    const s1 = posicao(p1), s2 = posicao(p2);
    if (circulo) {
      if (Math.abs(s1 - s2) < 1e-6) return null;
      const resto = novo(s2, ((s1 - s2) % 360 + 360) % 360, elemento.id);
      return resto ? [resto] : null;
    }
    const de = Math.min(s1, s2), ate = Math.max(s1, s2);
    const pedacos = [novo(0, de, elemento.id), novo(ate, elemento.varreduraGraus - ate, "")].filter((p): p is Elemento => !!p);
    if (!pedacos.length || (pedacos.length === 1 && de < 1e-6 && ate > elemento.varreduraGraus - 1e-6)) return null;
    return pedacos.map((pedaco, i) => ({ ...pedaco, id: i === 0 ? elemento.id : "" }) as Elemento);
  }
  const caminho = caminhoDe(elemento);
  if (!caminho) return null;
  const total = caminho.acumulado.at(-1)!;
  const s1 = comprimentoNoClique(caminho, p1), s2 = comprimentoNoClique(caminho, p2);
  if (caminho.fechado) {
    if (Math.abs(s1 - s2) < 1e-6) return null;
    const pontos = s1 < s2
      ? [...trechoDoCaminho(caminho, s2, total), ...trechoDoCaminho(caminho, 0, s1).slice(1)]
      : trechoDoCaminho(caminho, s2, s1);
    const resto = comPontos(elemento, pontos);
    return resto ? [resto] : null;
  }
  const de = Math.min(s1, s2), ate = Math.max(s1, s2);
  const pedacos: Elemento[] = [];
  if (de > 1e-3) { const p = comPontos(elemento, trechoDoCaminho(caminho, 0, de)); if (p) pedacos.push(p); }
  if (ate < total - 1e-3) { const p = comPontos(elemento, trechoDoCaminho(caminho, ate, total)); if (p) pedacos.push(pedacos.length ? { ...p, id: "" } as Elemento : p); }
  if (!pedacos.length) return null;
  // Quebra no próprio ponto, numa ponta: nada muda.
  if (pedacos.length === 1 && ate - de < 1e-6) return null;
  return pedacos;
}

const comoLimite = (cortante: Segmento): Limite => ({ tipo: "segmento", a: cortante.a, b: cortante.b, elementoId: cortante.elementoId });

/**
 * Apara o elemento no cortante, removendo o lado em que se clicou.
 *
 * Clicar no pedaço que sobra é como se apara em qualquer CAD, e é o gesto certo: a
 * pessoa aponta o que quer que suma, não o que quer que fique. Só parede e traço, e só
 * quando sobra um pedaço (a versão com vários limites é `apararElemento`).
 */
export function aparar(elemento: Elemento, cortante: Segmento, pontoClicado: Ponto): Elemento | null {
  if (elemento.tipo !== "parede" && elemento.tipo !== "traco") return null;
  const pedacos = apararElemento(elemento, [comoLimite(cortante)], pontoClicado);
  return pedacos && pedacos.length === 1 ? pedacos[0] : null;
}

/**
 * Estende o elemento até encontrar o cortante, pela ponta mais perto do clique.
 *
 * Só estende: se o encontro cair dentro do traço, o que a pessoa quer é aparar, e fazer
 * a coisa errada calada é pior do que não fazer nada.
 */
export function estender(elemento: Elemento, cortante: Segmento, pontoClicado: Ponto): Elemento | null {
  return estenderElemento(elemento, [comoLimite(cortante)], pontoClicado);
}
