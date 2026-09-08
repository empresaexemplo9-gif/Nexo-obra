"use client";
import { BrandLogo } from "@/components/brand-logo";
import Link from "next/link";
import { type FormEvent, useRef, useState } from "react";
import { CheckCircle2, ClipboardCheck, LoaderCircle, LogOut, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { PortalError, PortalItemCard } from "@/components/portal-shared";
import { resourceJson, resourceMessage, useLiveResource } from "@/hooks/use-live-resource";
import type { PortalAccess, PortalItem, PortalPage, PortalProgress } from "@/lib/portal";
import { diaryDate } from "@/lib/diary";

type PortalSession = { authenticated: boolean; accesses: PortalAccess[]; userName?: string; termsVersion: string };
function PortalFrame({ children }: { children: React.ReactNode }) {
  return <main className="min-h-svh bg-background"><header className="border-b border-white/10 bg-primary text-white"><div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-5 sm:px-6"><BrandLogo dark className="h-auto w-44" /><span className="ml-auto text-sm text-hoikos-200">Portal do cliente</span><Button asChild variant="ghost" size="icon" aria-label="Sair do portal"><a href="/signout-with-chatgpt?return_to=%2Fportal" target="_top"><LogOut className="size-4" /></a></Button></div></header><div className="mx-auto max-w-6xl space-y-6 px-4 py-7 sm:px-6">{children}</div></main>;
}
function SignInCard({ returnTo }: { returnTo: string }) {
  return <Card className="mx-auto mt-10 max-w-lg"><CardContent className="space-y-5 p-7"><ClipboardCheck className="size-10 text-hoikos-600" /><h1 className="text-2xl font-semibold">Acompanhe sua obra</h1><p className="text-base leading-7 text-hoikos-600">Entre com a conta ChatGPT do mesmo e-mail que recebeu o convite da empresa. O convite não libera acesso para outra pessoa.</p><Button asChild className="w-full"><a href={`/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`} target="_top">Entrar com ChatGPT</a></Button><p className="text-sm text-hoikos-500">Ainda não recebeu um convite? Solicite à empresa responsável pela obra.</p></CardContent></Card>;
}
export function ClientPortalApp() {
  const session = useLiveResource<PortalSession>("/api/portal");
  const [selected, setSelected] = useState("");
  const access = session.data?.accesses.find((item) => item.id === selected) ?? session.data?.accesses[0];
  return <PortalFrame>{session.error && <PortalError message={session.error} retry={session.refresh} />}{session.loading ? <Skeleton className="h-64 rounded-xl" /> : session.data && !session.data.authenticated ? <SignInCard returnTo="/portal" /> : session.data?.authenticated ? <>
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm text-hoikos-500">Bem-vindo, {session.data.userName}</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Suas obras e decisões</h1></div><Button variant="outline" onClick={session.refresh}><RefreshCw className="size-4" />Atualizar</Button></div>
    {access ? <><div className="space-y-2"><Label htmlFor="client-portal-project">Obra / projeto</Label><Select value={access.id} onValueChange={setSelected}><SelectTrigger id="client-portal-project" className="h-auto min-h-11 w-full bg-white"><SelectValue /></SelectTrigger><SelectContent>{session.data.accesses.map((item) => <SelectItem key={item.id} value={item.id}>{item.organizationName} · {item.projectName}</SelectItem>)}</SelectContent></Select></div>{access.termsAccepted ? <ClientProject key={access.id} access={access} onAccessChanged={session.refresh} /> : <PortalTerms endpoint={`/api/portal/access/${access.id}`} version={session.data.termsVersion} onAccepted={session.refresh} />}</> : <Card><Empty><EmptyHeader><EmptyTitle>Nenhuma obra liberada</EmptyTitle><EmptyDescription>Abra o convite enviado pela empresa. Um acesso revogado deixa de aparecer aqui.</EmptyDescription></EmptyHeader></Empty></Card>}
  </> : null}</PortalFrame>;
}

function PortalTerms({ endpoint, version, onAccepted, buttonText = "Aceitar e continuar" }: { endpoint: string; version: string; onAccepted: () => void; buttonText?: string }) {
  const [checked, setChecked] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function accept() { setBusy(true); setError(""); try { await resourceJson(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accepted: true, version }) }); onAccepted(); } catch (cause) { setError(resourceMessage(cause)); } finally { setBusy(false); } }
  return <Card><CardContent className="space-y-4 p-6"><h2 className="text-xl font-semibold">Confirme seu acesso</h2><p className="text-base leading-7 text-hoikos-600">Você verá somente as obras e os conteúdos que a empresa compartilhar. Aprovações e pedidos de ajuste ficam registrados com sua identidade, data e conteúdo apresentado.</p><div className="flex items-start gap-3"><Checkbox id="portal-terms" checked={checked} onCheckedChange={(value) => setChecked(value === true)} disabled={busy} /><Label htmlFor="portal-terms" className="block leading-6">Li e aceito os <a href="/termos" target="_blank" rel="noreferrer" className="text-hoikos-700 underline">Termos de Uso</a> (versão {version}).</Label></div>{error && <PortalError message={error} />}<Button disabled={!checked || busy} onClick={() => void accept()}>{busy && <LoaderCircle className="size-4 animate-spin" />}{buttonText}</Button></CardContent></Card>;
}

export function ClientPortalInvitation({ token }: { token: string }) {
  const session = useLiveResource<PortalSession>("/api/portal", 0);
  const invitation = useLiveResource<{ access: PortalAccess; termsVersion: string }>(session.data?.authenticated ? `/api/portal/invitations/${encodeURIComponent(token)}` : null, 0);
  const [accepted, setAccepted] = useState(false);
  return <PortalFrame><div className="mx-auto max-w-xl">{session.error && <PortalError message={session.error} retry={session.refresh} />}{session.loading || invitation.loading ? <Skeleton className="h-72 rounded-xl" /> : session.data && !session.data.authenticated ? <SignInCard returnTo={`/portal/convite/${encodeURIComponent(token)}`} /> : invitation.error ? <PortalError message={invitation.error} retry={invitation.refresh} /> : accepted ? <Card><CardContent className="space-y-5 p-7 text-center"><CheckCircle2 className="mx-auto size-12 text-hoikos-600" /><h1 className="text-2xl font-semibold">Acesso confirmado</h1><Button asChild><Link href="/portal">Abrir meu portal</Link></Button></CardContent></Card> : invitation.data ? <div className="space-y-5"><h1 className="text-2xl font-semibold">Convite de {invitation.data.access.organizationName}</h1><p className="text-base text-hoikos-600">{invitation.data.access.projectName} · {invitation.data.access.email}</p><PortalTerms endpoint={`/api/portal/invitations/${encodeURIComponent(token)}`} version={invitation.data.termsVersion} onAccepted={() => setAccepted(true)} buttonText="Aceitar convite" /></div> : null}</div></PortalFrame>;
}

function ClientProject({ access, onAccessChanged }: { access: PortalAccess; onAccessChanged: () => void }) {
  const [page, setPage] = useState(1);
  const resource = useLiveResource<PortalPage & { access: PortalAccess; progress: PortalProgress | null }>(`/api/portal/access/${access.id}?page=${page}`);
  if (resource.loading) return <Skeleton className="h-80 rounded-xl" />;
  if (!resource.data) return <PortalError message={resource.error || "Portal indisponível."} retry={() => { resource.refresh(); onAccessChanged(); }} />;
  const data = resource.data;
  const statuses: Record<string, string> = { active: "Em andamento", on_hold: "Pausado", completed: "Concluído", archived: "Arquivado" };
  return <div className="space-y-5">{resource.error && <PortalError message={resource.error} retry={resource.refresh} />}{data.progress && <Card className="border-0 bg-primary text-white"><CardContent className="grid gap-6 p-6 md:grid-cols-[1fr_1fr]"><div><p className="text-sm text-hoikos-200">{data.access.projectCode} · {statuses[data.progress.status] ?? data.progress.status}</p><h2 className="mt-2 text-2xl font-semibold">{data.access.projectName}</h2><p className="mt-2 text-base text-hoikos-300">Fase: {data.progress.phase}</p><p className="mt-2 text-sm text-hoikos-300">Início: {data.progress.startDate ? diaryDate(data.progress.startDate) : "Não informado"} · Entrega prevista: {data.progress.targetDate ? diaryDate(data.progress.targetDate) : "Não informada"}</p></div><div className="self-center"><div className="flex justify-between text-sm"><span>Avanço informado pela empresa</span><strong className="text-xl text-hoikos-300">{data.progress.progressPercent}%</strong></div><Progress value={data.progress.progressPercent} className="mt-3 bg-white/10 [&_[data-slot=progress-indicator]]:bg-hoikos-300" /></div></CardContent></Card>}
    <div className="flex flex-wrap justify-between gap-2"><h2 className="text-xl font-semibold">{data.pending ? `${data.pending} aprovação(ões) pendente(s)` : "Atualizações e histórico"}</h2><p className="text-sm text-hoikos-500">Atualização automática · 15 s</p></div>
    {data.items.map((item) => <PortalItemCard key={item.id} item={item}>{item.kind === "approval" && item.status === "open" && (data.access.canApprove && !resource.error ? <DecisionForm item={item} onSaved={resource.refresh} /> : <p className="text-sm text-hoikos-500">A resposta depende da permissão de aprovação liberada pela empresa.</p>)}</PortalItemCard>)}
    {!data.items.length && <Card><Empty><EmptyHeader><EmptyTitle>Nenhum conteúdo compartilhado ainda</EmptyTitle><EmptyDescription>As atualizações, fotos e solicitações da empresa aparecerão aqui.</EmptyDescription></EmptyHeader></Empty></Card>}
    {data.total > data.pageSize && <div className="flex items-center justify-end gap-3"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</Button><span className="text-sm">{page} / {Math.ceil(data.total / data.pageSize)}</span><Button variant="outline" disabled={page * data.pageSize >= data.total} onClick={() => setPage((value) => value + 1)}>Próxima</Button></div>}
  </div>;
}

function DecisionForm({ item, onSaved }: { item: PortalItem; onSaved: () => void }) {
  const [choice, setChoice] = useState<"approved" | "changes_requested" | "">("");
  const [comment, setComment] = useState(""); const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const attempt = useRef<{ id: string; payload: string } | null>(null); const submitting = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (submitting.current) return; submitting.current = true; setBusy(true); setError("");
    const payload = JSON.stringify({ choice, comment, confirmed }); if (!attempt.current || attempt.current.payload !== payload) attempt.current = { id: crypto.randomUUID(), payload };
    try { await resourceJson(`/api/portal/access/${item.accessId}/items/${item.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: attempt.current.id, choice, comment, confirmed }) }); onSaved(); }
    catch (cause) { setError(resourceMessage(cause)); } finally { submitting.current = false; setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-4 border-t border-hoikos-200 pt-4"><fieldset disabled={busy} className="space-y-4"><div className="space-y-2"><Label htmlFor={`choice-${item.id}`}>Sua decisão</Label><Select value={choice} onValueChange={(value) => { setChoice(value as typeof choice); setConfirmed(false); }}><SelectTrigger id={`choice-${item.id}`} className="w-full"><SelectValue placeholder="Escolha uma resposta" /></SelectTrigger><SelectContent><SelectItem value="approved">Aprovar o conteúdo apresentado</SelectItem><SelectItem value="changes_requested">Solicitar ajustes</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor={`comment-${item.id}`}>{choice === "changes_requested" ? "Quais ajustes são necessários?" : "Observação (opcional)"}</Label><Textarea id={`comment-${item.id}`} rows={3} maxLength={3000} required={choice === "changes_requested"} minLength={choice === "changes_requested" ? 5 : undefined} value={comment} onChange={(event) => setComment(event.target.value)} /></div><div className="flex items-start gap-3"><Checkbox id={`confirm-${item.id}`} checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} /><Label htmlFor={`confirm-${item.id}`} className="block leading-6">Revisei o conteúdo e confirmo o registro desta decisão. Ela ficará preservada no histórico.</Label></div><p className="text-xs text-hoikos-500">Esta confirmação registra sua decisão na plataforma; não é uma assinatura digital certificada.</p></fieldset>{error && <PortalError message={error} />}<Button disabled={!choice || !confirmed || busy} type="submit">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}Registrar decisão</Button></form>;
}
