"use client";

import { FormEvent, useState } from "react";
import { BadgeCheck, Check, FileSpreadsheet, LoaderCircle, Mail, Pencil, Phone, Plus, Search, Store, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { api, CampoArea, CampoTexto, classeCabecalhoFixo, Coluna, dataCurta, dinheiro, Escolha, Filtros, mensagem, useOrdenacao, type Fornecedor } from "@/components/compras/comum";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";

type DadosReceita = { cnpj: string; razaoSocial: string; nomeFantasia: string; situacao: string; atividade: string; municipio: string; uf: string; telefone: string; email: string };

// Cadastro de fornecedores com o histórico real de cada um: quantas vezes cotou, quantas
// ganhou, se entregou no prazo e quanto se comprou. É o que responde "posso confiar no
// prazo que ele promete?" na hora de escolher.
export function Fornecedores({ fornecedores, canEdit, busca, onAlterado }: {
  fornecedores: Fornecedor[]; canEdit: boolean; busca: string; onAlterado: () => Promise<void>;
}) {
  const [editando, setEditando] = useState<Fornecedor | "novo" | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [receita, setReceita] = useState<DadosReceita | null>(null);
  const [consultando, setConsultando] = useState<string | null>(null);
  const [lista, setLista] = useState<Fornecedor | null>(null);
  const [hoje] = useState(() => new Date().toISOString().slice(0, 10));
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const [visao, setVisao] = useState<"tabela" | "cartoes">("tabela");
  const [mostrar, setMostrar] = useState<"ativos" | "todos" | "desativados">("ativos");
  const buscados = fornecedores.filter((f) => !termo || `${f.name} ${f.categories} ${f.city} ${f.contactName}`.toLocaleLowerCase("pt-BR").includes(termo));
  const visiveis = buscados.filter((f) => mostrar === "todos" || (mostrar === "ativos" ? f.active : !f.active));

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

  // Preenche o formulário com o que a Receita respondeu. Nada é gravado aqui: a pessoa
  // confere e salva, e o selo de verificado só vem da conferência feita pelo servidor.
  async function buscarNaReceita(documento: string) {
    const cnpj = documento.replace(/\D/g, "");
    if (cnpj.length !== 14) { toast.error("Digite os 14 dígitos do CNPJ."); return; }
    setConsultando("formulario");
    try { const r = await api<{ registry: DadosReceita }>(`/api/compras/fornecedores/cnpj?cnpj=${cnpj}`); setReceita(r.registry); toast.success("Dados da Receita preenchidos; confira e salve."); }
    catch (causa) { toast.error(mensagem(causa, "Não foi possível consultar a Receita.")); }
    finally { setConsultando(null); }
  }

  async function conferir(f: Fornecedor) {
    setConsultando(f.id);
    try { await api(`/api/compras/fornecedores/${f.id}/receita`, { method: "POST" }); toast.success("CNPJ conferido na Receita"); await onAlterado(); }
    catch (causa) { toast.error(mensagem(causa, "Não foi possível conferir na Receita.")); }
    finally { setConsultando(null); }
  }

  async function importarLista(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lista || salvando) return;
    setSalvando(true);
    try {
      const r = await api<{ report: { itens: number; ignoradas: number; aba: string; linhaDoCabecalho: number } }>(`/api/compras/fornecedores/${lista.id}/lista`, { method: "PUT", body: new FormData(event.currentTarget) });
      toast.success(`${r.report.itens.toLocaleString("pt-BR")} itens importados`, { description: `Aba “${r.report.aba}”, cabeçalho na linha ${r.report.linhaDoCabecalho}, ${r.report.ignoradas} linhas sem preço ou título ignoradas.` });
      setLista(null); await onAlterado();
    } catch (causa) { toast.error(mensagem(causa, "Não foi possível importar a lista.")); }
    finally { setSalvando(false); }
  }

  async function removerLista(f: Fornecedor) {
    setSalvando(true);
    try { await api(`/api/compras/fornecedores/${f.id}/lista`, { method: "DELETE" }); toast.success("Lista de preços removida"); setLista(null); await onAlterado(); }
    catch (causa) { toast.error(mensagem(causa, "Não foi possível remover a lista.")); }
    finally { setSalvando(false); }
  }

  const atual = editando && editando !== "novo" ? editando : null;
  // O que a Receita respondeu entra como valor inicial; o resto vem do cadastro aberto.
  const inicial = {
    name: receita ? (receita.nomeFantasia || receita.razaoSocial) : atual?.name, document: receita?.cnpj ?? atual?.document,
    phone: receita?.telefone || atual?.phone, email: receita?.email || atual?.email, city: receita?.municipio || atual?.city, uf: receita?.uf || atual?.uf,
    categories: atual?.categories || receita?.atividade || "",
  };
  return <div className="space-y-4">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      {fornecedores.length ? <div className="flex flex-wrap items-center gap-3">
        <Filtros rotulo="Exibição" valor={visao} onChange={setVisao} opcoes={[{ value: "tabela", label: "Comparar em tabela" }, { value: "cartoes", label: "Cartões com contato" }]} />
        {fornecedores.some((f) => !f.active) ? <Filtros rotulo="Situação do fornecedor" valor={mostrar} onChange={setMostrar} opcoes={[{ value: "ativos", label: "Ativos", total: buscados.filter((f) => f.active).length }, { value: "desativados", label: "Desativados", total: buscados.filter((f) => !f.active).length }, { value: "todos", label: "Todos", total: buscados.length }]} /> : null}
      </div> : <span />}
      {canEdit ? <Button onClick={() => setEditando("novo")}><Plus />Novo fornecedor</Button> : null}
    </div>
    {!fornecedores.length ? <Card><Empty className="min-h-60 border-0"><EmptyHeader><EmptyMedia variant="icon" className="bg-drap-50 text-drap-700"><Store /></EmptyMedia><EmptyTitle>Nenhum fornecedor cadastrado</EmptyTitle><EmptyDescription>Cadastre quem vende para a obra. As cotações e o histórico de entrega ficam ligados a ele.</EmptyDescription></EmptyHeader>{canEdit ? <EmptyContent><Button onClick={() => setEditando("novo")}><Plus />Cadastrar fornecedor</Button></EmptyContent> : null}</Empty></Card>
      : !visiveis.length ? <Card className="p-6 text-sm text-drap-500">Nenhum fornecedor neste filtro ou busca.</Card>
      : visao === "tabela" ? <TabelaFornecedores fornecedores={visiveis} canEdit={canEdit} onEditar={setEditando} onLista={setLista} />
      : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{visiveis.map((f) => <Card key={f.id} className={`p-4 ${f.active ? "" : "opacity-60"}`}>
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-semibold text-drap-950">{f.name}</p><p className="truncate text-xs text-drap-500">{[f.city, f.uf].filter(Boolean).join(" · ") || "Sem cidade"}{f.document ? ` · ${f.document.length === 14 ? "CNPJ" : "CPF"} ${f.document}` : ""}</p></div>{canEdit ? <Button size="icon" variant="ghost" aria-label={`Editar ${f.name}`} onClick={() => setEditando(f)}><Pencil /></Button> : null}</div>
        {!f.active ? <Badge variant="outline" className="mt-2">Desativado</Badge> : null}
        {f.registry ? <p className={`mt-2 flex items-start gap-1.5 text-xs ${f.registry.status === "ATIVA" ? "text-drap-700" : "text-destructive"}`}>{f.registry.status === "ATIVA" ? <BadgeCheck className="mt-px size-3.5 shrink-0" /> : <TriangleAlert className="mt-px size-3.5 shrink-0" />}<span>Receita: {f.registry.status === "ATIVA" ? "CNPJ ativo" : `situação ${f.registry.status.toLowerCase()}`} · {f.registry.name} · conferido em {dataCurta(f.registry.checkedAt)}</span></p>
          : f.document.length === 14 && canEdit ? <Button size="sm" variant="ghost" className="mt-1 -ml-2" disabled={consultando === f.id} onClick={() => void conferir(f)}>{consultando === f.id ? <LoaderCircle className="animate-spin" /> : <Search />}Conferir CNPJ na Receita</Button> : null}
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
          <dt className="text-drap-500">Lista de preços</dt><dd className="text-right">{f.priceList ? `${f.priceList.items.toLocaleString("pt-BR")} itens · ${dataCurta(f.priceList.validOn)}` : "—"}</dd>
        </dl>
        {canEdit && f.active ? <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => setLista(f)}><FileSpreadsheet />{f.priceList ? "Atualizar lista de preços" : "Importar lista de preços"}</Button> : null}
      </Card>)}</div>}

    <Dialog open={editando !== null} onOpenChange={(aberto) => { if (!aberto && !salvando) { setEditando(null); setReceita(null); } }}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{atual ? `Editar ${atual.name}` : "Novo fornecedor"}</DialogTitle><DialogDescription>Só o nome é obrigatório. Condição, prazo e negociação viram sugestão ao lançar cotações.</DialogDescription></DialogHeader>
        <form key={`${atual?.id ?? "novo"}-${receita?.cnpj ?? ""}`} onSubmit={(e) => void salvar(e)} className="space-y-4">
          {receita ? <p className={`rounded-md border p-3 text-sm ${receita.situacao === "ATIVA" ? "border-drap-200 bg-drap-50 text-drap-800" : "border-destructive/40 text-destructive"}`}>Receita Federal: <strong>{receita.razaoSocial}</strong> · situação {receita.situacao.toLowerCase() || "sem informação"}{receita.atividade ? ` · ${receita.atividade}` : ""}. Depois de salvar, use “Conferir CNPJ na Receita” para registrar a verificação.</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <CampoTexto id="fornecedor-nome" name="nome" label="Nome ou razão social" required minLength={2} maxLength={140} defaultValue={inicial.name} />
            <div className="min-w-0"><label htmlFor="fornecedor-documento" className="mb-1.5 block text-sm font-medium text-drap-700">CNPJ ou CPF</label><div className="flex gap-2"><Input id="fornecedor-documento" name="documento" inputMode="numeric" maxLength={20} defaultValue={inicial.document} /><Button type="button" variant="outline" disabled={consultando === "formulario"} onClick={(e) => void buscarNaReceita(String((e.currentTarget.form?.elements.namedItem("documento") as HTMLInputElement | null)?.value ?? ""))}>{consultando === "formulario" ? <LoaderCircle className="animate-spin" /> : <Search />}Receita</Button></div><p className="mt-1 text-xs text-drap-500">Com CNPJ, a Receita preenche nome, cidade, telefone e atividade.</p></div>
            <CampoTexto id="fornecedor-contato" name="contato" label="Pessoa de contato" maxLength={120} defaultValue={atual?.contactName} />
            <CampoTexto id="fornecedor-telefone" name="telefone" label="Telefone ou WhatsApp" type="tel" maxLength={40} defaultValue={inicial.phone} />
            <CampoTexto id="fornecedor-email" name="email" label="E-mail" type="email" maxLength={160} defaultValue={inicial.email} />
            <div className="grid grid-cols-[1fr_5rem] gap-3"><CampoTexto id="fornecedor-cidade" name="cidade" label="Cidade" maxLength={80} defaultValue={inicial.city} /><CampoTexto id="fornecedor-uf" name="uf" label="UF" maxLength={2} defaultValue={inicial.uf} /></div>
            <CampoTexto id="fornecedor-categorias" name="categorias" label="O que fornece" placeholder="Cimento, aço, hidráulica" maxLength={300} defaultValue={inicial.categories} />
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

    <Dialog open={lista !== null} onOpenChange={(aberto) => { if (!aberto && !salvando) setLista(null); }}>
      <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Lista de preços · {lista?.name}</DialogTitle><DialogDescription>A planilha que a loja enviou, em XLSX ou CSV, com colunas de descrição (ou produto), unidade e preço; código é opcional. A nova lista substitui a anterior.</DialogDescription></DialogHeader>
        <form onSubmit={(e) => void importarLista(e)} className="space-y-4">
          <CampoTexto id="lista-arquivo" name="arquivo" label="Planilha" type="file" required accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" />
          <CampoTexto id="lista-data" name="validOn" label="Data da lista" type="date" required max={hoje} defaultValue={hoje} ajuda="A data que a loja deu aos preços. Aparece junto de cada preço sugerido." />
          {lista?.priceList ? <p className="text-xs text-drap-600">Lista atual: {lista.priceList.items.toLocaleString("pt-BR")} itens de {dataCurta(lista.priceList.validOn)} ({lista.priceList.fileName}).</p> : null}
          <div className="flex flex-wrap gap-2"><Button type="submit" disabled={salvando}>{salvando ? <LoaderCircle className="animate-spin" /> : <FileSpreadsheet />}Importar lista</Button>{lista?.priceList ? <Button type="button" variant="outline" disabled={salvando} onClick={() => void removerLista(lista)}>Remover lista atual</Button> : null}</div>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}

const pontualidade = (f: Fornecedor) => f.stats.delivered ? f.stats.onTime / f.stats.delivered : null;
const aproveitamento = (f: Fornecedor) => f.stats.quotes ? f.stats.won / f.stats.quotes : null;
const porcento = (v: number | null) => v === null ? "—" : `${Math.round(v * 100)}%`;

// A tabela responde "em quem confiar": prazo prometido contra o real, entregas no prazo,
// quantas cotações viraram compra e quanto já se comprou — lado a lado e ordenável.
function TabelaFornecedores({ fornecedores, canEdit, onEditar, onLista }: { fornecedores: Fornecedor[]; canEdit: boolean; onEditar: (f: Fornecedor) => void; onLista: (f: Fornecedor) => void }) {
  const { ordenadas, ordem, alternar } = useOrdenacao(fornecedores, {
    nome: (f) => f.name, local: (f) => [f.city, f.uf].filter(Boolean).join("/"), prometido: (f) => f.leadTimeDays, real: (f) => f.stats.averageLeadDays,
    prazo: pontualidade, ganhas: aproveitamento, negociacao: (f) => f.negotiationScore, comprado: (f) => f.stats.purchasedCents, lista: (f) => f.priceList?.validOn ?? null,
  }, { coluna: "comprado", direcao: "desc" });
  return <Card className="p-0"><div className={classeCabecalhoFixo}><Table>
    <TableHeader><TableRow>
      <Coluna coluna="nome" ordem={ordem} alternar={alternar} className="min-w-56">Fornecedor</Coluna>
      <Coluna coluna="local" ordem={ordem} alternar={alternar} className="hidden lg:table-cell">Cidade</Coluna>
      <Coluna coluna="prometido" ordem={ordem} alternar={alternar} direita className="hidden md:table-cell">Prazo prometido</Coluna>
      <Coluna coluna="real" ordem={ordem} alternar={alternar} direita className="hidden md:table-cell">Prazo real</Coluna>
      <Coluna coluna="prazo" ordem={ordem} alternar={alternar} direita>No prazo</Coluna>
      <Coluna coluna="ganhas" ordem={ordem} alternar={alternar} direita className="hidden sm:table-cell">Cotações ganhas</Coluna>
      <Coluna coluna="negociacao" ordem={ordem} alternar={alternar} direita className="hidden xl:table-cell">Negociação</Coluna>
      <Coluna coluna="comprado" ordem={ordem} alternar={alternar} direita>Comprado</Coluna>
      <Coluna coluna="lista" ordem={ordem} alternar={alternar} className="hidden xl:table-cell">Lista de preços</Coluna>
      {canEdit ? <TableHead className="w-10"><span className="sr-only">Ações</span></TableHead> : null}
    </TableRow></TableHeader>
    <TableBody>{ordenadas.map((f) => { const atraso = f.leadTimeDays !== null && f.stats.averageLeadDays !== null && f.stats.averageLeadDays > f.leadTimeDays;
      return <TableRow key={f.id} className={f.active ? undefined : "opacity-60"}>
        <TableCell className="whitespace-normal"><span className="flex items-center gap-1.5 font-medium text-drap-900">{f.name}{f.registry ? f.registry.status === "ATIVA" ? <BadgeCheck aria-label="CNPJ ativo na Receita" className="size-3.5 shrink-0 text-drap-700" /> : <TriangleAlert aria-label={`Receita: situação ${f.registry.status.toLowerCase()}`} className="size-3.5 shrink-0 text-destructive" /> : null}{!f.active ? <Badge variant="outline">Desativado</Badge> : null}</span>
          <span className="block text-xs text-drap-500">{f.categories || "—"}</span>
          <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs">{f.phone ? <a className="inline-flex items-center gap-1 text-drap-700 underline-offset-2 hover:underline" href={`tel:${f.phone.replace(/[^\d+]/g, "")}`}><Phone className="size-3" />{f.phone}</a> : null}{f.email ? <a className="inline-flex items-center gap-1 text-drap-700 underline-offset-2 hover:underline" href={`mailto:${f.email}`}><Mail className="size-3" />{f.contactName || "e-mail"}</a> : null}</span></TableCell>
        <TableCell className="hidden whitespace-normal text-sm lg:table-cell">{[f.city, f.uf].filter(Boolean).join("/") || "—"}</TableCell>
        <TableCell className="hidden text-right tabular-nums md:table-cell">{f.leadTimeDays === null ? "—" : `${f.leadTimeDays} d`}</TableCell>
        <TableCell className={`hidden text-right tabular-nums md:table-cell ${atraso ? "text-destructive" : ""}`}>{f.stats.averageLeadDays === null ? <span className="text-xs text-drap-500">sem entregas</span> : `${f.stats.averageLeadDays.toLocaleString("pt-BR")} d`}</TableCell>
        <TableCell className="text-right tabular-nums">{porcento(pontualidade(f))}{f.stats.delivered ? <span className="block text-xs text-drap-500">{f.stats.onTime} de {f.stats.delivered}</span> : null}</TableCell>
        <TableCell className="hidden text-right tabular-nums sm:table-cell">{porcento(aproveitamento(f))}<span className="block text-xs text-drap-500">{f.stats.won} de {f.stats.quotes}</span></TableCell>
        <TableCell className="hidden text-right tabular-nums xl:table-cell">{f.negotiationScore === null ? "—" : `${f.negotiationScore}/5`}</TableCell>
        <TableCell className="text-right tabular-nums">{dinheiro(f.stats.purchasedCents)}</TableCell>
        <TableCell className="hidden text-xs xl:table-cell">{f.priceList ? <>{f.priceList.items.toLocaleString("pt-BR")} itens<span className="block text-drap-500">{dataCurta(f.priceList.validOn)}</span></> : "—"}</TableCell>
        {canEdit ? <TableCell><div className="flex justify-end gap-1">
          {f.active ? <Button size="icon" variant="ghost" aria-label={`${f.priceList ? "Atualizar" : "Importar"} lista de preços de ${f.name}`} onClick={() => onLista(f)}><FileSpreadsheet /></Button> : null}
          <Button size="icon" variant="ghost" aria-label={`Editar ${f.name}`} onClick={() => onEditar(f)}><Pencil /></Button>
        </div></TableCell> : null}
      </TableRow>; })}</TableBody>
  </Table></div></Card>;
}
