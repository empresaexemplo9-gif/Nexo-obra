"use client";

import { FormEvent, useState } from "react";
import { Check, History, LoaderCircle, PackagePlus, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, CampoArea, CampoTexto, classeCabecalhoFixo, Coluna, dataCurta, dinheiro, Escolha, Filtros, lerCentavos, mensagem, SeloVariacao, useOrdenacao, variacao, type Produto } from "@/components/compras/comum";

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
  const [origem, setOrigem] = useState("todas");
  const buscados = produtos.filter((p) => !termo || `${p.name} ${p.code} ${p.category} ${p.brand}`.toLocaleLowerCase("pt-BR").includes(termo));
  const fontes = [...new Set(produtos.map((p) => p.source))];
  const visiveis = buscados.filter((p) => origem === "todas" || (origem === "sem-preco" ? p.referenceCostCents === null && p.lastQuotedCents === null : p.source === origem));
  const { ordenadas, ordem, alternar } = useOrdenacao(visiveis, {
    nome: (p) => p.name, categoria: (p) => p.category, unidade: (p) => p.unit, origem: (p) => rotuloFonte[p.source] ?? p.source,
    referencia: (p) => p.referenceCostCents, cotacao: (p) => p.lastQuotedCents, variacao: (p) => variacao(p.lastQuotedCents, p.referenceCostCents),
  }, { coluna: "nome", direcao: "asc" });

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
          : <>
            {fontes.length > 1 || produtos.some((p) => p.referenceCostCents === null && p.lastQuotedCents === null) ? <div className="border-b border-drap-100 px-4 py-2"><Filtros rotulo="Origem do produto" valor={origem} onChange={setOrigem} opcoes={[
              { value: "todas", label: "Todos", total: buscados.length },
              ...fontes.map((f) => ({ value: f, label: rotuloFonte[f] ?? f, total: buscados.filter((p) => p.source === f).length })),
              { value: "sem-preco", label: "Sem preço", total: buscados.filter((p) => p.referenceCostCents === null && p.lastQuotedCents === null).length },
            ]} /></div> : null}
            {!visiveis.length ? <p className="p-6 text-sm text-drap-500">Nenhum produto neste filtro ou busca.</p> : <div className={classeCabecalhoFixo}><Table>
            <TableHeader><TableRow>
              <Coluna coluna="nome" ordem={ordem} alternar={alternar} className="min-w-48">Produto</Coluna>
              <Coluna coluna="categoria" ordem={ordem} alternar={alternar} className="hidden 2xl:table-cell">Categoria</Coluna>
              <Coluna coluna="unidade" ordem={ordem} alternar={alternar}>Unid.</Coluna>
              <Coluna coluna="origem" ordem={ordem} alternar={alternar} className="hidden lg:table-cell">Origem</Coluna>
              <Coluna coluna="referencia" ordem={ordem} alternar={alternar} direita>Referência</Coluna>
              <Coluna coluna="cotacao" ordem={ordem} alternar={alternar} direita>Última cotação</Coluna>
              <TableHead className="w-10"><span className="sr-only">Histórico</span></TableHead>
            </TableRow></TableHeader>
            <TableBody>{ordenadas.map((p) => <TableRow key={p.id}>
              <TableCell className="whitespace-normal"><span className="block font-medium text-drap-900">{p.name}</span><span className="text-xs text-drap-500">{[p.code, p.brand].filter(Boolean).join(" · ")}<span className="2xl:hidden">{p.code || p.brand ? " · " : ""}{p.category}</span></span>{p.specification ? <span className="mt-0.5 line-clamp-2 block text-xs text-drap-600" title={p.specification}>{p.specification}</span> : null}</TableCell>
              <TableCell className="hidden whitespace-normal text-sm text-drap-700 2xl:table-cell">{p.category}</TableCell>
              <TableCell className="text-sm">{p.unit}</TableCell>
              <TableCell className="hidden lg:table-cell"><Badge variant="outline">{rotuloFonte[p.source] ?? p.source}</Badge></TableCell>
              <TableCell className="text-right tabular-nums" title={p.referenceLabel || undefined}>{dinheiro(p.referenceCostCents)}{p.referenceLabel ? <span className="block max-w-48 truncate text-xs text-drap-500 ml-auto">{p.referenceLabel}</span> : null}</TableCell>
              <TableCell className="text-right tabular-nums">{dinheiro(p.lastQuotedCents)}<SeloVariacao valor={variacao(p.lastQuotedCents, p.referenceCostCents)} />{p.quoteCount ? <span className="block text-xs text-drap-500">{p.quoteCount} {p.quoteCount === 1 ? "cotação" : "cotações"}</span> : null}</TableCell>
              <TableCell><Button size="icon" variant="ghost" aria-label={`Preços cotados de ${p.name}`} disabled={!p.quoteCount} onClick={() => void abrirHistorico(p)}><History /></Button></TableCell>
            </TableRow>)}</TableBody>
          </Table></div>}
          </>}
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
        {!historico?.linhas ? <p className="py-6 text-center text-sm text-drap-500"><LoaderCircle className="mx-auto mb-2 animate-spin" />Carregando…</p> : <TabelaHistorico linhas={historico.linhas} referencia={historico.produto.referenceCostCents} />}
      </DialogContent>
    </Dialog>
  </div>;
}

function TabelaHistorico({ linhas, referencia }: { linhas: Historico[]; referencia: number | null }) {
  const { ordenadas, ordem, alternar } = useOrdenacao(linhas, {
    fornecedor: (h) => h.supplierName, data: (h) => h.quotedAt, preco: (h) => h.unitPriceCents, entrega: (h) => h.deliveryDays,
  }, { coluna: "data", direcao: "desc" });
  if (!linhas.length) return <p className="py-6 text-center text-sm text-drap-500">Nenhuma cotação com este produto.</p>;
  const precos = linhas.map((h) => h.unitPriceCents);
  const menor = Math.min(...precos);
  return <>
    <p className="text-sm text-drap-600">Menor <strong className="tabular-nums text-drap-900">{dinheiro(menor)}</strong> · maior <strong className="tabular-nums text-drap-900">{dinheiro(Math.max(...precos))}</strong> · média <strong className="tabular-nums text-drap-900">{dinheiro(Math.round(precos.reduce((a, b) => a + b, 0) / precos.length))}</strong>{referencia ? <> · referência <strong className="tabular-nums text-drap-900">{dinheiro(referencia)}</strong></> : null}</p>
    <div className={classeCabecalhoFixo.replace("max-h-[36rem]", "max-h-[55svh]")}><Table>
      <TableHeader><TableRow>
        <Coluna coluna="fornecedor" ordem={ordem} alternar={alternar}>Fornecedor</Coluna>
        <Coluna coluna="data" ordem={ordem} alternar={alternar}>Pedido</Coluna>
        <Coluna coluna="preco" ordem={ordem} alternar={alternar} direita>Preço</Coluna>
        <Coluna coluna="entrega" ordem={ordem} alternar={alternar} direita>Entrega</Coluna>
      </TableRow></TableHeader>
      <TableBody>{ordenadas.map((h, i) => <TableRow key={i}>
        <TableCell className="whitespace-normal">{h.supplierName}{h.bought ? <Badge className="ml-2">Comprado</Badge> : null}</TableCell>
        <TableCell>PC-{String(h.requestNumber).padStart(4, "0")} · {dataCurta(h.quotedAt)}</TableCell>
        <TableCell className={`text-right tabular-nums ${h.unitPriceCents === menor ? "font-semibold text-drap-950" : ""}`}>{dinheiro(h.unitPriceCents)}<SeloVariacao valor={variacao(h.unitPriceCents, referencia)} /></TableCell>
        <TableCell className="text-right">{h.deliveryDays} {h.deliveryDays === 1 ? "dia" : "dias"}</TableCell>
      </TableRow>)}</TableBody>
    </Table></div>
  </>;
}

function Catalogo({ canEdit, canBiblioteca, onAdicionado }: { canEdit: boolean; canBiblioteca: boolean; onAdicionado: () => Promise<void> }) {
  const [fonte, setFonte] = useState("padrao");
  const [termo, setTermo] = useState("");
  const [tabela, setTabela] = useState("");
  const [uf, setUf] = useState("GO");
  const [resultado, setResultado] = useState<{ items: ItemCatalogo[]; emptyReason: string | null; goinfraTables: { id: string; label: string; totalItems: number }[] } | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [adicionando, setAdicionando] = useState<string | null>(null);

  async function buscar(event?: FormEvent) {
    event?.preventDefault();
    if (termo.trim().length < 2) { toast.error("Digite pelo menos 2 letras ou o código."); return; }
    setBuscando(true);
    try {
      const params = new URLSearchParams({ fonte, q: termo.trim() });
      if (fonte === "goinfra" && tabela) params.set("tabela", tabela);
      if (fonte === "sinapi") params.set("uf", uf);
      setResultado(await api(`/api/compras/catalogo?${params}`));
    } catch (causa) { toast.error(mensagem(causa, "Não foi possível buscar no catálogo.")); }
    finally { setBuscando(false); }
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
      <Tabs value={fonte} onValueChange={(valor) => { setFonte(valor); setResultado(null); }}>
        <TabsList className="h-auto w-full flex-wrap"><TabsTrigger value="padrao">Materiais padrão</TabsTrigger><TabsTrigger value="fornecedor">Listas das lojas</TabsTrigger><TabsTrigger value="goinfra">GOINFRA</TabsTrigger><TabsTrigger value="sinapi">SINAPI</TabsTrigger>{canBiblioteca ? <TabsTrigger value="biblioteca">Biblioteca</TabsTrigger> : null}</TabsList>
      </Tabs>
      <form onSubmit={(e) => void buscar(e)} className="space-y-3">
        {fonte === "goinfra" && resultado?.goinfraTables.length ? <Escolha id="catalogo-tabela" label="Tabela" value={tabela} onChange={setTabela} options={[{ value: "", label: "Todas as tabelas importadas" }, ...resultado.goinfraTables.map((t) => ({ value: t.id, label: t.label }))]} /> : null}
        {fonte === "sinapi" ? <CampoTexto id="catalogo-uf" label="UF" value={uf} maxLength={2} onChange={(e) => setUf(e.target.value.toUpperCase())} /> : null}
        <div className="flex gap-2"><label htmlFor="catalogo-busca" className="sr-only">Buscar no catálogo</label><Input id="catalogo-busca" value={termo} onChange={(e) => setTermo(e.target.value)} placeholder={fonte === "padrao" ? "Ex.: cimento, vergalhão 10, NBR 7480" : "Ex.: cimento, 020001"} /><Button type="submit" disabled={buscando}>{buscando ? <LoaderCircle className="animate-spin" /> : <Search />}Buscar</Button></div>
      </form>
      {resultado ? !resultado.items.length ? <p className="text-sm text-drap-600">{resultado.emptyReason}</p> : <ResultadoCatalogo itens={resultado.items} canEdit={canEdit} adicionando={adicionando} onAdicionar={(item) => void adicionar(item)} /> : null}
    </CardContent>
  </Card>;
}

function ResultadoCatalogo({ itens, canEdit, adicionando, onAdicionar }: { itens: ItemCatalogo[]; canEdit: boolean; adicionando: string | null; onAdicionar: (item: ItemCatalogo) => void }) {
  const { ordenadas, ordem, alternar } = useOrdenacao(itens, {
    descricao: (i) => i.description, codigo: (i) => i.code, preco: (i) => i.unitCostCents,
  }, { coluna: "descricao", direcao: "asc" });
  return <div className="rounded-md border border-drap-200">
    <p className="border-b border-drap-100 px-3 py-2 text-xs text-drap-500">{itens.length.toLocaleString("pt-BR")} {itens.length === 1 ? "resultado" : "resultados"}</p>
    <div className={classeCabecalhoFixo.replace("max-h-[36rem]", "max-h-[32rem]")}><Table>
      <TableHeader><TableRow>
        <Coluna coluna="descricao" ordem={ordem} alternar={alternar}>Item</Coluna>
        <Coluna coluna="codigo" ordem={ordem} alternar={alternar} className="hidden sm:table-cell">Código</Coluna>
        <Coluna coluna="preco" ordem={ordem} alternar={alternar} direita>Custo</Coluna>
        {canEdit ? <TableHead className="w-10"><span className="sr-only">Adicionar</span></TableHead> : null}
      </TableRow></TableHeader>
      <TableBody>{ordenadas.map((item) => <TableRow key={item.reference}>
        <TableCell className="whitespace-normal"><span className="block text-sm text-drap-900">{item.description}</span><span className="text-xs text-drap-500"><span className="sm:hidden">{item.code ? `${item.code} · ` : ""}</span>{item.label}</span>{item.specification ? <span className="mt-1 block text-xs text-drap-600">{item.specification}</span> : null}</TableCell>
        <TableCell className="hidden text-xs text-drap-600 sm:table-cell">{item.code || "—"}</TableCell>
        <TableCell className="text-right tabular-nums">{item.unitCostCents === null ? <span className="text-xs text-drap-500">sem preço</span> : dinheiro(item.unitCostCents)}<span className="block text-xs text-drap-500">por {item.unit}</span></TableCell>
        {canEdit ? <TableCell><Button size="sm" variant="outline" disabled={adicionando !== null} onClick={() => onAdicionar(item)} aria-label={`Adicionar ${item.description}`}>{adicionando === item.reference ? <LoaderCircle className="animate-spin" /> : <PackagePlus />}</Button></TableCell> : null}
      </TableRow>)}</TableBody>
    </Table></div>
  </div>;
}
