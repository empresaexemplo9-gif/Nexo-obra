"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { CircleDollarSign, LoaderCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { camposDoCorpo, lerEnvelope, lerValorBrasileiro } from "@/lib/drap-envelope";

// Operação de lançamentos da Drap dentro da H.OIKOS.
//
// As rotas REST (/lancamentos, /parceiros, /categorias) já existiam completas no servidor
// e nenhuma tela as chamava — por isso a integração parecia não fazer nada. Esta é a porta
// de entrada delas.
//
// A credencial nunca chega aqui: o navegador fala com a própria H.OIKOS, que fala com a
// Drap usando a chave do tenant da empresa.

type Lancamento = { id: string; data?: string; descricao?: string; tipo?: string; valor?: number; status?: string };

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// A Drap documenta `data` como AAAA-MM-DD, mas pode devolver data-hora. Sem o corte, a
// concatenação vira string inválida e a célula mostra "Invalid Date".
function formatarData(valor?: string) {
  if (!valor) return "—";
  const dia = valor.slice(0, 10);
  const data = new Date(`${dia}T12:00:00`);
  return Number.isNaN(data.getTime()) ? valor : data.toLocaleDateString("pt-BR");
}

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const resposta = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (resposta.status === 204) return undefined as T;
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const detalhe = (corpo as { detail?: unknown }).detail;
    const base = (corpo as { error?: string }).error ?? "A Drap não concluiu a operação.";
    throw new Error(detalhe ? `${base} ${typeof detalhe === "string" ? detalhe : JSON.stringify(detalhe)}` : base);
  }
  return corpo as T;
}

// A leitura do envelope é a mesma do adaptador do servidor, extraída para `lib/drap-envelope`
// — módulo puro, sem credencial, que o componente cliente pode importar sem ferir a regra 4.
//
// Antes esta função duplicava a regra numa versão mais fraca: não cobria `data.items`
// aninhado nem `transactions`, que a Drap usa. A homologação contra a API real confirmou
// `{ items, total }`, e a lista de formas vem de respostas observadas, não de suposição.
export function extrairLista(corpo: unknown): { itens: Lancamento[]; total: number | null } | { erro: string } {
  const lido = lerEnvelope(corpo);
  if (lido) return { itens: lido.itens as Lancamento[], total: lido.total };
  const campos = camposDoCorpo(corpo);
  return { erro: `A Drap respondeu num formato não previsto. Campos recebidos: ${campos.join(", ") || "nenhum"}.` };
}

export function DrapLancamentos({ canEdit, habilitado, centroCusto, escopo }: { canEdit: boolean; habilitado: boolean; centroCusto?: string; escopo?: string }) {
  const [itens, setItens] = useState<Lancamento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [criando, setCriando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState("");
  const [total, setTotal] = useState<number | null>(null);
  // Uma chave por abertura do diálogo: duas tentativas do MESMO envio compartilham a
  // chave e a Drap devolve o mesmo registro; um envio novo abre o diálogo de novo e
  // recebe chave nova. Gerar por requisição não protegeria nada.
  const [chaveIdempotencia, setChaveIdempotencia] = useState("");

  const carregar = useCallback(async () => {
    // Sem conexão não há o que consultar, e a tela já devolve o cartão de "não conectada"
    // antes de olhar o carregamento — mexer em estado aqui só dispararia render à toa.
    if (!habilitado) return;
    setCarregando(true); setErro("");
    try {
      const filtro = centroCusto ? `&centro_custo=${encodeURIComponent(centroCusto)}` : "";
      const corpo = await pedir<unknown>(`/api/integrations/drap/lancamentos?limit=50${filtro}`);
      const lido = extrairLista(corpo);
      if ("erro" in lido) { setErro(lido.erro); setItens([]); return; }
      setItens(lido.itens);
      // A Drap declara o total; sem isso a tela mostraria 50 de mil como se fossem todos.
      setTotal(lido.total);
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : "Não foi possível consultar a Drap.");
      setItens([]);
    } finally { setCarregando(false); }
  }, [habilitado, centroCusto]);

  // Mesmo padrão do finance-workspace: adiar a primeira carga tira o setState síncrono
  // de dentro do efeito, que dispara renders em cascata.
  useEffect(() => { const timer = window.setTimeout(() => void carregar(), 0); return () => window.clearTimeout(timer); }, [carregar]);

  async function criar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const form = new FormData(evento.currentTarget);
    // `1.234,56` e `1234.56` convivem. Tirar o ponto sempre transformava 1500.50 em
    // 150050 — dinheiro errado gravado no financeiro oficial.
    const valor = lerValorBrasileiro(String(form.get("valor") ?? ""));
    if (valor === null || valor <= 0) { toast.error("Informe um valor maior que zero."); return; }
    setSalvando(true);
    try {
      await pedir("/api/integrations/drap/lancamentos", {
        method: "POST",
        // Escrita financeira é operação distribuída: um tempo esgotado numa requisição
        // que a Drap já efetivou leva a pessoa a tentar de novo e duplicar o lançamento.
        // A chave repetida deixa a segunda tentativa cair no mesmo registro.
        headers: { "Idempotency-Key": chaveIdempotencia },
        body: JSON.stringify({
          descricao: String(form.get("descricao") ?? "").trim(),
          tipo: String(form.get("tipo") ?? "receita"),
          valor,
          data: String(form.get("data") ?? ""),
          // Sem o centro de custo, o lançamento fica invisível no financeiro da obra —
          // é exatamente o defeito que o filtro por obra levou semanas para revelar.
          ...(centroCusto ? { centro_custo: centroCusto } : {}),
        }),
      });
      toast.success("Lançamento criado na Drap.");
      setCriando(false);
      await carregar();
    } catch (causa) {
      toast.error(causa instanceof Error ? causa.message : "A Drap recusou o lançamento.");
    } finally { setSalvando(false); }
  }

  async function excluir(id: string) {
    if (!window.confirm("Excluir este lançamento na Drap? A ação vale no sistema financeiro oficial.")) return;
    setExcluindo(id);
    try {
      await pedir(`/api/integrations/drap/lancamentos/${encodeURIComponent(id)}`, { method: "DELETE" });
      toast.success("Lançamento excluído na Drap.");
      await carregar();
    } catch (causa) {
      toast.error(causa instanceof Error ? causa.message : "A Drap não excluiu o lançamento.");
    } finally { setExcluindo(""); }
  }

  if (!habilitado) {
    return <Card><CardContent className="p-0"><Empty className="min-h-64 border-0"><EmptyHeader><EmptyMedia variant="icon"><CircleDollarSign /></EmptyMedia><EmptyTitle>Drap não conectada nesta empresa</EmptyTitle><EmptyDescription>Ligue a credencial da Drap para lançar receitas e despesas sem sair daqui.</EmptyDescription></EmptyHeader></Empty></CardContent></Card>;
  }

  return <>
    <Card className="overflow-hidden">
      <CardHeader className="border-b">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base">Lançamentos na Drap</CardTitle>
            <p className="mt-1 text-sm text-hoikos-500">Receitas e despesas gravadas direto no financeiro oficial. A credencial fica no servidor.{total !== null && total > itens.length ? ` Mostrando ${itens.length} de ${total}.` : ""}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void carregar()} disabled={carregando} aria-label="Atualizar"><RefreshCw className={carregando ? "animate-spin" : ""} />Atualizar</Button>
            {canEdit ? <Button size="sm" onClick={() => { setChaveIdempotencia(crypto.randomUUID()); setCriando(true); }}><Plus />Novo lançamento</Button> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {carregando ? <div className="grid min-h-64 place-items-center"><LoaderCircle className="animate-spin text-hoikos-600" /></div>
          : erro ? <div role="alert" className="m-5 rounded-md border border-hoikos-300 bg-hoikos-50 p-4 text-sm leading-6 text-hoikos-800"><p className="font-medium">A consulta à Drap não foi concluída.</p><p className="mt-1">{erro}</p></div>
          : itens.length ? <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow className="bg-hoikos-50"><TableHead className="pl-5">Descrição</TableHead><TableHead>Data</TableHead><TableHead>Situação</TableHead><TableHead className="text-right">Valor</TableHead>{canEdit ? <TableHead className="pr-5" /> : null}</TableRow></TableHeader>
              <TableBody>{itens.map((item) => <TableRow key={item.id}>
                <TableCell className="pl-5"><p className="font-medium">{item.descricao || "Sem descrição"}</p><p className="text-xs text-hoikos-500">{item.tipo === "despesa" ? "Despesa" : "Receita"}</p></TableCell>
                <TableCell>{formatarData(item.data)}</TableCell>
                <TableCell>{item.status ? <Badge variant="secondary">{item.status}</Badge> : "—"}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{item.tipo === "despesa" ? "−" : "+"}{moeda.format(Math.abs(Number(item.valor ?? 0)))}</TableCell>
                {canEdit ? <TableCell className="pr-5 text-right"><Button size="sm" variant="ghost" aria-label={`Excluir ${item.descricao ?? item.id}`} disabled={excluindo === item.id} onClick={() => void excluir(item.id)}>{excluindo === item.id ? <LoaderCircle className="animate-spin" /> : <Trash2 />}</Button></TableCell> : null}
              </TableRow>)}</TableBody>
            </Table></div>
          : <Empty className="min-h-64 border-0"><EmptyHeader><EmptyMedia variant="icon"><CircleDollarSign /></EmptyMedia><EmptyTitle>Nenhum lançamento na Drap</EmptyTitle><EmptyDescription>Quando existir receita ou despesa lançada, ela aparece aqui — sem cópia local.</EmptyDescription></EmptyHeader>{canEdit ? <Button onClick={() => { setChaveIdempotencia(crypto.randomUUID()); setCriando(true); }}><Plus />Criar o primeiro</Button> : null}</Empty>}
      </CardContent>
    </Card>

    <Dialog open={criando} onOpenChange={(aberto) => { if (!salvando) setCriando(aberto); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Novo lançamento</DialogTitle><DialogDescription>Grava direto na Drap. Não existe cópia local do valor.{escopo ? ` Centro de custo: ${escopo}.` : ""}</DialogDescription></DialogHeader>
        <form onSubmit={criar} className="space-y-4">
          <fieldset disabled={salvando} className="space-y-4">
            <div><label htmlFor="descricao" className="mb-1.5 block text-sm font-medium text-hoikos-700">Descrição</label><Input id="descricao" name="descricao" required maxLength={180} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label htmlFor="valor" className="mb-1.5 block text-sm font-medium text-hoikos-700">Valor</label><Input id="valor" name="valor" required inputMode="decimal" placeholder="1.500,00" /></div>
              <div><label htmlFor="data" className="mb-1.5 block text-sm font-medium text-hoikos-700">Data</label><Input id="data" name="data" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></div>
            </div>
            <div><label htmlFor="tipo" className="mb-1.5 block text-sm font-medium text-hoikos-700">Tipo</label>
              <select id="tipo" name="tipo" defaultValue="receita" className="h-9 w-full rounded-md border border-hoikos-200 bg-white px-3 text-sm outline-none focus:border-hoikos-500 focus:ring-2 focus:ring-hoikos-100">
                <option value="receita">Receita</option><option value="despesa">Despesa</option>
              </select>
            </div>
          </fieldset>
          <Button type="submit" className="w-full" disabled={salvando}>{salvando ? <LoaderCircle className="animate-spin" /> : <Plus />}Gravar na Drap</Button>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
