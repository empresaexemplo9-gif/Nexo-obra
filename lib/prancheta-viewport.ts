import type { Elemento } from "./prancheta";
import { limitesDoDesenho } from "./prancheta";

export type VistaPrancheta = Readonly<{
  x: number;
  y: number;
  largura: number;
  proporcao: number;
}>;

export const PROPORCAO_VISTA_PRANCHETA = 0.62;
export const LARGURA_VISTA_MINIMA = 800;
export const LARGURA_VISTA_MAXIMA = 400_000;

export function criarVista(x = -2_000, y = -2_000, largura = 24_000): VistaPrancheta {
  return { x, y, largura: limitarLargura(largura), proporcao: PROPORCAO_VISTA_PRANCHETA };
}

export function limitarLargura(largura: number): number {
  if (!Number.isFinite(largura)) return 24_000;
  return Math.min(LARGURA_VISTA_MAXIMA, Math.max(LARGURA_VISTA_MINIMA, Math.round(largura)));
}

/** Zoom ancorado no ponto sob o cursor, para que a geometria não "escape" da mão. */
export function zoomNaVista(vista: VistaPrancheta, fator: number, ancora: { x: number; y: number }): VistaPrancheta {
  if (!Number.isFinite(fator) || fator <= 0) return vista;
  const largura = limitarLargura(vista.largura * fator);
  const escala = largura / vista.largura;
  return {
    ...vista,
    x: ancora.x - (ancora.x - vista.x) * escala,
    y: ancora.y - (ancora.y - vista.y) * escala,
    largura,
  };
}

/** Enquadra o desenho inteiro, mantendo uma margem para seleção e novos traços. */
export function enquadrarElementos(elementos: Elemento[], margem = 1_000): VistaPrancheta {
  const limites = limitesDoDesenho(elementos);
  if (!limites) return criarVista();
  const folga = Math.max(100, Number.isFinite(margem) ? margem : 1_000);
  const largura = Math.max(limites.x2 - limites.x1, (limites.y2 - limites.y1) / PROPORCAO_VISTA_PRANCHETA) + folga * 2;
  const centroX = (limites.x1 + limites.x2) / 2;
  const centroY = (limites.y1 + limites.y2) / 2;
  return {
    x: centroX - largura / 2,
    y: centroY - largura * PROPORCAO_VISTA_PRANCHETA / 2,
    largura: limitarLargura(largura),
    proporcao: PROPORCAO_VISTA_PRANCHETA,
  };
}
