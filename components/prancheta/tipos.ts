import type { Conversao } from "@/lib/prancheta-formatos";
import type { Folha } from "@/lib/prancheta-desenho";

export type SaidaConversao = { blob: Blob; nome: string };
export type OpcoesConversao = { folha: Folha; monocromatico: boolean; paginas: "atual" | "todas" };

/** O que um visualizador sabe fazer com o arquivo aberto, além de mostrá-lo. */
export type ControleVisualizador = {
  disponiveis: Conversao["id"][];
  converter: (id: Conversao["id"], opcoes: OpcoesConversao) => Promise<SaidaConversao[]>;
};

export type PropsVisualizador = {
  blob: Blob;
  nome: string;
  extensao: string;
  onControle?: (controle: ControleVisualizador | null) => void;
};

export function nomeSemExtensao(nome: string) {
  return nome.replace(/\.[a-z0-9]{1,12}$/i, "");
}
