"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { bulkActions, parseTable, replaceInSelection, runActions, type BulkAction } from "@/lib/worksheet-tools";
import type { SheetCells } from "@/lib/spreadsheet";

export type WorksheetRecipe = { name: string; actions: BulkAction[] };

export function WorksheetToolsPanel({ cells, keys, recipes, onCells, onTable, onRecipes }: {
  cells: SheetCells; keys: string[]; recipes: WorksheetRecipe[];
  onCells: (cells: SheetCells) => void; onTable: (table: string[][]) => void;
  onRecipes: (recipes: WorksheetRecipe[]) => void;
}) {
  const [steps, setSteps] = useState<BulkAction[]>([]);
  const [name, setName] = useState("");
  const [find, setFind] = useState("");
  const [replacement, setReplacement] = useState("");
  const [delimiter, setDelimiter] = useState(";");
  const [preview, setPreview] = useState<SheetCells | null>(null);
  const [previewBase, setPreviewBase] = useState<SheetCells | null>(null);

  function showPreview(action: () => SheetCells) {
    try { setPreview(action()); setPreviewBase(cells); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível executar."); }
  }
  const changes = preview ? Object.keys({ ...cells, ...preview }).filter(key => cells[key] !== preview[key]) : [];

  return <details className="rounded-md border p-3 text-sm">
    <summary className="cursor-pointer font-medium">Ferramentas e automações da seleção</summary>
    <div className="mt-3 space-y-4">
      <p className="text-xs text-hoikos-600">Seleção: {keys.length} {keys.length === 1 ? "célula" : "células"}. Confira a prévia antes de aplicar. Salve a planilha para guardar suas alterações e receitas.</p>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect aria-label="Adicionar ação" value="" onChange={event => { if (steps.length < 12) setSteps([...steps, event.target.value as BulkAction]); }}>
          <option value="">Adicionar ação…</option>
          {Object.entries(bulkActions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </NativeSelect>
        <Button size="sm" variant="outline" disabled={!steps.length} onClick={() => showPreview(() => runActions(cells, keys, steps))}>Prévia da automação</Button>
        <Button size="sm" variant="ghost" disabled={!steps.length} onClick={() => { setSteps([]); setPreview(null); }}>Limpar sequência</Button>
      </div>
      {steps.length > 0 && <ol className="list-inside list-decimal text-xs">{steps.map((step, i) => <li key={i}>{bulkActions[step]}</li>)}</ol>}
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Nome da automação" placeholder="Nome da receita" maxLength={80} value={name} onChange={event => setName(event.target.value)} className="max-w-xs" />
        <Button size="sm" variant="outline" disabled={!name.trim() || !steps.length || recipes.length >= 20} onClick={() => {
          onRecipes([...recipes, { name: name.trim(), actions: [...steps] }]); setName(""); toast.success("Receita adicionada. Salve a planilha para guardá-la.");
        }}>Guardar receita</Button>
        <NativeSelect aria-label="Carregar automação" value="" onChange={event => { const recipe = recipes[Number(event.target.value)]; if (recipe) { setSteps([...recipe.actions]); setPreview(null); } }}>
          <option value="">Carregar receita…</option>
          {recipes.map((recipe, index) => <option key={index} value={index}>{recipe.name}</option>)}
        </NativeSelect>
      </div>
      <p className="text-xs text-hoikos-500">As receitas são executadas por você, na ordem escolhida. Fórmulas são preservadas nas ações de texto.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Localizar texto na seleção" placeholder="Localizar texto" value={find} onChange={event => setFind(event.target.value)} className="max-w-xs" />
        <Input aria-label="Substituir texto por" placeholder="Substituir por" value={replacement} onChange={event => setReplacement(event.target.value)} className="max-w-xs" />
        <Button size="sm" variant="outline" disabled={!find} onClick={() => showPreview(() => replaceInSelection(cells, keys, find, replacement))}>Prévia da substituição</Button>
      </div>
      {preview && <div className="space-y-2 rounded-md bg-hoikos-50 p-3" role="status">
        <p>{changes.length} célula(s) serão alteradas.</p>
        <div className="max-h-44 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th>Célula</th><th>Antes</th><th>Depois</th></tr></thead>
          <tbody>{changes.slice(0, 50).map(key => <tr key={key}><td>{key}</td><td className="max-w-64 break-words">{cells[key] || "(vazio)"}</td><td className="max-w-64 break-words">{preview[key] || "(vazio)"}</td></tr>)}</tbody></table></div>
        {changes.length > 50 && <p className="text-xs">Exibindo as primeiras 50 alterações.</p>}
        <Button size="sm" disabled={!changes.length || previewBase !== cells} onClick={() => { onCells(preview); setPreview(null); }}>Aplicar alterações</Button>
        {previewBase !== cells && <p>A planilha mudou. Gere uma nova prévia.</p>}
      </div>}
      <div className="space-y-2 border-t pt-3">
        <p className="font-medium">Importar CSV na célula ativa</p>
        <p className="text-xs text-hoikos-500">O conteúdo da área de destino será substituído. Use Desfazer para reverter. Arquivos Excel podem ser abertos em Importar e exportar XLSX.</p>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect aria-label="Separador CSV" value={delimiter} onChange={event => setDelimiter(event.target.value)}>
            <option value=";">Ponto e vírgula (;)</option><option value=",">Vírgula (,)</option><option value={"\t"}>Tabulação</option>
          </NativeSelect>
          <input aria-label="Arquivo CSV" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={async event => {
            const input = event.currentTarget; const file = input.files?.[0]; if (!file) return;
            try { if (file.size > 2_000_000) throw new Error("O arquivo excede 2 MB."); onTable(parseTable(await file.text(), delimiter)); }
            catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível importar."); }
            finally { input.value = ""; }
          }} />
        </div>
      </div>
    </div>
  </details>;
}
