"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { DEFAULT_SINAPI_UF, UFS } from "@/lib/integrations/sinapi-contract";
const names = { inputs: "Preços de insumos", compositions: "Custos de composições", analytic: "Composições analíticas", families: "Famílias e coeficientes", labor: "Percentual de mão de obra", maintenance: "Manutenções", charges: "Encargos sociais", unburdened: "Insumos sem encargos sociais", compositionsUnburdened: "Composições sem encargos sociais", original: "Todas as abas originais" };
type Result = { month: string; file: string; sheet: string; headers: string[]; rows: string[][]; rowNumbers: number[]; total: number; page: number; pages: number; uf: string; scope: string; metadata: string[][]; original: boolean };
type Catalog = { month: string; files: { file: string; sheets: string[] }[] };
export function SinapiReferenceBrowser() {
  const [table, setTable] = useState("inputs"), [regime, setRegime] = useState("NaoDesonerado"), [uf, setUf] = useState(DEFAULT_SINAPI_UF), [query, setQuery] = useState("");
  const [file, setFile] = useState(""), [sheet, setSheet] = useState("");
  const [catalog, setCatalog] = useState<Catalog | null>(null), [catalogError, setCatalogError] = useState("");
  const [result, setResult] = useState<Result | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [catalogRevision, setCatalogRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setCatalog(null); setCatalogError(""); setFile(""); setSheet("");
    void fetch(`/api/integrations/sinapi/reference?${new URLSearchParams({ catalog: "1", uf, regime })}`, { signal: controller.signal }).then(async response => {
      const value = await response.json(); if (!response.ok) throw new Error(value.error);
      if (!controller.signal.aborted) { setCatalog(value); setFile(value.files[0]?.file ?? ""); setSheet(value.files[0]?.sheets[0] ?? ""); }
    }).catch(e => { if (!controller.signal.aborted) setCatalogError(e instanceof Error ? e.message : "Não foi possível listar as planilhas."); });
    return () => controller.abort();
  }, [uf, regime, catalogRevision]);
  function clear() { setResult(null); setError(""); }
  async function search(page = 1) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/integrations/sinapi/reference?${new URLSearchParams({ table, regime, uf, q: query, file, sheet, page: String(page) })}`);
      const value = await response.json(); if (!response.ok) throw new Error(value.error); setResult(value);
    } catch (e) { setResult(null); setError(e instanceof Error ? e.message : "Não foi possível consultar."); } finally { setBusy(false); }
  }
  const download = `/api/integrations/sinapi/reference?${new URLSearchParams({ download: "1", uf, regime })}`;
  return <section aria-label="Planilhas e relatórios SINAPI" className="min-w-0 space-y-4 rounded-xl border bg-background p-4">
    <div><h2 className="text-lg font-semibold">Planilhas e relatórios SINAPI</h2><p className="mt-1 text-sm">Consulte os dados oficiais dentro do orçamento: preços, composições, coeficientes, percentuais, encargos e todas as abas do pacote.</p></div>
    <form className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={e => { e.preventDefault(); void search(); }}>
      <label className="text-sm">UF do relatório<NativeSelect value={uf} disabled={busy} onChange={e => { setUf(e.target.value); clear(); }}><option value="all">Todas as UFs</option>{UFS.map(state => <option key={state}>{state}</option>)}</NativeSelect></label>
      <label className="text-sm">Regime do relatório<NativeSelect value={regime} disabled={busy} onChange={e => { setRegime(e.target.value); clear(); }}><option value="NaoDesonerado">Não desonerado</option><option value="Desonerado">Desonerado</option></NativeSelect></label>
      <label className="text-sm">Relatório<NativeSelect value={table} disabled={busy} onChange={e => { setTable(e.target.value); clear(); }}>{Object.entries(names).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</NativeSelect></label>
      <label className="text-sm">Buscar nas células<Input value={query} disabled={busy} maxLength={160} placeholder="Código, descrição ou termo" onChange={e => { setQuery(e.target.value); clear(); }} /></label>
      {table === "original" ? <>
        <label className="min-w-0 text-sm sm:col-span-2">Arquivo<NativeSelect className="max-w-full" value={file} disabled={busy || !catalog} onChange={e => { setFile(e.target.value); setSheet(catalog?.files.find(f => f.file === e.target.value)?.sheets[0] ?? ""); clear(); }}>{catalog?.files.map(f => <option key={f.file}>{f.file}</option>)}</NativeSelect></label>
        <label className="text-sm">Aba<NativeSelect value={sheet} disabled={busy || !catalog} onChange={e => { setSheet(e.target.value); clear(); }}>{catalog?.files.find(f => f.file === file)?.sheets.map(s => <option key={s}>{s}</option>)}</NativeSelect></label>
      </> : null}
      <Button disabled={busy || (table === "original" && !sheet)}>{busy ? "Consultando…" : "Consultar relatório"}</Button>
    </form>
    {catalog ? <div className="flex flex-wrap items-center gap-3 text-sm"><span>Competência {catalog.month} · {catalog.files.length} arquivos · {catalog.files.reduce((n, f) => n + f.sheets.length, 0)} abas disponíveis</span><a className="underline" href={download}>Baixar pacote original completo</a></div> : catalogError ? <div role="status" className="text-sm"><p>{catalogError}</p><Button variant="outline" onClick={() => setCatalogRevision(n => n + 1)}>Recarregar planilhas</Button></div> : <p role="status" className="text-sm">Carregando lista de planilhas…</p>}
    <p className="text-xs text-muted-foreground">O filtro mantém as colunas da UF e os campos comuns. Relatórios nacionais não variam por estado. Células vazias continuam vazias; percentuais em fração (0,20 = 20%) e valores são apresentados como publicados, sem BDI.</p>
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    {result ? <div className="space-y-3" aria-live="polite">
      <p className="text-sm font-medium">{result.month} · {result.sheet} · {result.scope === "national" ? "Relatório nacional, comum a todas as UFs" : result.uf === "all" ? "Todas as UFs" : `UF ${result.uf}`} · {result.total.toLocaleString("pt-BR")} linhas</p>
      <p className="break-all text-xs">{result.file}</p>
      {result.original ? <p className="text-xs">Todas as linhas e células da aba, incluindo notas e cabeçalhos. Fórmulas mostram o resultado armazenado no arquivo; cálculos interativos e formatação do Excel estão no pacote original.</p> : <details><summary className="cursor-pointer text-sm">Notas e cabeçalhos originais</summary><div className="max-h-64 overflow-auto"><table className="text-xs"><tbody>{result.metadata.map((r, i) => <tr key={i}>{r.map((cell, c) => <td className="whitespace-pre-wrap border p-2" key={c}>{cell}</td>)}</tr>)}</tbody></table></div></details>}
      <div className="max-h-[65vh] max-w-full overflow-auto rounded-md border"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-background"><tr><th className="border p-2">Linha</th>{result.headers.map((h, i) => <th scope="col" className="min-w-24 whitespace-pre-wrap border p-2" key={i}>{h}</th>)}</tr></thead><tbody>{result.rows.map((r, i) => <tr key={result.rowNumbers[i]}><th scope="row" className="border p-2">{result.rowNumbers[i]}</th>{result.headers.map((_, c) => <td className="min-w-24 max-w-96 whitespace-pre-wrap border p-2" key={c}>{r[c]}</td>)}</tr>)}</tbody></table>{!result.total ? <p className="p-4">Nenhuma linha encontrada para esta busca.</p> : null}</div>
      <nav aria-label="Páginas do relatório SINAPI" className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={busy || result.page <= 1} onClick={() => void search(result.page - 1)}>Anterior</Button><span className="text-sm">Página {result.page} de {result.pages}</span><Button variant="outline" disabled={busy || result.page >= result.pages} onClick={() => void search(result.page + 1)}>Próxima</Button></nav>
    </div> : null}
  </section>;
}
