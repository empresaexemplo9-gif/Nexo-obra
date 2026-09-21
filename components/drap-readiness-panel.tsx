"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
type Snapshot = { checks: { id: string; label: string; ready: boolean; next: string }[]; resources: Record<string, { status: string }> | null; events: { status: string; count: number }[]; canVerifyApi: boolean; notice: string };
const labels: Record<string, string> = { available: "Rota identificada", forbidden: "Sem permissão ou módulo", missing: "Não disponível na API", rate_limited: "Limite temporário", error: "Falha na consulta" };
export function DrapReadinessPanel() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load(verifyApi = false) {
    setBusy(true); setError("");
    try { const response = await fetch(`/api/integrations/drap/readiness${verifyApi ? "?verifyApi=1" : ""}`, { cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Não foi possível consultar."); setData(body); }
    catch (error) { setError(error instanceof Error ? error.message : "Não foi possível consultar."); }
    finally { setBusy(false); }
  }
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, []);
  return <Card><CardHeader><CardTitle className="text-base">Preparação da integração Drap</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm">Acompanhe o que está configurado e o que ainda depende da vinculação. A verificação da API apenas consulta recursos; não cria cobranças.</p>
    {error && <p role="alert" className="text-sm">{error}</p>}
    {data && <><ul className="grid gap-3 sm:grid-cols-2">{data.checks.map(check => <li key={check.id} className="rounded-md border p-3 text-sm"><p className="font-medium">{check.label}</p><p className="mt-1">{check.ready ? "Configurado / registrado" : "Pendente"}</p>{!check.ready && <p className="mt-1 text-hoikos-600">{check.next}</p>}</li>)}</ul>
    {data.resources && <details open><summary className="cursor-pointer text-sm font-medium">Resultado da consulta à API</summary><ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{Object.entries(data.resources).map(([name, resource]) => <li key={name}>{name}: {labels[resource.status] ?? "Não verificado"}</li>)}</ul></details>}
    <p className="text-sm">Eventos recebidos nesta empresa: {data.events.length ? data.events.map(event => `${event.status}: ${event.count}`).join(" · ") : "nenhum evento registrado"}.</p><p className="text-sm text-hoikos-600">{data.notice}</p></>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void load()}>Atualizar configuração</Button><Button disabled={busy || !data?.canVerifyApi} onClick={() => void load(true)}>{busy ? "Verificando…" : "Consultar API Drap"}</Button></div>
  </CardContent></Card>;
}
