"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Eye, EyeOff, KeyRound, LoaderCircle, LogIn } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// Entrada da plataforma. A senha é criada no link de convite; aqui a pessoa volta.
// O destino vem de `return_to`, mas só é obedecido quando é um caminho do próprio
// aplicativo — assim o link de entrada não serve para levar ninguém para fora.
function safeReturnTo(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.startsWith("/entrar")) return "/";
  return value;
}

export function SignInApp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; redirectTo?: string };
      if (!response.ok) throw new Error(body.error ?? "Não foi possível entrar.");
      // Credenciais do superadministrador levam ao painel da plataforma; as demais, ao destino
      // pedido. O destino é lido só agora, na hora de navegar: não há estado para sincronizar.
      window.location.assign(body.redirectTo === "/superadmin" ? "/superadmin" : safeReturnTo(new URLSearchParams(window.location.search).get("return_to")));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível entrar.");
      setLoading(false);
    }
  }

  return <main className="relative grid min-h-svh place-items-center overflow-hidden bg-primary p-5"><Card className="relative w-full max-w-md overflow-hidden border-white/10 bg-primary text-white shadow-none"><div className="h-px bg-border" /><CardContent className="p-7 sm:p-9"><BrandLogo variant="stacked" dark className="mx-auto w-[200px]" /><div className="mt-8 flex items-center gap-3"><span className="grid size-11 place-items-center rounded-md bg-hoikos-400/10 text-hoikos-300 ring-1 ring-hoikos-300/20"><LogIn className="size-5" /></span><div><h1 className="display-heading text-3xl">Entrar</h1><p className="mt-1 text-sm text-hoikos-500">Use o e-mail que recebeu o convite da empresa.</p></div></div><form onSubmit={submit} className="mt-7 space-y-4"><div><label htmlFor="signin-email" className="mb-2 block text-sm font-medium text-hoikos-200">E-mail</label><Input id="signin-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required className="h-11 border-white/10 bg-white/[0.06] text-white" /></div><div><label htmlFor="signin-password" className="mb-2 block text-sm font-medium text-hoikos-200">Senha</label><div className="relative"><Input id="signin-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required className="h-11 border-white/10 bg-white/[0.06] pr-11 text-white" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} className="absolute right-3 top-1/2 -translate-y-1/2 text-hoikos-500 hover:text-white">{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div></div>{error ? <p role="alert" className="rounded-md border border-hoikos-400/20 bg-hoikos-400/10 px-3 py-2 text-sm text-hoikos-200">{error}</p> : null}<Button type="submit" disabled={loading} className="h-11 w-full bg-hoikos-400 text-hoikos-950 hover:bg-hoikos-200">{loading ? <LoaderCircle className="animate-spin" /> : <KeyRound />}Entrar</Button></form><p className="mt-6 text-center text-sm leading-6 text-hoikos-500">Ainda não tem senha? Ela é criada no link de convite enviado pela empresa.</p><Link href="/termos" className="mt-3 block text-center text-sm text-hoikos-500 hover:text-hoikos-300">Termos de Uso e Privacidade</Link></CardContent></Card></main>;
}
