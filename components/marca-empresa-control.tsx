"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { IdentidadeVisual, type MarcaDaSessao } from "@/components/identidade-visual";

/** Identidade visual da empresa escolhida, enviada pelo superadministrador. */
export function MarcaEmpresaControl({ organizationId, name }: { organizationId: string; name: string }) {
  const [marca, setMarca] = useState<MarcaDaSessao | null>(null);
  const [erro, setErro] = useState("");
  const base = `/api/superadmin/organizations/${organizationId}/marca`;

  const carregar = useCallback(async () => {
    setErro("");
    const resposta = await fetch(base, { cache: "no-store" });
    const corpo = await resposta.json().catch(() => ({})) as { branding?: MarcaDaSessao; error?: string };
    if (!resposta.ok || !corpo.branding) throw new Error(corpo.error ?? "Não foi possível ler a identidade visual da empresa.");
    setMarca(corpo.branding);
  }, [base]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void carregar().catch((causa: Error) => setErro(causa.message)); }, 0);
    return () => window.clearTimeout(timer);
  }, [carregar]);

  return <section className="space-y-3" aria-labelledby={`marca-${organizationId}`}>
    <div>
      <h3 id={`marca-${organizationId}`} className="text-lg font-semibold">Identidade visual de {name}</h3>
      <p className="text-sm text-drap-600">O logotipo enviado aqui aparece no menu de toda a equipe da empresa, e as cores dele viram a paleta da plataforma para ela.</p>
    </div>
    {marca
      ? <IdentidadeVisual key={`${organizationId}-${marca.revision}`} marca={marca} empresa={name} previaNaPagina={false}
          endpoint={base} logoBase={`${base}/logo`} onSaved={carregar} />
      : erro
        ? <p role="alert" className="text-sm">{erro} <Button size="sm" variant="outline" className="ml-2" onClick={() => void carregar().catch((causa: Error) => setErro(causa.message))}>Tentar novamente</Button></p>
        : <LoaderCircle className="size-5 animate-spin text-drap-600" aria-label="Carregando identidade visual" />}
  </section>;
}
