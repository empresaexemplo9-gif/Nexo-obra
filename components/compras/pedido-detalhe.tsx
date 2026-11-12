"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Check, CircleAlert, LoaderCircle, PackageCheck, Pencil, Plus, Send, Trash2, Truck, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  PESOS, PRIORIDADES, cotacoesEditaveis, encerrada, itensEditaveis, logisticaEditavel, perguntaDoStatus, rotuloPrioridade, somarDias,
  type Comparativo,
} from "@/lib/compras";
import {
  api, CampoArea, CampoTexto, centavosParaTexto, dataCurta, dinheiro, ErroDeApi, Escolha, lerCentavos, lerQuantidade, mensagem, numero,
  SeloEntrega, SeloStatus, type Fornecedor, type PedidoResumo, type Produto, type Projeto,
} from "@/components/compras/comum";

type Item = { id: string; productId: string | null; description: string; unit: string; quantity: number; receivedQuantity: number; referenceCostCents: number | null };
type Cotacao = {
  id: string; supplierId: string; supplierName: string; supplierPhone: string; supplierEmail: string;
  deliveryDays: number; paymentTerms: string; paymentDays: number; freightCents: number; discountCents: number;
  validUntil: string | null; negotiationScore: number; notes: string; createdByName: string; updatedAt: string; prices: Record<string, number>;
};
type Detalhe = {
  request: PedidoResumo; items: Item[]; quotes: Cotacao[]; comparison: Comparativo;
  events: { id: string; kind: string; detail: string; authorName: string; createdAt: string }[]; today: string;
};

export function PedidoDetalhe({ id, projetos, fornecedores, produtos, canEdit, onVoltar, onAlterado }: {
  id: string; projetos: Projeto[]; fornecedores: Fornecedor[]; produtos: Produto[]; canEdit: boolean;
  onVoltar: () => void; onAlterado: () => void;
}) {
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [cotando, setCotando] = useState<Cotacao | "nova" | null>(null);
  const [cancelando, setCancelando] = useState(false);

  const carregar = useCallback(async () => {
    setErro("");
    try { setDetalhe(await api<Detalhe>(`/api/compras/${id}`)); }
    catch (causa) { setErro(mensagem(causa, "Não foi possível abrir o pedido.")); }
  }, [id]);
  useEffect(() => { const t = window.setTimeout(() => { void carregar(); }, 0); return () => window.clearTimeout(t); }, [carregar]);

  // Toda gravação devolve o pedido inteiro; conflito de revisão recarrega em vez de
  // insistir, para a pessoa ver o que a outra gravou.
  async function gravar(url: string, init: RequestInit, sucesso: string) {
    if (salvando) return false;
    setSalvando(true);
    try {
      const resposta = await api<Detalhe>(url, init);
      setDetalhe(resposta); toast.success(sucesso); onAlterado();
      return true;
    } catch (causa) {
      toast.error(mensagem(causa, "Não foi possível gravar."));
      if (causa instanceof ErroDeApi && causa.code === "revision_conflict") await carregar();
      return false;
    } finally { setSalvando(false); }
  }
  const agir = (corpo: Record<string, unknown>, sucesso: string) =>
    gravar(`/api/compras/${id}/acoes`, { method: "POST", body: JSON.stringify({ revision: detalhe!.request.revision, ...corpo }) }, sucesso);

  if (erro) return <Card className="p-6"><p role="alert" className="flex items-center gap-2 text-sm text-drap-700"><CircleAlert className="size-4" />{erro}</p><div className="mt-4 flex gap-2"><Button variant="outline" onClick={onVoltar}><ArrowLeft />Voltar</Button><Button onClick={() => void carregar()}>Tentar novamente</Button></div></Card>;
  if (!detalhe) return <Card className="p-8 text-center text-sm text-drap-500"><LoaderCircle className="mx-auto mb-3 animate-spin" />Abrindo pedido…</Card>;

  const { request: pedido } = detalhe;
  const fechado = encerrada(pedido.status);

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 border-b border-drap-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <Button variant="ghost" size="sm" onClick={onVoltar} className="-ml-2 mb-2"><ArrowLeft />Compras</Button>
        <p className="eyebrow text-drap-600">{pedido.code}{pedido.projectName ? ` · ${pedido.projectName}` : " · sem obra"}</p>
        <h1 className="display-heading mt-1 break-words text-3xl text-drap-950">{pedido.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2"><SeloStatus status={pedido.status} /><SeloEntrega situacao={pedido.delivery} />{pedido.priority !== "normal" ? <Badge variant="outline">Prioridade {rotuloPrioridade[pedido.priority as keyof typeof rotuloPrioridade]?.toLowerCase()}</Badge> : null}<span className="text-sm text-drap-500">{perguntaDoStatus[pedido.status]}</span></div>
      </div>
      {canEdit && !fechado ? <Button variant="outline" onClick={() => setCancelando(true)}><X />Cancelar pedido</Button> : null}
    </div>

    <div className="grid gap-5 xl:grid-cols-3">
      <div className="min-w-0 space-y-5 xl:col-span-2">
        <Itens detalhe={detalhe} produtos={produtos} canEdit={canEdit && itensEditaveis(pedido.status)} salvando={salvando}
          onSalvar={(items) => gravar(`/api/compras/${id}`, { method: "PATCH", body: JSON.stringify({ revision: pedido.revision, items }) }, "Itens salvos")} />
        <Comparativo detalhe={detalhe} canEdit={canEdit} salvando={salvando}
          onNova={() => setCotando("nova")} onEditar={(cotacao) => setCotando(cotacao)}
          onExcluir={(cotacao) => void gravar(`/api/compras/${id}/cotacoes/${cotacao.id}`, { method: "DELETE" }, `Cotação de ${cotacao.supplierName} excluída`)}
          onEscolher={(quoteId, nome) => void agir({ action: "escolher", quoteId }, `${nome} escolhido`)} semFornecedores={!fornecedores.some((f) => f.active)} />
      </div>
      <div className="min-w-0 space-y-5">
        <Etapa detalhe={detalhe} canEdit={canEdit} salvando={salvando} agir={agir}
          onLogistica={(corpo) => gravar(`/api/compras/${id}`, { method: "PATCH", body: JSON.stringify({ revision: pedido.revision, ...corpo }) }, "Logística atualizada")} />
        <DadosDoPedido pedido={pedido} projetos={projetos} canEdit={canEdit && !fechado} salvando={salvando}
          onSalvar={(corpo) => gravar(`/api/compras/${id}`, { method: "PATCH", body: JSON.stringify({ revision: pedido.revision, ...corpo }) }, "Pedido atualizado")} />
        <Card><CardHeader className="border-b py-3"><CardTitle className="text-sm font-semibold">Linha do tempo</CardTitle></CardHeader>
          <CardContent className="p-0"><ol className="divide-y divide-drap-100">{detalhe.events.map((evento) => <li key={evento.id} className="px-4 py-3 text-sm"><p className="text-drap-900">{evento.detail}</p><p className="mt-0.5 text-xs text-drap-500">{evento.authorName} · {new Date(evento.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p></li>)}</ol></CardContent>
        </Card>
      </div>
    </div>

    <DialogoCotacao aberto={cotando !== null} cotacao={cotando === "nova" ? null : cotando} detalhe={detalhe} fornecedores={fornecedores} salvando={salvando}
      onFechar={() => setCotando(null)}
      onSalvar={async (corpo) => { if (await gravar(`/api/compras/${id}/cotacoes`, { method: "POST", body: JSON.stringify(corpo) }, "Cotação gravada")) setCotando(null); }} />

    <Dialog open={cancelando} onOpenChange={(aberto) => { if (!salvando) setCancelando(aberto); }}>
      <DialogContent><DialogHeader><DialogTitle>Cancelar {pedido.code}</DialogTitle><DialogDescription>O pedido sai da fila e fica no histórico com o motivo.{pedido.status === "comprado" || pedido.status === "em_entrega" ? " Avise o fornecedor: o cancelamento aqui não chega até ele." : ""}</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={async (event) => { event.preventDefault(); const motivo = String(new FormData(event.currentTarget).get("motivo") ?? ""); if (await agir({ action: "cancelar", reason: motivo }, "Pedido cancelado")) setCancelando(false); }}>
          <CampoArea id="compra-cancelar-motivo" name="motivo" label="Motivo" required minLength={3} maxLength={500} />
          <Button type="submit" variant="destructive" className="w-full" disabled={salvando}>{salvando ? <LoaderCircle className="animate-spin" /> : <X />}Cancelar pedido</Button>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}

type LinhaItem = { key: string; id?: string; productId: string | null; description: string; unit: string; quantidade: string };

function Itens({ detalhe, produtos, canEdit, salvando, onSalvar }: {
  detalhe: Detalhe; produtos: Produto[]; canEdit: boolean; salvando: boolean; onSalvar: (items: unknown[]) => Promise<boolean>;
}) {
  const [editando, setEditando] = useState(false);
  const [linhas, setLinhas] = useState<LinhaItem[]>([]);
  const [produtoEscolhido, setProdutoEscolhido] = useState("");
  const recebe = detalhe.request.status === "comprado" || detalhe.request.status === "em_entrega" || detalhe.request.status === "entregue";

  function abrir() {
    setLinhas(detalhe.items.map((item) => ({ key: item.id, id: item.id, productId: item.productId, description: item.description, unit: item.unit, quantidade: numero(item.quantity) })));
    setEditando(true);
  }
  function incluirProduto() {
    const produto = produtos.find((p) => p.id === produtoEscolhido);
    if (!produto) return;
    setLinhas((atual) => [...atual, { key: crypto.randomUUID(), productId: produto.id, description: produto.name, unit: produto.unit, quantidade: "1" }]);
    setProdutoEscolhido("");
  }
  async function salvar() {
    const items = [];
    for (const linha of linhas) {
      const quantity = lerQuantidade(linha.quantidade);
      if (!linha.description.trim() || quantity === null) { toast.error(`Revise a linha “${linha.description || "sem descrição"}”: descrição e quantidade maior que zero.`); return; }
      items.push({ ...(linha.id ? { id: linha.id } : { productId: linha.productId }), description: linha.description.trim(), unit: linha.unit.trim() || "un", quantity });
    }
    if (await onSalvar(items)) setEditando(false);
  }
  const atualizar = (key: string, campo: keyof LinhaItem, valor: string) => setLinhas((atual) => atual.map((l) => l.key === key ? { ...l, [campo]: valor } : l));

  return <Card>
    <CardHeader className="flex flex-row items-center justify-between gap-2 border-b py-3"><CardTitle className="text-sm font-semibold">Itens · {detalhe.items.length}</CardTitle>{canEdit && !editando ? <Button size="sm" variant="outline" onClick={abrir}><Pencil />Editar itens</Button> : null}</CardHeader>
    <CardContent className="p-0">
      {editando ? <div className="space-y-3 p-4">
        {detalhe.quotes.length ? <p className="text-xs text-drap-600">Item removido leva junto os preços que as cotações tinham para ele.</p> : null}
        {linhas.map((linha, indice) => <div key={linha.key} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_5rem_auto]">
          <Input aria-label={`Descrição do item ${indice + 1}`} value={linha.description} onChange={(e) => atualizar(linha.key, "description", e.target.value)} readOnly={Boolean(linha.productId)} className="col-span-2 sm:col-span-1" />
          <Input aria-label={`Quantidade do item ${indice + 1}`} inputMode="decimal" value={linha.quantidade} onChange={(e) => atualizar(linha.key, "quantidade", e.target.value)} />
          <Input aria-label={`Unidade do item ${indice + 1}`} value={linha.unit} onChange={(e) => atualizar(linha.key, "unit", e.target.value)} readOnly={Boolean(linha.productId)} />
          <Button variant="ghost" size="icon" aria-label={`Remover ${linha.description || `item ${indice + 1}`}`} onClick={() => setLinhas((atual) => atual.filter((l) => l.key !== linha.key))}><Trash2 /></Button>
        </div>)}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          {produtos.length ? <div className="flex-1"><Escolha id="compra-item-produto" label="Produto do cadastro" value={produtoEscolhido} onChange={setProdutoEscolhido} options={[{ value: "", label: "Escolha um produto…" }, ...produtos.map((p) => ({ value: p.id, label: `${p.name} (${p.unit})` }))]} /></div> : null}
          {produtos.length ? <Button variant="outline" onClick={incluirProduto} disabled={!produtoEscolhido}><Plus />Incluir produto</Button> : null}
          <Button variant="outline" onClick={() => setLinhas((atual) => [...atual, { key: crypto.randomUUID(), productId: null, description: "", unit: "un", quantidade: "1" }])}><Plus />Item avulso</Button>
        </div>
        <div className="flex gap-2"><Button onClick={() => void salvar()} disabled={salvando}>{salvando ? <LoaderCircle className="animate-spin" /> : <Check />}Salvar itens</Button><Button variant="ghost" onClick={() => setEditando(false)}>Descartar</Button></div>
      </div> : !detalhe.items.length ? <p className="p-6 text-sm text-drap-500">Nenhum item. {canEdit ? "Use “Editar itens” para incluir o que precisa ser comprado." : ""}</p> : <div className="overflow-x-auto"><Table>
        <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Quantidade</TableHead>{recebe ? <TableHead className="text-right">Recebido</TableHead> : null}<TableHead className="text-right">Referência</TableHead></TableRow></TableHeader>
        <TableBody>{detalhe.items.map((item) => <TableRow key={item.id}>
          <TableCell className="whitespace-normal">{item.description}</TableCell>
          <TableCell className="text-right tabular-nums">{numero(item.quantity)} {item.unit}</TableCell>
          {recebe ? <TableCell className="text-right tabular-nums">{numero(item.receivedQuantity)} {item.unit}</TableCell> : null}
          <TableCell className="text-right tabular-nums text-drap-500">{item.referenceCostCents === null ? "—" : `${dinheiro(item.referenceCostCents)}/${item.unit}`}</TableCell>
        </TableRow>)}</TableBody>
      </Table></div>}
    </CardContent>
  </Card>;
}

function Comparativo({ detalhe, canEdit, salvando, semFornecedores, onNova, onEditar, onExcluir, onEscolher }: {
  detalhe: Detalhe; canEdit: boolean; salvando: boolean; semFornecedores: boolean;
  onNova: () => void; onEditar: (c: Cotacao) => void; onExcluir: (c: Cotacao) => void; onEscolher: (quoteId: string, nome: string) => void;
}) {
  const { request: pedido, comparison, items } = detalhe;
  const editavel = canEdit && cotacoesEditaveis(pedido.status);
  const cotacaoPorId = new Map(detalhe.quotes.map((q) => [q.id, q]));
  const linhas = comparison.linhas;

  return <Card>
    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b py-3">
      <div><CardTitle className="text-sm font-semibold">Cotações e comparativo · {linhas.length}</CardTitle><p className="mt-1 text-xs text-drap-500">Nota: preço {PESOS.preco * 100}%, prazo de entrega {PESOS.prazo * 100}%, negociação {PESOS.negociacao * 100}% e prazo de pagamento {PESOS.pagamento * 100}%. Só concorre cotação completa e dentro da validade.</p></div>
      {editavel ? <Button size="sm" onClick={onNova} disabled={!items.length || semFornecedores} title={semFornecedores ? "Cadastre um fornecedor na aba Fornecedores" : undefined}><Plus />Lançar cotação</Button> : null}
    </CardHeader>
    <CardContent className="p-0">
      {!linhas.length ? <p className="p-6 text-sm text-drap-500">{!items.length ? "Inclua os itens antes de cotar." : semFornecedores ? "Cadastre fornecedores na aba Fornecedores para lançar cotações." : "Nenhuma cotação lançada. Peça preço a pelo menos dois fornecedores para comparar."}</p> : <>
        <div className="overflow-x-auto"><Table className="min-w-[36rem]">
          <TableHeader><TableRow><TableHead className="min-w-44">Item</TableHead>{linhas.map((l) => <TableHead key={l.quoteId} className="min-w-40 text-right align-bottom whitespace-normal">
            <span className="block font-semibold text-drap-900">{l.supplierName}</span>
            <span className="mt-1 flex flex-wrap justify-end gap-1">{l.quoteId === pedido.selectedQuoteId ? <Badge>Escolhida</Badge> : null}{l.recomendada ? <Badge variant="secondary">Recomendada</Badge> : null}{l.menorPreco ? <Badge variant="outline">Menor preço</Badge> : null}{l.menorPrazo ? <Badge variant="outline">Mais rápida</Badge> : null}{l.melhorNegociacao ? <Badge variant="outline">Mais flexível</Badge> : null}{!l.completa ? <Badge variant="destructive">Incompleta</Badge> : null}{l.vencida ? <Badge variant="destructive">Vencida</Badge> : null}</span>
          </TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {items.map((item) => <TableRow key={item.id}><TableCell className="whitespace-normal"><span className="block">{item.description}</span><span className="text-xs text-drap-500">{numero(item.quantity)} {item.unit}</span></TableCell>
              {linhas.map((l) => { const preco = cotacaoPorId.get(l.quoteId)?.prices[item.id]; const melhor = comparison.melhorPorItem[item.id]?.quoteId === l.quoteId;
                return <TableCell key={l.quoteId} className={`text-right tabular-nums ${melhor ? "font-semibold text-drap-900" : ""}`}>{preco === undefined ? <span className="text-drap-400">sem preço</span> : <><span className="block">{dinheiro(preco)}</span><span className="text-xs text-drap-500">{dinheiro(Math.round(preco * item.quantity))}</span></>}</TableCell>; })}
            </TableRow>)}
          </TableBody>
          <TableFooter>
            <Linha titulo="Frete" valores={linhas.map((l) => dinheiro(cotacaoPorId.get(l.quoteId)!.freightCents))} />
            <Linha titulo="Desconto" valores={linhas.map((l) => { const d = cotacaoPorId.get(l.quoteId)!.discountCents; return d ? `− ${dinheiro(d)}` : "—"; })} />
            <Linha titulo="Total" forte valores={linhas.map((l) => <>{dinheiro(l.totalCents)}{l.diferencaReferenciaPercent !== null ? <span className="block text-xs font-normal text-drap-500">{l.diferencaReferenciaPercent > 0 ? "+" : ""}{l.diferencaReferenciaPercent.toLocaleString("pt-BR")}% da referência</span> : null}</>)} />
            <Linha titulo="Entrega" valores={linhas.map((l) => <>{l.deliveryDays} {l.deliveryDays === 1 ? "dia" : "dias"}<span className={`block text-xs font-normal ${l.chegaATempo === false ? "text-destructive" : "text-drap-500"}`}>{l.chegaATempo === false ? `chega ${dataCurta(l.chegadaPrevista)}, depois da necessidade` : `chega ${dataCurta(l.chegadaPrevista)} se pedir hoje`}</span></>)} />
            <Linha titulo="Pagamento" valores={linhas.map((l) => { const q = cotacaoPorId.get(l.quoteId)!; return q.paymentTerms || (q.paymentDays ? `${q.paymentDays} dias` : "À vista"); })} />
            <Linha titulo="Negociação" valores={linhas.map((l) => `${l.negotiationScore}/5`)} />
            <Linha titulo="Validade" valores={linhas.map((l) => dataCurta(cotacaoPorId.get(l.quoteId)!.validUntil))} />
            <Linha titulo="Nota" forte valores={linhas.map((l) => l.nota === null ? "—" : String(l.nota))} />
            {canEdit ? <TableRow><TableCell className="text-xs font-medium text-drap-600">Ações</TableCell>{linhas.map((l) => { const cotacao = cotacaoPorId.get(l.quoteId)!; const escolhida = l.quoteId === pedido.selectedQuoteId;
              return <TableCell key={l.quoteId} className="text-right"><div className="flex flex-wrap justify-end gap-1">
                {editavel && !escolhida ? <Button size="sm" disabled={salvando || !l.completa || l.vencida} onClick={() => onEscolher(l.quoteId, l.supplierName)}><Check />Escolher</Button> : null}
                {editavel ? <Button size="sm" variant="outline" aria-label={`Editar cotação de ${l.supplierName}`} onClick={() => onEditar(cotacao)}><Pencil /></Button> : null}
                {editavel && !escolhida ? <Button size="sm" variant="ghost" aria-label={`Excluir cotação de ${l.supplierName}`} disabled={salvando} onClick={() => onExcluir(cotacao)}><Trash2 /></Button> : null}
              </div></TableCell>; })}</TableRow> : null}
          </TableFooter>
        </Table></div>
        <div className="grid gap-2 border-t border-drap-100 p-4 text-sm sm:grid-cols-2">
          <p className="text-drap-600">Referência oficial ou da biblioteca: <strong className="text-drap-900">{comparison.referenciaCents === null ? "nem todos os itens têm" : dinheiro(comparison.referenciaCents)}</strong></p>
          <p className="text-drap-600">Cada item do fornecedor mais barato, sem frete: <strong className="text-drap-900">{comparison.totalItemAItemCents === null ? "faltam preços" : dinheiro(comparison.totalItemAItemCents)}</strong></p>
        </div>
      </>}
    </CardContent>
  </Card>;
}

function Linha({ titulo, valores, forte }: { titulo: string; valores: ReactNode[]; forte?: boolean }) {
  return <TableRow><TableCell className={`text-xs ${forte ? "font-semibold text-drap-900" : "font-medium text-drap-600"}`}>{titulo}</TableCell>{valores.map((valor, i) => <TableCell key={i} className={`text-right tabular-nums whitespace-normal ${forte ? "font-semibold text-drap-950" : ""}`}>{valor}</TableCell>)}</TableRow>;
}

function DialogoCotacao({ aberto, cotacao, detalhe, fornecedores, salvando, onFechar, onSalvar }: {
  aberto: boolean; cotacao: Cotacao | null; detalhe: Detalhe; fornecedores: Fornecedor[]; salvando: boolean;
  onFechar: () => void; onSalvar: (corpo: Record<string, unknown>) => Promise<void>;
}) {
  const jaCotados = new Set(detalhe.quotes.map((q) => q.supplierId));
  const disponiveis = fornecedores.filter((f) => f.active && (!jaCotados.has(f.id) || f.id === cotacao?.supplierId));
  const [fornecedorId, setFornecedorId] = useState("");
  const fornecedor = fornecedores.find((f) => f.id === (cotacao?.supplierId ?? fornecedorId));
  const chave = `${cotacao?.id ?? "nova"}-${fornecedor?.id ?? ""}`;

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const dados = new FormData(event.currentTarget);
    const supplierId = cotacao?.supplierId ?? fornecedorId;
    if (!supplierId) { toast.error("Escolha o fornecedor."); return; }
    const prices = [];
    for (const item of detalhe.items) {
      const texto = String(dados.get(`preco-${item.id}`) ?? "");
      if (!texto.trim()) continue;
      const centavos = lerCentavos(texto, null);
      if (centavos === null) { toast.error(`Preço inválido em “${item.description}”. Use, por exemplo, 32,90.`); return; }
      prices.push({ itemId: item.id, unitPriceCents: centavos });
    }
    const frete = lerCentavos(String(dados.get("frete") ?? ""));
    const desconto = lerCentavos(String(dados.get("desconto") ?? ""));
    if (frete === null || desconto === null) { toast.error("Frete e desconto em reais, por exemplo 150,00."); return; }
    await onSalvar({
      supplierId, deliveryDays: Number(dados.get("prazo") || 0), paymentTerms: String(dados.get("condicao") ?? ""), paymentDays: Number(dados.get("diasPagamento") || 0),
      freightCents: frete, discountCents: desconto, validUntil: String(dados.get("validade") || "") || null,
      negotiationScore: Number(dados.get("negociacao") || 3), notes: String(dados.get("observacoes") ?? ""), prices,
    });
  }

  return <Dialog open={aberto} onOpenChange={(valor) => { if (!valor && !salvando) { onFechar(); setFornecedorId(""); } }}>
    <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle>{cotacao ? `Cotação de ${cotacao.supplierName}` : "Lançar cotação"}</DialogTitle><DialogDescription>Preço unitário de cada item como o fornecedor mandou. Item que ele não tem fica em branco.</DialogDescription></DialogHeader>
      {!cotacao ? <Escolha id="cotacao-fornecedor" label="Fornecedor" value={fornecedorId} onChange={setFornecedorId} options={[{ value: "", label: disponiveis.length ? "Escolha o fornecedor…" : "Todos os fornecedores ativos já cotaram" }, ...disponiveis.map((f) => ({ value: f.id, label: f.name }))]} /> : null}
      {fornecedor ? <form key={chave} onSubmit={(e) => void enviar(e)} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <CampoTexto id="cotacao-prazo" name="prazo" label="Entrega (dias)" type="number" min={0} max={365} required defaultValue={String(cotacao?.deliveryDays ?? fornecedor.leadTimeDays ?? "")} />
          <CampoTexto id="cotacao-condicao" name="condicao" label="Condição de pagamento" placeholder="30/60/90" maxLength={120} defaultValue={cotacao?.paymentTerms ?? fornecedor.paymentTerms} />
          <CampoTexto id="cotacao-dias-pagamento" name="diasPagamento" label="Prazo médio para pagar (dias)" type="number" min={0} max={365} defaultValue={String(cotacao?.paymentDays ?? 0)} />
          <Escolha id="cotacao-negociacao" name="negociacao" label="Abertura para negociar" defaultValue={String(cotacao?.negotiationScore ?? fornecedor.negotiationScore ?? 3)} options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} · ${["rígido", "pouca", "média", "boa", "muito flexível"][n - 1]}` }))} />
          <CampoTexto id="cotacao-frete" name="frete" label="Frete (R$)" inputMode="decimal" placeholder="0,00" defaultValue={centavosParaTexto(cotacao?.freightCents ?? null)} />
          <CampoTexto id="cotacao-desconto" name="desconto" label="Desconto no total (R$)" inputMode="decimal" placeholder="0,00" defaultValue={centavosParaTexto(cotacao?.discountCents ?? null)} />
          <CampoTexto id="cotacao-validade" name="validade" label="Válida até" type="date" defaultValue={cotacao?.validUntil ?? ""} />
        </div>
        <div className="rounded-md border border-drap-200">
          <p className="border-b border-drap-100 bg-drap-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-drap-600">Preço unitário (R$)</p>
          <div className="divide-y divide-drap-100">{detalhe.items.map((item) => <div key={item.id} className="grid grid-cols-[1fr_8rem] items-center gap-3 px-3 py-2">
            <label htmlFor={`preco-${item.id}`} className="text-sm"><span className="block">{item.description}</span><span className="text-xs text-drap-500">{numero(item.quantity)} {item.unit}{item.referenceCostCents !== null ? ` · referência ${dinheiro(item.referenceCostCents)}` : ""}</span></label>
            <Input id={`preco-${item.id}`} name={`preco-${item.id}`} inputMode="decimal" placeholder="0,00" defaultValue={centavosParaTexto(cotacao?.prices[item.id])} className="text-right" />
          </div>)}</div>
        </div>
        <CampoArea id="cotacao-observacoes" name="observacoes" label="Observações da negociação" maxLength={1000} defaultValue={cotacao?.notes ?? ""} placeholder="Ex.: aceita parcelar em 3x sem juros acima de R$ 5.000; troca de marca permitida." />
        <Button type="submit" className="w-full" disabled={salvando}>{salvando ? <LoaderCircle className="animate-spin" /> : <Check />}Gravar cotação</Button>
      </form> : null}
    </DialogContent>
  </Dialog>;
}

function Etapa({ detalhe, canEdit, salvando, agir, onLogistica }: {
  detalhe: Detalhe; canEdit: boolean; salvando: boolean;
  agir: (corpo: Record<string, unknown>, sucesso: string) => Promise<boolean>;
  onLogistica: (corpo: Record<string, unknown>) => Promise<boolean>;
}) {
  const { request: pedido, today } = detalhe;
  const escolhida = detalhe.comparison.linhas.find((l) => l.quoteId === pedido.selectedQuoteId);
  const pendentes = useMemo(() => detalhe.items.filter((i) => i.receivedQuantity < i.quantity), [detalhe.items]);

  const resumo = <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
    {pedido.supplierName ? <><dt className="text-drap-500">Fornecedor</dt><dd className="text-right font-medium">{pedido.supplierName}</dd></> : null}
    {pedido.totalCents !== null ? <><dt className="text-drap-500">{pedido.orderedAt ? "Valor comprado" : "Valor escolhido"}</dt><dd className="text-right font-medium tabular-nums">{dinheiro(pedido.totalCents)}</dd></> : null}
    {pedido.orderedAt ? <><dt className="text-drap-500">Pedido em</dt><dd className="text-right">{dataCurta(pedido.orderedAt)}{pedido.orderNumber ? ` · nº ${pedido.orderNumber}` : ""}</dd></> : null}
    {pedido.expectedDeliveryDate ? <><dt className="text-drap-500">Previsão</dt><dd className="text-right">{dataCurta(pedido.expectedDeliveryDate)}</dd></> : null}
    {pedido.neededBy ? <><dt className="text-drap-500">Obra precisa em</dt><dd className="text-right">{dataCurta(pedido.neededBy)}</dd></> : null}
    {pedido.carrier ? <><dt className="text-drap-500">Transporte</dt><dd className="text-right">{pedido.carrier}{pedido.trackingCode ? ` · ${pedido.trackingCode}` : ""}</dd></> : null}
    {pedido.deliveredAt ? <><dt className="text-drap-500">Entregue em</dt><dd className="text-right">{dataCurta(pedido.deliveredAt)}</dd></> : null}
    {pedido.cancelReason ? <><dt className="text-drap-500">Motivo</dt><dd className="text-right">{pedido.cancelReason}</dd></> : null}
  </dl>;

  let acao: ReactNode = null;
  if (canEdit && pedido.status === "a_orcar") {
    acao = <p className="text-sm text-drap-600">{detalhe.comparison.linhas.some((l) => l.nota !== null) ? "Compare as cotações e use “Escolher” na que vai ser comprada." : "Lance cotações completas para poder escolher."}</p>;
  } else if (canEdit && pedido.status === "a_comprar" && escolhida) {
    acao = <form className="space-y-3" onSubmit={async (event) => { event.preventDefault(); const d = new FormData(event.currentTarget);
      await agir({ action: "comprar", orderNumber: String(d.get("numero") ?? ""), orderedAt: String(d.get("data") || today), expectedDeliveryDate: String(d.get("previsao") || "") || null }, "Pedido registrado"); }}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <CampoTexto id="compra-numero" name="numero" label="Nº do pedido ou da nota" maxLength={60} />
        <CampoTexto id="compra-data" name="data" label="Data do pedido" type="date" max={today} defaultValue={today} />
        <CampoTexto id="compra-previsao" name="previsao" label="Previsão de entrega" type="date" defaultValue={somarDias(today, escolhida.deliveryDays)} ajuda={`Pelo prazo de ${escolhida.deliveryDays} dias da cotação.`} />
      </div>
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={salvando}><Send />Confirmar pedido</Button><Button type="button" variant="outline" disabled={salvando} onClick={() => void agir({ action: "reabrir" }, "Escolha reaberta")}>Trocar fornecedor</Button></div>
    </form>;
  } else if (canEdit && logisticaEditavel(pedido.status)) {
    acao = <div className="space-y-5">
      {pedido.status === "comprado" ? <form className="space-y-3" onSubmit={async (event) => { event.preventDefault(); const d = new FormData(event.currentTarget);
        await agir({ action: "despachar", carrier: String(d.get("transportadora") ?? ""), trackingCode: String(d.get("rastreio") ?? ""), expectedDeliveryDate: String(d.get("previsao") || "") || null }, "Saída registrada"); }}>
        <p className="text-sm font-medium text-drap-800">O fornecedor despachou?</p>
        <CampoTexto id="compra-transportadora" name="transportadora" label="Transportadora ou veículo" maxLength={120} defaultValue={pedido.carrier} />
        <CampoTexto id="compra-rastreio" name="rastreio" label="Rastreio ou placa" maxLength={120} defaultValue={pedido.trackingCode} />
        <CampoTexto id="compra-nova-previsao" name="previsao" label="Previsão de chegada" type="date" defaultValue={pedido.expectedDeliveryDate ?? ""} />
        <Button type="submit" variant="outline" disabled={salvando}><Truck />Registrar saída</Button>
      </form> : <form className="space-y-3" onSubmit={async (event) => { event.preventDefault(); const d = new FormData(event.currentTarget);
        await onLogistica({ carrier: String(d.get("transportadora") ?? ""), trackingCode: String(d.get("rastreio") ?? ""), expectedDeliveryDate: String(d.get("previsao") || "") || null }); }}>
        <p className="text-sm font-medium text-drap-800">Logística</p>
        <CampoTexto id="compra-transportadora" name="transportadora" label="Transportadora ou veículo" maxLength={120} defaultValue={pedido.carrier} />
        <CampoTexto id="compra-rastreio" name="rastreio" label="Rastreio ou placa" maxLength={120} defaultValue={pedido.trackingCode} />
        <CampoTexto id="compra-nova-previsao" name="previsao" label="Previsão de chegada" type="date" defaultValue={pedido.expectedDeliveryDate ?? ""} />
        <Button type="submit" variant="outline" disabled={salvando}><Check />Atualizar logística</Button>
      </form>}
      <form className="space-y-3 border-t border-drap-100 pt-4" onSubmit={async (event) => { event.preventDefault(); const d = new FormData(event.currentTarget);
        const items = [];
        for (const item of pendentes) { const texto = String(d.get(`receber-${item.id}`) ?? "").trim(); if (!texto) continue; const q = lerQuantidade(texto); if (q === null) { toast.error(`Quantidade inválida em “${item.description}”.`); return; } items.push({ itemId: item.id, quantity: q }); }
        if (!items.length) { toast.error("Informe a quantidade que chegou."); return; }
        await agir({ action: "receber", items, receivedAt: String(d.get("dataRecebimento") || today), note: String(d.get("nota") ?? "") }, "Recebimento registrado"); }}>
        <p className="text-sm font-medium text-drap-800">O material chegou?</p>
        {pendentes.map((item) => <div key={item.id} className="grid grid-cols-[1fr_6.5rem] items-center gap-2"><label htmlFor={`receber-${item.id}`} className="text-sm">{item.description}<span className="block text-xs text-drap-500">falta {numero(Math.round((item.quantity - item.receivedQuantity) * 1000) / 1000)} {item.unit}</span></label><Input id={`receber-${item.id}`} name={`receber-${item.id}`} inputMode="decimal" defaultValue={numero(Math.round((item.quantity - item.receivedQuantity) * 1000) / 1000)} className="text-right" /></div>)}
        <CampoTexto id="compra-data-recebimento" name="dataRecebimento" label="Recebido em" type="date" max={today} defaultValue={today} />
        <CampoTexto id="compra-nota-recebimento" name="nota" label="Observação (avaria, falta, troca)" maxLength={500} />
        <Button type="submit" disabled={salvando}><PackageCheck />Registrar recebimento</Button>
      </form>
    </div>;
  }

  return <Card><CardHeader className="border-b py-3"><CardTitle className="text-sm font-semibold">Próximo passo</CardTitle></CardHeader><CardContent className="space-y-4 p-4">{resumo}{acao}</CardContent></Card>;
}

function DadosDoPedido({ pedido, projetos, canEdit, salvando, onSalvar }: {
  pedido: PedidoResumo; projetos: Projeto[]; canEdit: boolean; salvando: boolean; onSalvar: (corpo: Record<string, unknown>) => Promise<boolean>;
}) {
  if (!canEdit) return <Card><CardHeader className="border-b py-3"><CardTitle className="text-sm font-semibold">Dados do pedido</CardTitle></CardHeader><CardContent className="space-y-2 p-4 text-sm"><p><span className="text-drap-500">Entrega em: </span>{pedido.deliveryAddress || "—"}</p><p className="whitespace-pre-wrap"><span className="text-drap-500">Observações: </span>{pedido.notes || "—"}</p><p className="text-xs text-drap-500">Criado por {pedido.createdByName}</p></CardContent></Card>;
  return <Card><CardHeader className="border-b py-3"><CardTitle className="text-sm font-semibold">Dados do pedido</CardTitle></CardHeader><CardContent className="p-4">
    <form key={pedido.revision} className="space-y-3" onSubmit={async (event) => { event.preventDefault(); const d = new FormData(event.currentTarget);
      await onSalvar({ title: String(d.get("titulo") ?? ""), projectId: String(d.get("obra") || "") || null, neededBy: String(d.get("necessidade") || "") || null, priority: String(d.get("prioridade")), deliveryAddress: String(d.get("endereco") ?? ""), notes: String(d.get("observacoes") ?? "") }); }}>
      <CampoTexto id="pedido-titulo" name="titulo" label="Nome" required minLength={3} maxLength={140} defaultValue={pedido.title} />
      <Escolha id="pedido-obra" name="obra" label="Obra ou projeto" defaultValue={pedido.projectId ?? ""} options={[{ value: "", label: "Sem obra (estoque ou escritório)" }, ...projetos.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))]} />
      <div className="grid grid-cols-2 gap-3"><CampoTexto id="pedido-necessidade" name="necessidade" label="Obra precisa em" type="date" defaultValue={pedido.neededBy ?? ""} /><Escolha id="pedido-prioridade" name="prioridade" label="Prioridade" defaultValue={pedido.priority} options={PRIORIDADES.map((p) => ({ value: p, label: rotuloPrioridade[p] }))} /></div>
      <CampoTexto id="pedido-endereco" name="endereco" label="Endereço de entrega" maxLength={300} defaultValue={pedido.deliveryAddress} />
      <CampoArea id="pedido-observacoes" name="observacoes" label="Observações" maxLength={2000} defaultValue={pedido.notes} />
      <Button type="submit" variant="outline" disabled={salvando}><Check />Salvar dados</Button>
    </form>
  </CardContent></Card>;
}
