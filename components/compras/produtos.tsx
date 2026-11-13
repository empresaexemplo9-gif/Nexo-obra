"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Check, History, LoaderCircle, PackagePlus, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, CampoArea, CampoTexto, dataCurta, dinheiro, Escolha, lerCentavos, mensagem, type Produto } from "@/components/compras/comum";

type ItemCatalogo = { source: string; reference: string; code: string; description: string; unit: string; unitCostCents: number | null; label: string; category: string; specification?: string };
type Historico = { unitPriceCents: number; deliveryDays: number; quotedAt: string; supplierName: string; requestNumber: number; bought: boolean };

const rotuloFonte: Record<string, string> = { manual: "Manual", padrao: "Padrão ABNT", fornecedor: "Lista da loja", goinfra: "GOINFRA", sinapi: "SINAPI", biblioteca: "Biblioteca" };

export function Produtos({ produtos, canEdit, canBiblioteca, busca, onAlterado }: {
  produtos: Produto[]; canEdit: boolean; canBiblioteca: boolean; busca: string; onAlterado: () => Promise<void>;
}) {
  const [manual, setManual] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [historico, setHistorico] = useState<{ produto: Produto; linhas: Historico[] | null } | null>(null);
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const visiveis = produtos.filter((p) => !termo || `${p.name} ${p.code} ${p.category} ${p.brand}`.toLocaleLowerCase("pt-BR").includes(termo));

  async function cadastrar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (salvando) return;
    const d = new FormData(event.currentTarget);
    const custo = lerCentavos(String(d.get("custo") ?? ""), null);
    if (String(d.get("custo") ?? "").trim() && custo === null) { toast.error("Custo em reais, por exemplo 32,90."); return; }
    setSalvando(true);
    try {
      await api("/api/compras/produtos", { method: "POST", body: JSON.stringify({
        code: String(d.get("codigo") ?? ""), name: String(d.get("nome") ?? ""), category: String(d.get("categoria") || "Geral"), unit: String(d.get("unidade") || "un"),
        brand: String(d.get("marca") ?? ""), specification: String(d.get("especificacao") ?? ""), referenceCostCents: custo,
      }) });
      toast.success("Produto cadastrado"); setManual(false); await onAlterado();
    } catch (causa) { toast.error(mensagem(causa, "Não foi possível cadastrar o produto.")); }
    finally { setSalvando(false); }
  }

  async function abrirHistorico(produto: Produto) {
    setHistorico({ produto, linhas: null });
    try { const r = await api<{ history: Historico[] }>(`/api/compras/produtos/${produto.id}`); setHistorico({ produto, linhas: r.history }); }
    catch (causa) { toast.error(mensagem(causa, "Não foi possível abrir o histórico.")); setHistorico(null); }
  }

  return <div className="grid gap-5 xl:grid-cols-5">
    <Card className="min-w-0 xl:col-span-3">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b py-3"><CardTitle className="text-sm font-semibold">Cadastro de produtos · {produtos.length}</CardTitle>{canEdit ? <Button size="sm" variant="outline" onClick={() => setManual(true)}><Plus />Cadastrar manualmente</Button> : null}</CardHeader>
      <CardContent className="p-0">
        {!produtos.length ? <p className="p-6 text-sm text-drap-500">Nenhum produto cadastrado. {canEdit ? "Busque no catálogo ao lado ou cadastre manualmente o material que a obra compra com frequência." : ""}</p>
          : !visiveis.length ? <p className="p-6 text-sm text-drap-500">Nenhum produto corresponde à busca.</p>
          : <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Produto</TableHead><TableHead>Origem</TableHead><TableHead className="text-right">Referência</TableHead><TableHead className="text-right">Última cotação</TableHead><TableHead className="w-10"><span className="sr-only">Histórico</span></TableHead></TableRow></TableHeader>
            <TableBody>{visiveis.map((p) => <TableRow key={p.id}>
              <TableCell className="whitespace-normal"><span className="block font-medium text-drap-900">{p.name}</span><span className="text-xs text-drap-500">{[p.code, p.category, p.brand, p.unit].filter(Boolean).join(" · ")}</span>{p.specification ? <span className="mt-0.5 line-clamp-2 block text-xs text-drap-600" title={p.specification}>{p.specification}</span> : null}</TableCell>
              <TableCell><Badge variant="outline">{rotuloFonte[p.source] ?? p.source}</Badge></TableCell>
              <TableCell className="text-right tabular-nums" title={p.referenceLabel || undefined}>{dinheiro(p.referenceCostCents)}</TableCell>
              <TableCell className="text-right tabular-nums">{dinheiro(p.lastQuotedCents)}</TableCell>
              <TableCell><Button size="icon" variant="ghost" aria-label={`Preços cotados de ${p.name}`} disabled={!p.quoteCount} onClick={() => void abrirHistorico(p)}><History /></Button></TableCell>
            </TableRow>)}</TableBody>
          </Table></div>}
      </CardContent>
    </Card>

    <Catalogo canEdit={canEdit} canBiblioteca={canBiblioteca} onAdicionado={onAlterado} />

    <Dialog open={manual} onOpenChange={(aberto) => { if (!salvando) setManual(aberto); }}>
      <DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Cadastrar produto</DialogTitle><DialogDescription>Material ou serviço que a empresa compra. O custo de referência serve para comparar as cotações.</DialogDescription></DialogHeader>
        <form onSubmit={(e) => void cadastrar(e)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <CampoTexto id="produto-nome" name="nome" label="Nome" required minLength={2} maxLength={200} placeholder="Porcelanato 80×80 retificado" />
            <CampoTexto id="produto-codigo" name="codigo" label="Código interno" maxLength={40} />
            <CampoTexto id="produto-categoria" name="categoria" label="Categoria" maxLength={80} placeholder="Revestimento" />
            <CampoTexto id="produto-unidade" name="unidade" label="Unidade" maxLength={16} placeholder="m²" required defaultValue="un" />
            <CampoTexto id="produto-marca" name="marca" label="Marca ou linha" maxLength={80} />
            <CampoTexto id="produto-custo" name="custo" label="Custo de referência (R$)" inputMode="decimal" placeholder="0,00" />
          </div>
          <CampoArea id="produto-especificacao" name="especificacao" label="Especificação" maxLength={1000} />
          <Button type="submit" className="w-full" disabled={salvando}>{salvando ? <LoaderCircle className="animate-spin" /> : <Check />}Cadastrar produto</Button>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog open={historico !== null} onOpenChange={(aberto) => { if (!aberto) setHistorico(null); }}>
      <DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>{historico?.produto.name}</DialogTitle><DialogDescription>Preços que os fornecedores deram nos pedidos da empresa, do mais recente ao mais antigo.</DialogDescription></DialogHeader>
        {!historico?.linhas ? <p className="py-6 text-center text-sm text-drap-500"><LoaderCircle className="mx-auto mb-2 animate-spin" />Carregando…</p> : <div className="max-h-[60svh] overflow-auto"><Table>
          <TableHeader><TableRow><TableHead>Fornecedor</TableHead><TableHead>Pedido</TableHead><TableHead className="text-right">Preço</TableHead><TableHead className="text-right">Entrega</TableHead></TableRow></TableHeader>
          <TableBody>{historico.linhas.map((h, i) => <TableRow key={i}><TableCell>{h.supplierName}{h.bought ? <Badge className="ml-2">Comprado</Badge> : null}</TableCell><TableCell>PC-{String(h.requestNumber).padStart(4, "0")} · {dataCurta(h.quotedAt)}</TableCell><TableCell className="text-right tabular-nums">{dinheiro(h.unitPriceCents)}</TableCell><TableCell className="text-right">{h.deliveryDays} dias</TableCell></TableRow>)}</TableBody>
        </Table></div>}
      </DialogContent>
    </Dialog>
  </div>;
}

type PaginaCatalogo = { items: ItemCatalogo[]; total: number; page: number; pageSize: number; emptyReason: string | null; goinfraTables: { id: string; label: string; totalItems: number }[] };

function Catalogo({ canEdit, canBiblioteca, onAdicionado }: { canEdit: boolean; canBiblioteca: boolean; onAdicionado: () => Promise<void> }) {
  const [fonte, setFonte] = useState("padrao");
  const [termo, setTermo] = useState("");
  const [tabela, setTabela] = useState("");
  const [uf, setUf] = useState("GO");
  const [resultado, setResultado] = useState<PaginaCatalogo | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState("");
  const [adicionando, setAdicionando] = useState<string | null>(null);
  // Só a resposta do pedido mais recente vale: trocar de aba rápido não pode deixar a lista
  // da aba anterior na tela.
  const pedidoAtual = useRef(0);
  const [carregado, setCarregado] = useState<{ fonte: string; termo: string; tabela: string; uf: string } | null>(null);

  const carregar = useCallback(async (filtro: { fonte: string; termo: string; tabela: string; uf: string }, pagina = 1) => {
    const numero = ++pedidoAtual.current;
    setBuscando(true); setErro("");
    try {
      const params = new URLSearchParams({ fonte: filtro.fonte, q: filtro.termo.trim(), pagina: String(pagina) });
      if (filtro.fonte === "goinfra" && filtro.tabela) params.set("tabela", filtro.tabela);
      if (filtro.fonte === "sinapi") params.set("uf", filtro.uf);
      const pagina_ = await api<PaginaCatalogo>(`/api/compras/catalogo?${params}`);
      if (numero !== pedidoAtual.current) return;
      setResultado((anterior) => pagina > 1 && anterior ? { ...pagina_, items: [...anterior.items, ...pagina_.items] } : pagina_);
      setCarregado(filtro);
    } catch (causa) { if (numero === pedidoAtual.current) setErro(mensagem(causa, "Não foi possível abrir o catálogo.")); }
    finally { if (numero === pedidoAtual.current) setBuscando(false); }
  }, []);

  // Abrir ou trocar de aba mostra a fonte inteira; a busca só filtra.
  useEffect(() => {
    const t = window.setTimeout(() => { void carregar({ fonte, termo: "", tabela, uf }); }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a busca digitada não recarrega sozinha; só a aba e os filtros
  }, [fonte, tabela, carregar]);

  function buscar(event?: FormEvent) {
    event?.preventDefault();
    void carregar({ fonte, termo, tabela, uf });
  }

  async function adicionar(item: ItemCatalogo) {
    setAdicionando(item.reference);
    try {
      const r = await api<{ existing?: boolean }>("/api/compras/produtos", { method: "POST", body: JSON.stringify({ reference: item.reference }) });
      toast.success(r.existing ? "Este item já estava no cadastro" : "Produto adicionado ao cadastro"); await onAdicionado();
    } catch (causa) { toast.error(mensagem(causa, "Não foi possível adicionar o item.")); }
    finally { setAdicionando(null); }
  }

  return <Card className="min-w-0 xl:col-span-2">
    <CardHeader className="border-b py-3"><CardTitle className="text-sm font-semibold">Adicionar do catálogo</CardTitle><p className="mt-1 text-xs text-drap-500">{fonte === "padrao" ? "Materiais de mercado com a norma ABNT e a especificação a pedir. Sem preço: o custo vem da SINAPI, da GOINFRA ou da lista da loja." : fonte === "fornecedor" ? "Itens e preços das planilhas que os fornecedores enviaram, com a data da lista." : "Descrição, unidade e custo vêm da tabela oficial; o produto guarda de qual referência saiu."}</p></CardHeader>
    <CardContent className="space-y-3 p-4">
      <Tabs value={fonte} onValueChange={(valor) => { setFonte(valor); setTermo(""); setResultado(null); }}>
        <TabsList className="h-auto w-full flex-wrap"><TabsTrigger value="padrao">Materiais padrão</TabsTrigger><TabsTrigger value="fornecedor">Listas das lojas</TabsTrigger><TabsTrigger value="goinfra">GOINFRA</TabsTrigger><TabsTrigger value="sinapi">SINAPI</TabsTrigger>{canBiblioteca ? <TabsTrigger value="biblioteca">Biblioteca</TabsTrigger> : null}</TabsList>
      </Tabs>
      <form onSubmit={(e) => void buscar(e)} className="space-y-3">
        {fonte === "goinfra" && resultado?.goinfraTables.length ? <Escolha id="catalogo-tabela" label="Tabela" value={tabela} onChange={setTabela} options={[{ value: "", label: "Todas as tabelas importadas" }, ...resultado.goinfraTables.map((t) => ({ value: t.id, label: t.label }))]} /> : null}
        {fonte === "sinapi" ? <CampoTexto id="catalogo-uf" label="UF" value={uf} maxLength={2} onChange={(e) => setUf(e.target.value.toUpperCase())} ajuda="Depois de trocar a UF, use Buscar." /> : null}
        <div className="flex gap-2"><label htmlFor="catalogo-busca" className="sr-only">Buscar no catálogo</label><Input id="catalogo-busca" type="search" value={termo} onChange={(e) => { setTermo(e.target.value); if (!e.target.value) void carregar({ fonte, termo: "", tabela, uf }); }} placeholder={fonte === "padrao" ? "Ex.: cimento, vergalhão 10, NBR 7480" : "Ex.: cimento, 020001"} /><Button type="submit" disabled={buscando}>{buscando ? <LoaderCircle className="animate-spin" /> : <Search />}Buscar</Button></div>
      </form>
      {erro ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-drap-700"><span>{erro}</span><Button size="sm" variant="outline" onClick={() => buscar()}>Tentar novamente</Button></div> : null}
      {!resultado && buscando ? <p className="text-sm text-drap-500"><LoaderCircle className="mr-2 inline size-4 animate-spin" />Abrindo o catálogo…</p> : null}
      {resultado?.items.length ? <p className="text-xs text-drap-600" aria-live="polite">{resultado.items.length < resultado.total ? `Mostrando ${resultado.items.length.toLocaleString("pt-BR")} de ${resultado.total.toLocaleString("pt-BR")} itens` : `${resultado.total.toLocaleString("pt-BR")} ${resultado.total === 1 ? "item" : "itens"}`}{carregado?.termo.trim() ? ` para “${carregado.termo.trim()}”` : ""}</p> : null}
      {resultado ? !resultado.items.length ? <p className="text-sm text-drap-600">{resultado.emptyReason}</p> : <ul className="max-h-[36rem] divide-y divide-drap-100 overflow-y-auto rounded-md border border-drap-200">{resultado.items.map((item) => <li key={item.reference} className="flex items-start gap-3 p-3">
        <div className="min-w-0 flex-1"><p className="text-sm text-drap-900">{item.description}</p><p className="mt-0.5 text-xs text-drap-500">{[item.code, item.unit].filter(Boolean).join(" · ")} · <span className="tabular-nums">{item.unitCostCents === null ? "sem preço" : dinheiro(item.unitCostCents)}</span> · {item.label}</p>{item.specification ? <p className="mt-1 text-xs text-drap-600">{item.specification}</p> : null}</div>
        {canEdit ? <Button size="sm" variant="outline" disabled={adicionando !== null} onClick={() => void adicionar(item)} aria-label={`Adicionar ${item.description}`}>{adicionando === item.reference ? <LoaderCircle className="animate-spin" /> : <PackagePlus />}</Button> : null}
      </li>)}</ul> : null}
      {resultado && resultado.items.length < resultado.total ? <Button variant="outline" className="w-full" disabled={buscando} onClick={() => carregado && void carregar(carregado, resultado.page + 1)}>{buscando ? <LoaderCircle className="animate-spin" /> : null}Mostrar mais {Math.min(resultado.pageSize, resultado.total - resultado.items.length).toLocaleString("pt-BR")}</Button> : null}
    </CardContent>
  </Card>;
}
