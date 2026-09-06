"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { Eye, EyeOff, KeyRound, LoaderCircle, ShieldCheck, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function MaintenanceLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const response = await fetch("/api/maintenance/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Não foi possível entrar.");
      window.location.assign("/");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível entrar."); }
    finally { setLoading(false); }
  }

  return <main className="relative grid min-h-svh place-items-center overflow-hidden bg-[#06111f] p-5"><div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(11,207,221,0.22),transparent_30%),radial-gradient(circle_at_86%_82%,rgba(35,93,230,0.2),transparent_34%)]" /><Card className="relative w-full max-w-md overflow-hidden border-white/10 bg-slate-950/85 text-white shadow-2xl backdrop-blur-xl"><div className="h-1 bg-gradient-to-r from-cyan-400 via-blue-500 to-cyan-400" /><CardContent className="p-7 sm:p-9"><Image src="/drap-architector-logo.png" alt="Drap Architector" width={2037} height={772} priority className="h-auto w-full max-w-[240px]" /><div className="mt-8 flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-cyan-400/10 text-cyan-300 ring-1 ring-cyan-300/20"><Wrench className="size-5" /></span><div><h1 className="text-2xl font-semibold">Administrador de manutenção</h1><p className="mt-1 text-sm text-slate-400">Experiência completa do lado da empresa.</p></div></div><div className="mt-6 rounded-xl border border-cyan-300/10 bg-cyan-300/[0.05] p-4 text-sm leading-6 text-slate-300"><p className="flex items-center gap-2 font-medium text-cyan-200"><ShieldCheck className="size-4" />Ambiente isolado</p><p className="mt-1">Este acesso usa uma empresa própria e vazia para testes, sem revelar dados de clientes contratantes.</p></div><form onSubmit={submit} className="mt-6 space-y-4"><div><label htmlFor="maintenance-email" className="mb-2 block text-sm font-medium text-slate-200">E-mail</label><Input id="maintenance-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required className="h-11 border-white/10 bg-white/[0.06] text-white" /></div><div><label htmlFor="maintenance-password" className="mb-2 block text-sm font-medium text-slate-200">Senha</label><div className="relative"><Input id="maintenance-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required className="h-11 border-white/10 bg-white/[0.06] pr-11 text-white" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div></div>{error ? <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}<Button type="submit" disabled={loading} className="h-11 w-full bg-cyan-400 text-slate-950 hover:bg-cyan-300">{loading ? <LoaderCircle className="animate-spin" /> : <KeyRound />}Entrar no ambiente de manutenção</Button></form><Link href="/" className="mt-6 block text-center text-sm text-slate-500 hover:text-cyan-300">Voltar ao acesso principal</Link></CardContent></Card></main>;
}
