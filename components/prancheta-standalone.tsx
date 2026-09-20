"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, CircleAlert, LoaderCircle } from "lucide-react";

import { PranchetaEditor, type Prancha } from "@/components/prancheta-editor";
import { useUsageHeartbeat } from "@/components/usage-workspace";
import { Button } from "@/components/ui/button";

type Session = {
  authenticated?: boolean;
  member?: { permissions?: { studio?: { view: boolean; edit: boolean } } };
  terms?: { accepted: boolean };
};

export function PranchetaStandalone({ drawingId }: { drawingId: string }) {
  const [prancha, definirPrancha] = useState<Prancha | null>(null);
  const [canEdit, definirCanEdit] = useState(false);
  const [carregando, definirCarregando] = useState(true);
  const [erro, definirErro] = useState("");
  const [presenca, definirPresenca] = useState(false);

  useUsageHeartbeat(presenca);

  useEffect(() => {
    let ativa = true;
    async function carregar() {
      try {
        const sessaoResposta = await fetch("/api/session", { cache: "no-store" });
        const sessao = await sessaoResposta.json() as Session;
        if (!sessaoResposta.ok || !sessao.authenticated) throw new Error("Entre na H.OIKOS para abrir esta prancha.");
        if (sessao.terms && !sessao.terms.accepted) throw new Error("Aceite os termos na H.OIKOS antes de abrir a prancha.");
        if (!sessao.member?.permissions?.studio?.view) throw new Error("Seu acesso não permite ver esta prancha.");
        const resposta = await fetch(`/api/studio/${drawingId}`, { cache: "no-store" });
        const corpo = await resposta.json() as { prancha?: Prancha; error?: string };
        if (!resposta.ok || !corpo.prancha) throw new Error(corpo.error ?? "Não foi possível abrir a prancha.");
        if (!ativa) return;
        definirCanEdit(Boolean(sessao.member.permissions.studio.edit));
        definirPrancha(corpo.prancha);
        definirPresenca(true);
      } catch (causa) {
        if (ativa) definirErro(causa instanceof Error ? causa.message : "Não foi possível abrir a prancha.");
      } finally {
        if (ativa) definirCarregando(false);
      }
    }
    void carregar();
    return () => { ativa = false; };
  }, [drawingId]);

  function voltar() {
    window.close();
    window.setTimeout(() => { if (!window.closed) window.location.assign("/"); }, 100);
  }

  if (carregando) return <main className="grid min-h-svh place-items-center" aria-label="Carregando prancha"><LoaderCircle className="size-7 animate-spin" /></main>;
  if (erro || !prancha) return <main className="grid min-h-svh place-items-center p-6"><div className="max-w-md space-y-4 text-center"><CircleAlert className="mx-auto size-8 text-hoikos-700" /><p role="alert">{erro}</p><Button asChild variant="outline"><a href="/"><ArrowLeft />Voltar à H.OIKOS</a></Button></div></main>;

  return <main className="prancheta-autonoma min-h-svh bg-hoikos-50 p-3 sm:p-4">
    <PranchetaEditor prancha={prancha} canEdit={canEdit} onVoltar={voltar}
      onSalvo={(atualizada) => definirPrancha(atualizada)} fullPage />
  </main>;
}
