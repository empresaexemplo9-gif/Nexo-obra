"use client";

import { FormEvent, useState } from "react";
import { Check, LoaderCircle, Mail, Pencil, Phone, Plus, Store } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { api, CampoArea, CampoTexto, dinheiro, Escolha, mensagem, type Fornecedor } from "@/components/compras/comum";

// Cadastro de fornecedores com o histórico real de cada um: quantas vezes cotou, quantas
// ganhou, se entregou no prazo e quanto se comprou. É o que responde "posso confiar no
// prazo que ele promete?" na hora de escolher.
export function Fornecedores({ fornecedores, canEdit, busca, onAlterado }: {
  fornecedores: Fornecedor[]; canEdit: boolean; busca: string; onAlterado: () => Promise<void>;
}) {
  const [editando, setEditando] = useState<Fornecedor | "novo" | null>(null);
  const [salvando, setSalvando] = useState(false);
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const visiveis = fornecedores.filter((f) => !termo || `${f.name} ${f.categories} ${f.city} ${f.contactName}`.toLocaleLowerCase("pt-BR").includes(termo));

  async function salvar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (salvando) return;
    const d = new FormData(event.currentTarget);
    const numeroOuNulo = (campo: string) => { const v = String(d.get(campo) ?? "").trim(); return v ? Number(v) : null; };
    const corpo = {
      name: String(d.get("nome") ?? ""), document: String(d.get("documento") ?? ""), contactName: String(d.get("contato") ?? ""),
      email: String(d.get("email") ?? ""), phone: String(d.get("telefone") ?? ""), city: String(d.get("cidade") ?? ""), uf: String(d.get("uf") ?? ""),
      categories: String(d.get("categorias") ?? ""), paymentTerms: String(d.get("condicao") ?? ""),
      leadTimeDays: numeroOuNulo("prazo"), negotiationScore: numeroOuNulo("negociacao"), notes: String(d.get("observacoes") ?? ""),
    };
    setSalvando(true);
    try {
      const atual = editando !== "novo" ? editando : null;
      await api(atual ? `/api/compras/fornecedores/${atual.id}` : "/api/compras/fornecedores", { method: atual ? "PATCH" : "POST", body: JSON.stringify(atual ? { ...corpo, active: d.get("ativo") === "on" } : corpo) });
      toast.success(atual ? "Fornecedor atualizado" : "Fornecedor cadastrado");
      setEditando(null); await onAlterado();
    } catch (causa) { toast.error(mensagem(causa, "Não foi possível salvar o fornecedor.")); }
    finally { setSalvando(false); }
  }

  const atual = editando && editando !== "novo" ? editando : null;
  return <div className="space-y-4">
    {canEdit ? <div className="flex justify-end"><Button onClick={() => setEditando("novo")}><Plus />Novo fornecedor</Button></div> : null}
    {!fornecedores.length ? <Card><Empty className="min-h-60 border-0"><EmptyHeader><EmptyMedia variant="icon" className="bg-drap-50 text-drap-700"><Store /></EmptyMedia><EmptyTitle>Nenhum fornecedor cadastrado</EmptyTitle><EmptyDescription>Cadastre quem vende para a obra. As cotações e o histórico de entrega ficam ligados a ele.</EmptyDescription></EmptyHeader>{canEdit ? <EmptyContent><Button onClick={() => setEditando("novo")}><Plus />Cadastrar fornecedor</Button></EmptyContent> : null}</Empty></Card>
      : !visiveis.length ? <Card className="p-6 text-sm text-drap-500">Nenhum fornecedor corresponde à busca.</Card>
      : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{visiveis.map((f) => <Card key={f.id} className={`p-4 ${f.active ? "" : "opacity-60"}`}>
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-semibold text-drap-950">{f.name}</p><p className="truncate text-xs text-drap-500">{[f.city, f.uf].filter(Boolean).join(" · ") || "Sem cidade"}{f.document ? ` · ${f.document.length === 14 ? "CNPJ" : "CPF"} ${f.document}` : ""}</p></div>{canEdit ? <Button size="icon" variant="ghost" aria-label={`Editar ${f.name}`} onClick={() => setEditando(f)}><Pencil /></Button> : null}</div>
        {!f.active ? <Badge variant="outline" className="mt-2">Desativado</Badge> : null}
        {f.categories ? <p className="mt-2 text-sm text-drap-700">{f.categories}</p> : null}
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">{f.phone ? <a className="inline-flex items-center gap-1 text-drap-700 underline-offset-2 hover:underline" href={`tel:${f.phone.replace(/[^\d+]/g, "")}`}><Phone className="size-3.5" />{f.phone}</a> : null}{f.email ? <a className="inline-flex items-center gap-1 text-drap-700 underline-offset-2 hover:underline" href={`mailto:${f.email}`}><Mail className="size-3.5" />{f.contactName || f.email}</a> : null}</div>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-drap-100 pt-3 text-xs">
          <dt className="text-drap-500">Condição usual</dt><dd className="text-right">{f.paymentTerms || "—"}</dd>
          <dt className="text-drap-500">Prazo prometido</dt><dd className="text-right">{f.leadTimeDays === null ? "—" : `${f.leadTimeDays} dias`}</dd>
          <dt className="text-drap-500">Prazo real médio</dt><dd className="text-right">{f.stats.averageLeadDays === null ? "sem entregas" : `${f.stats.averageLeadDays.toLocaleString("pt-BR")} dias`}</dd>
          <dt className="text-drap-500">Negociação</dt><dd className="text-right">{f.negotiationScore === null ? "—" : `${f.negotiationScore}/5`}</dd>
          <dt className="text-drap-500">Cotações · ganhas</dt><dd className="text-right">{f.stats.quotes} · {f.stats.won}</dd>
          <dt className="text-drap-500">Entregas no prazo</dt><dd className="text-right">{f.stats.delivered ? `${f.stats.onTime} de ${f.stats.delivered}` : "—"}</dd>
          <dt className="text-drap-500">Comprado</dt><dd className="text-right tabular-nums">{dinheiro(f.stats.purchasedCents)}</dd>
        </dl>
      </Card>)}</div>}

    <Dialog open={editando !== null} onOpenChange={(aberto) => { if (!aberto && !salvando) setEditando(null); }}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{atual ? `Editar ${atual.name}` : "Novo fornecedor"}</DialogTitle><DialogDescription>Só o nome é obrigatório. Condição, prazo e negociação viram sugestão ao lançar cotações.</DialogDescription></DialogHeader>
        <form key={atual?.id ?? "novo"} onSubmit={(e) => void salvar(e)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <CampoTexto id="fornecedor-nome" name="nome" label="Nome ou razão social" required minLength={2} maxLength={140} defaultValue={atual?.name} />
            <CampoTexto id="fornecedor-documento" name="documento" label="CNPJ ou CPF" inputMode="numeric" maxLength={20} defaultValue={atual?.document} />
            <CampoTexto id="fornecedor-contato" name="contato" label="Pessoa de contato" maxLength={120} defaultValue={atual?.contactName} />
            <CampoTexto id="fornecedor-telefone" name="telefone" label="Telefone ou WhatsApp" type="tel" maxLength={40} defaultValue={atual?.phone} />
            <CampoTexto id="fornecedor-email" name="email" label="E-mail" type="email" maxLength={160} defaultValue={atual?.email} />
            <div className="grid grid-cols-[1fr_5rem] gap-3"><CampoTexto id="fornecedor-cidade" name="cidade" label="Cidade" maxLength={80} defaultValue={atual?.city} /><CampoTexto id="fornecedor-uf" name="uf" label="UF" maxLength={2} defaultValue={atual?.uf} /></div>
            <CampoTexto id="fornecedor-categorias" name="categorias" label="O que fornece" placeholder="Cimento, aço, hidráulica" maxLength={300} defaultValue={atual?.categories} />
            <CampoTexto id="fornecedor-condicao" name="condicao" label="Condição de pagamento usual" placeholder="30/60 dias" maxLength={120} defaultValue={atual?.paymentTerms} />
            <CampoTexto id="fornecedor-prazo" name="prazo" label="Prazo de entrega usual (dias)" type="number" min={0} max={365} defaultValue={atual?.leadTimeDays === null || atual?.leadTimeDays === undefined ? "" : String(atual.leadTimeDays)} />
            <Escolha id="fornecedor-negociacao" name="negociacao" label="Abertura para negociar" defaultValue={atual?.negotiationScore ? String(atual.negotiationScore) : ""} options={[{ value: "", label: "Ainda não sei" }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} · ${["rígido", "pouca", "média", "boa", "muito flexível"][n - 1]}` }))]} />
          </div>
          <CampoArea id="fornecedor-observacoes" name="observacoes" label="Observações" maxLength={2000} defaultValue={atual?.notes} />
          {atual ? <div className="flex items-center gap-2 text-sm"><Checkbox id="fornecedor-ativo" name="ativo" defaultChecked={atual.active} /><label htmlFor="fornecedor-ativo">Fornecedor ativo (desativado não recebe cotação nova)</label></div> : null}
          <Button type="submit" className="w-full" disabled={salvando}>{salvando ? <LoaderCircle className="animate-spin" /> : <Check />}Salvar fornecedor</Button>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}
