"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, LoaderCircle, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

type CatalogItem = {
  id: string;
  name: string;
  kind: "free" | "module" | "bundle" | "plan";
  monthlyCents: number;
  annualCents?: number;
  trialDays?: number;
  modules?: string[];
  description: string;
};

type CatalogResponse = {
  catalog: CatalogItem[];
  source: string;
  checkedAt: string;
  pricing: "same_as_drap";
  embeddedExperience: boolean;
  requiresRedirect: boolean;
  checkoutAvailable: boolean;
  tenantProvisioned: boolean;
  connectionStatus: string | null;
  subscription: null | {
    planId: string;
    status: string;
    monthlyCents: number | null;
    subscriptionId: string | null;
    lastError: string | null;
  };
};

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function price(item: CatalogItem) {
  if (item.monthlyCents === 0) return "Grátis";
  return `${currency.format(item.monthlyCents / 100)}/mês`;
}

export function DrapSolutionsWorkspace() {
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void fetch("/api/integrations/drap/catalog", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as CatalogResponse & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Não foi possível carregar as soluções DRAP.");
        if (active) setData(body);
      })
      .catch((cause: Error) => { if (active) setError(cause.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const groups = useMemo(() => {
    if (!data) return [] as Array<{ title: string; items: CatalogItem[] }>;
    return [
      { title: "Plano base", items: data.catalog.filter((item) => item.kind === "free") },
      { title: "Módulos avulsos", items: data.catalog.filter((item) => item.kind === "module") },
      { title: "Pacotes", items: data.catalog.filter((item) => item.kind === "bundle") },
      { title: "Plano DRAP Retaguarda", items: data.catalog.filter((item) => item.kind === "plan") },
    ];
  }, [data]);

  if (loading) {
    return <div className="grid min-h-[60vh] place-items-center"><LoaderCircle className="size-7 animate-spin" /></div>;
  }

  if (!data || error) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <Card><Empty className="min-h-72 border-0"><EmptyHeader><EmptyMedia variant="icon"><ShieldCheck /></EmptyMedia><EmptyTitle>Soluções DRAP indisponíveis</EmptyTitle><EmptyDescription>{error || "Não foi possível consultar o catálogo."}</EmptyDescription></EmptyHeader></Empty></Card>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow text-hoikos-600">H.OIKOS · Financeiro</p>
          <h1 className="display-heading mt-2 text-4xl text-hoikos-950">Soluções DRAP</h1>
          <p className="mt-2 max-w-3xl text-sm text-hoikos-500">Use os serviços DRAP dentro da H.OIKOS, com o mesmo preço publicado pela DRAP e sem redirecionamento operacional.</p>
        </div>
        <Button variant="outline" onClick={() => { window.location.href = "/"; }}><ArrowLeft />Voltar à H.OIKOS</Button>
      </div>

      <Card>
        <CardContent className="grid gap-4 p-5 md:grid-cols-3">
          <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-hoikos-500">Preço</p><p className="mt-2 font-medium">Mesmo valor da DRAP</p></div>
          <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-hoikos-500">Experiência</p><p className="mt-2 font-medium">Dentro da H.OIKOS</p></div>
          <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-hoikos-500">Tenant DRAP</p><p className="mt-2 font-medium">{data.tenantProvisioned ? "Vinculado" : "Ainda não provisionado"}</p></div>
        </CardContent>
      </Card>

      <div className="rounded-md border border-hoikos-200 bg-hoikos-50 p-4 text-sm text-hoikos-900">
        <p className="font-medium">Contratação dentro da H.OIKOS preparada, mas ainda não liberada para cobrança.</p>
        <p className="mt-1 text-hoikos-600">A API pública da DRAP permite operar lançamentos, parceiros, categorias e webhooks, mas não publica criação de tenant, checkout, assinatura ou ativação de módulo. Mesmo que o adaptador de ativação esteja configurado, a H.OIKOS só habilitará o botão de compra quando existir uma ação de checkout service-to-service homologada e testada de ponta a ponta.</p>
      </div>

      {data.subscription ? (
        <Card><CardHeader><CardTitle className="text-base">Assinatura vinculada</CardTitle></CardHeader><CardContent className="flex flex-wrap items-center gap-3 text-sm"><Badge variant="outline">{data.subscription.status}</Badge><span>{data.subscription.planId}</span>{data.subscription.monthlyCents !== null ? <strong>{currency.format(data.subscription.monthlyCents / 100)}/mês</strong> : null}</CardContent></Card>
      ) : null}

      {groups.map((group) => group.items.length ? (
        <section key={group.title} className="space-y-3">
          <h2 className="text-lg font-semibold text-hoikos-950">{group.title}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {group.items.map((item) => (
              <Card key={item.id} className="flex h-full flex-col">
                <CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><CardTitle className="text-base">{item.name}</CardTitle>{item.trialDays ? <Badge variant="secondary">{item.trialDays} dias</Badge> : null}</div></CardHeader>
                <CardContent className="flex flex-1 flex-col gap-4">
                  <div><p className="text-2xl font-semibold tabular-nums text-hoikos-950">{price(item)}</p>{item.annualCents ? <p className="mt-1 text-xs text-hoikos-500">ou {currency.format(item.annualCents / 100)}/ano</p> : null}</div>
                  <p className="flex-1 text-sm text-hoikos-600">{item.description}</p>
                  {item.kind === "free" ? <Button disabled><Check />Incluído</Button> : <Button disabled>{data.checkoutAvailable ? "Checkout DRAP aguardando homologação final" : "Aguardando checkout DRAP"}</Button>}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null)}

      <p className="pb-4 text-xs text-hoikos-500">Catálogo público DRAP conferido em {new Date(`${data.checkedAt}T12:00:00`).toLocaleDateString("pt-BR")}. O valor final de qualquer cobrança deve ser confirmado no servidor da DRAP; a H.OIKOS não aceita preço informado pelo navegador.</p>
    </main>
  );
}
