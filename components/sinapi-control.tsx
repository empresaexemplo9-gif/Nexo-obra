"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { UFS, columnName, previousMonth, type Mapping, type Profile } from "@/lib/integrations/sinapi-contract";

type Sheet = { aba: string; linhas: string[][] };
type Snapshot = {
  config: Profile | null; jobId?: string; lastChecked?: number; error?: string;
  schedulerConfigured: boolean; storageConfigured: boolean;
  jobs: { id: string; competencia: string; uf: string; regime: string; estado: string; total_itens: number; origem_url: string; arquivo_sha256: string;
    report: { abas?: Sheet[]; cursor?: number; alertas?: string[]; semPreco?: number; cleanup?: boolean; amostra?: { codigo: string; descricao: string; unidade: string; custoUnitarioCentavos: number; tipo: string }[] } }[];
};
const labels: Record<string, string> = { baixando: "Aguardando download", conferindo: "Conferir colunas", interpretando: "Aguardando análise", importando: "Importando preços", pendente: "Aguardando revisão", aprovada: "Ativa" };
function MappingForm({ sheets, busy, onSave }: { sheets: Sheet[]; busy: boolean; onSave: (maps: Mapping[]) => void }) {
  const [maps, setMaps] = useState<Mapping[]>([{ aba: sheets[0]?.aba ?? "", tipo: "composicao", cabecalho: 1, codigo: 0, descricao: 1, unidade: 2, preco: 3 }]);
  const update = (index: number, patch: Partial<Mapping>) => setMaps((old) => old.map((m, i) => i === index ? { ...m, ...patch } : m));
  return <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); onSave(maps); }}>
    <p className="text-sm">Selecione as abas de preços e a coluna da UF e do regime escolhidos. Confira os títulos e valores nas linhas do arquivo original abaixo.</p>
    {maps.map((m, index) => {
      const sheet = sheets.find((s) => s.aba === m.aba)!;
      const columns = Array.from({ length: Math.max(4, ...sheet.linhas.map((r) => r.length)) }, (_, i) => i);
      return <fieldset key={index} className="min-w-0 space-y-3 rounded-md border p-3"><legend className="px-1 font-medium">Tabela {index + 1}</legend>
        <div className="flex flex-wrap gap-3">
          <label className="text-sm">Tipo<NativeSelect value={m.tipo} onChange={(e) => update(index, { tipo: e.target.value as Mapping["tipo"] })}><option value="composicao">Composições</option><option value="insumo">Insumos</option></NativeSelect></label>
          <label className="min-w-0 text-sm">Aba<NativeSelect className="max-w-full" value={m.aba} onChange={(e) => update(index, { aba: e.target.value })}>{sheets.map((s) => <option key={s.aba}>{s.aba}</option>)}</NativeSelect></label>
          <label className="text-sm">Linha dos títulos<Input className="w-24" type="number" min={1} max={30} value={m.cabecalho} onChange={(e) => update(index, { cabecalho: Number(e.target.value) })} required /></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">{([['codigo', 'Código'], ['descricao', 'Descrição'], ['unidade', 'Unidade'], ['preco', 'Preço da UF selecionada']] as const).map(([field, label]) => <label key={field} className="min-w-0 text-sm">{label}<NativeSelect className="max-w-[240px]" value={m[field]} onChange={(e) => update(index, { [field]: Number(e.target.value) })}>{columns.map((c) => <option key={c} value={c}>{columnName(c)} — {sheet.linhas[m.cabecalho - 1]?.[c]?.slice(0, 60) || "Sem título"}</option>)}</NativeSelect></label>)}</div>
        <details><summary className="cursor-pointer text-sm underline">Ver as primeiras 30 linhas da planilha</summary><div className="max-h-80 overflow-auto"><table className="text-xs"><thead><tr><th>Linha</th>{columns.map((c) => <th key={c} className="border p-2">{columnName(c)}</th>)}</tr></thead><tbody>{sheet.linhas.map((row, r) => <tr key={r}><th className="border p-2">{r + 1}</th>{columns.map((c) => <td key={c} className="min-w-24 max-w-64 border p-2">{row[c]}</td>)}</tr>)}</tbody></table></div></details>
      </fieldset>;
    })}
    <div className="flex flex-wrap gap-2">{maps.length < 2 ? <Button type="button" variant="outline" onClick={() => setMaps([...maps, { ...maps[0], tipo: maps[0].tipo === "insumo" ? "composicao" : "insumo" }])}>Adicionar outra tabela</Button> : <Button type="button" variant="outline" onClick={() => setMaps(maps.slice(0, 1))}>Remover segunda tabela</Button>}<Button disabled={busy}>Analisar preços selecionados</Button></div>
  </form>;
}
export function SinapiControl() {
  const [data, setData] = useState<Snapshot | null>(null); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [confirmed, setConfirmed] = useState(false);
  const load = useCallback(async () => { const response = await fetch("/api/superadmin/sinapi", { cache: "no-store" }); const value = await response.json(); if (!response.ok) throw new Error(value.error); setData(value); }, []);
  useEffect(() => { const timer = setTimeout(() => { void load().catch((e: Error) => setError(e.message)); }, 0); return () => clearTimeout(timer); }, [load]);
  async function act(body: object) {
    setBusy(true); setError(""); setMessage(""); setConfirmed(false);
    try { const response = await fetch("/api/superadmin/sinapi", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const value = await response.json(); if (!response.ok) throw new Error(value.error); setData(value); setMessage("Etapa concluída."); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível atualizar."); await load().catch(() => {}); }
    finally { setBusy(false); }
  }
  const job = data?.jobs.find((j) => j.id === data.jobId);
  return <Card className="mt-6 min-w-0 [&_button]:h-auto [&_button]:min-h-9 [&_button]:whitespace-normal"><CardHeader><CardTitle>Referência SINAPI</CardTitle><p className="text-sm">Confira a primeira referência e habilite a renovação mensal. A tabela anterior é excluída após a ativação da nova; os orçamentos salvos são preservados.</p></CardHeader><CardContent className="min-w-0 space-y-4">
    <div aria-live="polite">{busy ? <p>Processando a etapa. O progresso fica salvo no servidor.</p> : message ? <p>{message}</p> : null}{error || data?.error ? <p role="alert" className="break-words text-red-700">{error || data?.error}</p> : null}</div>
    {!data ? <Button variant="outline" disabled={busy} onClick={() => void load().catch((e: Error) => setError(e.message))}>Carregar referências</Button> : <>
      {!data.storageConfigured ? <p className="text-sm">Configure BLOB_READ_WRITE_TOKEN na hospedagem para permitir o processamento temporário.</p> : null}
      {!data.schedulerConfigured ? <p className="text-sm">Configure CRON_SECRET na hospedagem para autorizar a verificação diária de novas competências.</p> : null}
      <p className="text-sm">{data.lastChecked ? `Última verificação: ${new Date(data.lastChecked).toLocaleString("pt-BR")}.` : "Nenhuma verificação automática realizada."} A rotina atende à UF e ao regime configurados abaixo.</p>
      {data.config?.assinaturas.length ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={data.config.automatico} disabled={busy} onChange={(e) => void act({ action: "automatic", enabled: e.target.checked })} />Renovar automaticamente {data.config.uf} · {data.config.regime === "Desonerado" ? "Desonerado" : "Não desonerado"} quando a Caixa publicar a competência anterior. Mudanças de colunas ou contagens exigem revisão.</label> : null}
      {!job ? <form key={`${data.config?.uf}:${data.config?.regime}`} className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void act({ action: "start", month: f.get("month"), uf: f.get("uf"), regime: f.get("regime") }); }}>
        <label className="text-sm">Competência<Input name="month" type="month" defaultValue={previousMonth()} required /></label>
        <label className="text-sm">UF<NativeSelect name="uf" defaultValue={data.config?.uf ?? "SP"}>{UFS.map((uf) => <option key={uf}>{uf}</option>)}</NativeSelect></label>
        <label className="text-sm">Regime<NativeSelect name="regime" defaultValue={data.config?.regime ?? "NaoDesonerado"}><option value="NaoDesonerado">Não desonerado</option><option value="Desonerado">Desonerado</option></NativeSelect></label>
        <Button disabled={busy}>Preparar referência</Button>
      </form> : <section className="min-w-0 space-y-4 rounded-md border p-3">
        <h3 className="font-medium">{job.competencia} · {job.uf} · {job.regime === "Desonerado" ? "Desonerado" : "Não desonerado"} — {labels[job.estado] ?? job.estado}</h3>
        <a className="text-sm underline" href={job.origem_url} target="_blank" rel="noreferrer">Abrir publicação original da Caixa</a>
        {job.report.alertas?.map((a) => <p role="alert" key={a}>{a}</p>)}
        {job.estado === "conferindo" && job.report.abas ? <MappingForm key={job.id} sheets={job.report.abas} busy={busy} onSave={(maps) => void act({ action: "map", maps })} /> : null}
        {job.total_itens > 0 ? <p className="text-sm">{job.report.cursor ?? 0} de {job.total_itens} preços gravados. {job.report.semPreco ?? 0} itens sem preço, não importados.</p> : null}
        {job.report.amostra?.length ? <div className="max-h-72 overflow-auto"><table className="w-full text-sm"><caption className="text-left">Amostra para conferir no arquivo original</caption><thead><tr><th>Código / tipo</th><th>Descrição</th><th>Un.</th><th>Preço</th></tr></thead><tbody>{job.report.amostra.map((item) => <tr key={`${item.tipo}:${item.codigo}`}><td className="border p-2">{item.codigo} · {item.tipo}</td><td className="border p-2">{item.descricao}</td><td className="border p-2">{item.unidade}</td><td className="border p-2">{(item.custoUnitarioCentavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</td></tr>)}</tbody></table></div> : null}
        {job.arquivo_sha256 ? <p className="break-all text-xs">SHA-256 da publicação: {job.arquivo_sha256}</p> : null}
        {job.estado === "pendente" ? <div className="space-y-3"><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />Conferi competência, UF, regime, colunas e preços da amostra no arquivo original.</label><Button disabled={busy || !confirmed} onClick={() => void act({ action: "approve", confirmed: true })}>Ativar e substituir a referência anterior</Button></div> : null}
        <div className="flex flex-wrap gap-2">{!["conferindo", "pendente"].includes(job.estado) ? <Button disabled={busy} onClick={() => void act({ action: "advance" })}>{job.estado === "aprovada" ? "Concluir limpeza dos temporários" : "Processar próxima etapa"}</Button> : null}{job.estado !== "aprovada" ? <Button variant="outline" disabled={busy} onClick={() => void act({ action: "discard" })}>Descartar tentativa</Button> : null}</div>
      </section>}
      <div className="space-y-1 text-sm"><h3 className="font-medium">Referências ativas</h3>{data.jobs.filter((j) => j.estado === "aprovada").map((j) => <p key={j.id}>{j.uf} · {j.regime === "Desonerado" ? "Desonerado" : "Não desonerado"} · {j.competencia} · {j.total_itens.toLocaleString("pt-BR")} preços</p>)}{!data.jobs.some((j) => j.estado === "aprovada") ? <p>Nenhuma referência ativa. Prepare e confira a primeira tabela.</p> : null}</div>
    </>}
  </CardContent></Card>;
}
