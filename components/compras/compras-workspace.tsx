"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CircleAlert, LoaderCircle, Plus, ShoppingCart, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PRIORIDADES, emAndamento, rotuloPrioridade, rotuloStatus, somarDias, type StatusCompra } from "@/lib/compras";
import {
  api, CampoArea, CampoTexto, dataCurta, dinheiro, Escolha, lerQuantidade, mensagem, SeloEntrega,
  type Fornecedor, type PedidoResumo, type Produto, type Projeto,
} from "@/components/compras/comum";
import { PedidoDetalhe } from "@/components/compras/pedido-detalhe";
import { Fornecedores } from "@/components/compras/fornecedores";
import { Produtos } from "@/components/compras/produtos";
import { Estoque, type DadosEstoque } from "@/components/compras/estoque";

type Orcamento = { id: string; projectId: string | null; projectName: string | null; code: string; version: number; status: string; itemCount: number };
const COLUNAS: StatusCompra[] = ["a_orcar", "a_comprar", "comprado", "em_entrega", "entregue"];

export function ComprasWorkspace({ projects, query, canEdit }: { projects: Projeto[]; query: string; canEdit: boolean }) {
  const [aba, setAba] = useState("pedidos");
  const [pedidos, setPedidos] = useState<PedidoResumo[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [hoje, setHoje] = useState("");
  const [podeOrcamento, setPodeOrcamento] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [obra, setObra] = useState("");
  const [mostrarCancelados, setMostrarCancelados] = useState(false);
  const [estoque, setEstoque] = useState<DadosEstoque | null>(null);
  const [inicial, setInicial] = useState<{ productId: string; quantity: number; location: string } | null>(null);

  const carregarPedidos = useCallback(async () => {
    const r = await api<{ requests: PedidoResumo[]; today: string; canImportBudget: boolean }>("/api/compras");
    setPedidos(r.requests); setHoje(r.today); setPodeOrcamento(r.canImportBudget);
  }, []);
  const carregarCadastros = useCallback(async () => {
    const [f, p] = await Promise.all([
      api<{ suppliers: Fornecedor[] }>("/api/compras/fornecedores?inativos=1"),
      api<{ products: Produto[] }>("/api/compras/produtos"),
    ]);
    setFornecedores(f.suppliers); setProdutos(p.products);
  }, []);
  const carregarEstoque = useCallback(async () => { setEstoque(await api<DadosEstoque>("/api/compras/estoque")); }, []);
  const carregar = useCallback(async () => {
    setCarregando(true); setErro("");
    try { await Promise.all([carregarPedidos(), carregarCadastros(), carregarEstoque()]); }
    catch (causa) { setErro(mensagem(causa, "Não foi possível carregar Compras.")); }
    finally { setCarregando(false); }
  }, [carregarPedidos, carregarCadastros, carregarEstoque]);
  useEffect(() => { const t = window.setTimeout(() => { void carregar(); }, 0); return () => window.clearTimeout(t); }, [carregar]);

  const termo = query.trim().toLocaleLowerCase("pt-BR");
  const filtrados = useMemo(() => pedidos.filter((p) => (!obra || p.projectId === obra) && (!termo || `${p.code} ${p.title} ${p.projectName ?? ""} ${p.supplierName ?? ""}`.toLocaleLowerCase("pt-BR").includes(termo))), [pedidos, obra, termo]);
  const semana = hoje ? somarDias(hoje, 7) : "";
  const urgentes = filtrados.filter((p) => (p.status === "a_orcar" || p.status === "a_comprar") && p.neededBy && p.neededBy <= semana);
  const atrasadas = filtrados.filter((p) => p.delivery === "atrasada");
  const andamento = filtrados.filter((p) => emAndamento(p.status));
  const comprometido = andamento.reduce((soma, p) => soma + (p.totalCents ?? 0), 0);

  if (aberto) {
    return <PedidoDetalhe key={aberto} id={aberto} projetos={projects} fornecedores={fornecedores} produtos={produtos} canEdit={canEdit}
      onVoltar={() => { setAberto(null); void carregarPedidos().catch(() => undefined); void carregarEstoque().catch(() => undefined); }}
      onAlterado={() => { void carregarPedidos().catch(() => undefined); void carregarCadastros().catch(() => undefined); }} />;
  }

  return <div className="space-y-5">
    <div className="drap-module-heading flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="eyebrow text-drap-600">Suprimentos</p><h1 className="display-heading mt-2 text-4xl text-drap-950">Compras</h1><p className="mt-2 text-sm text-drap-500">Do que precisa ser orçado até o material na obra: cotações, escolha, pedido e entrega.</p></div>
      {canEdit ? <Button onClick={() => setNovo(true)}><Plus />Novo pedido de compra</Button> : null}
    </div>

    {carregando ? <Card className="p-8 text-center text-sm text-drap-500"><LoaderCircle className="mx-auto mb-3 animate-spin" />Carregando compras…</Card>
      : erro ? <Card className="p-6"><p role="alert" className="flex items-center gap-2 text-sm text-drap-700"><CircleAlert className="size-4" />{erro}</p><Button variant="outline" className="mt-4" onClick={() => void carregar()}>Tentar novamente</Button></Card>
      : <Tabs value={aba} onValueChange={setAba} className="gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsList className="h-auto flex-wrap rounded-md">
            <TabsTrigger value="pedidos">Pedidos <Badge variant="secondary">{pedidos.filter((p) => p.status !== "entregue" && p.status !== "cancelado").length}</Badge></TabsTrigger>
            <TabsTrigger value="entregas"><Truck />Entregas{atrasadas.length ? <Badge variant="destructive">{atrasadas.length}</Badge> : null}</TabsTrigger>
            <TabsTrigger value="estoque">Estoque{estoque?.attention.length ? <Badge variant="destructive" aria-label={`${estoque.attention.length} itens de atenção`}>{estoque.attention.length}</Badge> : null}</TabsTrigger>
            <TabsTrigger value="fornecedores">Fornecedores <Badge variant="secondary">{fornecedores.filter((f) => f.active).length}</Badge></TabsTrigger>
            <TabsTrigger value="produtos">Parâmetros <Badge variant="secondary">{produtos.length}</Badge></TabsTrigger>
          </TabsList>
          {aba === "pedidos" || aba === "entregas" ? <div className="w-full lg:w-72"><Escolha id="compras-obra" label="Obra" value={obra} onChange={setObra} options={[{ value: "", label: "Todas as obras" }, ...projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))]} /></div> : null}
        </div>

        <TabsContent value="pedidos" className="space-y-4">
          {!pedidos.length ? <Card><Empty className="min-h-72 border-0"><EmptyHeader><EmptyMedia variant="icon" className="bg-drap-50 text-drap-700"><ShoppingCart /></EmptyMedia><EmptyTitle>Nenhum pedido de compra</EmptyTitle><EmptyDescription>Abra um pedido com o que a obra precisa, lance as cotações dos fornecedores e acompanhe até a entrega.</EmptyDescription></EmptyHeader>{canEdit ? <EmptyContent><Button onClick={() => setNovo(true)}><Plus />Novo pedido de compra</Button></EmptyContent> : null}</Empty></Card> : <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Indicador titulo="Comprar em até 7 dias" valor={String(urgentes.length)} detalhe={urgentes.length ? "pedidos ainda sem compra com a obra precisando logo" : "nenhuma necessidade apertada"} alerta={urgentes.length > 0} />
              <Indicador titulo="Entregas atrasadas" valor={String(atrasadas.length)} detalhe={atrasadas.length ? "cobre o fornecedor ou ajuste a previsão" : "nenhuma passou da previsão"} alerta={atrasadas.length > 0} />
              <Indicador titulo="Comprado a receber" valor={dinheiro(comprometido)} detalhe={`${andamento.length} ${andamento.length === 1 ? "pedido" : "pedidos"} em andamento`} />
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">{COLUNAS.map((status) => {
              const doStatus = filtrados.filter((p) => p.status === status);
              const lista = status === "entregue" ? doStatus.slice(0, 8) : doStatus;
              return <section key={status} className="min-w-0" aria-label={rotuloStatus[status]}>
                <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold text-drap-800">{rotuloStatus[status]}</h2><span className="text-xs text-drap-500">{doStatus.length}</span></div>
                <div className="space-y-2">{lista.length ? lista.map((p) => <CartaoPedido key={p.id} pedido={p} hoje={hoje} onAbrir={() => setAberto(p.id)} />) : <p className="rounded-md border border-dashed border-drap-200 p-3 text-xs text-drap-500">Nada aqui.</p>}
                  {status === "entregue" && doStatus.length > lista.length ? <p className="text-xs text-drap-500">Mais {doStatus.length - lista.length} entregues; use a busca para achar.</p> : null}</div>
              </section>;
            })}</div>
            {filtrados.some((p) => p.status === "cancelado") ? <div><Button variant="ghost" size="sm" onClick={() => setMostrarCancelados((v) => !v)}>{mostrarCancelados ? "Ocultar cancelados" : `Ver cancelados (${filtrados.filter((p) => p.status === "cancelado").length})`}</Button>
              {mostrarCancelados ? <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">{filtrados.filter((p) => p.status === "cancelado").map((p) => <CartaoPedido key={p.id} pedido={p} hoje={hoje} onAbrir={() => setAberto(p.id)} />)}</div> : null}</div> : null}
          </>}
        </TabsContent>

        <TabsContent value="entregas"><Entregas pedidos={filtrados} hoje={hoje} onAbrir={setAberto} /></TabsContent>
        <TabsContent value="estoque">{estoque ? <Estoque dados={estoque} produtos={produtos} projetos={projects} canEdit={canEdit} busca={query} onAbrirPedido={setAberto}
          onAlterado={async () => { await carregarEstoque().catch((c) => toast.error(mensagem(c, "Não foi possível atualizar o estoque."))); }}
          onComprar={(dados) => { setInicial(dados); setNovo(true); }} /> : null}</TabsContent>
        <TabsContent value="fornecedores"><Fornecedores fornecedores={fornecedores} canEdit={canEdit} busca={query} onAlterado={async () => { await carregarCadastros().catch((c) => toast.error(mensagem(c, "Não foi possível atualizar a lista."))); }} /></TabsContent>
        <TabsContent value="produtos"><Produtos produtos={produtos} canEdit={canEdit} canBiblioteca={podeOrcamento} busca={query} onAlterado={async () => { await carregarCadastros().catch((c) => toast.error(mensagem(c, "Não foi possível atualizar a lista."))); }} /></TabsContent>
      </Tabs>}

    <NovoPedido key={inicial ? `${inicial.productId}-${inicial.location}` : "novo"} aberto={novo} onFechar={() => { setNovo(false); setInicial(null); }} projetos={projects} produtos={produtos} podeOrcamento={podeOrcamento}
      obraInicial={inicial ? (inicial.location === "central" ? "" : inicial.location) : obra} inicial={inicial}
      onCriado={async (id) => { setNovo(false); setInicial(null); await carregarPedidos().catch(() => undefined); void carregarEstoque().catch(() => undefined); setAberto(id); }} />
  </div>;
}

function Indicador({ titulo, valor, detalhe, alerta }: { titulo: string; valor: string; detalhe: string; alerta?: boolean }) {
  return <div className="drap-metric" data-attention={alerta || undefined}><div className="drap-metric-label"><span>{titulo}</span></div><p className="metric-number drap-metric-value">{valor}</p><p className="drap-metric-detail">{alerta ? <CircleAlert aria-hidden="true" className="size-3.5" /> : null}{detalhe}</p></div>;
}

function CartaoPedido({ pedido, hoje, onAbrir }: { pedido: PedidoResumo; hoje: string; onAbrir: () => void }) {
  const aperto = (pedido.status === "a_orcar" || pedido.status === "a_comprar") && pedido.neededBy && hoje && pedido.neededBy < hoje;
  const valor = pedido.totalCents ?? pedido.bestQuoteCents;
  return <button type="button" onClick={onAbrir} className="block w-full rounded-lg border border-drap-200 bg-white p-3 text-left shadow-none transition hover:border-drap-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-drap-400">
    <p className="text-xs text-drap-500">{pedido.code}{pedido.projectCode ? ` · ${pedido.projectCode}` : ""}</p>
    <p className="mt-0.5 line-clamp-2 text-sm font-medium text-drap-950">{pedido.title}</p>
    <div className="mt-2 flex flex-wrap gap-1">
      {pedido.priority === "urgente" || pedido.priority === "alta" ? <Badge variant="outline">{rotuloPrioridade[pedido.priority as keyof typeof rotuloPrioridade]}</Badge> : null}
      {aperto ? <Badge variant="destructive">Necessidade vencida</Badge> : null}
      <SeloEntrega situacao={pedido.delivery === "entregue" ? null : pedido.delivery} />
    </div>
    <dl className="mt-2 space-y-0.5 text-xs text-drap-600">
      {pedido.status === "a_orcar" ? <div className="flex justify-between gap-2"><dt>Cotações</dt><dd>{pedido.quoteCount} · {pedido.itemCount} {pedido.itemCount === 1 ? "item" : "itens"}</dd></div> : null}
      {pedido.supplierName ? <div className="flex justify-between gap-2"><dt>Fornecedor</dt><dd className="truncate">{pedido.supplierName}</dd></div> : null}
      {valor !== null ? <div className="flex justify-between gap-2"><dt>{pedido.orderedAt ? "Comprado" : pedido.selectedQuoteId ? "Escolhido" : "Melhor cotação"}</dt><dd className="tabular-nums">{dinheiro(valor)}</dd></div> : null}
      {pedido.status === "entregue" ? <div className="flex justify-between gap-2"><dt>Entregue</dt><dd>{dataCurta(pedido.deliveredAt)}</dd></div>
        : emAndamento(pedido.status) ? <div className="flex justify-between gap-2"><dt>Previsão</dt><dd>{dataCurta(pedido.expectedDeliveryDate)}</dd></div>
        : pedido.neededBy ? <div className="flex justify-between gap-2"><dt>Obra precisa</dt><dd>{dataCurta(pedido.neededBy)}</dd></div> : null}
    </dl>
  </button>;
}

function Entregas({ pedidos, hoje, onAbrir }: { pedidos: PedidoResumo[]; hoje: string; onAbrir: (id: string) => void }) {
  const ativos = pedidos.filter((p) => emAndamento(p.status)).sort((a, b) => (a.expectedDeliveryDate ?? "9999").localeCompare(b.expectedDeliveryDate ?? "9999"));
  const semana = hoje ? somarDias(hoje, 7) : "";
  const grupos = [
    { titulo: "Atrasadas", itens: ativos.filter((p) => p.expectedDeliveryDate && p.expectedDeliveryDate < hoje) },
    { titulo: "Chegam em até 7 dias", itens: ativos.filter((p) => p.expectedDeliveryDate && p.expectedDeliveryDate >= hoje && p.expectedDeliveryDate <= semana) },
    { titulo: "Depois ou sem previsão", itens: ativos.filter((p) => !p.expectedDeliveryDate || p.expectedDeliveryDate > semana) },
  ];
  if (!ativos.length) return <Card className="p-8 text-center"><Truck className="mx-auto size-8 text-drap-500" /><p className="mt-3 font-medium">Nenhuma entrega em andamento</p><p className="mt-1 text-sm text-drap-500">Pedidos comprados aparecem aqui até o material chegar.</p></Card>;
  return <div className="grid gap-4 lg:grid-cols-3">{grupos.map((grupo) => <section key={grupo.titulo} className="min-w-0" aria-label={grupo.titulo}>
    <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold text-drap-800">{grupo.titulo}</h2><span className="text-xs text-drap-500">{grupo.itens.length}</span></div>
    <div className="space-y-2">{grupo.itens.length ? grupo.itens.map((p) => <button key={p.id} type="button" onClick={() => onAbrir(p.id)} className="block w-full rounded-lg border border-drap-200 bg-white p-3 text-left hover:border-drap-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-drap-400">
      <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-xs text-drap-500">{p.code} · {p.projectName ?? "sem obra"}</p><p className="mt-0.5 line-clamp-2 text-sm font-medium text-drap-950">{p.title}</p></div><SeloEntrega situacao={p.delivery} /></div>
      <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs text-drap-600">
        <dt>Fornecedor</dt><dd className="truncate text-right">{p.supplierName ?? "—"}</dd>
        <dt>Previsão</dt><dd className="text-right">{dataCurta(p.expectedDeliveryDate)}</dd>
        {p.neededBy ? <><dt>Obra precisa</dt><dd className="text-right">{dataCurta(p.neededBy)}</dd></> : null}
        <dt>Transporte</dt><dd className="truncate text-right">{p.status === "comprado" ? "aguardando saída" : [p.carrier, p.trackingCode].filter(Boolean).join(" · ") || "a caminho"}</dd>
        {p.deliveryAddress ? <><dt>Entregar em</dt><dd className="truncate text-right" title={p.deliveryAddress}>{p.deliveryAddress}</dd></> : null}
      </dl>
    </button>) : <p className="rounded-md border border-dashed border-drap-200 p-3 text-xs text-drap-500">Nada aqui.</p>}</div>
  </section>)}</div>;
}

type LinhaNova = { key: string; productId: string | null; description: string; unit: string; quantidade: string };

function NovoPedido({ aberto, onFechar, projetos, produtos, podeOrcamento, obraInicial, inicial, onCriado }: {
  aberto: boolean; onFechar: () => void; projetos: Projeto[]; produtos: Produto[]; podeOrcamento: boolean; obraInicial: string;
  inicial: { productId: string; quantity: number } | null;
  onCriado: (id: string) => Promise<void>;
}) {
  const [origem, setOrigem] = useState<"itens" | "orcamento">("itens");
  const [linhas, setLinhas] = useState<LinhaNova[]>(() => {
    const p = inicial ? produtos.find((x) => x.id === inicial.productId) : null;
    return p && inicial ? [{ key: "inicial", productId: p.id, description: p.name, unit: p.unit, quantidade: inicial.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 3 }) }] : [];
  });
  const [produto, setProduto] = useState("");
  const [orcamentos, setOrcamentos] = useState<Orcamento[] | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto || !podeOrcamento || orcamentos) return;
    let vivo = true;
    api<{ budgets: Orcamento[] }>("/api/budgets").then((r) => { if (vivo) setOrcamentos(r.budgets.filter((b) => b.itemCount > 0)); }).catch(() => { if (vivo) setOrcamentos([]); });
    return () => { vivo = false; };
  }, [aberto, podeOrcamento, orcamentos]);

  function incluirProduto() {
    const p = produtos.find((x) => x.id === produto); if (!p) return;
    setLinhas((atual) => [...atual, { key: crypto.randomUUID(), productId: p.id, description: p.name, unit: p.unit, quantidade: "1" }]); setProduto("");
  }

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (salvando) return;
    const d = new FormData(event.currentTarget);
    const items = [];
    if (origem === "itens") for (const linha of linhas) {
      const quantity = lerQuantidade(linha.quantidade);
      if (!linha.description.trim() || quantity === null) { toast.error(`Revise “${linha.description || "item sem descrição"}”: descrição e quantidade maior que zero.`); return; }
      items.push({ productId: linha.productId, description: linha.description.trim(), unit: linha.unit.trim() || "un", quantity });
    }
    const budgetVersionId = origem === "orcamento" ? String(d.get("orcamento") || "") || null : null;
    if (origem === "orcamento" && !budgetVersionId) { toast.error("Escolha o orçamento."); return; }
    setSalvando(true);
    try {
      const r = await api<{ id: string; code: string }>("/api/compras", { method: "POST", body: JSON.stringify({
        title: String(d.get("titulo") ?? ""), projectId: String(d.get("obra") || "") || null, neededBy: String(d.get("necessidade") || "") || null,
        priority: String(d.get("prioridade") || "normal"), deliveryAddress: String(d.get("endereco") ?? ""), notes: String(d.get("observacoes") ?? ""),
        items, budgetVersionId,
      }) });
      toast.success(`${r.code} criado`); setLinhas([]); setOrigem("itens");
      await onCriado(r.id);
    } catch (causa) { toast.error(mensagem(causa, "Não foi possível criar o pedido.")); }
    finally { setSalvando(false); }
  }

  return <Dialog open={aberto} onOpenChange={(valor) => { if (!valor && !salvando) onFechar(); }}>
    <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle>Novo pedido de compra</DialogTitle><DialogDescription>O que a obra precisa e para quando. As cotações entram depois, no próprio pedido.</DialogDescription></DialogHeader>
      <form onSubmit={(e) => void enviar(e)} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto id="novo-titulo" name="titulo" label="Nome do pedido" required minLength={3} maxLength={140} placeholder="Concreto e aço — laje do 1º pavimento" />
          <Escolha id="novo-obra" name="obra" label="Obra ou projeto" defaultValue={obraInicial} options={[{ value: "", label: "Sem obra (estoque ou escritório)" }, ...projetos.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))]} />
          <CampoTexto id="novo-necessidade" name="necessidade" label="Obra precisa em" type="date" />
          <Escolha id="novo-prioridade" name="prioridade" label="Prioridade" defaultValue="normal" options={PRIORIDADES.map((p) => ({ value: p, label: rotuloPrioridade[p] }))} />
        </div>
        <CampoTexto id="novo-endereco" name="endereco" label="Endereço de entrega" maxLength={300} />
        {podeOrcamento ? <Tabs value={origem} onValueChange={(v) => setOrigem(v as "itens" | "orcamento")}><TabsList><TabsTrigger value="itens">Informar itens</TabsTrigger><TabsTrigger value="orcamento">Copiar de um orçamento</TabsTrigger></TabsList></Tabs> : null}
        {origem === "orcamento" ? (orcamentos === null ? <p className="text-sm text-drap-500"><LoaderCircle className="mr-2 inline size-4 animate-spin" />Carregando orçamentos…</p> : !orcamentos.length ? <p className="text-sm text-drap-600">Nenhum orçamento com itens nesta empresa.</p>
          : <Escolha id="novo-orcamento" name="orcamento" label="Orçamento" ajuda="Os itens de primeiro nível entram com quantidade e custo do orçamento como referência; a obra vem junto." options={[{ value: "", label: "Escolha o orçamento…" }, ...orcamentos.map((b) => ({ value: b.id, label: `${b.code} v${b.version} · ${b.projectName ?? "sem obra"} · ${b.itemCount} itens` }))]} />)
          : <div className="space-y-2 rounded-md border border-drap-200 p-3">
            {linhas.map((linha, i) => <div key={linha.key} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_5rem_auto]">
              <Input aria-label={`Descrição do item ${i + 1}`} value={linha.description} readOnly={Boolean(linha.productId)} onChange={(e) => setLinhas((a) => a.map((l) => l.key === linha.key ? { ...l, description: e.target.value } : l))} className="col-span-2 sm:col-span-1" placeholder="Descrição" />
              <Input aria-label={`Quantidade do item ${i + 1}`} inputMode="decimal" value={linha.quantidade} onChange={(e) => setLinhas((a) => a.map((l) => l.key === linha.key ? { ...l, quantidade: e.target.value } : l))} />
              <Input aria-label={`Unidade do item ${i + 1}`} value={linha.unit} readOnly={Boolean(linha.productId)} onChange={(e) => setLinhas((a) => a.map((l) => l.key === linha.key ? { ...l, unit: e.target.value } : l))} />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remover item ${i + 1}`} onClick={() => setLinhas((a) => a.filter((l) => l.key !== linha.key))}><Trash2 /></Button>
            </div>)}
            {!linhas.length ? <p className="text-sm text-drap-500">Pode criar sem itens e completar depois.</p> : null}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              {produtos.length ? <div className="flex-1"><Escolha id="novo-produto" label="Produto do cadastro" value={produto} onChange={setProduto} options={[{ value: "", label: "Escolha um produto…" }, ...produtos.map((p) => ({ value: p.id, label: `${p.name} (${p.unit})` }))]} /></div> : null}
              {produtos.length ? <Button type="button" variant="outline" disabled={!produto} onClick={incluirProduto}><Plus />Incluir</Button> : null}
              <Button type="button" variant="outline" onClick={() => setLinhas((a) => [...a, { key: crypto.randomUUID(), productId: null, description: "", unit: "un", quantidade: "1" }])}><Plus />Item avulso</Button>
            </div>
          </div>}
        <CampoArea id="novo-observacoes" name="observacoes" label="Observações" maxLength={2000} />
        <Button type="submit" className="w-full" disabled={salvando}>{salvando ? <LoaderCircle className="animate-spin" /> : <Plus />}Criar pedido</Button>
      </form>
    </DialogContent>
  </Dialog>;
}
