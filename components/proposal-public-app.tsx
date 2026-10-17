"use client";

import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, Printer } from "lucide-react";

import { ProposalDocument, type ProposalDocumentData } from "@/components/proposal-document";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { formatDateTime, formatMoney } from "@/lib/proposals";

// Página que o cliente abre pelo link. Lê a proposta inteira e, se estiver de acordo,
// registra o aceite ali mesmo. Sem conta e sem cadastro: o link assinado basta.

export function ProposalPublicApp({ token, data, version, totalCents, accepted, updatedAfterSend, expired }: {
  token: string;
  data: ProposalDocumentData & { issuedAt: number };
  version: number;
  totalCents: number;
  accepted: { at: number; name: string } | null;
  updatedAfterSend: boolean;
  /** Calculado no servidor, no momento em que a página foi aberta. */
  expired: boolean;
}) {
  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
  const [agree, setAgree] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(accepted);

  // A abertura é registrada daqui, no navegador, e não no carregamento da página no
  // servidor: prévias de link do WhatsApp e do e-mail não executam este código.
  useEffect(() => {
    void fetch(`/api/proposta/${encodeURIComponent(token)}/view`, { method: "POST" }).catch(() => undefined);
  }, [token]);

  async function accept(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/proposta/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, document: document || null, agree, version }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; acceptedAt?: number; acceptedName?: string; details?: Record<string, string[]> };
      if (!response.ok) {
        const first = body.details ? Object.values(body.details).flat()[0] : undefined;
        throw new Error(first ?? body.error ?? "Não foi possível registrar o aceite. Tente de novo.");
      }
      setDone({ at: body.acceptedAt ?? Date.now(), name: body.acceptedName ?? name });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível registrar o aceite. Tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="proposal-page min-h-svh bg-drap-stone px-3 py-6 sm:px-6 sm:py-10">
      <div className="proposal-actions mx-auto mb-4 flex max-w-[52rem] items-center justify-between gap-3">
        <p className="text-sm text-drap-800">Proposta de <span className="font-medium text-drap-950">{data.organizationName}</span></p>
        <Button variant="outline" size="sm" onClick={() => window.print()}><Printer />Imprimir ou salvar PDF</Button>
      </div>
      {updatedAfterSend && !done ? <p role="status" className="proposal-actions mx-auto mb-4 max-w-[52rem] rounded-md border border-drap-warning bg-drap-warning px-4 py-2 text-sm text-drap-950">Esta proposta foi atualizada depois do envio. Você está vendo a versão mais recente.</p> : null}
      <div className="proposal-paper mx-auto max-w-[52rem] rounded-sm bg-white px-5 py-8 shadow-sm sm:px-12 sm:py-12">
        <ProposalDocument data={data} />
      </div>

      <section aria-labelledby="aceite-titulo" className="proposal-accept mx-auto mt-6 max-w-[52rem] rounded-sm bg-white px-5 py-7 shadow-sm sm:px-12">
        <h2 id="aceite-titulo" className="proposal-heading">Aceite</h2>
        {done ? (
          <div role="status" className="mt-4 flex items-start gap-3 rounded-md border border-drap-success bg-drap-success px-4 py-3 text-white">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
            <p>Proposta aceita por <strong>{done.name}</strong> em {formatDateTime(done.at, data.timezone)}. A equipe de {data.organizationName} já foi avisada.</p>
          </div>
        ) : expired ? (
          <p className="mt-4 rounded-md border border-drap-danger bg-drap-danger px-4 py-3 text-white">O prazo de validade desta proposta terminou. Peça uma proposta atualizada à equipe de {data.organizationName}.</p>
        ) : (
          <form onSubmit={accept} className="mt-4 grid gap-4">
            <p className="text-sm leading-6 text-drap-800">Ao aceitar, você declara estar de acordo com o escopo, os valores ({formatMoney(totalCents)}) e as condições desta proposta. Ficam registrados seu nome, a data e a hora.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label htmlFor="aceite-nome" className="mb-1.5 block text-sm font-medium">Nome completo</label><Input id="aceite-nome" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required minLength={3} maxLength={160} /></div>
              <div><label htmlFor="aceite-documento" className="mb-1.5 block text-sm font-medium">CPF ou CNPJ <span className="font-normal text-drap-800">(opcional)</span></label><Input id="aceite-documento" value={document} onChange={(event) => setDocument(event.target.value)} inputMode="numeric" maxLength={30} /></div>
            </div>
            <label className="flex items-start gap-3 text-sm leading-6"><Checkbox checked={agree} onCheckedChange={(value) => setAgree(value === true)} className="mt-1" /><span>Li a proposta e estou de acordo.</span></label>
            {error ? <p role="alert" className="rounded-md border border-drap-danger bg-drap-danger px-3 py-2 text-sm text-white">{error}</p> : null}
            <div><Button type="submit" disabled={saving || !agree || name.trim().length < 3} className="h-11 px-6">{saving ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}Aceitar proposta</Button></div>
          </form>
        )}
      </section>
      <p className="proposal-actions mx-auto mt-6 max-w-[52rem] text-center text-xs text-drap-800">Enviada pelo DRAP Backoffice</p>
    </main>
  );
}
