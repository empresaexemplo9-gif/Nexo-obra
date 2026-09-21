"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

type Item = { id: string; name: string; kind: string; baseCents: number; multiplierBps: number; revision: number };
type Data = { catalog: Item[]; commission: null | { baseCents: number; monthlyCents: number; commissionCents: number; status: string }; events: { id: string; action: string; entity_id: string; actor_user_id: string; created_at: number }[] };
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export function DrapPricingControl({ organizationId }: { organizationId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [selected, setSelected] = useState("");
  const [percent, setPercent] = useState("0");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(`/api/superadmin/drap-pricing?organizationId=${encodeURIComponent(organizationId)}`, { cache: "no-store" });
    const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Não foi possível carregar os preços."); setData(body);
  }, [organizationId]);
  useEffect(() => { const timer = setTimeout(() => void load().catch(error => setMessage(error.message)), 0); return () => clearTimeout(timer); }, [load]);
  const item = data?.catalog.find(item => item.id === selected);
  const multiplierBps = Math.round(10000 + Number(percent) * 100);
  const valid = percent.trim() !== "" && Number.isFinite(multiplierBps) && multiplierBps >= 10000 && multiplierBps <= 100000;
  const total = item && valid ? Math.round(item.baseCents * multiplierBps / 10000) : 0;
  async function save() {
    if (!item || !valid) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/superadmin/drap-pricing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId, planId: item.id, multiplierBps, revision: item.revision }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Não foi possível salvar.");
      await load(); setMessage("Política registrada para novas solicitações. Assinaturas e solicitações já enviadas mantêm o preço confirmado.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }
  return <Card><CardHeader><CardTitle>Preços e comissionamento Drap</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm">Controle exclusivo do superadministrador. O preço oficial é o mínimo; o acréscimo é opcional. A cobrança e o pagamento são feitos diretamente na Drap.</p>
    {message && <p role="status" className="rounded-md border p-3 text-sm">{message}</p>}
    {!data ? <p>Carregando política…</p> : <>
      <div className="grid items-end gap-3 sm:grid-cols-2"><label className="text-sm">Módulo ou pacote<NativeSelect value={selected} onChange={event => { const next = data.catalog.find(item => item.id === event.target.value); setSelected(event.target.value); setPercent(String(((next?.multiplierBps ?? 10000) - 10000) / 100)); }}><option value="">Selecione</option>{data.catalog.filter(item => item.kind !== "free").map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></label>
      <label className="text-sm">Acréscimo (%)<Input type="number" min="0" max="900" step="0.01" value={percent} onChange={event => setPercent(event.target.value)} /></label></div>
      {item && valid && <p className="text-sm">Base mensal: {money(item.baseCents)} · Total: {money(total)} · Comissão prevista: {money(total - item.baseCents)}</p>}
      <Button disabled={busy || !item || !valid} onClick={() => void save()}>Salvar política de preço</Button>
      <div className="rounded-md border p-4 text-sm"><p className="font-medium">Comissão mensal confirmada na assinatura</p>{data.commission ? <p className="mt-2">{money(data.commission.commissionCents)} · Estado da assinatura: {data.commission.status}</p> : <p className="mt-2">Nenhuma assinatura confirmada com valores.</p>}<p className="mt-2">Pendente de conciliação entre as partes. Este valor mensal não comprova pagamento nem representa saldo acumulado de comissões.</p></div>
      <details><summary className="cursor-pointer text-sm font-medium">Histórico de preços e confirmações ({data.events.length})</summary><ul className="mt-3 space-y-3 text-sm">{data.events.map(event => <li key={event.id} className="break-words border-b pb-2">{event.action === "drap.pricing_changed" ? "Política alterada" : event.action === "drap.pricing_locked" ? "Preço vinculado à solicitação" : "Assinatura confirmada"} · {event.entity_id}<br />{event.actor_user_id} · {new Date(event.created_at).toLocaleString("pt-BR")}</li>)}</ul></details>
    </>}
  </CardContent></Card>;
}
