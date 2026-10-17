"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, Eye, EyeOff, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ResetInfo = { email: string; expiresAt: number };

// Criação de nova senha pelo link que um administrador gerou. O link é de uso único.
export function PasswordResetApp({ token }: { token: string }) {
  const [info, setInfo] = useState<ResetInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/password-reset/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as ResetInfo & { error?: string };
        if (!alive) return;
        if (response.ok) setInfo(body); else setError(body.error ?? "Não foi possível abrir este link.");
      })
      .catch(() => { if (alive) setError("Sem conexão. Verifique a internet e recarregue a página."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token]);

  const problem = password && password.length < 10 ? "Use pelo menos 10 caracteres."
    : confirmation && password !== confirmation ? "As senhas não conferem." : "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (problem || !password || password !== confirmation) return;
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/password-reset/${encodeURIComponent(token)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Não foi possível salvar a nova senha.");
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar a nova senha.");
    } finally {
      setSaving(false);
    }
  }

  const field = "h-11 border-white/10 bg-white/[0.06] text-white";
  return <main className="relative grid min-h-svh place-items-center overflow-hidden bg-drap-deep p-5"><Card className="relative w-full max-w-md border-white/10 bg-drap-deep text-white shadow-none"><CardContent className="p-7 sm:p-9"><BrandLogo variant="stacked" dark className="mx-auto w-[200px]" />
    {loading ? <div className="grid min-h-60 place-items-center"><LoaderCircle className="size-7 animate-spin text-drap-300" aria-label="Carregando" /></div>
      : done ? <div className="py-10 text-center"><CheckCircle2 className="mx-auto size-14 text-drap-300" /><h1 className="display-heading mt-5 text-3xl">Senha alterada</h1><p className="mt-3 text-sm text-drap-300">Entre com {info?.email} e a nova senha. As sessões abertas com a senha antiga foram encerradas.</p><Button asChild className="mt-7 h-11 w-full bg-drap-400 text-drap-950 hover:bg-drap-200"><Link href="/entrar">Entrar</Link></Button></div>
      : !info ? <div className="py-10 text-center"><ShieldCheck className="mx-auto size-12 text-drap-300" /><h1 className="display-heading mt-5 text-3xl">Link indisponível</h1><p role="alert" className="mt-3 text-sm text-drap-300">{error}</p><Button asChild variant="outline" className="mt-7 h-11 w-full border-white/20 bg-transparent text-white hover:bg-white/10"><Link href="/entrar">Ir para a entrada</Link></Button></div>
      : <form onSubmit={submit} className="mt-8 space-y-4"><div><h1 className="display-heading text-3xl">Crie uma nova senha</h1><p className="mt-2 text-sm text-drap-300">Conta {info.email}. Link válido até {new Date(info.expiresAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.</p></div>
        <div><label htmlFor="reset-password" className="mb-2 block text-sm font-medium text-drap-200">Nova senha</label><div className="relative"><Input id="reset-password" type={show ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={10} required aria-describedby="reset-hint" className={`${field} pr-11`} /><button type="button" onClick={() => setShow((value) => !value)} aria-label={show ? "Ocultar senha" : "Mostrar senha"} className="absolute right-3 top-1/2 -translate-y-1/2 text-drap-500 hover:text-white">{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div><p id="reset-hint" className="mt-2 text-xs text-drap-500">Pelo menos 10 caracteres. Vale para todas as empresas em que você entra.</p></div>
        <div><label htmlFor="reset-confirmation" className="mb-2 block text-sm font-medium text-drap-200">Repita a nova senha</label><Input id="reset-confirmation" type={show ? "text" : "password"} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" required className={field} /></div>
        {problem || error ? <p role="alert" className="rounded-md border border-drap-400/20 bg-drap-400/10 px-3 py-2 text-sm text-drap-200">{problem || error}</p> : null}
        <Button type="submit" disabled={saving || Boolean(problem) || !password || password !== confirmation} className="h-11 w-full bg-drap-400 text-drap-950 hover:bg-drap-200">{saving ? <LoaderCircle className="animate-spin" /> : <KeyRound />}Salvar nova senha</Button></form>}
  </CardContent></Card></main>;
}
