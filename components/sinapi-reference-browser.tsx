"use client";
import {useState} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {NativeSelect} from "@/components/ui/native-select";
const names = {analytic:"Composições analíticas",families:"Famílias e coeficientes",labor:"Percentual de mão de obra",maintenance:"Manutenções",charges:"Encargos sociais",unburdened:"Insumos sem encargos sociais"};
type Result = {month:string;file:string;sheet:string;headers:string[];rows:string[][];total:number};
export function SinapiReferenceBrowser(){
 const [table,setTable]=useState("analytic"),[regime,setRegime]=useState("NaoDesonerado"),[query,setQuery]=useState("");
 const [result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function search(){setBusy(true);setError("");try{const response=await fetch(`/api/integrations/sinapi/reference?${new URLSearchParams({table,regime,q:query})}`);const value=await response.json();if(!response.ok)throw new Error(value.error);setResult(value);}catch(e){setError(e instanceof Error?e.message:"Não foi possível consultar.");}finally{setBusy(false);}}
 return <details className="min-w-0 rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Consultar parâmetros e relatórios completos do SINAPI</summary><div className="mt-3 space-y-3">
  <p className="text-xs">Dados originais da competência ativa. Coeficientes e percentuais são exibidos como publicados, sem BDI ou margem. Percentuais em fração: 0,20 equivale a 20%.</p>
  <form className="flex flex-wrap items-end gap-2" onSubmit={(e)=>{e.preventDefault();void search();}}><label className="text-xs">Relatório<NativeSelect value={table} onChange={(e)=>setTable(e.target.value)}>{Object.entries(names).map(([v,n])=><option key={v} value={v}>{n}</option>)}</NativeSelect></label><label className="text-xs">Regime<NativeSelect value={regime} onChange={(e)=>setRegime(e.target.value)}><option value="NaoDesonerado">Não desonerado</option><option value="Desonerado">Desonerado</option></NativeSelect></label><label className="text-xs">Código ou descrição<Input value={query} maxLength={160} onChange={(e)=>setQuery(e.target.value)}/></label><Button disabled={busy}>{busy?"Consultando…":"Consultar relatório"}</Button></form>
  {error?<p role="alert" className="text-sm text-red-700">{error}</p>:null}
  {result?<><p className="text-xs">{result.month} · {result.file} · {result.total.toLocaleString("pt-BR")} linhas encontradas; exibindo até 100. Refine a busca para ver outros itens.</p><div className="max-h-80 max-w-full overflow-auto"><table className="text-xs"><thead><tr>{result.headers.map((h,i)=><th className="min-w-24 border p-2" key={i}>{h}</th>)}</tr></thead><tbody>{result.rows.map((r,i)=><tr key={i}>{result.headers.map((_,c)=><td className="min-w-24 max-w-96 border p-2" key={c}>{r[c]}</td>)}</tr>)}</tbody></table></div><a className="text-sm underline" href="/api/integrations/sinapi/reference?download=1">Baixar todas as planilhas da referência ativa</a></>:null}
 </div></details>;
}
