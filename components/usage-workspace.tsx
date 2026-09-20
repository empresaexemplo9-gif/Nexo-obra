"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleAlert, Clock, LoaderCircle, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { accessProfileLabels } from "@/lib/permissions";

type UsageDay = {
  organizationId: string; organizationName: string; subjectId: string; subjectKind: string;
  day: string; email: string; displayName: string; role: string;
  activeMs: number; sessions: number; firstSeenAt: number; lastSeenAt: number;
};
export type UsageReport = {
  range: { from: string; to: string };
  today: string;
  scope: "self" | "organization" | "dependents" | "platform";
  beatMs: number;
  gapLimitMs: number;
  viewer: { subjectId: string; role: string; displayName: string };
  days: UsageDay[];
  actions: Array<{ organizationId: string; subjectId: string; total: number }>;
};

const kindLabels: Record<string, string> = {
  member: "Equipe", superadmin: "Plataforma", maintenance: "Manutenção", portal_client: "Cliente do portal",
};

export function formatDuration(ms: number) {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours && !minutes) return ms > 0 ? "menos de 1 min" : "—";
  return hours ? `${hours} h ${String(minutes).padStart(2, "0")} min` : `${minutes} min`;
}

const dayLabel = (day: string) => new Date(`${day}T12:00:00.000Z`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const clock = (value: number) => new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

// O sinal de presença. Só envia com a aba visível: minimizar ou trocar de aba pausa a
// contagem, e o servidor credita apenas o intervalo entre dois sinais que recebeu.
export function useUsageHeartbeat(enabled: boolean, accessId?: string) {
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer = 0;
    const beat = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      await fetch("/api/usage", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accessId ? { accessId } : {}),
      }).catch(() => undefined);
    };
    const schedule = () => { timer = window.setInterval(() => { void beat(); }, 30_000); };
    const kick = window.setTimeout(() => { void beat(); schedule(); }, 0);
    document.addEventListener("visibilitychange", () => { void beat(); });
    return () => { stopped = true; window.clearTimeout(kick); window.clearInterval(timer); };
  }, [enabled, accessId]);
}

export function UsageWorkspace({ query = "" }: { query?: string }) {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async (range?: { from: string; to: string }) => {
    setLoading(true); setError("");
    const search = range?.from && range?.to ? `?from=${range.from}&to=${range.to}` : "";
    try {
      const response = await fetch(`/api/usage${search}`, { cache: "no-store" });
      const body = await response.json() as UsageReport & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Não foi possível carregar o histórico.");
      setReport(body);
      setFrom((current) => current || body.range.from);
      setTo((current) => current || body.range.to);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar o histórico.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const people = useMemo(() => {
    if (!report) return [];
    const actions = new Map(report.actions.map((row) => [`${row.organizationId}:${row.subjectId}`, row.total]));
    const grouped = new Map<string, {
      key: string; subjectId: string; organizationId: string; organizationName: string;
      displayName: string; email: string; role: string; subjectKind: string;
      totalMs: number; days: number; sessions: number; today: number; lastSeenAt: number;
    }>();
    for (const day of report.days) {
      const key = `${day.organizationId}:${day.subjectId}`;
      const entry = grouped.get(key) ?? {
        key, subjectId: day.subjectId, organizationId: day.organizationId, organizationName: day.organizationName,
        displayName: day.displayName, email: day.email, role: day.role, subjectKind: day.subjectKind,
        totalMs: 0, days: 0, sessions: 0, today: 0, lastSeenAt: 0,
      };
      entry.totalMs += day.activeMs;
      entry.days += 1;
      entry.sessions += day.sessions;
      entry.lastSeenAt = Math.max(entry.lastSeenAt, day.lastSeenAt);
      if (day.day === report.today) entry.today = day.activeMs;
      grouped.set(key, entry);
    }
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return [...grouped.values()]
      .map((entry) => ({ ...entry, actions: actions.get(entry.key) ?? 0 }))
      .filter((entry) => !normalized || `${entry.displayName} ${entry.email} ${entry.organizationName}`.toLocaleLowerCase("pt-BR").includes(normalized))
      .sort((left, right) => right.totalMs - left.totalMs);
  }, [report, query]);

  const byDay = useMemo(() => {
    if (!report) return [];
    const grouped = new Map<string, { day: string; totalMs: number; people: number }>();
    for (const entry of report.days) {
      const current = grouped.get(entry.day) ?? { day: entry.day, totalMs: 0, people: 0 };
      current.totalMs += entry.activeMs;
      current.people += 1;
      grouped.set(entry.day, current);
    }
    return [...grouped.values()].sort((left, right) => right.day.localeCompare(left.day));
  }, [report]);

  if (loading && !report) {
    return <Card><CardContent className="grid min-h-64 place-items-center"><LoaderCircle className="size-6 animate-spin text-hoikos-600" /></CardContent></Card>;
  }
  if (error && !report) {
    return <Card className="border-hoikos-200"><CardContent className="flex flex-col items-start gap-3 p-6"><CircleAlert className="size-6 text-hoikos-600" /><p className="text-sm text-hoikos-800">{error}</p><Button onClick={() => void load()}><RefreshCw />Tentar novamente</Button></CardContent></Card>;
  }
  if (!report) return null;

  const scopeLabel = report.scope === "platform" ? "Todos os acessos da plataforma"
    : report.scope === "organization" ? "Todos os acessos desta empresa"
    : report.scope === "dependents" ? "Seu acesso e os dependentes desta empresa" : "Somente o seu histórico";
  const totalMs = people.reduce((sum, entry) => sum + entry.totalMs, 0);

  return <div className="space-y-5">
    <Card className="workspace-card">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="flex items-center gap-2 text-base"><Clock className="size-4 text-hoikos-600" />Tempo online</CardTitle>
          <Badge variant="outline">{scopeLabel}</Badge>
        </div>
        <p className="text-sm leading-6 text-hoikos-500">
          O tempo é medido no servidor, somando apenas os intervalos entre sinais recebidos enquanto a aba está visível,
          com no máximo {Math.round(report.gapLimitMs / 1000)} s por intervalo. Fechar a aba, perder a rede ou desligar o
          computador interrompe a contagem no último sinal: o total nunca é inflado, e o erro possível é de até
          {" "}{Math.round(report.beatMs / 1000)} s por sessão, sempre para menos.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="text-sm">De<Input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} className="mt-1 h-10" /></label>
        <label className="text-sm">Até<Input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className="mt-1 h-10" /></label>
        <Button variant="outline" disabled={loading || !from || !to} onClick={() => void load({ from, to })}>{loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}Atualizar período</Button>
        <p className="text-sm text-hoikos-600 sm:ml-auto">Total no período: <strong className="tabular-nums">{formatDuration(totalMs)}</strong></p>
      </CardContent>
    </Card>

    {error ? <p role="alert" className="rounded-md border border-hoikos-200 bg-hoikos-50 px-4 py-3 text-sm text-hoikos-800">{error}</p> : null}

    {people.length === 0 ? (
      <Card><CardContent className="grid min-h-56 place-items-center p-6 text-center"><div><Clock className="mx-auto size-7 text-hoikos-500" /><p className="mt-3 font-medium text-hoikos-900">Nenhum tempo registrado no período</p><p className="mt-1 text-sm text-hoikos-500">A contagem começa no próximo acesso dentro do período escolhido.</p></div></CardContent></Card>
    ) : <>
      <Card className="overflow-hidden">
        <CardHeader className="border-b"><CardTitle className="text-base">Por acesso</CardTitle></CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow className="bg-hoikos-50">
              <TableHead className="pl-5">Acesso</TableHead>
              {report.scope === "platform" ? <TableHead>Empresa</TableHead> : null}
              <TableHead>Perfil</TableHead><TableHead className="text-right">Hoje</TableHead>
              <TableHead className="text-right">No período</TableHead><TableHead className="text-right">Dias</TableHead>
              <TableHead className="text-right">Sessões</TableHead><TableHead className="pr-5 text-right">Ações</TableHead>
            </TableRow></TableHeader>
            <TableBody>{people.map((entry) => <TableRow key={entry.key}>
              <TableCell className="pl-5"><p className="font-medium text-hoikos-900">{entry.displayName}</p><p className="text-xs text-hoikos-500">{entry.email}</p></TableCell>
              {report.scope === "platform" ? <TableCell className="text-sm">{entry.organizationName}</TableCell> : null}
              <TableCell><Badge variant="outline">{accessProfileLabels[entry.role] ?? kindLabels[entry.subjectKind] ?? entry.role}</Badge></TableCell>
              <TableCell className="text-right tabular-nums">{formatDuration(entry.today)}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatDuration(entry.totalMs)}</TableCell>
              <TableCell className="text-right tabular-nums">{entry.days}</TableCell>
              <TableCell className="text-right tabular-nums">{entry.sessions}</TableCell>
              <TableCell className="pr-5 text-right tabular-nums">{entry.actions}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="border-b"><CardTitle className="text-base">Dia a dia</CardTitle></CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow className="bg-hoikos-50"><TableHead className="pl-5">Dia</TableHead><TableHead className="text-right">Acessos com registro</TableHead><TableHead className="pr-5 text-right">Tempo somado</TableHead></TableRow></TableHeader>
            <TableBody>{byDay.map((entry) => <TableRow key={entry.day}>
              <TableCell className="pl-5 font-medium">{dayLabel(entry.day)}{entry.day === report.today ? <Badge variant="outline" className="ml-2">Hoje</Badge> : null}</TableCell>
              <TableCell className="text-right tabular-nums">{entry.people}</TableCell>
              <TableCell className="pr-5 text-right font-semibold tabular-nums">{formatDuration(entry.totalMs)}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </div>
      </Card>

      {report.scope === "self" ? <Card className="overflow-hidden">
        <CardHeader className="border-b"><CardTitle className="text-base">Suas sessões por dia</CardTitle></CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow className="bg-hoikos-50"><TableHead className="pl-5">Dia</TableHead><TableHead>Primeiro sinal</TableHead><TableHead>Último sinal</TableHead><TableHead className="pr-5 text-right">Tempo</TableHead></TableRow></TableHeader>
            <TableBody>{report.days.map((day) => <TableRow key={`${day.subjectId}-${day.day}`}>
              <TableCell className="pl-5 font-medium">{dayLabel(day.day)}</TableCell>
              <TableCell className="tabular-nums">{clock(day.firstSeenAt)}</TableCell>
              <TableCell className="tabular-nums">{clock(day.lastSeenAt)}</TableCell>
              <TableCell className="pr-5 text-right font-semibold tabular-nums">{formatDuration(day.activeMs)}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </div>
      </Card> : null}
    </>}
  </div>;
}
