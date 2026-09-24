// Cores e tipos de linha do desenho CAD.
//
// O DWG guarda cor pelo índice da paleta do AutoCAD (ACI, 1 a 255) ou em RGB. A paleta é
// fixa e documentada: 1 a 9 são as cores básicas, 10 a 249 variam o matiz de 15 em 15
// graus em cinco intensidades (cheia e meio-tom), 250 a 255 são cinzas. Gerar a tabela
// pela regra evita copiar 255 números à mão.
//
// A cor 7 é "tinta": branca no fundo escuro do AutoCAD e preta no papel. Por isso ela
// não vira hexadecimal aqui — fica sem cor, e a tela escolhe conforme o fundo.

const BASICAS: Record<number, string> = {
  1: "#ff0000", 2: "#ffff00", 3: "#00ff00", 4: "#00ffff", 5: "#0000ff", 6: "#ff00ff",
  8: "#808080", 9: "#c0c0c0",
};
const CINZAS = [51, 91, 132, 173, 214, 255];
const NIVEIS = [255, 165, 127, 76, 38];

const hex2 = (valor: number) => Math.max(0, Math.min(255, Math.round(valor))).toString(16).padStart(2, "0");
export const rgbHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

function hsv(matiz: number, saturacao: number, valor: number) {
  const c = valor * saturacao, x = c * (1 - Math.abs(((matiz / 60) % 2) - 1)), m = valor - c;
  const [r, g, b] = matiz < 60 ? [c, x, 0] : matiz < 120 ? [x, c, 0] : matiz < 180 ? [0, c, x] : matiz < 240 ? [0, x, c] : matiz < 300 ? [x, 0, c] : [c, 0, x];
  return rgbHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

const PALETA: Array<string | null> = Array.from({ length: 256 }, (_, indice) => {
  if (indice === 0 || indice === 7) return null;
  if (BASICAS[indice]) return BASICAS[indice];
  if (indice >= 250) { const v = CINZAS[indice - 250]; return rgbHex(v, v, v); }
  if (indice >= 10) {
    const matiz = Math.floor((indice - 10) / 10) * 15, passo = (indice - 10) % 10;
    return hsv(matiz, passo % 2 ? 0.5 : 1, NIVEIS[Math.floor(passo / 2)] / 255);
  }
  return null;
});

/** Hexadecimal de um índice ACI; `null` para tinta (7), por bloco (0) e por camada (256). */
export function corAci(indice: number): string | null {
  const absoluto = Math.abs(Math.trunc(indice));
  return absoluto >= 1 && absoluto <= 255 ? PALETA[absoluto] : null;
}

/** Cor verdadeira do DXF (código 420): inteiro 0xRRGGBB. */
export function corVerdadeira(valor: number): string | null {
  if (!Number.isFinite(valor) || valor < 0) return null;
  const n = Math.trunc(valor) & 0xffffff;
  const cor = rgbHex(n >> 16, (n >> 8) & 255, n & 255);
  // Branco puro e preto puro também são tinta: o desenhista quis "a cor do papel ao contrário".
  return cor === "#ffffff" || cor === "#000000" ? null : cor;
}

/** Índice ACI mais próximo de uma cor, para o DXF R12, que só conhece a paleta. */
export function aciMaisProximo(cor: string | null | undefined): number {
  if (!cor) return 7;
  const n = Number.parseInt(cor.slice(1), 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  let melhor = 7, menor = Infinity;
  for (let indice = 1; indice <= 255; indice += 1) {
    const candidato = PALETA[indice];
    if (!candidato) continue;
    const m = Number.parseInt(candidato.slice(1), 16);
    const d = (r - (m >> 16)) ** 2 + (g - ((m >> 8) & 255)) ** 2 + (b - (m & 255)) ** 2;
    if (d < menor) { menor = d; melhor = indice; }
  }
  return melhor;
}

/**
 * Cor legível no fundo da tela. Amarelo e ciano puros somem no papel branco, e azul
 * escuro some no fundo preto; o traço fica com o mesmo matiz, só mais escuro ou mais claro.
 */
export function corNaTela(cor: string | null | undefined, fundoEscuro: boolean): string {
  if (!cor) return fundoEscuro ? "#f2f0e8" : "#1C190F";
  const n = Number.parseInt(cor.slice(1), 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const luz = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (!fundoEscuro && luz > 0.72) { const f = 0.72 / luz; return rgbHex(r * f, g * f, b * f); }
  if (fundoEscuro && luz < 0.3) { const f = 0.35; return rgbHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f); }
  return cor;
}

export const TIPOS_LINHA = ["continua", "tracejada", "traco-ponto", "pontilhada"] as const;
export type TipoLinha = typeof TIPOS_LINHA[number];
export const tipoLinhaLabels: Record<TipoLinha, string> = {
  continua: "Contínua", tracejada: "Tracejada", "traco-ponto": "Traço e ponto (eixo)", pontilhada: "Pontilhada",
};

/** Tipo de linha pelo nome do DWG: DASHED, HIDDEN, CENTER, DOT, TRACEJADA, EIXO… */
export function tipoLinhaPeloNome(nome: string | null | undefined): TipoLinha | undefined {
  const limpo = (nome ?? "").toUpperCase();
  if (!limpo || limpo === "CONTINUOUS" || limpo === "BYLAYER" || limpo === "BYBLOCK") return undefined;
  if (/CENTER|DASHDOT|PHANTOM|DIVIDE|EIXO|TRACO.?PONTO/.test(limpo)) return "traco-ponto";
  if (/DOT|PONT/.test(limpo)) return "pontilhada";
  if (/DASH|HIDDEN|TRACEJ|OCULT|BORDER/.test(limpo)) return "tracejada";
  return undefined;
}

/** Traço e intervalo em milímetros do desenho, proporcionais à escala de impressão. */
export function tracejadoPara(tipo: TipoLinha | undefined, escala: number): string | undefined {
  const u = Math.max(1, escala) * 2; // 2 mm no papel
  if (!tipo || tipo === "continua") return undefined;
  if (tipo === "tracejada") return `${u * 3} ${u * 1.5}`;
  if (tipo === "pontilhada") return `${u * 0.3} ${u}`;
  return `${u * 5} ${u} ${u * 0.5} ${u}`;
}
