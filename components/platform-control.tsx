"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";

type Rule = { subject: string; state: string; until: number | null; reason: string; revision: number };
type Snapshot = {
  members: { id: string; name: string; email: string; role: string; active: number }[];
  rules: Rule[];
  targets: { email: string }[];
  configured: boolean;
  activation: null | { company_id: string; plan_id: string; request_key: string; status: string; base_cents: number | null; monthly_cents: number | null; last_error: string | null };
  history: { action: string; entity_id: string; actor_user_id: string; metadata_json: string; created_at: number }[];
};
const labels: Record<string, string> = { active: "Ativo", suspended: "Bloqueado temporariamente", blocked: "Bloqueado permanentemente", removed: "Acesso excluído", pending: "Aguardando confirmação", canceled: "Assinatura cancelada", partner: "Parceiro", owner: "Proprietário", admin: "Administrador" };
const money = (cents: number | null) => cents === null ? "Aguardando Empresa" : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
async function api<T>(url: string, body?: object): Promise<T> {
  const response = await fetch(url, { method: body ? "POST" : "GET", cache: "no-store", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Não foi possível concluir."); return result;
}

function CompanyControls({ organizationId, name, maintenance = false }: { organizationId: string; name: string; maintenance?: boolean }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [companyId, setCompanyId] = useState(""); const [planId, setPlanId] = useState("");
  const [email, setEmail] = useState(""); const [link, setLink] = useState("");
  const [subject, setSubject] = useState("*"); const [state, setState] = useState("suspended"); const [until, setUntil] = useState(""); const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState<{ body: object; text: string } | null>(null);
  const load = useCallback(async () => setData(await api<Snapshot>(`/api/superadmin/platform?organizationId=${organizationId}`)), [organizationId]);
  // O horário entra por estado: comparar com Date.now() durante o render é impuro.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => { setNow(Date.now()); void load().catch((e: Error) => setError(e.message)); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function save(body: object, success: string) {
    setBusy(true); setError(""); setMessage("");
    try { const result = await api<{ invitationPath?: string }>("/api/superadmin/platform", { ...body, organizationId });
      if (result.invitationPath) setLink(`${window.location.origin}${result.invitationPath}`);
      await load(); setMessage(success);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }
  function access(event: FormEvent) {
    event.preventDefault();
    const normalized = subject === "*" ? "*" : subject.trim().toLowerCase();
    const rule = data?.rules.find((r) => r.subject === normalized);
    setConfirmation({ body: { action: "access", subject: normalized, state, until: state === "suspended" ? new Date(until).getTime() : null, reason, revision: rule?.revision ?? 0 },
      text: `${labels[state]}: ${normalized === "*" ? `todos os acessos de ${name}` : normalized}. ${state === "removed" ? "O vínculo de acesso será excluído logicamente; registros e histórico da empresa serão preservados." : "A mudança passa a valer nas próximas requisições, inclusive em sessões abertas."}` });
  }
  if (!data) return <div className="p-5" role="status">{error || "Carregando controles…"}{error && <Button className="ml-3" onClick={() => void load().catch((e: Error) => setError(e.message))}>Tentar novamente</Button>}</div>;
  return <div className="space-y-6">
    {error && <p role="alert" className="rounded-lg bg-hoikos-50 p-4 text-hoikos-800">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-hoikos-50 p-4 text-hoikos-800">{message}</p>}
    {maintenance && <p className="rounded-lg border border-hoikos-200 bg-hoikos-50 p-4 text-sm text-hoikos-900">Ambiente interno da plataforma. Não tem contratante, parceiro nem assinatura: aqui você controla o acesso do administrador de manutenção e lê o histórico administrativo.</p>}
    <div className={`grid gap-6 lg:grid-cols-2 ${maintenance ? "hidden" : ""}`}>
      <Card><CardHeader><CardTitle>Ativação e mensalidade</CardTitle></CardHeader><CardContent className="space-y-4">
        <p>Mensalidade pelo preço oficial do Drap Empresa, sem acréscimo da H.OIKOS. A cobrança fica no Empresa, inclusive para quem usa somente o Architector.</p>
        {!data.configured && <p className="rounded-lg bg-hoikos-50 p-3 text-sm text-hoikos-900">A conexão de ativação com o Empresa ainda não está configurada. Nenhuma cobrança foi iniciada por esta ferramenta.</p>}
        {data.activation ? <>
          <dl className="grid grid-cols-2 gap-3 text-sm"><dt>Situação</dt><dd>{labels[data.activation.status] ?? data.activation.status}</dd><dt>Plano no Empresa</dt><dd className="break-all">{data.activation.plan_id}</dd><dt>Mensalidade base</dt><dd>{money(data.activation.base_cents)}</dd><dt>Total mensal confirmado</dt><dd className="font-semibold">{money(data.activation.monthly_cents)}</dd></dl>
          {data.activation.last_error && <p className="text-sm text-hoikos-900">{data.activation.last_error}</p>}
          <div className="flex flex-wrap gap-2"><Button disabled={busy || !data.configured} onClick={() => void save({ action: "send" }, "Solicitação enviada. A ativação depende da confirmação do Empresa.")}>Enviar ativação ao Empresa</Button><Button variant="outline" disabled={busy} onClick={() => void load().catch((e: Error) => setError(e.message))}>Atualizar situação</Button></div>
        </> : <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); setConfirmation({ body: { action: "enroll", companyId, planId, confirmed: true }, text: `Vincular ${name} ao plano ${planId} do Empresa. O acesso ficará aguardando confirmação da assinatura. A mensalidade seguirá exatamente o valor oficial confirmado pelo Drap Empresa, sem acréscimo da H.OIKOS.` }); }}>
          <label className="block text-sm">Identificador da empresa no Drap Empresa<Input required value={companyId} onChange={(e) => setCompanyId(e.target.value)} maxLength={120} /></label>
          <label className="block text-sm">Identificador do plano mensal no Empresa<Input required value={planId} onChange={(e) => setPlanId(e.target.value)} maxLength={120} /></label>
          <Button disabled={busy || !data.configured}>Vincular assinatura</Button>
        </form>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Adicionar parceiro</CardTitle></CardHeader><CardContent className="space-y-4">
        <p>O parceiro recebe acesso de leitura aos módulos permitidos pelo perfil da empresa.</p>
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); setLink(""); void save({ action: "partner", email }, "Convite criado. Copie o link para compartilhar."); }}>
          <label className="block text-sm">E-mail do parceiro<Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label><Button disabled={busy}>Criar convite de parceiro</Button>
        </form>
        {link && <div className="space-y-2"><label className="block text-sm">Link válido por sete dias<Input readOnly value={link} onFocus={(e) => e.target.select()} /></label><Button variant="outline" onClick={() => void navigator.clipboard.writeText(link).then(() => setMessage("Link copiado.")).catch(() => setError("Selecione e copie o link manualmente."))}>Copiar link</Button></div>}
      </CardContent></Card>
    </div>
    <Card><CardHeader><CardTitle>Controle de acessos</CardTitle></CardHeader><CardContent className="space-y-5">
      <p className="text-sm text-hoikos-600">Bloquear ou excluir um acesso não cancela a assinatura. Gerencie o cancelamento da cobrança no Drap Empresa.</p>
      <form onSubmit={access} className="grid items-end gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="block text-sm">Quem será afetado<NativeSelect value={subject} onChange={(e) => setSubject(e.target.value)} className="max-w-full"><option value="*">Empresa inteira</option>{Array.from(new Set([...data.targets.map((m) => m.email), ...data.rules.filter((r) => r.subject !== "*").map((r) => r.subject)])).map((address) => <option key={address} value={address}>{address}</option>)}</NativeSelect></label>
        <label className="block text-sm">Ação<NativeSelect value={state} onChange={(e) => setState(e.target.value)}><option value="suspended">Bloquear temporariamente</option><option value="blocked">Bloquear permanentemente</option><option value="removed">Excluir acesso</option><option value="active">Restaurar acesso</option></NativeSelect></label>
        {state === "suspended" && <label className="block text-sm">Bloquear até (seu horário local)<Input type="datetime-local" required value={until} onChange={(e) => setUntil(e.target.value)} /></label>}
        <label className="block text-sm md:col-span-2">Motivo<Input required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label><Button disabled={busy}>Revisar alteração</Button>
      </form>
      <div className="grid gap-3 md:grid-cols-2">{data.members.length === 0 && <p>Nenhum membro cadastrado nesta empresa.</p>}{data.members.map((member) => {
        const companyRule = data.rules.find((r) => r.subject === "*"); const ownRule = data.rules.find((r) => r.subject === member.email.toLowerCase());
        const denies = (r?: Rule) => r && r.state !== "active" && !(r.state === "suspended" && r.until !== null && r.until <= Date.now());
        const rule = denies(companyRule) ? companyRule : denies(ownRule) ? ownRule : undefined;
        return <div className="rounded-lg border p-4" key={member.id}><p className="font-medium">{member.name}</p><p className="break-all text-sm text-hoikos-600">{member.email} · {labels[member.role] ?? member.role}</p><p className="mt-2 text-sm">{rule ? labels[rule.state] : member.active ? "Ativo" : "Inativo"}{rule?.until ? ` até ${new Date(rule.until).toLocaleString("pt-BR")}` : ""}</p><Button className="mt-2" size="sm" variant="outline" onClick={() => setSubject(member.email.toLowerCase())}>Selecionar acesso</Button></div>;
      })}</div>
      {data.rules.filter((r) => r.subject === "*").map((r) => <p key={r.subject} className="text-sm">Regra da empresa: {r.state === "suspended" && r.until && now > 0 && r.until <= now ? "Bloqueio temporário encerrado" : labels[r.state]}. Motivo: {r.reason}</p>)}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Histórico administrativo</CardTitle></CardHeader><CardContent><div className="space-y-3">{!data.history.length && <p>Nenhuma alteração registrada.</p>}{data.history.map((event, i) => <div key={i} className="border-b pb-3 text-sm"><p className="font-medium">{({ "platform.access_changed": "Alteração de acesso", "platform.partner_invited": "Convite de parceiro", "drap.activation_enrolled": "Assinatura vinculada", "drap.activation_requested": "Ativação solicitada", "drap.activation_confirmed": "Assinatura confirmada pelo Empresa" } as Record<string, string>)[event.action] ?? event.action}</p><p className="break-all">{event.entity_id === "*" ? "Empresa inteira" : event.entity_id} · {event.actor_user_id}</p><p className="text-hoikos-500">{new Date(event.created_at).toLocaleString("pt-BR")}</p></div>)}</div></CardContent></Card>
    <AlertDialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open) setConfirmation(null); }}><AlertDialogContent><AlertDialogTitle>Confirmar alteração</AlertDialogTitle><AlertDialogDescription>{confirmation?.text}</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={() => { if (confirmation) void save(confirmation.body, "Alteração registrada."); }}>Confirmar</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
export function PlatformControl({ organizations, maintenanceId }: { organizations: { id: string; name: string }[]; maintenanceId?: string }) {
  const [selected, setSelected] = useState("");
  const options = maintenanceId ? [...organizations, { id: maintenanceId, name: "Ambiente de manutenção" }] : organizations;
  const organization = options.find((o) => o.id === selected);
  return <section className="mt-6 space-y-4"><div className="flex flex-wrap items-end gap-4"><h2 className="text-xl font-semibold">Assinaturas, parceiros e acessos</h2><label className="block text-sm">Empresa<NativeSelect value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">Selecione uma empresa</option>{options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</NativeSelect></label></div>{organization && <CompanyControls key={selected} organizationId={selected} name={organization.name} maintenance={selected === maintenanceId} />}</section>;
}