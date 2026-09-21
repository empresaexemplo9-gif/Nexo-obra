"use client";
import { useEffect, useState } from "react";
import { upload } from "@vercel/blob/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { DEFAULT_SINAPI_UF, previousMonth, sourceUrl, UFS, type SinapiRegime } from "@/lib/integrations/sinapi-contract";
import type { SinapiImport } from "@/lib/server/sinapi-import";
const endpoint = "/api/superadmin/sinapi/import";
export function SinapiImportControl({ onUpdated }: { onUpdated?: () => Promise<unknown> } = {}) {
  const [month, setMonth] = useState(previousMonth()); const [mode, setMode] = useState("url");
  const [url, setUrl] = useState(sourceUrl(previousMonth())); const [uf, setUf] = useState("all"); const [regime, setRegime] = useState("all");
  const [files, setFiles] = useState<File[]>([]); const [current, setCurrent] = useState<SinapiImport | null>(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [confirmed, setConfirmed] = useState(false);
  useEffect(() => { let id: string | null = null; try { id = window.localStorage.getItem("sinapi-import-id"); } catch {} if (id) void fetch(`${endpoint}?id=${encodeURIComponent(id)}`).then(async (r) => { if(r.ok) setCurrent(await r.json()); }).catch(() => {}); }, []);
  async function post(body: object) { const response = await fetch(endpoint, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); return result as SinapiImport; }
  async function prepare() {
    setBusy(true); setError(""); setConfirmed(false);
    try {
      const id = crypto.randomUUID(); const paths: string[] = [];
      if (mode !== "url") {
        if (!files.length || files.length > 20 || files.reduce((n,f)=>n+f.size,0)>80*1024*1024) throw new Error("Selecione até 20 arquivos, totalizando no máximo 80 MB.");
        for (const [i, file] of files.entries()) {
          const name = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w.-]/g, "_");
          if (!/\.(zip|xlsx|csv)$/i.test(name)) throw new Error("A pasta deve conter somente os XLSX ou CSV do SINAPI.");
          setMessage(`Enviando ${i+1}/${files.length}: ${file.name}`);
          const blob = await upload(`sinapi-imports/${id}/files/${name}`, file, { access: "private", multipart: true, handleUploadUrl: "/api/superadmin/sinapi/upload" }); paths.push(blob.pathname);
        }
      }
      const states = uf === "all" ? [DEFAULT_SINAPI_UF, ...UFS.filter((s)=>s!==DEFAULT_SINAPI_UF)] : [uf];
      const taxes: SinapiRegime[] = regime === "all" ? ["NaoDesonerado", "Desonerado"] : [regime as SinapiRegime];
      setMessage("Lendo o arquivo real e preparando a amostra...");
      const result = await post({action:"prepare",id,month,profiles:states.flatMap((state)=>taxes.map((tax)=>({uf:state,regime:tax}))),...(mode === "url" ? {url} : {files:paths})});
      setCurrent(result); try { window.localStorage.setItem("sinapi-import-id", result.id); } catch {} setMessage("Arquivo validado. Confira a amostra antes de ativar.");
    } catch(e) { setError(e instanceof Error ? e.message : "Falha ao preparar arquivo."); } finally {setBusy(false);}
  }
  async function activate() {
    if (!current) return; setBusy(true); setError("");
    try { let result = current;
      while (result.completed.length < result.profiles.length) {
        setMessage(`Importando e ativando ${result.completed.length + 1}/${result.profiles.length}. Mantenha esta página aberta; se interromper, use Continuar.`);
        result = await post({action:"advance",id:result.id,confirmed:true}); setCurrent(result);
      }
      setMessage("Importação concluída. Os preços e relatórios completos estão disponíveis na plataforma."); try { window.localStorage.removeItem("sinapi-import-id"); } catch {}
      await onUpdated?.();
    } catch(e) { setError(e instanceof Error ? e.message : "Falha na importação; o progresso foi salvo."); } finally {setBusy(false);}
  }
  const done = current && current.completed.length === current.profiles.length;
  return <section className="space-y-4 rounded-xl border border-hoikos-200 bg-hoikos-50/40 p-4" aria-label="Atualizar base SINAPI">
    <div><h3 className="font-semibold">Atualizar relatórios completos do SINAPI</h3><p className="mt-1 text-sm">Busque diretamente na CAIXA o pacote oficial da competência selecionada, com preços, composições analíticas, coeficientes e encargos. Confira a amostra e ative as 27 UFs nos dois regimes. Os valores dos orçamentos já salvos são preservados.</p></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm">Origem<NativeSelect value={mode} onChange={(e)=>{setMode(e.target.value);setFiles([]);}} disabled={busy}><option value="url">URL oficial da CAIXA</option><option value="file">Arquivo ZIP, XLSX ou CSV</option><option value="folder">Pasta com XLSX ou CSV</option></NativeSelect></label>
      <label className="text-sm">Mês da referência<Input type="month" value={month} min="2025-01" onChange={(e)=>{setMonth(e.target.value);if(/^\d{4}-\d{2}$/.test(e.target.value))setUrl(sourceUrl(e.target.value));}} disabled={busy}/></label>
      <label className="text-sm">Estados<NativeSelect value={uf} onChange={(e)=>setUf(e.target.value)} disabled={busy}><option value="all">Todas as 27 UFs</option>{UFS.map((s)=><option key={s}>{s}</option>)}</NativeSelect></label>
      <label className="text-sm">Encargos<NativeSelect value={regime} onChange={(e)=>setRegime(e.target.value)} disabled={busy}><option value="all">Ambos os regimes</option><option value="NaoDesonerado">Não desonerado</option><option value="Desonerado">Desonerado</option></NativeSelect></label>
    </div>
    {mode === "url" ? <p className="break-all text-sm">Fonte oficial: <a className="underline" href={url} target="_blank" rel="noreferrer">Pacote nacional XLSX da CAIXA · {month}</a></p> : <label className="block text-sm">{mode === "folder" ? "Selecionar pasta" : "Selecionar arquivos"}<input key={mode} type="file" multiple accept=".zip,.xlsx,.csv" {...(mode === "folder" ? {webkitdirectory:"",directory:""} : {})} onChange={(e)=>setFiles(Array.from(e.target.files ?? []).filter((f)=>/\.(xlsx|csv|zip)$/i.test(f.name)))} disabled={busy} className="mt-2 block w-full"/></label>}
    <p className="text-xs">O envio vai diretamente ao armazenamento para aceitar pacotes grandes. CSV em UTF-8: competencia;uf;regime;tipo;codigo;descricao;unidade;preco. Regimes: NaoDesonerado ou Desonerado; tipos: insumo ou composicao. Deixe preço vazio quando não publicado. <a className="underline" href="/sinapi-modelo.csv" download>Baixar modelo de cabeçalho CSV</a></p>
    <Button disabled={busy} onClick={()=>void prepare()}>{mode === "url" ? "Atualizar relatórios completos pela CAIXA" : "Conferir arquivos enviados"}</Button>
    <div aria-live="polite" className="text-sm">{message}</div>{error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    {current ? <div className="space-y-3 rounded-lg border bg-background p-4">
      <h4 className="font-medium">Referência {current.month} · {current.completed.length}/{current.profiles.length} combinações ativas</h4>
      <p className="break-all text-xs">Fonte: {current.source}<br/>SHA-256: {current.sha256}</p>
      <p className="text-sm">Amostra de {current.profiles[0].uf} / {current.profiles[0].regime}: {current.sampleCount.toLocaleString("pt-BR")} preços utilizáveis; {current.sampleMissing.toLocaleString("pt-BR")} itens sem preço utilizável.</p>
      <details><summary className="cursor-pointer text-sm">Conteúdo completo do pacote</summary><ul className="mt-2 text-xs">{current.reports.map((f)=><li key={f}>{f}</li>)}</ul></details>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th>Código</th><th>Descrição</th><th>Unidade</th><th>Preço</th></tr></thead><tbody>{current.sample.map((i)=><tr key={`${i.tipo}:${i.codigo}`}><td className="p-2">{i.codigo}</td><td>{i.descricao}</td><td>{i.unidade}</td><td className="whitespace-nowrap">{(i.custoUnitarioCentavos/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}</td></tr>)}</tbody></table></div>
      {!done ? <><label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(e)=>setConfirmed(e.target.checked)} disabled={busy}/>Conferi a competência e a amostra e quero ativar as UFs e regimes selecionados.</label><Button disabled={busy || !confirmed} onClick={()=>void activate()}>{current.completed.length ? "Continuar importação" : "Importar e ativar referência"}</Button></> : <a className="text-sm underline" href="/api/integrations/sinapi/reference?download=1">Baixar o pacote completo da referência ativa</a>}
    </div> : null}
  </section>;
}
