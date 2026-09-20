"use client";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { ImportedSheet } from "@/lib/server/worksheet-xlsx";

export function WorksheetXlsxPanel({ id, name, revision, dirty, readOnly, onImport }: {
  id: string; name: string; revision: number; dirty: boolean; readOnly: boolean; onImport: (sheet: ImportedSheet) => void;
}) {
  const [sheets, setSheets] = useState<ImportedSheet[]>([]), [selected, setSelected] = useState(0), [busy, setBusy] = useState(false);
  const running = useRef(false);
  const sheet = sheets[selected];
  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true);
    try { await action(); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Não foi possível processar o XLSX."); }
    finally { running.current = false; setBusy(false); }
  }
  return <details className="rounded-md border p-3 text-sm"><summary className="cursor-pointer font-medium">Importar e exportar XLSX</summary><div className="mt-3 space-y-3">
    <p className="text-xs">Compatibilidade de valores: a importação usa os resultados salvos das fórmulas. A exportação leva valores calculados, formatos de coluna, negrito e cores atuais; as fórmulas originais vão em uma aba de referência como texto. Gráficos e regras permanecem na plataforma.</p>
    <Button size="sm" variant="outline" disabled={busy || dirty} onClick={() => void run(async () => {
      const response = await fetch(`/api/worksheets/${id}/xlsx?revision=${revision}`, { cache: "no-store" });
      if (!response.ok) throw new Error((await response.json()).error ?? "Não foi possível exportar.");
      const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${name}.xlsx`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    })}>Baixar XLSX salvo</Button>
    {dirty && <p className="text-xs">Salve as alterações antes de exportar XLSX.</p>}
    {!readOnly && <><label className="block">Selecionar XLSX (até 4 MB)<input aria-label="Importar arquivo XLSX" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} className="mt-1 block w-full min-w-0 text-xs" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
      setSheets([]); setSelected(0);
      if (file.size > 4 * 1024 * 1024 || !file.name.toLowerCase().endsWith(".xlsx")) { toast.error("Escolha um XLSX de até 4 MB."); return; }
      void run(async () => {
        const response = await fetch(`/api/worksheets/${id}/xlsx`, { method: "POST", body: file });
        const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error ?? "Não foi possível importar. Verifique o tamanho do arquivo e tente novamente."); setSheets(body.sheets);
      });
    }} /></label>
      {sheet && <div className="space-y-2 rounded border p-3">
        <NativeSelect aria-label="Aba do arquivo XLSX" value={selected} onChange={event => setSelected(Number(event.target.value))}>{sheets.map((item, index) => <option key={index} value={index}>{item.name}</option>)}</NativeSelect>
        <p>{sheet.rows} linhas · {sheet.columns} colunas · {Object.keys(sheet.cells).length} células preenchidas.</p>
        {sheet.warnings.map(warning => <p key={warning} className="text-xs">{warning}</p>)}
        <div className="max-h-40 overflow-auto"><table className="w-full text-left text-xs"><caption>Prévia das primeiras 20 células</caption><thead><tr><th>Célula</th><th>Valor</th></tr></thead><tbody>{Object.entries(sheet.cells).slice(0, 20).map(([key, value]) => <tr key={key}><td>{key}</td><td className="break-all">{value}</td></tr>)}</tbody></table></div>
        <p className="text-xs">Aplicar substitui os dados, formatos, regras e resumos da planilha aberta. Você pode desfazer antes de sair; o servidor só muda ao salvar.</p>
        <Button size="sm" className="h-auto max-w-full whitespace-normal py-2" disabled={busy} onClick={() => { onImport(sheet); setSheets([]); }}>Substituir pela aba selecionada</Button>
        <Button size="sm" variant="ghost" onClick={() => setSheets([])}>Cancelar importação</Button>
      </div>}
    </>}
    {busy && <p role="status">Processando XLSX…</p>}
  </div></details>;
}
