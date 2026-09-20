import { Documento, Elemento, camadaBloqueada, elementosVisiveis, encaixar, moverElemento, pontosDoArco } from "@/lib/prancheta";
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
const inteiro = (ponto: Ponto): Ponto => ({ x: Math.round(ponto.x) || 0, y: Math.round(ponto.y) || 0 });

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
      ponto: inteiro({ x: (segmento.a.x + segmento.b.x) / 2, y: (segmento.a.y + segmento.b.y) / 2 }),
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
  return inteiro({ x: um.a.x + t * r.x, y: um.a.y + t * r.y });
}

/** Pé da perpendicular baixada de um ponto sobre o segmento. É o que faz uma parede nova
 *  encontrar a existente em ângulo reto sem ninguém calcular nada. */
export function pePerpendicular(origem: Ponto, segmento: Segmento): Ponto | null {
  const r = { x: segmento.b.x - segmento.a.x, y: segmento.b.y - segmento.a.y };
  const comprimentoQuadrado = r.x * r.x + r.y * r.y;
  if (comprimentoQuadrado === 0) return null;
  const t = ((origem.x - segmento.a.x) * r.x + (origem.y - segmento.a.y) * r.y) / comprimentoQuadrado;
  if (t < 0 || t > 1) return null;
  return inteiro({ x: segmento.a.x + t * r.x, y: segmento.a.y + t * r.y });
}

export type OpcoesEncaixe = {
  /** Raio de captura em milímetros de desenho. Vem do zoom: o que vale é a distância na
   *  tela, senão o encaixe fica impossível de acertar afastado e agressivo demais perto. */
  toleranciaMm: number;
  /** Ponto de onde o traço está saindo, quando há um. Só com ele existe perpendicular. */
  origem?: Ponto | null;
  ativos?: readonly TipoEncaixe[];
};

/**
 * O encaixe escolhido para uma posição do cursor.
 *
 * Nunca devolve nada: quando não há entidade por perto, cai na malha, que é o
 * comportamento anterior. Assim a ferramenta funciona igual em desenho vazio.
 */
export function encaixePerto(documento: Documento, alvo: Ponto, opcoes: OpcoesEncaixe): Encaixe {
  const ativos = opcoes.ativos ?? TIPOS_ENCAIXE;
  const tolerancia = Math.max(1, opcoes.toleranciaMm);
  const naMalha: Encaixe = {
    tipo: "malha",
    ponto: { x: encaixar(alvo.x, documento.malhaMm), y: encaixar(alvo.y, documento.malhaMm) },
  };
  if (!ativos.length) return naMalha;

  const candidatos: Encaixe[] = [];
  const perto = (ponto: Ponto) => distancia(ponto, alvo) <= tolerancia;

  for (const candidato of pontosNotaveis(documento)) {
    if (!ativos.includes(candidato.tipo)) continue;
    if (perto(candidato.ponto)) candidatos.push(candidato);
  }

  // Interseção e perpendicular custam mais, então só se olha o que passa perto do alvo.
  const proximos = ativos.includes("interseccao") || ativos.includes("perpendicular")
    ? segmentosDo(documento).filter((segmento) =>
      Math.min(segmento.a.x, segmento.b.x) - tolerancia <= alvo.x
      && Math.max(segmento.a.x, segmento.b.x) + tolerancia >= alvo.x
      && Math.min(segmento.a.y, segmento.b.y) - tolerancia <= alvo.y
      && Math.max(segmento.a.y, segmento.b.y) + tolerancia >= alvo.y)
    : [];

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
    for (const segment of segmentosDo(documento)) {
      const point = nearestOnSegment(alvo, segment.a, segment.b);
      if (perto(point)) candidatos.push({ tipo: "proximo", ponto: point, elementoId: segment.elementoId });
    }
  }
  for (const element of elementosVisiveis(documento)) {
    if (element.tipo !== "arco" || camadaBloqueada(documento, element.camada)) continue;
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
    const ponto = inteiro(destino);
    const dx = ponto.x - origem.x;
    const dy = ponto.y - origem.y;
    return {
      ponto,
      comprimentoMm: Math.round(Math.hypot(dx, dy)),
      // De volta ao ângulo do desenho técnico, com o eixo Y desinvertido.
      anguloGraus: ((Math.round(Math.atan2(-dy, dx) * 180 / Math.PI) % 360) + 360) % 360,
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
    const graus = Number.parseFloat(comAngulo[1].replace(",", "."));
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
  if (elemento.tipo !== "comodo" && elemento.tipo !== "traco") return elemento;
  if (indice < 0 || indice >= elemento.pontos.length) return elemento;
  const pontos = elemento.pontos.map((ponto, i) => i === indice ? inteiro(destino) : ponto);
  return { ...elemento, pontos };
}

/** Vértices que a tela deve oferecer para arrastar, com o índice de cada um. */
export function verticesDe(elemento: Elemento): { indice: number; ponto: Ponto }[] {
  if (elemento.tipo !== "comodo" && elemento.tipo !== "traco") return [];
  return elemento.pontos.map((ponto, indice) => ({ indice, ponto }));
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

  if (!fechada) saida.push(inteiro(deslocados[0].a));
  for (let i = 0; i < deslocados.length; i += 1) {
    const atual = deslocados[i];
    const seguinte = deslocados[(i + 1) % deslocados.length];
    if (!fechada && i === deslocados.length - 1) { saida.push(inteiro(atual.b)); break; }
    saida.push(inteiro(emenda(atual, seguinte, atual.b)));
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
  if (!Number.isFinite(distanciaMm) || Math.round(distanciaMm) === 0) return null;
  const distancia = Math.round(distanciaMm);
  switch (elemento.tipo) {
    case "parede": {
      const n = normal(elemento.a, elemento.b);
      if (!n) return null;
      return {
        ...elemento,
        a: inteiro({ x: elemento.a.x + n.x * distancia, y: elemento.a.y + n.y * distancia }),
        b: inteiro({ x: elemento.b.x + n.x * distancia, y: elemento.b.y + n.y * distancia }),
      };
    }
    case "comodo": {
      const pontos = paralelaDePolilinha(elemento.pontos, distancia, true);
      return pontos && pontos.length >= 3 ? { ...elemento, pontos } : null;
    }
    case "traco": {
      const pontos = paralelaDePolilinha(elemento.pontos, distancia, false);
      return pontos ? { ...elemento, pontos } : null;
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
  const meia = Math.round(elemento.espessuraMm / 2);
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
  return inteiro({
    x: a.x + 2 * projecao * ux - vx,
    y: a.y + 2 * projecao * uy - vy,
  });
}

const normalizarGraus = (graus: number) => ((Math.round(graus) % 360) + 360) % 360;

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
  const passoX = Math.round(matriz.passoXMm);
  const passoY = Math.round(matriz.passoYMm);
  if (!Number.isFinite(passoX) || !Number.isFinite(passoY)) return [];
  if (colunas > 1 && passoX === 0 && linhas === 1) return []; // Cópias empilhadas no mesmo lugar.
  if (linhas > 1 && passoY === 0 && colunas === 1) return [];

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

/** Onde a RETA que contém `a`–`b` cruza o segmento cortante. Devolve também a posição
 *  relativa `t` ao longo de `a`–`b`: `t < 0` é antes de `a`, `t > 1` é depois de `b`. */
function cruzamentoComCortante(a: Ponto, b: Ponto, cortante: Segmento): { ponto: Ponto; t: number } | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: cortante.b.x - cortante.a.x, y: cortante.b.y - cortante.a.y };
  const denominador = r.x * s.y - r.y * s.x;
  if (Math.abs(denominador) < 1e-9) return null;
  const diferenca = { x: cortante.a.x - a.x, y: cortante.a.y - a.y };
  const t = (diferenca.x * s.y - diferenca.y * s.x) / denominador;
  const u = (diferenca.x * r.y - diferenca.y * r.x) / denominador;
  // O corte precisa cair DENTRO do cortante: aparar contra o prolongamento de uma parede
  // que não chega ali cortaria num lugar onde não há nada desenhado.
  if (u < 0 || u > 1) return null;
  return { ponto: inteiro({ x: a.x + t * r.x, y: a.y + t * r.y }), t };
}

/** Qual segmento do elemento está mais perto do ponto, e o índice da ponta mais próxima. */
function segmentoMaisPerto(elemento: Elemento, ponto: Ponto) {
  const partes = elemento.tipo === "parede"
    ? [{ a: elemento.a, b: elemento.b, indice: 0 }]
    : elemento.tipo === "traco"
      ? elemento.pontos.slice(0, -1).map((a, indice) => ({ a, b: elemento.pontos[indice + 1], indice }))
      : [];
  if (!partes.length) return null;
  let melhor = partes[0];
  let menor = Infinity;
  for (const parte of partes) {
    const pe = pePerpendicular(ponto, { ...parte, elementoId: "" });
    const perto = pe ? distancia(pe, ponto) : Math.min(distancia(parte.a, ponto), distancia(parte.b, ponto));
    if (perto < menor) { menor = perto; melhor = parte; }
  }
  return melhor;
}

function comSegmentoTrocado(elemento: Elemento, indice: number, a: Ponto, b: Ponto): Elemento | null {
  if (a.x === b.x && a.y === b.y) return null; // Segmento de comprimento zero não é traço.
  if (elemento.tipo === "parede") return { ...elemento, a, b };
  if (elemento.tipo === "traco") {
    const pontos = [...elemento.pontos];
    pontos[indice] = a;
    pontos[indice + 1] = b;
    return { ...elemento, pontos };
  }
  return null;
}

/**
 * Apara o elemento no cortante, removendo o lado em que se clicou.
 *
 * Clicar no pedaço que sobra é como se apara em qualquer CAD, e é o gesto certo: a
 * pessoa aponta o que quer que suma, não o que quer que fique.
 */
export function aparar(elemento: Elemento, cortante: Segmento, pontoClicado: Ponto): Elemento | null {
  const parte = segmentoMaisPerto(elemento, pontoClicado);
  if (!parte) return null;
  const cruzamento = cruzamentoComCortante(parte.a, parte.b, cortante);
  // Fora de 0..1 o corte cairia fora do traço: não há o que aparar.
  if (!cruzamento || cruzamento.t <= 0 || cruzamento.t >= 1) return null;
  const distanciaA = distancia(parte.a, pontoClicado);
  const distanciaB = distancia(parte.b, pontoClicado);
  return distanciaA < distanciaB
    ? comSegmentoTrocado(elemento, parte.indice, cruzamento.ponto, parte.b)
    : comSegmentoTrocado(elemento, parte.indice, parte.a, cruzamento.ponto);
}

/**
 * Estende o elemento até encontrar o cortante, pela ponta mais perto do clique.
 *
 * Só estende: se o encontro cair dentro do traço, o que a pessoa quer é aparar, e fazer
 * a coisa errada calada é pior do que não fazer nada.
 */
export function estender(elemento: Elemento, cortante: Segmento, pontoClicado: Ponto): Elemento | null {
  const parte = segmentoMaisPerto(elemento, pontoClicado);
  if (!parte) return null;
  const cruzamento = cruzamentoComCortante(parte.a, parte.b, cortante);
  if (!cruzamento) return null;
  if (cruzamento.t < 0) return comSegmentoTrocado(elemento, parte.indice, cruzamento.ponto, parte.b);
  if (cruzamento.t > 1) return comSegmentoTrocado(elemento, parte.indice, parte.a, cruzamento.ponto);
  return null;
}
