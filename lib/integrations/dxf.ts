import { aciMaisProximo, corAci, corVerdadeira, tipoLinhaPeloNome, type TipoLinha } from "@/lib/cad-cores";
import { Camada, Disciplina, Elemento, elementoSchema, LIMITE_CAMADAS } from "@/lib/prancheta";

// Leitor de DXF escrito do zero, sem dependência. O DWG chega aqui depois de convertido
// para DXF pelo LibreDWG no servidor; os dois passam pelo mesmo leitor e pelo mesmo
// relatório.
//
// ## Como o DXF é
//
// O arquivo é uma sequência de PARES de linhas: um código de grupo inteiro e o valor.
// `0` abre uma entidade, `8` nomeia a camada, `10/20/30` são coordenadas. Toda a
// complexidade está em saber o que cada código significa em cada entidade.
//
// ## O que este leitor traz
//
// - TODAS as camadas da tabela do arquivo, inclusive vazias, com cor, tipo de linha e
//   estado: desligada ou congelada entra escondida, travada entra travada.
// - Linhas, polilinhas (as novas e as antigas com VERTEX), arcos dentro de polilinha
//   (bulge), círculos, arcos, elipses, splines, pontos, sólidos, faces, hachuras (contorno
//   e preenchimento), linhas múltiplas, chamadas (LEADER), textos, MTEXT em várias linhas,
//   atributos visíveis, cotas e tabelas (pelo bloco que o próprio arquivo desenha).
// - Blocos com escala, giro, espelhamento, matriz (MINSERT) e aninhamento; o que está na
//   camada 0 dentro do bloco herda a camada do INSERT, como no AutoCAD.
// - Cor por entidade (índice ou RGB), "por camada" e "por bloco".
//
// Traz GEOMETRIA, não semântica: uma linha não diz se é parede ou eixo, então entra como
// traço na camada do arquivo, e quem desenha decide o que virar o quê. O espaço de papel
// (carimbo, viewports) fica de fora: o editor trabalha no espaço do modelo. O que não
// entra é dito com nome e contagem.

export const UNIDADES = {
  mm: 1, cm: 10, m: 1000, polegada: 25.4, pe: 304.8,
} as const;
export type Unidade = keyof typeof UNIDADES;

export const unidadeLabels: Record<Unidade, string> = {
  mm: "Milímetro", cm: "Centímetro", m: "Metro", polegada: "Polegada", pe: "Pé",
};

// $INSUNITS do cabeçalho do DXF. Os que não estão aqui não aparecem em planta de
// arquitetura, e chutar um deles seria pior do que perguntar.
const INSUNITS: Record<number, Unidade> = {
  1: "polegada", 2: "pe", 4: "mm", 5: "cm", 6: "m",
};

export const LIMITE_IMPORTACAO = 60_000;
const LIMITE_PONTOS = 2000;
const MAX_MM = 2_000_000_000;
const PROFUNDIDADE_BLOCOS = 8;

export type Par = { codigo: number; valor: string };

/** Separa o arquivo em pares código/valor. É a única função que conhece o formato de
 *  linha; tudo depois disso trabalha em cima dos pares. */
export function pares(texto: string): Par[] {
  const linhas = texto.split(/\r\n|\r|\n/);
  const saida: Par[] = [];
  let i = 0;
  // Linha que não é um código anda UMA, não duas: assim o leitor volta ao passo certo
  // depois de uma linha estranha, em vez de trocar código por valor até o fim do arquivo.
  while (i + 1 < linhas.length) {
    const bruto = linhas[i].trim();
    if (!/^-?\d+$/.test(bruto)) { i += 1; continue; }
    saida.push({ codigo: Number.parseInt(bruto, 10), valor: linhas[i + 1] ?? "" });
    i += 2;
  }
  return saida;
}

type Entidade = { tipo: string; pares: Par[]; vertices?: Entidade[] };
type Pt = { x: number; y: number };
/** Afim 2D [a, b, c, d, e, f]: x' = a·x + c·y + e; y' = b·x + d·y + f. Coordenadas do DXF (Y para cima). */
type Matriz = readonly [number, number, number, number, number, number];

const IDENTIDADE: Matriz = [1, 0, 0, 1, 0, 0];
const compor = (m: Matriz, n: Matriz): Matriz => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const aplicar = (m: Matriz, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
const vetor = (m: Matriz, v: Pt): Pt => ({ x: m[0] * v.x + m[2] * v.y, y: m[1] * v.x + m[3] * v.y });
const transladar = (x: number, y: number): Matriz => [1, 0, 0, 1, x, y];
const girar = (graus: number): Matriz => { const r = graus * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, 0, 0]; };
const escalar = (sx: number, sy: number): Matriz => [sx, 0, 0, sy, 0, 0];

const num = (entidade: Entidade, codigo: number, padrao: number) => {
  const encontrado = entidade.pares.find((par) => par.codigo === codigo);
  const valor = encontrado ? Number.parseFloat(encontrado.valor) : NaN;
  return Number.isFinite(valor) ? valor : padrao;
};
const txt = (entidade: Entidade, codigo: number, padrao = "") =>
  entidade.pares.find((par) => par.codigo === codigo)?.valor ?? padrao;
const tem = (entidade: Entidade, codigo: number) => entidade.pares.some((par) => par.codigo === codigo);
const ponto = (entidade: Entidade, cx: number, cy: number): Pt => ({ x: num(entidade, cx, 0), y: num(entidade, cy, 0) });

/**
 * Sistema de coordenadas do objeto (OCS). Círculo, arco, polilinha 2D, texto, INSERT,
 * sólido e hachura guardam coordenadas no plano definido pela extrusão (210/220/230).
 * Com extrusão (0, 0, −1) — o que o comando MIRROR produz — o X do objeto aponta para a
 * esquerda; sem esta conta, metade dos arcos espelhados de uma planta sai virada.
 */
function matrizOcs(entidade: Entidade): Matriz {
  const n = { x: num(entidade, 210, 0), y: num(entidade, 220, 0), z: num(entidade, 230, 1) };
  const modulo = Math.hypot(n.x, n.y, n.z);
  if (!modulo) return IDENTIDADE;
  n.x /= modulo; n.y /= modulo; n.z /= modulo;
  if (Math.abs(n.x) < 1e-12 && Math.abs(n.y) < 1e-12 && n.z > 0) return IDENTIDADE;
  // Algoritmo do eixo arbitrário, projetado no plano XY.
  const cruz = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
    ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const ax0 = Math.abs(n.x) < 1 / 64 && Math.abs(n.y) < 1 / 64 ? cruz({ x: 0, y: 1, z: 0 }, n) : cruz({ x: 0, y: 0, z: 1 }, n);
  const ma = Math.hypot(ax0.x, ax0.y, ax0.z) || 1;
  const ax = { x: ax0.x / ma, y: ax0.y / ma, z: ax0.z / ma };
  const ay0 = cruz(n, ax);
  const mb = Math.hypot(ay0.x, ay0.y, ay0.z) || 1;
  return [ax.x, ax.y, ay0.x / mb, ay0.y / mb, 0, 0];
}

/** Vértices de LWPOLYLINE com o bulge de cada um. */
function verticesLw(entidade: Entidade): Array<Pt & { bulge: number }> {
  const pontos: Array<Pt & { bulge: number }> = [];
  let atual: (Pt & { bulge: number }) | null = null;
  for (const par of entidade.pares) {
    if (par.codigo === 10) { if (atual) pontos.push(atual); atual = { x: Number.parseFloat(par.valor) || 0, y: 0, bulge: 0 }; }
    else if (par.codigo === 20 && atual) atual.y = Number.parseFloat(par.valor) || 0;
    else if (par.codigo === 42 && atual) atual.bulge = Number.parseFloat(par.valor) || 0;
  }
  if (atual) pontos.push(atual);
  return pontos;
}

/** Pares (x, y) de dois códigos, na ordem em que aparecem. */
function lista(entidade: Entidade, cx: number, cy: number): Pt[] {
  const pontos: Pt[] = [];
  let atual: Pt | null = null;
  for (const par of entidade.pares) {
    if (par.codigo === cx) { if (atual) pontos.push(atual); atual = { x: Number.parseFloat(par.valor) || 0, y: 0 }; }
    else if (par.codigo === cy && atual) atual.y = Number.parseFloat(par.valor) || 0;
  }
  if (atual) pontos.push(atual);
  return pontos;
}

const valores = (entidade: Entidade, codigo: number) =>
  entidade.pares.filter((par) => par.codigo === codigo).map((par) => Number.parseFloat(par.valor)).filter(Number.isFinite);

/** Passos para uma curva de `raio` e `angulo` (rad) com desvio de ~0,5% do raio, limitado. */
function passosDaCurva(raio: number, angulo: number, maximo = 128) {
  const porVolta = 72;
  return raio > 0 ? Math.max(2, Math.min(maximo, Math.ceil(Math.abs(angulo) / (2 * Math.PI) * porVolta))) : 2;
}

/** Pontos do trecho entre dois vértices com bulge (tangente de ¼ do ângulo incluso). */
function trechoComBulge(a: Pt, b: Pt, bulge: number): Pt[] {
  if (!bulge || (a.x === b.x && a.y === b.y)) return [];
  const theta = 4 * Math.atan(bulge);
  const corda = Math.hypot(b.x - a.x, b.y - a.y);
  const raio = corda / (2 * Math.sin(Math.abs(theta) / 2));
  const meio = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const altura = raio * Math.cos(Math.abs(theta) / 2);
  const dir = { x: (b.x - a.x) / corda, y: (b.y - a.y) / corda };
  // Centro à esquerda da corda quando o arco é anti-horário (bulge positivo).
  const lado = bulge > 0 ? 1 : -1;
  const centro = { x: meio.x - dir.y * altura * lado, y: meio.y + dir.x * altura * lado };
  const inicio = Math.atan2(a.y - centro.y, a.x - centro.x);
  const passos = passosDaCurva(raio, theta, 64);
  const pontos: Pt[] = [];
  for (let i = 1; i < passos; i += 1) {
    const t = inicio + theta * i / passos;
    pontos.push({ x: centro.x + raio * Math.cos(t), y: centro.y + raio * Math.sin(t) });
  }
  return pontos;
}

/** Polilinha com bulges já transformada em pontos (sem repetir o fechamento). */
function pontosComBulge(vertices: Array<Pt & { bulge: number }>, fechada: boolean): Pt[] {
  const saida: Pt[] = [];
  const n = vertices.length;
  for (let i = 0; i < n; i += 1) {
    const v = vertices[i];
    saida.push({ x: v.x, y: v.y });
    const proximo = i + 1 < n ? vertices[i + 1] : fechada ? vertices[0] : null;
    if (proximo && v.bulge) saida.push(...trechoComBulge(v, proximo, v.bulge));
  }
  return saida;
}

/** B-spline (racional) avaliada por de Boor; sem pontos de controle, passa pelos de ajuste. */
function pontosDaSpline(entidade: Entidade): Pt[] {
  const grau = Math.max(1, Math.round(num(entidade, 71, 3)));
  const nos = valores(entidade, 40);
  const controle = lista(entidade, 10, 20);
  const pesos = valores(entidade, 41);
  if (controle.length >= grau + 1 && nos.length === controle.length + grau + 1) {
    const racional = pesos.length === controle.length;
    const inicio = nos[grau], fim = nos[nos.length - grau - 1];
    if (!(fim > inicio)) return controle;
    const amostras = Math.min(600, Math.max(24, controle.length * 10));
    const saida: Pt[] = [];
    for (let s = 0; s <= amostras; s += 1) {
      const u = s === amostras ? fim - 1e-12 * (fim - inicio) : inicio + (fim - inicio) * s / amostras;
      let k = grau;
      while (k < nos.length - grau - 2 && u >= nos[k + 1]) k += 1;
      const d = Array.from({ length: grau + 1 }, (_, j) => {
        const p = controle[k - grau + j], w = racional ? pesos[k - grau + j] : 1;
        return { x: p.x * w, y: p.y * w, w };
      });
      for (let r = 1; r <= grau; r += 1) {
        for (let j = grau; j >= r; j -= 1) {
          const i = k - grau + j;
          const den = nos[i + grau - r + 1] - nos[i];
          const a = den ? (u - nos[i]) / den : 0;
          d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y, w: (1 - a) * d[j - 1].w + a * d[j].w };
        }
      }
      const w = d[grau].w || 1;
      saida.push({ x: d[grau].x / w, y: d[grau].y / w });
    }
    return saida;
  }
  // Só pontos de ajuste: Catmull-Rom passa por todos eles, que é o que a spline de
  // ajuste promete.
  const ajuste = lista(entidade, 11, 21);
  if (ajuste.length < 3) return ajuste.length ? ajuste : controle;
  const saida: Pt[] = [ajuste[0]];
  for (let i = 0; i < ajuste.length - 1; i += 1) {
    const p0 = ajuste[Math.max(0, i - 1)], p1 = ajuste[i], p2 = ajuste[i + 1], p3 = ajuste[Math.min(ajuste.length - 1, i + 2)];
    for (let s = 1; s <= 8; s += 1) {
      const t = s / 8, t2 = t * t, t3 = t2 * t;
      saida.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return saida;
}

/** Pontos da elipse em coordenadas do mundo, do parâmetro inicial ao final. */
function pontosDaElipse(centro: Pt, maior: Pt, razao: number, t0: number, t1: number, normalZ: number): Pt[] {
  let fim = t1;
  while (fim <= t0 + 1e-9) fim += 2 * Math.PI;
  const menor = { x: -maior.y * razao * (normalZ < 0 ? -1 : 1), y: maior.x * razao * (normalZ < 0 ? -1 : 1) };
  const passos = Math.max(8, Math.min(192, Math.ceil((fim - t0) / (2 * Math.PI) * 96)));
  return Array.from({ length: passos + 1 }, (_, i) => {
    const t = t0 + (fim - t0) * i / passos;
    return { x: centro.x + Math.cos(t) * maior.x + Math.sin(t) * menor.x, y: centro.y + Math.cos(t) * maior.y + Math.sin(t) * menor.y };
  });
}

/** Limpa o texto: códigos %% do TEXT e formatação do MTEXT. Devolve as linhas. */
export function limparTexto(cru: string, mtext: boolean): string[] {
  let texto = cru
    .replace(/%%[cC]/g, "Ø").replace(/%%[dD]/g, "°").replace(/%%[pP]/g, "±")
    .replace(/%%[uUoOkK]/g, "").replace(/%%(\d{3})/g, (_, codigo) => String.fromCharCode(Number(codigo)))
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\M\+[0-9A-Fa-f]{5}/g, "");
  if (!mtext) return [texto.replace(/\s+/g, " ").trim()].filter(Boolean);
  let saida = "";
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (c === "{" || c === "}") continue;
    if (c !== "\\") { saida += c; continue; }
    const codigo = texto[i + 1];
    if (codigo === undefined) break;
    if (codigo === "P") { saida += "\n"; i += 1; continue; }
    if (codigo === "~") { saida += " "; i += 1; continue; }
    if (codigo === "\\" || codigo === "{" || codigo === "}") { saida += codigo; i += 1; continue; }
    if (codigo === "S") {
      // Fração empilhada: \S1/2; ou \S1^2; vira 1/2.
      const fim = texto.indexOf(";", i + 2);
      const conteudo = fim >= 0 ? texto.slice(i + 2, fim) : texto.slice(i + 2);
      saida += conteudo.replace(/[\^#]/, "/");
      i = fim >= 0 ? fim : texto.length;
      continue;
    }
    if ("ACcFfHQTWpa".includes(codigo)) {
      const fim = texto.indexOf(";", i + 2);
      i = fim >= 0 ? fim : texto.length;
      continue;
    }
    // \L \l \O \o \K \k \N \X: liga e desliga sublinhado, sobrelinha, riscado; sem texto.
    i += 1;
  }
  texto = saida;
  return texto.split("\n").map((linha) => linha.replace(/[ \t]+/g, " ").trim());
}

// Nome de camada do CAD costuma dizer a disciplina: A-PAREDE, ELE-TOMADAS, ILU-TETO.
// O palpite adianta o trabalho e fica visível no painel de camadas, onde é corrigido em
// um clique — diferente de um palpite escondido, que ninguém descobre que existe.
function disciplinaPeloNome(nome: string): Disciplina {
  const limpo = nome.toLowerCase();
  if (/(elet|elét|tomad|interrup|energia|forca|força|quadro|^e-|^ele)/.test(limpo)) return "eletrico";
  if (/(lumin|ilumin|luz|spot|teto|forro|^lum|^ilu)/.test(limpo)) return "luminotecnico";
  if (/(mobil|movel|móvel|moveis|móveis|interior|layout-mob|furn|^mob)/.test(limpo)) return "mobiliario";
  if (/(cota|dim|texto|text|anota|legenda|carimbo|eixo|anno)/.test(limpo)) return "anotacao";
  return "layout";
}

const identificador = (nome: string, usados: Set<string>) => {
  const base = `dxf-${nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "camada"}`.slice(0, 56);
  let candidato = base;
  let n = 2;
  while (usados.has(candidato)) { candidato = `${base}-${n}`; n += 1; }
  usados.add(candidato);
  return candidato;
};

export type Importacao = {
  camadas: Camada[];
  elementos: Elemento[];
  /** Unidade que foi de fato usada na conversão, e se ela veio do arquivo ou de fora. */
  unidade: Unidade;
  unidadeDeclarada: boolean;
  /** Tudo que o leitor não trouxe, dito com nome. Um arquivo que perde metade das
   *  entidades em silêncio é pior do que um arquivo que não abre. */
  avisos: string[];
  ignorados: Record<string, number>;
  truncado: boolean;
};

export class DxfInvalido extends Error {}

type CamadaDxf = { nome: string; cor: string | null; tipoLinha?: TipoLinha; desligada: boolean; congelada: boolean; travada: boolean };
/** O que o INSERT passa para dentro do bloco: camada e cor de quem está "por bloco". */
type Heranca = { camada: string; cor: string | null; tipoLinha?: TipoLinha };

const TIPOS_SEM_DESENHO = new Set(["VIEWPORT", "SEQEND", "VERTEX", "ATTDEF", "ENDBLK", "BLOCK"]);

/**
 * Lê um DXF em texto e devolve camadas e elementos em milímetros.
 *
 * O eixo Y é invertido: no DXF ele cresce para cima e aqui para baixo. Sem essa inversão
 * a planta entra espelhada — e espelhada é o tipo de erro que passa despercebido até
 * alguém executar a obra pelo desenho.
 */
export function lerDxf(texto: string, opcoes: { unidade?: Unidade; limiteElementos?: number } = {}): Importacao {
  if (texto.startsWith("AutoCAD Binary DXF")) {
    throw new DxfInvalido("Este é um DXF binário. Exporte de novo como DXF ASCII (opção “DXF R12/2013 ASCII”).");
  }
  const todos = pares(texto);
  if (!todos.length) throw new DxfInvalido("O arquivo não tem pares de código DXF. Confirme que é mesmo um DXF em texto.");
  const limite = Math.max(1, opcoes.limiteElementos ?? LIMITE_IMPORTACAO);

  // Cabeçalho: unidade declarada pelo arquivo.
  let unidadeDoArquivo: Unidade | null = null;
  for (let i = 0; i < todos.length - 1; i += 1) {
    if (todos[i].codigo === 9 && todos[i].valor.trim() === "$INSUNITS") {
      const seguinte = todos.slice(i + 1, i + 4).find((par) => par.codigo === 70);
      const codigo = seguinte ? Number.parseInt(seguinte.valor.trim(), 10) : NaN;
      unidadeDoArquivo = INSUNITS[codigo] ?? null;
      break;
    }
    if (todos[i].codigo === 0 && todos[i].valor.trim() === "ENDSEC") break;
  }
  const unidade = opcoes.unidade ?? unidadeDoArquivo ?? "mm";
  const escala = UNIDADES[unidade];

  // Separa as seções: tabela de camadas, blocos e entidades do desenho.
  const tabelaCamadas: CamadaDxf[] = [];
  const blocos = new Map<string, { base: Pt; itens: Entidade[] }>();
  const entidades: Entidade[] = [];
  let secao = "";
  let tabela = "";
  let blocoAtual: { nome: string; base: Pt; itens: Entidade[] } | null = null;
  let atual: Entidade | null = null;

  const guardar = () => {
    if (!atual) return;
    if (secao === "TABLES" && tabela === "LAYER" && atual.tipo === "LAYER") {
      const nome = txt(atual, 2, "").trim();
      if (nome) {
        const indice = Math.round(num(atual, 62, 7));
        const verdadeira = tem(atual, 420) ? corVerdadeira(num(atual, 420, -1)) : undefined;
        const flags = Math.round(num(atual, 70, 0));
        tabelaCamadas.push({
          nome, cor: verdadeira !== undefined ? verdadeira : corAci(indice),
          tipoLinha: tipoLinhaPeloNome(txt(atual, 6, "")),
          desligada: indice < 0, congelada: (flags & 1) === 1, travada: (flags & 4) === 4,
        });
      }
    } else if (blocoAtual) blocoAtual.itens.push(atual);
    else if (secao === "ENTITIES") entidades.push(atual);
    atual = null;
  };

  for (let i = 0; i < todos.length; i += 1) {
    const par = todos[i];
    if (par.codigo !== 0) { atual?.pares.push(par); continue; }
    const marca = par.valor.trim().toUpperCase();
    guardar();
    if (marca === "SECTION") {
      secao = todos.slice(i + 1, i + 4).find((seguinte) => seguinte.codigo === 2)?.valor.trim().toUpperCase() ?? "";
      continue;
    }
    if (marca === "ENDSEC") { secao = ""; tabela = ""; blocoAtual = null; continue; }
    if (marca === "EOF") break;
    if (secao === "TABLES" && marca === "TABLE") {
      tabela = todos.slice(i + 1, i + 4).find((seguinte) => seguinte.codigo === 2)?.valor.trim().toUpperCase() ?? "";
      continue;
    }
    if (secao === "TABLES" && marca === "ENDTAB") { tabela = ""; continue; }
    if (marca === "BLOCK") {
      const cabecalho: Entidade = { tipo: "BLOCK", pares: [] };
      for (let j = i + 1; j < todos.length && todos[j].codigo !== 0; j += 1) cabecalho.pares.push(todos[j]);
      blocoAtual = { nome: txt(cabecalho, 2, "").trim(), base: ponto(cabecalho, 10, 20), itens: [] };
      continue;
    }
    if (marca === "ENDBLK") {
      if (blocoAtual) blocos.set(blocoAtual.nome.toUpperCase(), { base: blocoAtual.base, itens: agruparPolilinhas(blocoAtual.itens) });
      blocoAtual = null;
      continue;
    }
    atual = { tipo: marca, pares: [] };
  }
  guardar();

  // Camadas: primeiro todas as da tabela, na ordem do arquivo; depois as que só aparecem
  // nas entidades (arquivo sem tabela, ou camada referida sem ter sido declarada).
  const camadas: Camada[] = [];
  const dxfPorNome = new Map(tabelaCamadas.map((c) => [c.nome.toUpperCase(), c]));
  const idsUsados = new Set<string>();
  const porNome = new Map<string, string>();
  let camadasJuntadas = 0;
  const camadaDe = (nome: string): string => {
    const limpo = (nome || "0").trim() || "0";
    const chave = limpo.toUpperCase();
    const existente = porNome.get(chave);
    if (existente) return existente;
    if (camadas.length >= LIMITE_CAMADAS) {
      camadasJuntadas += 1;
      const zero = porNome.get("0") ?? camadas[0]?.id ?? "dxf-0";
      porNome.set(chave, zero);
      return zero;
    }
    const id = identificador(limpo, idsUsados);
    porNome.set(chave, id);
    const dados = dxfPorNome.get(chave);
    camadas.push({
      id, nome: limpo.slice(0, 255), disciplina: disciplinaPeloNome(limpo),
      visivel: !(dados?.desligada || dados?.congelada), bloqueada: Boolean(dados?.travada),
      ...(dados?.cor ? { cor: dados.cor } : {}), ...(dados?.tipoLinha ? { tipoLinha: dados.tipoLinha } : {}),
    });
    return id;
  };
  for (const camada of tabelaCamadas) camadaDe(camada.nome);
  const corDaCamada = new Map(camadas.map((c) => [c.id, c.cor ?? null]));
  const linhaDaCamada = new Map(camadas.map((c) => [c.id, c.tipoLinha]));

  const elementos: Elemento[] = [];
  const ignorados: Record<string, number> = {};
  const contar = (motivo: string, quantos = 1) => { ignorados[motivo] = (ignorados[motivo] ?? 0) + quantos; };
  let truncado = false;
  let sequencia = 0;
  const proximoId = () => `dxf-${(sequencia += 1).toString(36)}`;

  const mm = (valor: number) => {
    const convertido = Math.round(valor * escala * 100) / 100;
    const limitado = Math.max(-MAX_MM, Math.min(MAX_MM, Number.isFinite(convertido) ? convertido : 0));
    // `|| 0` normaliza o zero negativo que a inversão do eixo produz.
    return limitado || 0;
  };
  // Y para baixo: a inversão acontece aqui, uma vez só.
  const final = (p: Pt) => ({ x: mm(p.x), y: mm(-p.y) });

  function guardarElemento(elemento: Elemento) {
    if (elementos.length >= limite) { truncado = true; return; }
    const analisado = elementoSchema.safeParse(elemento);
    if (analisado.success) elementos.push(analisado.data);
    else contar("fora_de_faixa");
  }

  /** Estilo resolvido: camada (com herança da 0), cor e tipo de linha próprios. */
  function estilo(entidade: Entidade, heranca: Heranca | null) {
    const nome = txt(entidade, 8, "0").trim() || "0";
    const camada = heranca && nome === "0" ? heranca.camada : camadaDe(nome);
    let cor: string | null | undefined;
    const indice = tem(entidade, 62) ? Math.round(num(entidade, 62, 256)) : 256;
    if (tem(entidade, 420)) cor = corVerdadeira(num(entidade, 420, -1));
    else if (indice === 0) cor = heranca ? heranca.cor : null; // por bloco
    else if (indice === 256) cor = undefined; // por camada
    else cor = corAci(indice);
    const nomeLinha = txt(entidade, 6, "").trim().toUpperCase();
    let tipoLinha: TipoLinha | undefined;
    if (nomeLinha === "BYBLOCK") tipoLinha = heranca?.tipoLinha;
    else if (nomeLinha && nomeLinha !== "BYLAYER") tipoLinha = tipoLinhaPeloNome(nomeLinha) ?? "continua";
    const doElemento: { cor?: string; tipoLinha?: TipoLinha } = {};
    const daCamada = corDaCamada.get(camada) ?? null;
    // Cor própria só quando difere da camada: mudar a cor da camada muda o desenho junto.
    if (cor !== undefined && cor !== daCamada) {
      if (cor) doElemento.cor = cor;
      else if (daCamada) doElemento.cor = "#000000"; // tinta explícita sobre camada colorida
    }
    if (tipoLinha && tipoLinha !== (linhaDaCamada.get(camada) ?? "continua")) doElemento.tipoLinha = tipoLinha;
    return { camada, ...doElemento, corEfetiva: cor === undefined ? daCamada : cor, tipoLinhaEfetivo: tipoLinha ?? linhaDaCamada.get(camada) };
  }

  const ESPESSURA = 10; // mm do desenho: fio fino, 0,2 mm no papel a 1:50

  function traco(pontos: Pt[], m: Matriz, base: { camada: string; cor?: string; tipoLinha?: TipoLinha }, espessuraMm = ESPESSURA) {
    const convertidos = pontos.map((p) => final(aplicar(m, p)));
    const limpos = convertidos.filter((p, i, lista) => i === 0 || p.x !== lista[i - 1].x || p.y !== lista[i - 1].y);
    if (limpos.length < 2) { if (pontos.length >= 2) contar("traço de comprimento zero"); return; }
    // Uma polilinha imensa não cabe num elemento só; parte-se mantendo o ponto de
    // emenda, para o traço não abrir buraco.
    for (let i = 0; i < limpos.length - 1; i += LIMITE_PONTOS - 1) {
      const pedaco = limpos.slice(i, i + LIMITE_PONTOS);
      if (pedaco.length >= 2) guardarElemento({ id: proximoId(), camada: base.camada, ...(base.cor ? { cor: base.cor } : {}), ...(base.tipoLinha ? { tipoLinha: base.tipoLinha } : {}), tipo: "traco", pontos: pedaco, espessuraMm: Math.max(1, Math.min(200, espessuraMm)) });
    }
  }

  /** Arco (ou círculo) no OCS da entidade, levado pela matriz. Continua arco quando a
   *  matriz é semelhança (escala igual nos dois eixos); senão vira traço. */
  function arco(centro: Pt, raio: number, inicioGraus: number, fimGraus: number, circulo: boolean, m: Matriz, base: { camada: string; cor?: string; tipoLinha?: TipoLinha }) {
    const det = m[0] * m[3] - m[1] * m[2];
    const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
    let varredura = circulo ? 360 : ((fimGraus - inicioGraus) % 360 + 360) % 360;
    if (!circulo && varredura < 1e-9) varredura = 360;
    const semelhanca = Math.abs(sx - sy) < 1e-9 * Math.max(sx, sy, 1) && Math.abs(m[0] * m[2] + m[1] * m[3]) < 1e-9 * Math.max(sx * sy, 1);
    if (!semelhanca) {
      const passos = passosDaCurva(raio, varredura * Math.PI / 180, 144);
      traco(Array.from({ length: passos + 1 }, (_, i) => {
        const t = (inicioGraus + varredura * i / passos) * Math.PI / 180;
        return { x: centro.x + raio * Math.cos(t), y: centro.y + raio * Math.sin(t) };
      }), m, base);
      return;
    }
    const raioMm = Math.round(raio * sx * escala * 100) / 100;
    if (raioMm < 1) { contar("arco sem raio"); return; }
    const c = final(aplicar(m, centro));
    const giro = Math.atan2(m[1], m[0]) * 180 / Math.PI;
    // Com espelhamento, o sentido inverte: o arco novo começa onde o espelhado termina.
    const inicio = det >= 0 ? inicioGraus + giro : giro - inicioGraus - varredura;
    const normal = (g: number) => { const v = ((Math.round(g * 1e6) / 1e6) % 360 + 360) % 360; return v >= 360 ? 0 : v; };
    guardarElemento({
      id: proximoId(), camada: base.camada, ...(base.cor ? { cor: base.cor } : {}), ...(base.tipoLinha ? { tipoLinha: base.tipoLinha } : {}),
      tipo: "arco", centro: c, raioMm, inicioGraus: normal(inicio),
      varreduraGraus: varredura >= 360 ? 360 : Math.max(1e-6, Math.round(varredura * 1e6) / 1e6), espessuraMm: ESPESSURA,
    });
  }

  function emitirTexto(conteudo: string, posicao: Pt, alturaDxf: number, anguloGraus: number, m: Matriz, base: { camada: string; cor?: string; tipoLinha?: TipoLinha },
    ancoraH?: "inicio" | "meio" | "fim", ancoraV?: "base" | "meio" | "topo") {
    const limpo = conteudo.slice(0, 500);
    if (!limpo.trim()) return;
    const r = anguloGraus * Math.PI / 180;
    const direcao = vetor(m, { x: Math.cos(r), y: Math.sin(r) });
    const perpendicular = vetor(m, { x: -Math.sin(r), y: Math.cos(r) });
    const alturaMm = Math.max(0.5, Math.min(50000, Math.round(alturaDxf * Math.hypot(perpendicular.x, perpendicular.y) * escala * 100) / 100));
    const anguloMundo = Math.atan2(direcao.y, direcao.x) * 180 / Math.PI;
    guardarElemento({
      id: proximoId(), camada: base.camada, ...(base.cor ? { cor: base.cor } : {}),
      tipo: "texto", posicao: final(aplicar(m, posicao)), texto: limpo, alturaMm,
      // Giro invertido junto com o eixo.
      rotacaoGraus: ((Math.round(-anguloMundo * 1e6) / 1e6) % 360 + 360) % 360 % 360,
      ...(ancoraH && ancoraH !== "inicio" ? { ancoraH } : {}), ...(ancoraV && ancoraV !== "base" ? { ancoraV } : {}),
    });
  }

  function hachura(aneis: Pt[][], m: Matriz, base: { camada: string; cor?: string; tipoLinha?: TipoLinha }, solida: boolean, padrao?: string) {
    const convertidos = aneis
      .map((anel) => anel.map((p) => final(aplicar(m, p))).filter((p, i, l) => i === 0 || p.x !== l[i - 1].x || p.y !== l[i - 1].y))
      .map((anel) => anel.length > 1 && anel[0].x === anel.at(-1)!.x && anel[0].y === anel.at(-1)!.y ? anel.slice(0, -1) : anel)
      .filter((anel) => anel.length >= 3)
      .map((anel) => anel.length > 4000 ? anel.filter((_, i) => i % Math.ceil(anel.length / 4000) === 0) : anel)
      .slice(0, 200);
    if (!convertidos.length) { contar("hachura sem contorno"); return; }
    guardarElemento({ id: proximoId(), camada: base.camada, ...(base.cor ? { cor: base.cor } : {}), tipo: "hachura", aneis: convertidos, solida, ...(padrao ? { padrao: padrao.slice(0, 40) } : {}) });
  }

  function converter(entidade: Entidade, m: Matriz, heranca: Heranca | null, profundidade: number) {
    if (truncado) return;
    if (Math.round(num(entidade, 67, 0)) === 1) { contar("espaço de papel"); return; }
    if (TIPOS_SEM_DESENHO.has(entidade.tipo)) return;
    const { corEfetiva, tipoLinhaEfetivo, ...base } = estilo(entidade, heranca);
    const ocs = compor(m, matrizOcs(entidade));

    switch (entidade.tipo) {
      case "LINE":
        traco([ponto(entidade, 10, 20), ponto(entidade, 11, 21)], m, base);
        return;
      case "LWPOLYLINE": {
        const fechada = (Math.round(num(entidade, 70, 0)) & 1) === 1;
        const pontos = pontosComBulge(verticesLw(entidade), fechada);
        const largura = num(entidade, 43, 0) * escala;
        traco(fechada && pontos.length > 2 ? [...pontos, pontos[0]] : pontos, ocs, base, largura > 0 ? largura : ESPESSURA);
        return;
      }
      case "POLYLINE": {
        const flags = Math.round(num(entidade, 70, 0));
        if (flags & 16) { contar("malha 3D"); return; }
        const vertices = (entidade.vertices ?? []).filter((v) => !(Math.round(num(v, 70, 0)) & 128));
        if (flags & 64) { contar("malha de faces"); return; }
        const tresD = (flags & 8) === 8;
        const fechada = (flags & 1) === 1;
        const pontos = tresD
          ? vertices.map((v) => ponto(v, 10, 20))
          : pontosComBulge(vertices.map((v) => ({ ...ponto(v, 10, 20), bulge: num(v, 42, 0) })), fechada);
        traco(fechada && pontos.length > 2 ? [...pontos, pontos[0]] : pontos, tresD ? m : ocs, base);
        return;
      }
      case "CIRCLE":
      case "ARC": {
        const circulo = entidade.tipo === "CIRCLE";
        arco(ponto(entidade, 10, 20), Math.abs(num(entidade, 40, 0)), circulo ? 0 : num(entidade, 50, 0), circulo ? 360 : num(entidade, 51, 0), circulo, ocs, base);
        return;
      }
      case "ELLIPSE": {
        const nz = num(entidade, 230, 1);
        traco(pontosDaElipse(ponto(entidade, 10, 20), ponto(entidade, 11, 21), num(entidade, 40, 1), num(entidade, 41, 0), num(entidade, 42, 2 * Math.PI), nz), m, base);
        return;
      }
      case "SPLINE": {
        const pontos = pontosDaSpline(entidade);
        const fechada = (Math.round(num(entidade, 70, 0)) & 1) === 1;
        traco(fechada && pontos.length > 2 ? [...pontos, pontos[0]] : pontos, m, base);
        return;
      }
      case "LEADER": {
        traco(lista(entidade, 10, 20), m, base);
        return;
      }
      case "MLINE": {
        // Linha múltipla (parede em duas linhas). O estilo fica num objeto à parte; o
        // padrão tem as duas linhas a meia escala de cada lado, e a justificação desloca.
        const vertices = lista(entidade, 11, 21);
        const escalaMl = num(entidade, 40, 1);
        const justificacao = Math.round(num(entidade, 70, 1));
        const deslocamento = justificacao === 0 ? -escalaMl / 2 : justificacao === 2 ? escalaMl / 2 : 0;
        const fechada = (Math.round(num(entidade, 71, 0)) & 2) === 2;
        for (const lado of [0.5, -0.5]) {
          const d = lado * escalaMl + deslocamento;
          const deslocados = deslocarPolilinha(vertices, d, fechada);
          traco(fechada && deslocados.length > 2 ? [...deslocados, deslocados[0]] : deslocados, m, base);
        }
        return;
      }
      case "POINT": {
        const centro = final(aplicar(m, ponto(entidade, 10, 20)));
        const lado = 50;
        for (const [a, b] of [[{ x: centro.x - lado, y: centro.y }, { x: centro.x + lado, y: centro.y }], [{ x: centro.x, y: centro.y - lado }, { x: centro.x, y: centro.y + lado }]]) {
          guardarElemento({ id: proximoId(), camada: base.camada, ...(base.cor ? { cor: base.cor } : {}), tipo: "traco", pontos: [a, b], espessuraMm: ESPESSURA });
        }
        return;
      }
      case "SOLID":
      case "TRACE": {
        const p = [ponto(entidade, 10, 20), ponto(entidade, 11, 21), ponto(entidade, 13, 23), ponto(entidade, 12, 22)];
        const anel = p[2].x === p[3].x && p[2].y === p[3].y ? p.slice(0, 3) : p;
        hachura([anel], ocs, base, true);
        return;
      }
      case "3DFACE": {
        const p = [ponto(entidade, 10, 20), ponto(entidade, 11, 21), ponto(entidade, 12, 22), ponto(entidade, 13, 23)];
        traco([...p, p[0]], m, base);
        return;
      }
      case "HATCH": {
        const lido = contornosDaHachura(entidade);
        if (!lido.aneis.length) { contar("hachura sem contorno"); return; }
        hachura(lido.aneis, ocs, base, lido.solida, lido.padrao);
        return;
      }
      case "TEXT":
      case "ATTRIB": {
        if (entidade.tipo === "ATTRIB" && (Math.round(num(entidade, 70, 0)) & 1)) return; // atributo invisível
        const [conteudo] = limparTexto(txt(entidade, 1, ""), false);
        if (!conteudo) return;
        const h = Math.round(num(entidade, 72, 0)), v = Math.round(num(entidade, 73, entidade.tipo === "ATTRIB" ? num(entidade, 74, 0) : 0));
        const alinhado = (h !== 0 || v !== 0) && h !== 3 && h !== 5 && tem(entidade, 11);
        const posicao = alinhado ? ponto(entidade, 11, 21) : ponto(entidade, 10, 20);
        const ancoraH = !alinhado ? "inicio" : h === 1 || h === 4 ? "meio" : h === 2 ? "fim" : "inicio";
        const ancoraV = !alinhado ? "base" : h === 4 || v === 2 ? "meio" : v === 3 ? "topo" : "base";
        emitirTexto(conteudo, posicao, num(entidade, 40, 2.5), num(entidade, 50, 0), ocs, base, ancoraH, ancoraV);
        return;
      }
      case "MTEXT": {
        const partes = entidade.pares.filter((par) => par.codigo === 3).map((par) => par.valor).join("");
        const linhas = limparTexto(`${partes}${txt(entidade, 1, "")}`, true);
        while (linhas.length && !linhas.at(-1)) linhas.pop();
        if (!linhas.some(Boolean)) return;
        const altura = num(entidade, 40, 2.5);
        const direcao = tem(entidade, 11) ? ponto(entidade, 11, 21) : null;
        const angulo = direcao && (direcao.x || direcao.y) ? Math.atan2(direcao.y, direcao.x) * 180 / Math.PI : num(entidade, 50, 0) * 180 / Math.PI;
        const anexo = Math.min(9, Math.max(1, Math.round(num(entidade, 71, 1))));
        const coluna = (anexo - 1) % 3, fila = Math.floor((anexo - 1) / 3);
        const ancoraH = coluna === 0 ? "inicio" : coluna === 1 ? "meio" : "fim";
        const entrelinha = altura * 1.667 * num(entidade, 44, 1);
        const total = altura + entrelinha * (linhas.length - 1);
        // Topo da primeira linha, medido a partir do ponto de inserção.
        const topo = fila === 0 ? 0 : fila === 1 ? total / 2 : total;
        const origem = ponto(entidade, 10, 20);
        const r = angulo * Math.PI / 180;
        const baixo = { x: Math.sin(r), y: -Math.cos(r) }; // perpendicular para baixo
        linhas.forEach((linha, i) => {
          if (!linha) return;
          const desce = i * entrelinha - topo;
          emitirTexto(linha, { x: origem.x + baixo.x * desce, y: origem.y + baixo.y * desce }, altura, angulo, m, base, ancoraH, "topo");
        });
        return;
      }
      case "INSERT":
      case "DIMENSION":
      case "ACAD_TABLE": {
        const nome = txt(entidade, 2, "").trim();
        const bloco = blocos.get(nome.toUpperCase());
        if (!bloco) { contar(`bloco ausente: ${nome || "sem nome"}`); return; }
        // Bloco dentro de bloco existe e é legítimo; bloco que se insere a si mesmo,
        // não — e sem este limite o arquivo travaria o servidor.
        if (profundidade >= PROFUNDIDADE_BLOCOS) { contar("bloco aninhado demais"); return; }
        const dentro: Heranca = { camada: base.camada, cor: corEfetiva ?? null, tipoLinha: tipoLinhaEfetivo };
        if (entidade.tipo === "DIMENSION") {
          // A cota é desenhada pelo próprio arquivo num bloco anônimo, já no lugar.
          const desvio = tem(entidade, 12) ? transladar(num(entidade, 12, 0), num(entidade, 22, 0)) : IDENTIDADE;
          for (const item of bloco.itens) converter(item, compor(m, desvio), dentro, profundidade + 1);
          return;
        }
        const sx = entidade.tipo === "INSERT" ? num(entidade, 41, 1) || 1 : 1;
        const sy = entidade.tipo === "INSERT" ? num(entidade, 42, 1) || 1 : 1;
        const rotacao = entidade.tipo === "INSERT" ? num(entidade, 50, 0) : 0;
        const colunas = Math.max(1, Math.min(1000, Math.round(num(entidade, 70, 1)))), filas = Math.max(1, Math.min(1000, Math.round(num(entidade, 71, 1))));
        const passoColuna = num(entidade, 44, 0), passoFila = num(entidade, 45, 0);
        const insercao = ponto(entidade, 10, 20);
        const matrizDoBase = compor(escalar(sx, sy), transladar(-bloco.base.x, -bloco.base.y));
        const multiplo = entidade.tipo === "INSERT" && colunas * filas > 1 ? colunas * filas : 1;
        for (let f = 0; f < (multiplo > 1 ? filas : 1); f += 1) {
          for (let c = 0; c < (multiplo > 1 ? colunas : 1); c += 1) {
            const posicionado = compor(transladar(insercao.x, insercao.y), compor(girar(rotacao), compor(transladar(c * passoColuna, f * passoFila), matrizDoBase)));
            const total = compor(entidade.tipo === "INSERT" ? ocs : m, posicionado);
            for (const item of bloco.itens) { converter(item, total, dentro, profundidade + 1); if (truncado) return; }
          }
        }
        return;
      }
      default:
        contar(entidade.tipo);
    }
  }

  for (const entidade of agruparPolilinhas(entidades)) {
    converter(entidade, IDENTIDADE, null, 0);
    if (truncado) break;
  }

  if (!camadas.length) camadaDe("0");
  const avisos: string[] = [];
  if (!unidadeDoArquivo) {
    avisos.push(`O arquivo não declara a unidade de desenho. A importação usou ${unidadeLabels[unidade].toLowerCase()}; meça algo conhecido com a cota antes de confiar nas medidas.`);
  }
  if (truncado) {
    avisos.push(`O desenho passa de ${limite.toLocaleString("pt-BR")} elementos e foi cortado nesse ponto. Importe o arquivo em partes, ou apague no CAD o que não for necessário antes de exportar.`);
  }
  if (camadasJuntadas) {
    avisos.push(`O arquivo tem mais de ${LIMITE_CAMADAS} camadas; ${camadasJuntadas} delas entraram na camada 0.`);
  }
  // Todas as camadas com desenho desligadas abririam uma prancha vazia. Acontece em DWG
  // convertido (o conversor grava a cor negativa em todas) e em arquivo salvo com tudo
  // desligado; nos dois casos o que se quer é ver o desenho.
  const comDesenho = new Set(elementos.map((e) => e.camada));
  const desenhadas = camadas.filter((c) => comDesenho.has(c.id));
  if (desenhadas.length && desenhadas.every((c) => !c.visivel)) {
    for (const camada of camadas) camada.visivel = true;
    avisos.push("O arquivo marca todas as camadas com desenho como desligadas, o que abriria uma prancha vazia. Elas entraram visíveis; esconda no painel de camadas o que não precisar.");
  } else {
    const escondidas = camadas.filter((c) => !c.visivel).length;
    if (escondidas) avisos.push(`${escondidas} camada(s) vieram desligadas ou congeladas no arquivo e entraram escondidas. Ligue-as no painel de camadas.`);
  }
  const papel = ignorados["espaço de papel"];
  const semSuporte = Object.entries(ignorados).filter(([nome]) => nome !== "fora_de_faixa" && nome !== "espaço de papel");
  if (semSuporte.length) {
    avisos.push(`Não foram importados: ${semSuporte.map(([nome, quantos]) => `${quantos} × ${nome}`).join(", ")}.`);
  }
  if (papel) avisos.push(`${papel} entidade(s) do espaço de papel (carimbo e folhas de impressão) ficaram de fora: o editor lê o espaço do modelo.`);
  if (ignorados.fora_de_faixa) {
    avisos.push(`${ignorados.fora_de_faixa} elemento(s) ficaram fora da faixa de medida aceita e não entraram. Confira a unidade escolhida.`);
  }
  if (!elementos.length) {
    avisos.push("Nenhuma geometria foi encontrada na seção ENTITIES deste arquivo.");
  }

  return {
    camadas, elementos, unidade, unidadeDeclarada: Boolean(unidadeDoArquivo),
    avisos, ignorados, truncado,
  };
}

/** POLYLINE antigo guarda os vértices em entidades VERTEX seguintes, até o SEQEND. */
function agruparPolilinhas(lista: Entidade[]): Entidade[] {
  const saida: Entidade[] = [];
  let aberta: Entidade | null = null;
  for (const entidade of lista) {
    if (entidade.tipo === "VERTEX" && aberta) { aberta.vertices!.push(entidade); continue; }
    if (entidade.tipo === "SEQEND") { aberta = null; continue; }
    aberta = null;
    if (entidade.tipo === "POLYLINE") { entidade.vertices = []; aberta = entidade; }
    saida.push(entidade);
  }
  return saida;
}

/** Polilinha deslocada pela normal, com os cantos no cruzamento das retas vizinhas. */
function deslocarPolilinha(pontos: Pt[], distancia: number, fechada: boolean): Pt[] {
  if (pontos.length < 2 || !distancia) return pontos;
  const n = pontos.length;
  const normalDe = (a: Pt, b: Pt) => { const dx = b.x - a.x, dy = b.y - a.y, m = Math.hypot(dx, dy) || 1; return { x: -dy / m, y: dx / m }; };
  return pontos.map((p, i) => {
    const anterior = i > 0 ? pontos[i - 1] : fechada ? pontos[n - 1] : null;
    const seguinte = i < n - 1 ? pontos[i + 1] : fechada ? pontos[0] : null;
    const n1 = anterior ? normalDe(anterior, p) : null, n2 = seguinte ? normalDe(p, seguinte) : null;
    if (n1 && n2) {
      const soma = { x: n1.x + n2.x, y: n1.y + n2.y }, modulo = Math.hypot(soma.x, soma.y);
      if (modulo < 1e-9) return { x: p.x + n1.x * distancia, y: p.y + n1.y * distancia };
      const bissetriz = { x: soma.x / modulo, y: soma.y / modulo };
      const cos = bissetriz.x * n1.x + bissetriz.y * n1.y;
      const fator = Math.min(6, 1 / Math.max(cos, 1e-3));
      return { x: p.x + bissetriz.x * distancia * fator, y: p.y + bissetriz.y * distancia * fator };
    }
    const unica = n1 ?? n2!;
    return { x: p.x + unica.x * distancia, y: p.y + unica.y * distancia };
  });
}

/**
 * Contornos da hachura. A ordem dos códigos é rígida: ponto de elevação, nome do padrão,
 * sólido (70), número de contornos (91) e, para cada um, o tipo (92) seguido de uma
 * polilinha (72/73/93 e vértices com bulge) ou de arestas (93 e cada aresta pelo 72:
 * reta, arco, arco de elipse ou spline). Depois vêm os objetos de origem (97/330).
 */
function contornosDaHachura(entidade: Entidade): { aneis: Pt[][]; solida: boolean; padrao: string } {
  const p = entidade.pares;
  const padrao = txt(entidade, 2, "").trim();
  const solida = Math.round(num(entidade, 70, 0)) === 1 || padrao.toUpperCase() === "SOLID";
  let i = p.findIndex((par) => par.codigo === 91);
  if (i < 0) return { aneis: [], solida, padrao };
  const contornos = Math.min(500, Math.max(0, Math.round(Number(p[i].valor))));
  i += 1;
  const f = (k: number) => Number.parseFloat(p[k]?.valor ?? "") || 0;
  /** Avança até o próximo par com o código pedido e devolve o valor; -1 quando acaba. */
  const pegar = (codigo: number) => {
    while (i < p.length && p[i].codigo !== codigo) i += 1;
    if (i >= p.length) return NaN;
    const valor = f(i); i += 1; return valor;
  };
  const aneis: Pt[][] = [];
  for (let c = 0; c < contornos && i < p.length; c += 1) {
    const tipo = Math.round(pegar(92));
    if (!Number.isFinite(tipo)) break;
    const anel: Pt[] = [];
    if (tipo & 2) {
      const comBulge = Math.round(pegar(72)) === 1;
      pegar(73);
      const quantos = Math.min(20000, Math.round(pegar(93)));
      const vertices: Array<Pt & { bulge: number }> = [];
      for (let v = 0; v < quantos; v += 1) {
        const x = pegar(10), y = pegar(20);
        const bulge = comBulge ? pegar(42) : 0;
        if (!Number.isFinite(x) || !Number.isFinite(y)) break;
        vertices.push({ x, y, bulge });
      }
      anel.push(...pontosComBulge(vertices, true));
    } else {
      const arestas = Math.min(20000, Math.round(pegar(93)));
      for (let a = 0; a < arestas; a += 1) {
        const tipoAresta = Math.round(pegar(72));
        if (tipoAresta === 1) {
          const inicio = { x: pegar(10), y: pegar(20) }, fim = { x: pegar(11), y: pegar(21) };
          if (!anel.length || anel.at(-1)!.x !== inicio.x || anel.at(-1)!.y !== inicio.y) anel.push(inicio);
          anel.push(fim);
        } else if (tipoAresta === 2) {
          const centro = { x: pegar(10), y: pegar(20) }, raio = pegar(40);
          let inicio = pegar(50), fim = pegar(51);
          const antiHorario = Math.round(pegar(73)) === 1;
          if (!antiHorario) { inicio = 360 - inicio; fim = 360 - fim; }
          let varredura = antiHorario ? fim - inicio : inicio - fim;
          while (varredura <= 0) varredura += 360;
          if (varredura > 360) varredura = 360;
          const passos = passosDaCurva(raio, varredura * Math.PI / 180, 96);
          for (let s = 0; s <= passos; s += 1) {
            const t = (inicio + (antiHorario ? 1 : -1) * varredura * s / passos) * Math.PI / 180;
            anel.push({ x: centro.x + raio * Math.cos(t), y: centro.y + raio * Math.sin(t) });
          }
        } else if (tipoAresta === 3) {
          const centro = { x: pegar(10), y: pegar(20) }, maior = { x: pegar(11), y: pegar(21) }, razao = pegar(40);
          let inicio = pegar(50) * Math.PI / 180, fim = pegar(51) * Math.PI / 180;
          const antiHorario = Math.round(pegar(73)) === 1;
          if (!antiHorario) { const t = inicio; inicio = 2 * Math.PI - fim; fim = 2 * Math.PI - t; }
          const pontos = pontosDaElipse(centro, maior, razao, inicio, fim, antiHorario ? 1 : -1);
          anel.push(...(antiHorario ? pontos : pontos.reverse()));
        } else if (tipoAresta === 4) {
          // Spline de contorno: grau, racional, periódica, nós, controles e ajuste.
          const grau = Math.round(pegar(94)); const racional = Math.round(pegar(73)) === 1; pegar(74);
          const quantosNos = Math.round(pegar(95)), quantosControles = Math.round(pegar(96));
          const pares: Par[] = [{ codigo: 71, valor: String(grau) }];
          for (let k = 0; k < quantosNos; k += 1) pares.push({ codigo: 40, valor: String(pegar(40)) });
          for (let k = 0; k < quantosControles; k += 1) {
            pares.push({ codigo: 10, valor: String(pegar(10)) }, { codigo: 20, valor: String(pegar(20)) });
            if (racional) pares.push({ codigo: 41, valor: String(pegar(42)) });
          }
          anel.push(...pontosDaSpline({ tipo: "SPLINE", pares }));
        } else break;
      }
    }
    // Objetos de origem: um 97 com a contagem e um 330 para cada.
    const origem = i < p.length && p[i].codigo === 97 ? Math.round(f(i)) : 0;
    if (i < p.length && p[i].codigo === 97) i += 1 + Math.max(0, origem);
    if (anel.length >= 3) aneis.push(anel);
  }
  return { aneis, solida, padrao };
}

// ## DWG
//
// Os seis primeiros bytes de todo DWG são a versão em ASCII. Ler isso é trivial e é o
// único proveito honesto que se tira do arquivo aqui: em vez de "formato não suportado",
// a pessoa ouve qual é o arquivo dela e o que fazer com ele.
const VERSOES_DWG: Record<string, string> = {
  AC1009: "AutoCAD R11/R12", AC1012: "AutoCAD R13", AC1014: "AutoCAD R14",
  AC1015: "AutoCAD 2000–2002", AC1018: "AutoCAD 2004–2006", AC1021: "AutoCAD 2007–2009",
  AC1024: "AutoCAD 2010–2012", AC1027: "AutoCAD 2013–2017", AC1032: "AutoCAD 2018 ou mais novo",
};

export function versaoDoDwg(bytes: Uint8Array): { codigo: string; nome: string } | null {
  if (bytes.length < 6) return null;
  const codigo = String.fromCharCode(...bytes.subarray(0, 6));
  if (!/^AC10\d\d$/.test(codigo)) return null;
  return { codigo, nome: VERSOES_DWG[codigo] ?? "versão não catalogada" };
}

// ## Escrita
//
// O caminho de volta. Sem ele a prancheta é uma ilha: o desenho entra e não sai para o
// programa em que o resto do escritório trabalha.
//
// A saída é DXF R12 ASCII, que é o dialeto mais antigo e por isso o que TODO programa
// abre — AutoCAD, BricsCAD, LibreCAD, QCAD, SketchUp, Revit. Versões novas trazem
// recursos que este desenho não usa e fecham a porta de programas antigos: escolher a
// versão mais capaz aqui seria pagar compatibilidade por nada.
//
// O eixo Y volta a apontar para cima, desfazendo a inversão da leitura. Exportar sem
// desfazer devolveria a planta espelhada para quem a mandou.

function par(codigo: number, valor: string | number) {
  return `${codigo}\n${valor}`;
}

// O DXF R12 não tem onde guardar acento, e nome de camada não aceita alguns sinais.
// Trocar é melhor do que gerar um arquivo que o CAD recusa a abrir.
function nomeDeCamada(nome: string, usados: Map<string, string>) {
  const existente = usados.get(nome);
  if (existente) return existente;
  const base = nome.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9_$-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 31) || "CAMADA";
  let candidato = base;
  let n = 2;
  const tomados = new Set(usados.values());
  while (tomados.has(candidato)) { candidato = `${base.slice(0, 28)}-${n}`; n += 1; }
  usados.set(nome, candidato);
  return candidato;
}

const numeroDxf = (valor: number) => Number.isInteger(valor) ? String(valor) : valor.toFixed(4);

// Nome, descrição e trechos (positivo é traço, negativo é intervalo, em mm).
const TIPOS_DXF: Array<[string, string, number[]]> = [
  ["CONTINUOUS", "Solid line", []],
  ["DASHED", "__ __ __", [12.7, -6.35]],
  ["CENTER", "____ _ ____ _", [31.75, -6.35, 6.35, -6.35]],
  ["DOT", ". . . .", [0, -6.35]],
];
const nomeDoTipo = (tipo: TipoLinha | undefined) =>
  tipo === "tracejada" ? "DASHED" : tipo === "traco-ponto" ? "CENTER" : tipo === "pontilhada" ? "DOT" : "CONTINUOUS";

/**
 * Escreve o documento como DXF R12 ASCII, em milímetros.
 *
 * Só sai o que está em camada visível — o mesmo critério da tela e da exportação em SVG,
 * para que as três concordem. Cômodo vira polilinha fechada; a área calculada não vai
 * junto, porque no DXF ela seria texto solto que envelhece assim que alguém mover uma
 * parede. Símbolo e mobília saem como a geometria que representam, não como bloco: bloco
 * exigiria uma tabela de definição que este desenho não mantém.
 */
export function exportarDxf(documento: { camadas: Camada[]; elementos: Elemento[] },
  opcoes: { visiveis?: Elemento[] } = {}): string {
  const elementos = opcoes.visiveis ?? documento.elementos;
  const nomes = new Map<string, string>();
  const camadaDoElemento = new Map<string, string>();
  for (const camada of documento.camadas) camadaDoElemento.set(camada.id, nomeDeCamada(camada.nome, nomes));
  const nomeDe = (id: string) => camadaDoElemento.get(id) ?? "0";

  const linhas: string[] = [];
  const escrever = (codigo: number, valor: string | number) => linhas.push(par(codigo, valor));

  escrever(0, "SECTION"); escrever(2, "HEADER");
  // 4 = milímetro. É o que torna a medida do arquivo inequívoca para quem o abrir.
  escrever(9, "$INSUNITS"); escrever(70, 4);
  escrever(9, "$MEASUREMENT"); escrever(70, 1);
  escrever(0, "ENDSEC");

  escrever(0, "SECTION"); escrever(2, "TABLES");
  // Tipos de linha usados pelas camadas e elementos. Referir um tipo que não está na
  // tabela faz o AutoCAD recusar o arquivo; declarar os quatro é barato.
  escrever(0, "TABLE"); escrever(2, "LTYPE"); escrever(70, 4);
  for (const [nome, descricao, trechos] of TIPOS_DXF) {
    escrever(0, "LTYPE"); escrever(2, nome); escrever(70, 0); escrever(3, descricao); escrever(72, 65);
    escrever(73, trechos.length); escrever(40, numeroDxf(trechos.reduce((soma, t) => soma + Math.abs(t), 0)));
    for (const trecho of trechos) escrever(49, numeroDxf(trecho));
  }
  escrever(0, "ENDTAB");
  escrever(0, "TABLE"); escrever(2, "LAYER"); escrever(70, documento.camadas.length + 1);
  escrever(0, "LAYER"); escrever(2, "0"); escrever(70, 0); escrever(62, 7); escrever(6, "CONTINUOUS");
  for (const camada of documento.camadas) {
    const cor = aciMaisProximo(camada.cor);
    escrever(0, "LAYER"); escrever(2, nomeDe(camada.id));
    escrever(70, camada.bloqueada ? 4 : 0); escrever(62, camada.visivel ? cor : -cor); escrever(6, nomeDoTipo(camada.tipoLinha));
  }
  escrever(0, "ENDTAB"); escrever(0, "ENDSEC");

  escrever(0, "SECTION"); escrever(2, "ENTITIES");

  // Y para cima de novo: é aqui, e só aqui, que a inversão da leitura é desfeita.
  const ex = (valor: number) => numeroDxf(valor);
  const ey = (valor: number) => numeroDxf(-valor);

  // Cor e tipo de linha próprios do elemento; sem eles, "por camada".
  let proprio: Elemento | null = null;
  const estiloProprio = () => {
    if (proprio?.cor) escrever(62, aciMaisProximo(proprio.cor === "#000000" ? null : proprio.cor));
    if (proprio?.tipoLinha) escrever(6, nomeDoTipo(proprio.tipoLinha));
  };
  const linha = (camada: string, a: { x: number; y: number }, b: { x: number; y: number }) => {
    escrever(0, "LINE"); escrever(8, camada); estiloProprio();
    escrever(10, ex(a.x)); escrever(20, ey(a.y)); escrever(30, 0);
    escrever(11, ex(b.x)); escrever(21, ey(b.y)); escrever(31, 0);
  };
  const polilinha = (camada: string, pontos: { x: number; y: number }[], fechada: boolean) => {
    escrever(0, "LWPOLYLINE"); escrever(8, camada); estiloProprio();
    escrever(90, pontos.length); escrever(70, fechada ? 1 : 0);
    for (const ponto of pontos) { escrever(10, ex(ponto.x)); escrever(20, ey(ponto.y)); }
  };
  const texto = (camada: string, posicao: { x: number; y: number }, conteudo: string, alturaMm: number, giro: number,
    ancoraH?: "inicio" | "meio" | "fim", ancoraV?: "base" | "meio" | "topo") => {
    escrever(0, "TEXT"); escrever(8, camada); estiloProprio();
    escrever(10, ex(posicao.x)); escrever(20, ey(posicao.y)); escrever(30, 0);
    escrever(40, numeroDxf(alturaMm));
    escrever(1, conteudo.replace(/[\r\n]+/g, " ").slice(0, 250));
    escrever(50, numeroDxf(((-giro % 360) + 360) % 360));
    const h = ancoraH === "meio" ? 1 : ancoraH === "fim" ? 2 : 0, v = ancoraV === "meio" ? 2 : ancoraV === "topo" ? 3 : 0;
    if (h || v) {
      // Alinhado: o AutoCAD posiciona pelo ponto de alinhamento (11/21).
      escrever(72, h); escrever(11, ex(posicao.x)); escrever(21, ey(posicao.y)); escrever(31, 0); escrever(73, v);
    }
  };

  for (const elemento of elementos) {
    const camada = nomeDe(elemento.camada);
    proprio = elemento;
    switch (elemento.tipo) {
      case "parede":
      case "cota":
        linha(camada, elemento.a, elemento.b);
        break;
      case "comodo":
        polilinha(camada, elemento.pontos, true);
        break;
      case "traco":
        polilinha(camada, elemento.pontos, false);
        break;
      case "abertura": {
        const meia = elemento.larguraMm / 2;
        const radianos = elemento.rotacaoGraus * Math.PI / 180;
        const girar = (dx: number, dy: number) => ({
          x: elemento.posicao.x + dx * Math.cos(radianos) - dy * Math.sin(radianos),
          y: elemento.posicao.y + dx * Math.sin(radianos) + dy * Math.cos(radianos),
        });
        linha(camada, girar(-meia, 0), girar(meia, 0));
        break;
      }
      case "mobilia":
      case "imagem": {
        const meiaLargura = elemento.larguraMm / 2;
        const meiaAltura = elemento.alturaMm / 2;
        const radianos = elemento.rotacaoGraus * Math.PI / 180;
        const girar = (dx: number, dy: number) => ({
          x: elemento.posicao.x + dx * Math.cos(radianos) - dy * Math.sin(radianos),
          y: elemento.posicao.y + dx * Math.sin(radianos) + dy * Math.cos(radianos),
        });
        polilinha(camada, [
          girar(-meiaLargura, -meiaAltura), girar(meiaLargura, -meiaAltura),
          girar(meiaLargura, meiaAltura), girar(-meiaLargura, meiaAltura),
        ], true);
        if (elemento.tipo === "mobilia" && elemento.rotulo) {
          texto(camada, elemento.posicao, elemento.rotulo, Math.max(50, elemento.alturaMm / 6), elemento.rotacaoGraus);
        }
        break;
      }
      case "simbolo": {
        // Círculo de referência com o rótulo ao lado: o glifo da tela é desenho de tela,
        // e reproduzi-lo em segmentos encheria o arquivo de traço sem significado. O
        // ponto e o nome dele são o que o outro programa precisa.
        escrever(0, "CIRCLE"); escrever(8, camada); estiloProprio();
        escrever(10, ex(elemento.posicao.x)); escrever(20, ey(elemento.posicao.y)); escrever(30, 0);
        escrever(40, 120);
        texto(camada, { x: elemento.posicao.x + 180, y: elemento.posicao.y }, elemento.rotulo ?? elemento.familia, 150, 0);
        break;
      }
      case "arco": {
        // Sai como curva de verdade, não como cem segmentos: o outro programa precisa
        // poder cotar o raio e prolongar o arco.
        if (elemento.varreduraGraus >= 360) {
          escrever(0, "CIRCLE"); escrever(8, camada); estiloProprio();
          escrever(10, ex(elemento.centro.x)); escrever(20, ey(elemento.centro.y)); escrever(30, 0);
          escrever(40, numeroDxf(elemento.raioMm));
        } else {
          escrever(0, "ARC"); escrever(8, camada); estiloProprio();
          escrever(10, ex(elemento.centro.x)); escrever(20, ey(elemento.centro.y)); escrever(30, 0);
          escrever(40, numeroDxf(elemento.raioMm));
          // O ângulo do desenho já é anti-horário a partir do +X, igual ao do DXF: o que
          // muda entre os dois é só o sentido do Y, e esse é desfeito acima.
          escrever(50, numeroDxf(elemento.inicioGraus));
          escrever(51, numeroDxf((elemento.inicioGraus + elemento.varreduraGraus) % 360));
        }
        break;
      }
      case "texto":
        texto(camada, elemento.posicao, elemento.texto, elemento.alturaMm, elemento.rotacaoGraus, elemento.ancoraH, elemento.ancoraV);
        break;
      case "hachura":
        // O DXF R12 não tem HATCH: sai o contorno de cada anel, fechado.
        for (const anel of elemento.aneis) polilinha(camada, anel, true);
        break;
    }
  }

  escrever(0, "ENDSEC");
  escrever(0, "EOF");
  return `${linhas.join("\n")}\n`;
}
