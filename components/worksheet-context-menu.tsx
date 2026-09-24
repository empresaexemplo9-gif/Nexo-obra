"use client";

// Menu do botão direito da planilha, com as ações que o Excel e o Google Planilhas põem
// ali. Também abre por teclado (tecla Menu ou Shift+F10) e com toque longo no celular.
// Cada ação é despachada para a tela, que aplica com desfazer; o menu não muda nada sozinho.

import {
  AlignCenter, AlignLeft, AlignRight, ArrowDownAZ, ArrowDownWideNarrow, Bold, ClipboardPaste, Columns3, Copy, EyeOff, Eye,
  Filter, Italic, ListChecks, Paintbrush, Pin, PinOff, Rows3, Scissors, Sigma, StickyNote, Strikethrough, TableCellsMerge,
  TableCellsSplit, Trash2, Underline, WrapText, MoveHorizontal, ArrowDownToLine, ArrowRightToLine, Eraser, SquareDashedMousePointer,
} from "lucide-react";

import {
  ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub,
  ContextMenuSubContent, ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { colorLabels, fillColors, textColors } from "@/lib/worksheet-format";
import type { AlvoDoMenu } from "@/components/worksheets-workspace";

export type AcaoDoMenu =
  | "recortar" | "copiar" | "colar" | "colar-valores" | "colar-formatacao" | "colar-transposto"
  | "inserir-linhas-acima" | "inserir-linhas-abaixo" | "inserir-colunas-esquerda" | "inserir-colunas-direita"
  | "excluir-linhas" | "excluir-colunas"
  | "limpar-conteudo" | "limpar-formatacao" | "limpar-tudo"
  | "ordenar-asc" | "ordenar-desc" | "filtrar-valor"
  | "negrito" | "italico" | "sublinhado" | "tachado" | "quebra"
  | "alinhar-esquerda" | "alinhar-centro" | "alinhar-direita"
  | "mesclar" | "desmesclar"
  | "nota" | "excluir-nota"
  | "ocultar-linhas" | "ocultar-colunas" | "reexibir-linhas" | "reexibir-colunas"
  | "autoajustar" | "fixar-ate-aqui" | "soltar-fixas"
  | "preencher-baixo" | "preencher-direita" | "autosoma"
  | "selecionar-linha" | "selecionar-coluna"
  | "validacao" | "formatacao-condicional"
  | `cor:${string}` | `fundo:${string}`;

export type EstadoDoMenu = {
  alvo: AlvoDoMenu;
  readOnly: boolean;
  /** Quantas linhas e colunas estão marcadas, para "Inserir 3 linhas acima". */
  linhas: number; colunas: number;
  /** "linhas 3–5", "colunas B–D", "A1:C4" — o que a ação vai atingir. */
  rotuloLinhas: string; rotuloColunas: string; rotuloIntervalo: string;
  temRecorte: boolean;
  temNota: boolean;
  mesclada: boolean;
  podeMesclar: boolean;
  fixas: number;
  colunaDoCursor: number;
  ocultas: { linhas: number; colunas: number };
};

const atalho = (texto: string) => <ContextMenuShortcut>{texto}</ContextMenuShortcut>;

export function WorksheetContextMenu({ estado, onAcao }: { estado: EstadoDoMenu; onAcao: (acao: AcaoDoMenu) => void }) {
  const { alvo, readOnly, linhas, colunas } = estado;
  const item = (acao: AcaoDoMenu, rotulo: string, icone: React.ReactNode, extra?: { atalho?: string; desabilitado?: boolean; perigo?: boolean }) => (
    <ContextMenuItem key={acao} disabled={extra?.desabilitado} variant={extra?.perigo ? "destructive" : "default"} onSelect={() => onAcao(acao)}
      // No Linux o menu abre no pressionar do botão direito. Se ele for reposicionado para
      // caber na tela, o soltar do mesmo botão cai sobre um item e o executaria sozinho —
      // ordenar ou excluir sem a pessoa ter escolhido nada. Só o botão principal seleciona.
      onPointerUp={(event) => { if (event.button !== 0) event.preventDefault(); }}>
      {icone}{rotulo}{extra?.atalho ? atalho(extra.atalho) : null}
    </ContextMenuItem>
  );
  const plural = (n: number, um: string, varios: string) => n === 1 ? um : `${n} ${varios}`;
  const linhasTxt = plural(linhas, "linha", "linhas"), colunasTxt = plural(colunas, "coluna", "colunas");

  return <ContextMenuContent className="w-[min(18rem,var(--radix-context-menu-content-available-width))]" collisionPadding={8} aria-label="Ações da planilha">
    <ContextMenuLabel className="text-xs font-normal text-hoikos-500">
      {alvo.tipo === "linha" ? estado.rotuloLinhas : alvo.tipo === "coluna" ? estado.rotuloColunas : estado.rotuloIntervalo}
    </ContextMenuLabel>
    {readOnly ? null : item("recortar", "Recortar", <Scissors />, { atalho: "Ctrl+X" })}
    {item("copiar", "Copiar", <Copy />, { atalho: "Ctrl+C" })}
    {readOnly ? null : <>
      {item("colar", "Colar", <ClipboardPaste />, { atalho: "Ctrl+V" })}
      <ContextMenuSub>
        <ContextMenuSubTrigger><ClipboardPaste className="mr-2" />Colar especial</ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-64">
          {!estado.temRecorte ? <ContextMenuLabel className="text-xs font-normal text-hoikos-500">Copie ou recorte na planilha primeiro</ContextMenuLabel> : null}
          {item("colar-valores", "Somente valores", <Sigma />, { desabilitado: !estado.temRecorte })}
          {item("colar-formatacao", "Somente formatação", <Paintbrush />, { desabilitado: !estado.temRecorte })}
          {item("colar-transposto", "Transposto (linhas viram colunas)", <MoveHorizontal />, { desabilitado: !estado.temRecorte })}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />

      {alvo.tipo !== "coluna" ? <>
        {item("inserir-linhas-acima", `Inserir ${linhasTxt} acima`, <Rows3 />)}
        {item("inserir-linhas-abaixo", `Inserir ${linhasTxt} abaixo`, <Rows3 />)}
      </> : null}
      {alvo.tipo !== "linha" ? <>
        {item("inserir-colunas-esquerda", `Inserir ${colunasTxt} à esquerda`, <Columns3 />)}
        {item("inserir-colunas-direita", `Inserir ${colunasTxt} à direita`, <Columns3 />)}
      </> : null}
      {alvo.tipo !== "coluna" ? item("excluir-linhas", `Excluir ${estado.rotuloLinhas}`, <Trash2 />, { perigo: true }) : null}
      {alvo.tipo !== "linha" ? item("excluir-colunas", `Excluir ${estado.rotuloColunas}`, <Trash2 />, { perigo: true }) : null}
      <ContextMenuSub>
        <ContextMenuSubTrigger><Eraser className="mr-2" />Limpar</ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-56">
          {item("limpar-conteudo", "Conteúdo", <Eraser />, { atalho: "Delete" })}
          {item("limpar-formatacao", "Formatação", <Paintbrush />)}
          {item("limpar-tudo", "Tudo (conteúdo, formatação e notas)", <Trash2 />)}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />

      {item("ordenar-asc", `Ordenar pela coluna, A → Z`, <ArrowDownAZ />)}
      {item("ordenar-desc", `Ordenar pela coluna, Z → A`, <ArrowDownWideNarrow />)}
    </>}
    {alvo.tipo === "celula" ? item("filtrar-valor", "Filtrar pelo valor desta célula", <Filter />) : null}
    {readOnly ? null : <>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger><Bold className="mr-2" />Formatar texto</ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-60">
          {item("negrito", "Negrito", <Bold />, { atalho: "Ctrl+B" })}
          {item("italico", "Itálico", <Italic />, { atalho: "Ctrl+I" })}
          {item("sublinhado", "Sublinhado", <Underline />, { atalho: "Ctrl+U" })}
          {item("tachado", "Tachado", <Strikethrough />)}
          <ContextMenuSeparator />
          {item("alinhar-esquerda", "Alinhar à esquerda", <AlignLeft />)}
          {item("alinhar-centro", "Centralizar", <AlignCenter />)}
          {item("alinhar-direita", "Alinhar à direita", <AlignRight />)}
          {item("quebra", "Quebrar texto na célula", <WrapText />)}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger><Paintbrush className="mr-2" />Cores</ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-52">
          <ContextMenuLabel className="text-xs">Cor do texto</ContextMenuLabel>
          {item("cor:", "Padrão", <span className="size-3 rounded-full border" />)}
          {Object.entries(textColors).map(([cor, hex]) => item(`cor:${cor}`, colorLabels[cor], <span className="size-3 rounded-full" style={{ backgroundColor: hex }} />))}
          <ContextMenuSeparator />
          <ContextMenuLabel className="text-xs">Preenchimento</ContextMenuLabel>
          {item("fundo:", "Nenhum", <span className="size-3 rounded-sm border" />)}
          {Object.entries(fillColors).map(([cor, hex]) => item(`fundo:${cor}`, colorLabels[cor], <span className="size-3 rounded-sm border" style={{ backgroundColor: hex }} />))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      {estado.mesclada
        ? item("desmesclar", "Desfazer mesclagem", <TableCellsSplit />)
        : item("mesclar", "Mesclar células", <TableCellsMerge />, { desabilitado: !estado.podeMesclar })}
      {alvo.tipo === "celula" ? <>
        {item("nota", estado.temNota ? "Editar nota" : "Inserir nota", <StickyNote />)}
        {estado.temNota ? item("excluir-nota", "Excluir nota", <StickyNote />) : null}
      </> : null}
      <ContextMenuSeparator />
      {item("preencher-baixo", "Preencher para baixo", <ArrowDownToLine />)}
      {item("preencher-direita", "Preencher à direita", <ArrowRightToLine />)}
      {item("autosoma", "Inserir SOMA", <Sigma />)}
      <ContextMenuSeparator />
      {alvo.tipo !== "coluna" ? item("ocultar-linhas", `Ocultar ${estado.rotuloLinhas}`, <EyeOff />) : null}
      {alvo.tipo !== "linha" ? item("ocultar-colunas", `Ocultar ${estado.rotuloColunas}`, <EyeOff />) : null}
      {estado.ocultas.linhas ? item("reexibir-linhas", `Reexibir ${plural(estado.ocultas.linhas, "linha oculta", "linhas ocultas")}`, <Eye />) : null}
      {estado.ocultas.colunas ? item("reexibir-colunas", `Reexibir ${plural(estado.ocultas.colunas, "coluna oculta", "colunas ocultas")}`, <Eye />) : null}
      {alvo.tipo !== "linha" ? item("autoajustar", "Ajustar largura ao conteúdo", <MoveHorizontal />) : null}
      {alvo.tipo !== "linha" ? (estado.colunaDoCursor < 2
        ? item("fixar-ate-aqui", `Fixar até esta coluna`, <Pin />)
        : item("fixar-ate-aqui", "Fixar até esta coluna (no máximo A e B)", <Pin />, { desabilitado: true })) : null}
      {estado.fixas ? item("soltar-fixas", "Soltar colunas fixas", <PinOff />) : null}
      <ContextMenuSeparator />
      {item("validacao", "Validação de dados…", <ListChecks />)}
      {item("formatacao-condicional", "Formatação condicional…", <Paintbrush />)}
    </>}
    {alvo.tipo === "celula" ? <>
      <ContextMenuSeparator />
      {item("selecionar-linha", "Selecionar a linha inteira", <SquareDashedMousePointer />)}
      {item("selecionar-coluna", "Selecionar a coluna inteira", <SquareDashedMousePointer />)}
    </> : null}
  </ContextMenuContent>;
}
