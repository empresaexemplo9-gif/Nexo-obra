import { buildPdf, deflate, pdfNumber } from "@/lib/pdf-writer";

// Desenho técnico como primitivas: traços, triângulos (texto, hachura sólida) e pontos,
// já com a transformação de cada bloco aplicada. É exatamente o que o visualizador
// desenhou na tela, então o PDF e o SVG gerados daqui saem iguais ao que a pessoa viu —
// vetoriais, sem virar imagem.

export type Primitiva = {
  tipo: "linhas" | "triangulos" | "pontos";
  /** 0xRRGGBB */
  cor: number;
  /** Pares x,y. Linhas: 2 pontos por segmento. Triângulos: 3 pontos por triângulo. */
  coords: Float64Array | number[];
};

export type Limites = { minX: number; minY: number; maxX: number; maxY: number };

/** Folhas ISO em milímetros, deitadas. */
export const FOLHAS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] } as const;
export type Folha = keyof typeof FOLHAS;

const MM_PT = 72 / 25.4;

export function limitesDe(primitivas: Primitiva[]): Limites | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const primitiva of primitivas) {
    const c = primitiva.coords;
    for (let i = 0; i + 1 < c.length; i += 2) {
      const x = c[i], y = c[i + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function rgb(cor: number, monocromatico: boolean) {
  if (monocromatico) return [0, 0, 0];
  return [(cor >> 16) & 255, (cor >> 8) & 255, cor & 255].map((value) => value / 255);
}

/** Enquadra os limites na área útil, mantendo a proporção; devolve a função de pontos. */
export function enquadrar(limites: Limites, largura: number, altura: number, margem: number, inverterY: boolean) {
  const w = Math.max(limites.maxX - limites.minX, 1e-9);
  const h = Math.max(limites.maxY - limites.minY, 1e-9);
  const escala = Math.min((largura - 2 * margem) / w, (altura - 2 * margem) / h);
  const dx = margem + ((largura - 2 * margem) - w * escala) / 2;
  const dy = margem + ((altura - 2 * margem) - h * escala) / 2;
  return {
    escala,
    x: (x: number) => dx + (x - limites.minX) * escala,
    y: inverterY ? (y: number) => altura - (dy + (y - limites.minY) * escala) : (y: number) => dy + (y - limites.minY) * escala,
  };
}

/**
 * Fluxo de conteúdo do PDF. Segmentos encadeados (fim de um = início do outro) viram uma
 * polilinha só: o arquivo fica bem menor e o traço sai contínuo na impressão.
 */
export function conteudoPdf(primitivas: Primitiva[], limites: Limites, larguraPt: number, alturaPt: number, opcoes: { monocromatico: boolean; espessuraPt?: number }) {
  const t = enquadrar(limites, larguraPt, alturaPt, 10 * MM_PT, false);
  const n = pdfNumber;
  const linhas: string[] = [`1 J 1 j ${n(opcoes.espessuraPt ?? 0.3)} w`];
  const porCor = new Map<string, Primitiva[]>();
  for (const primitiva of primitivas) {
    const chave = `${primitiva.tipo}:${opcoes.monocromatico ? 0 : primitiva.cor}`;
    const lista = porCor.get(chave) ?? [];
    lista.push(primitiva);
    porCor.set(chave, lista);
  }
  for (const [chave, grupo] of porCor) {
    const tipo = chave.split(":")[0] as Primitiva["tipo"];
    const [r, g, b] = rgb(grupo[0].cor, opcoes.monocromatico);
    if (tipo === "linhas") {
      linhas.push(`${n(r)} ${n(g)} ${n(b)} RG`);
      let fimX = NaN, fimY = NaN, aberto = 0;
      for (const primitiva of grupo) {
        const c = primitiva.coords;
        for (let i = 0; i + 3 < c.length; i += 4) {
          const x1 = t.x(c[i]), y1 = t.y(c[i + 1]), x2 = t.x(c[i + 2]), y2 = t.y(c[i + 3]);
          // Escrito como "não encadeia" para que o NaN do início (sem ponto anterior) abra o traço.
          const encadeia = Math.abs(x1 - fimX) <= 1e-3 && Math.abs(y1 - fimY) <= 1e-3;
          if (!encadeia) linhas.push(`${n(x1)} ${n(y1)} m`);
          linhas.push(`${n(x2)} ${n(y2)} l`);
          fimX = x2; fimY = y2;
          // Caminho gigante estoura a memória de alguns leitores: fecha a cada 2 mil trechos.
          if (++aberto >= 2000) { linhas.push("S"); aberto = 0; fimX = NaN; }
        }
      }
      if (aberto) linhas.push("S");
    } else if (tipo === "triangulos") {
      linhas.push(`${n(r)} ${n(g)} ${n(b)} rg`);
      let abertos = 0;
      for (const primitiva of grupo) {
        const c = primitiva.coords;
        for (let i = 0; i + 5 < c.length; i += 6) {
          linhas.push(`${n(t.x(c[i]))} ${n(t.y(c[i + 1]))} m ${n(t.x(c[i + 2]))} ${n(t.y(c[i + 3]))} l ${n(t.x(c[i + 4]))} ${n(t.y(c[i + 5]))} l h`);
          if (++abertos >= 2000) { linhas.push("f"); abertos = 0; }
        }
      }
      if (abertos) linhas.push("f");
    } else {
      linhas.push(`${n(r)} ${n(g)} ${n(b)} rg`);
      for (const primitiva of grupo) {
        const c = primitiva.coords;
        for (let i = 0; i + 1 < c.length; i += 2) linhas.push(`${n(t.x(c[i]) - 0.5)} ${n(t.y(c[i + 1]) - 0.5)} 1 1 re f`);
      }
    }
  }
  return linhas.join("\n");
}

export function orientacaoPara(limites: Limites, folha: Folha) {
  const [maior, menor] = FOLHAS[folha];
  const deitado = limites.maxX - limites.minX >= limites.maxY - limites.minY;
  return deitado ? { larguraPt: maior * MM_PT, alturaPt: menor * MM_PT } : { larguraPt: menor * MM_PT, alturaPt: maior * MM_PT };
}

export async function pdfDoDesenho(primitivas: Primitiva[], opcoes: { folha: Folha; monocromatico: boolean; titulo: string }) {
  const limites = limitesDe(primitivas);
  if (!limites) throw new Error("O desenho não tem nada visível para exportar. Ligue alguma camada.");
  const { larguraPt, alturaPt } = orientacaoPara(limites, opcoes.folha);
  const conteudo = new TextEncoder().encode(conteudoPdf(primitivas, limites, larguraPt, alturaPt, { monocromatico: opcoes.monocromatico }));
  return buildPdf([{ width: larguraPt, height: alturaPt, content: await deflate(conteudo), contentCompressed: true }], { title: opcoes.titulo });
}

const escaparXml = (value: string) => value.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

/**
 * SVG com o viewBox nas unidades do desenho: as proporções e medidas relativas são as do
 * CAD. Sem largura e altura fixas, porque em milímetro uma planta vira uma página de
 * quilômetros; o programa que abre ajusta à tela.
 */
export function svgDoDesenho(primitivas: Primitiva[], opcoes: { monocromatico: boolean; titulo: string }) {
  const limites = limitesDe(primitivas);
  if (!limites) throw new Error("O desenho não tem nada visível para exportar. Ligue alguma camada.");
  const w = Math.max(limites.maxX - limites.minX, 1e-9), h = Math.max(limites.maxY - limites.minY, 1e-9);
  const n = (value: number) => pdfNumber(value);
  const hex = (cor: number) => opcoes.monocromatico ? "#000" : `#${cor.toString(16).padStart(6, "0")}`;
  // Y do CAD cresce para cima; o do SVG para baixo.
  const X = (x: number) => n(x - limites.minX), Y = (y: number) => n(limites.maxY - y);
  const corpo: string[] = [];
  for (const primitiva of primitivas) {
    const c = primitiva.coords;
    if (primitiva.tipo === "linhas") {
      let d = "", fimX = NaN, fimY = NaN;
      for (let i = 0; i + 3 < c.length; i += 4) {
        if (c[i] !== fimX || c[i + 1] !== fimY) d += `M${X(c[i])} ${Y(c[i + 1])}`;
        d += `L${X(c[i + 2])} ${Y(c[i + 3])}`;
        fimX = c[i + 2]; fimY = c[i + 3];
      }
      if (d) corpo.push(`<path d="${d}" stroke="${hex(primitiva.cor)}"/>`);
    } else if (primitiva.tipo === "triangulos") {
      let d = "";
      for (let i = 0; i + 5 < c.length; i += 6) d += `M${X(c[i])} ${Y(c[i + 1])}L${X(c[i + 2])} ${Y(c[i + 3])}L${X(c[i + 4])} ${Y(c[i + 5])}Z`;
      if (d) corpo.push(`<path d="${d}" fill="${hex(primitiva.cor)}" stroke="none"/>`);
    } else {
      for (let i = 0; i + 1 < c.length; i += 2) corpo.push(`<circle cx="${X(c[i])}" cy="${Y(c[i + 1])}" r="${n(Math.max(w, h) / 2000)}" fill="${hex(primitiva.cor)}"/>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(w)} ${n(h)}" preserveAspectRatio="xMidYMid meet">` +
    // Traço de espessura fixa na tela, em qualquer zoom — como no CAD.
    `<title>${escaparXml(opcoes.titulo)}</title><style>path[stroke]{vector-effect:non-scaling-stroke}</style><rect width="100%" height="100%" fill="#fff"/>` +
    `<g fill="none" stroke-width="0.6" stroke-linecap="round" stroke-linejoin="round">${corpo.join("")}</g></svg>\n`;
}
