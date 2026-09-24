import { executeCadCommand } from "@/lib/cad-commands";
import { camadaBloqueada, elementosVisiveis, limitesEmCache, type Documento } from "@/lib/prancheta";
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
