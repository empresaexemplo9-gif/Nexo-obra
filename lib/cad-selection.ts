import { executeCadCommand } from "@/lib/cad-commands";
import { camadaBloqueada, elementosVisiveis, limitesEmCache, pontosDoArco, type Documento } from "@/lib/prancheta";
import type { Ponto } from "@/lib/prancheta-cad";

const GROUP_COMMANDS = new Set(["M", "MOVE", "CO", "COPY", "RO", "ROTATE", "SC", "SCALE", "MI", "MIRROR", "O", "OFFSET", "AR", "ARRAY", "AP", "ARRAYPOLAR", "E", "ERASE", "J", "CLOSE"]);

/** Uma operação em grupo só é entregue depois que TODOS os elementos foram validados. */
export function executarNaSelecao(documento: Documento, input: string, ids: readonly string[], novoId?: () => string, camada?: string) {
  const command = input.trim().split(/\s+/)[0].toUpperCase();
  const grupo = GROUP_COMMANDS.has(command);
  if (!grupo && ids.length > 1 && ["TR", "TRIM", "EX", "EXTEND"].includes(command)) throw new Error("Apare ou estenda um elemento por vez.");
  const alvos = grupo ? [...new Set(ids)] : [ids.at(-1) ?? null];
  if (!alvos.length) throw new Error("Selecione pelo menos um elemento.");
  let proximo = documento;
  const selecionados: string[] = [];
  let mensagem = "";
  for (const id of alvos) {
    const result = executeCadCommand(proximo, input, id, novoId, camada);
    proximo = result.document;
    if (result.selectedId) selecionados.push(result.selectedId);
    mensagem = result.message;
  }
  return { document: proximo, selectedIds: selecionados, message: grupo ? `${mensagem} ${alvos.length} elemento(s).` : mensagem };
}

/** Janela de contenção: seleciona somente elementos inteiros, visíveis e destravados. */
export function selecionarNaJanela(documento: Documento, a: Ponto, b: Ponto): string[] {
  const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
  return elementosVisiveis(documento).filter(e => {
    if (camadaBloqueada(documento, e.camada)) return false;
    const box = limitesEmCache(e);
    return box.x1 >= x1 && box.x2 <= x2 && box.y1 >= y1 && box.y2 <= y2;
  }).map(e => e.id);
}

/** Segmento toca o retângulo: uma ponta dentro ou cruza uma das quatro bordas. */
function segmentoNoRetangulo(a: Ponto, b: Ponto, x1: number, y1: number, x2: number, y2: number) {
  const dentro = (p: Ponto) => p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;
  if (dentro(a) || dentro(b)) return true;
  if (Math.max(a.x, b.x) < x1 || Math.min(a.x, b.x) > x2 || Math.max(a.y, b.y) < y1 || Math.min(a.y, b.y) > y2) return false;
  const lado = (p: Ponto) => Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
  const cantos = [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }].map(lado);
  // A reta passa pelo retângulo quando os cantos não ficam todos do mesmo lado dela.
  return cantos.some((s) => s !== cantos[0]) || cantos[0] === 0;
}

function pontoNoPoligono(p: Ponto, pontos: Ponto[]) {
  let dentro = false;
  for (let i = 0, j = pontos.length - 1; i < pontos.length; j = i++) {
    const a = pontos[i], b = pontos[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) dentro = !dentro;
  }
  return dentro;
}

/** Janela cruzada (da direita para a esquerda no AutoCAD): pega tudo que ela toca, não
 *  só o que está inteiro dentro. O toque é pelo traço de verdade, não pela caixa — uma
 *  diagonal cuja caixa encosta na janela mas que passa longe não entra. */
export function selecionarCruzando(documento: Documento, a: Ponto, b: Ponto): string[] {
  const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
  const centro = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  return elementosVisiveis(documento).filter((e) => {
    if (camadaBloqueada(documento, e.camada)) return false;
    const box = limitesEmCache(e);
    if (box.x2 < x1 || box.x1 > x2 || box.y2 < y1 || box.y1 > y2) return false;
    if (box.x1 >= x1 && box.x2 <= x2 && box.y1 >= y1 && box.y2 <= y2) return true;
    const cadeia = (pontos: Ponto[], fechada = false) => {
      for (let i = 1; i < pontos.length; i += 1) if (segmentoNoRetangulo(pontos[i - 1], pontos[i], x1, y1, x2, y2)) return true;
      return fechada && pontos.length > 2 && segmentoNoRetangulo(pontos.at(-1)!, pontos[0], x1, y1, x2, y2);
    };
    switch (e.tipo) {
      case "parede": case "cota": return segmentoNoRetangulo(e.a, e.b, x1, y1, x2, y2);
      case "traco": return cadeia(e.pontos);
      case "arco": return cadeia(pontosDoArco(e));
      case "comodo": return cadeia(e.pontos, true) || pontoNoPoligono(centro, e.pontos);
      case "hachura": return e.aneis.some((anel) => cadeia(anel, true)) || e.aneis.filter((anel) => pontoNoPoligono(centro, anel)).length % 2 === 1;
      default: return true;
    }
  }).map((e) => e.id);
}
