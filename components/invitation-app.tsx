"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Building2, CheckCircle2, LoaderCircle, Mail, ShieldCheck, UserPlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { accessProfileLabels, permissionModuleLabels, permissionModules, type PermissionSet } from "@/lib/permissions";

type Invitation = { email: string; role: string; organizationName: string; expiresAt: number; permissions: PermissionSet };
type Session = { authenticated: boolean; signInPath?: string };

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Não foi possível concluir a operação.");
  return body as T;
}

export function InvitationApp({ token }: { token: string }) {
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      Promise.all([
        readJson<{ invitation: Invitation }>(`/api/invitations/${encodeURIComponent(token)}`),
        readJson<Session>("/api/session"),
      ]).then(([invite, currentSession]) => {
        setInvitation(invite.invitation);
        setSession(currentSession);
      }).catch((cause) => setError(cause instanceof Error ? cause.message : "Convite inválido."))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [token]);

  async function accept() {
    setAccepting(true);
    setError("");
    try {
      await readJson(`/api/invitations/${encodeURIComponent(token)}/accept`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acceptTerms: true }) });
      setAccepted(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível aceitar o convite.");
    } finally {
      setAccepting(false);
    }
  }

  const returnTo = `/convite/${encodeURIComponent(token)}`;
  const signInPath = `/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`;
  const visibleAreas = invitation ? permissionModules.filter((module) => invitation.permissions[module].view) : [];
  return <main className="relative grid min-h-svh place-items-center overflow-hidden bg-[#06111f] p-5"><div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_12%,rgba(11,207,221,0.2),transparent_30%),radial-gradient(circle_at_82%_86%,rgba(35,93,230,0.2),transparent_35%)]" /><Card className="relative w-full max-w-lg border-white/10 bg-slate-950/85 text-white shadow-2xl backdrop-blur-xl"><CardContent className="p-7 sm:p-9"><Image src="/drap-architector-logo.png" alt="Drap Architector" width={2037} height={772} priority className="h-auto w-full max-w-[240px]" />{loading ? <div className="grid min-h-72 place-items-center"><LoaderCircle className="size-7 animate-spin text-cyan-300" /></div> : accepted ? <div className="py-12 text-center"><CheckCircle2 className="mx-auto size-14 text-emerald-400" /><h1 className="mt-5 text-3xl font-semibold">Acesso criado</h1><p className="mt-3 text-slate-300">Sua conta já faz parte de {invitation?.organizationName}.</p><Button asChild className="mt-7 h-11 w-full bg-cyan-400 text-slate-950 hover:bg-cyan-300"><Link href="/">Abrir a plataforma</Link></Button></div> : error && !invitation ? <div className="py-12 text-center"><ShieldCheck className="mx-auto size-12 text-red-300" /><h1 className="mt-5 text-2xl font-semibold">Convite indisponível</h1><p className="mt-3 text-slate-400">{error}</p></div> : invitation ? <div className="mt-9"><span className="grid size-12 place-items-center rounded-2xl bg-cyan-300/10 text-cyan-300 ring-1 ring-cyan-300/20"><UserPlus className="size-5" /></span><h1 className="mt-5 text-3xl font-semibold tracking-tight">Você recebeu um convite</h1><p className="mt-3 text-slate-300">Confirme sua identidade para criar o acesso à empresa.</p><div className="mt-7 space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-5"><p className="flex items-center gap-3"><Building2 className="size-4 text-cyan-300" /><span className="font-medium">{invitation.organizationName}</span></p><p className="flex items-center gap-3 text-sm text-slate-300"><Mail className="size-4 text-cyan-300" />{invitation.email}</p><div><Badge className="border-cyan-300/20 bg-cyan-300/10 text-cyan-200">{accessProfileLabels[invitation.role] ?? invitation.role}</Badge></div><p className="text-xs leading-5 text-slate-400">Áreas liberadas: {visibleAreas.map((module) => permissionModuleLabels[module]).join(", ")}.</p></div>{session?.authenticated ? <label className="mt-5 flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm leading-6 text-slate-300"><Checkbox checked={acceptedTerms} onCheckedChange={(value) => setAcceptedTerms(value === true)} className="mt-1 border-slate-500" /><span>Li e aceito os <Link href="/termos" target="_blank" className="font-medium text-cyan-300 underline underline-offset-2">Termos de Uso e Privacidade</Link>.</span></label> : null}{error ? <p role="alert" className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}{session?.authenticated ? <Button onClick={() => void accept()} disabled={accepting || !acceptedTerms} className="mt-6 h-11 w-full bg-cyan-400 text-slate-950 hover:bg-cyan-300">{accepting ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}Aceitar e criar acesso</Button> : <Button asChild className="mt-6 h-11 w-full bg-cyan-400 text-slate-950 hover:bg-cyan-300"><a href={signInPath} target="_top">Entrar para aceitar o convite</a></Button>}<p className="mt-4 text-center text-xs text-slate-500">Válido até {new Date(invitation.expiresAt).toLocaleDateString("pt-BR")}.</p></div> : null}</CardContent></Card></main>;
}
