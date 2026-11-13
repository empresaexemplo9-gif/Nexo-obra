"use client";

import { FormEvent, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, CircleAlert, LoaderCircle, Mail, Phone, ShoppingCart, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, CampoArea, CampoTexto, dataCurta, dinheiro, Escolha, lerCentavos, lerQuantidade, mensagem, numero, type Produto, type Projeto } from "@/components/compras/comum";

export type Sugestao = { supplierId: string; name: string; phone: string; email: string; reason: string; lastPriceCents: number | null; deliveryDays: number | null; onTime: number; delivered: number };
export type ItemAtencao = {
  key: string; kind: "falta" | "abaixo" | "sem_previsao" | "atrasada"; title: string; detail: string; locationName: string;
  productId: string | null; location: string | null; requestId: string | null; requestCode: string | null; suggestions: Sugestao[];
  suggestedQuantity: number | null; unit: string | null;
};
type Saldo = { productId: string; productName: string; unit: string; category: string; location: string; locationName: string; balance: number; minimum: number | null; lastMovementOn: string | null; state: "falta" | "abaixo" | "zerado" | "ok" };
type Movimento = { id: string; productName: string; unit: string; locationName: string; kind: "entrada" | "baixa"; quantity: number; unitCostCents: number | null; source: string; requestId: string | null; requestCode: string | null; note: string; occurredOn: string; authorName: string };
export type DadosEstoque = { balances: Saldo[]; attention: ItemAtencao[]; movements: Movimento[] };

const rotuloAtencao: Record<ItemAtencao["kind"], string> = { falta: "Em falta", abaixo: "Abaixo do mínimo", sem_previsao: "Sem previsão de entrega", atrasada: "Entrega atrasada" };
const rotuloSaldo: Record<Saldo["state"], string> = { falta: "Em falta", abaixo: "Abaixo do mínimo", zerado: "Zerado", ok: "Ok" };

/** Lista curta de quem mais pode fornecer, com contato direto. */
export function OutrosFornecedores({ sugestoes, vazio }: { sugestoes: Sugestao[]; vazio: string }) {
  if (!sugestoes.length) return <p className="text-xs text-drap-500">{vazio}</p>;
  return <ul className="space-y-2">{sugestoes.map((s) => <li key={s.supplierId} className="rounded-md border border-drap-100 bg-drap-50/60 p-2 text-sm">
    <p className="font-medium text-drap-900">{s.name}</p>
    <p className="text-xs text-drap-600">{s.reason}{s.delivered ? ` · ${s.onTime} de ${s.delivered} entregas no prazo` : ""}</p>
    <div className="mt-1 flex flex-wrap gap-x-3 text-xs">{s.phone ? <a className="inline-flex items-center gap-1 text-drap-700 underline-offset-2 hover:underline" href={`tel:${s.phone.replace(/[^\d+]/g, "")}`}><Phone className="size-3" />{s.phone}</a> : null}{s.email ? <a className="inline-flex items-center gap-1 text-drap-700 underline-offset-2 hover:underline" href={`mailto:${s.email}`}><Mail className="size-3" />{s.email}</a> : null}</div>
  </li>)}</ul>;
}

export function Estoque({ dados, produtos, projetos, canEdit, busca, onAlterado, onAbrirPedido, onComprar }: {
  dados: DadosEstoque; produtos: Produto[]; projetos: Projeto[]; canEdit: boolean; busca: string;
  onAlterado: () => Promise<void>; onAbrirPedido: (id: string) => void;
  onComprar: (inicial: { productId: string; quantity: number; location: string }) => void;
}) {
  const [local, setLocal] = useState("");
  const [movimento, setMovimento] = useState<{ kind: "entrada" | "baixa"; productId?: string; location?: string } | null>(null);
  const [ajuste, setAjuste] = useState<{ productId?: string; location?: string; minimum?: number | null } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [chave, setChave] = useState(() => crypto.randomUUID());
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const locais = [{ value: "central", label: "Depósito central" }, ...projetos.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))];
  const saldos = dados.balances.filter((b) => (!local || b.location === local) && (!termo || `${b.productName} ${b.category}`.toLocaleLowerCase("pt-BR").includes(termo)));

  async function registrar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!movimento || salvando) return;
    const d = new FormData(event.currentTarget);
    const quantity = lerQuantidade(String(d.get("quantidade") ?? ""));
    if (quantity === null) { toast.error("Informe a quantidade, maior que zero."); return; }
    const custo = movimento.kind === "entrada" ? lerCentavos(String(d.get("custo") ?? ""), null) : null;
    if (movimento.kind === "entrada" && String(d.get("custo") ?? "").trim() && custo === null) { toast.error("Custo em reais, por exemplo 32,90."); return; }
    setSalvando(true);
    try {
      // A mesma chave acompanha o formulário até dar certo: reenviar depois de falha de
      // rede não lança o movimento duas vezes.
      await api("/api/compras/estoque/movimentos", { method: "POST", body: JSON.stringify({
        clientKey: chave, kind: movimento.kind, productId: String(d.get("produto") ?? ""), location: String(d.get("local") ?? "central"),
        quantity, unitCostCents: custo, occurredOn: String(d.get("data") || "") || undefined, note: String(d.get("nota") ?? ""),
      }) });
      toast.success(movimento.kind === "entrada" ? "Entrada registrada" : "Baixa registrada");
      setMovimento(null); setChave(crypto.randomUUID()); await onAlterado();
    } catch (causa) { toast.error(mensagem(causa, "Não foi possível registrar o movimento.")); }
    finally { setSalvando(false); }
  }

  async function salvarMinimo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (salvando) return;
    const d = new FormData(event.currentTarget);
    const texto = String(d.get("minimo") ?? "").trim();
    const valor = texto ? lerQuantidade(texto) : 0;
    if (texto && valor === null && texto !== "0") { toast.error("Informe o mínimo como número."); return; }
    setSalvando(true);
    try {
      await api("/api/compras/estoque/minimos", { method: "PUT", body: JSON.stringify({ productId: String(d.get("produto") ?? ""), location: String(d.get("local") ?? "central"), minimum: valor ?? 0 }) });
      toast.success("Estoque mínimo salvo"); setAjuste(null); await onAlterado();
    } catch (causa) { toast.error(mensagem(causa, "Não foi possível salvar o mínimo.")); }
    finally { setSalvando(false); }
  }

  const saldoEscolhido = (productId?: string, location?: string) => dados.balances.find((b) => b.productId === productId && b.location === (location ?? "central"));

  return <div className="space-y-5">
    <section aria-label="Atenção">
      <div className="mb-2 flex items-center gap-2"><CircleAlert className="size-4 text-destructive" /><h2 className="text-sm font-semibold text-drap-800">Atenção · {dados.attention.length}</h2></div>
      {!dados.attention.length ? <Card className="p-4 text-sm text-drap-600">Nenhum material em falta e nenhuma compra sem previsão. Defina o estoque mínimo dos materiais críticos para a plataforma avisar antes de faltar.</Card>
        : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{dados.attention.map((a) => <Card key={a.key} className="border-destructive/40 p-4">
          <div className="flex flex-wrap items-center gap-2"><Badge variant={a.kind === "abaixo" ? "outline" : "destructive"}>{rotuloAtencao[a.kind]}</Badge><span className="text-xs text-drap-500">{a.locationName}</span></div>
          <p className="mt-2 font-medium text-drap-950">{a.title}</p>
          <p className="mt-1 text-sm text-drap-600">{a.detail}</p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-drap-600">Outros fornecedores possíveis</p>
          <div className="mt-1"><OutrosFornecedores sugestoes={a.suggestions} vazio="Nenhum outro fornecedor cotou este material nem declara essa categoria. Cadastre mais fornecedores com o que eles fornecem." /></div>
          <div className="mt-3 flex flex-wrap gap-2">
            {a.requestId ? <Button size="sm" variant="outline" onClick={() => onAbrirPedido(a.requestId!)}>Abrir {a.requestCode}</Button> : null}
            {canEdit && !a.requestId && a.productId && a.location ? <Button size="sm" onClick={() => onComprar({ productId: a.productId!, quantity: a.suggestedQuantity || 1, location: a.location! })}><ShoppingCart />Pedir compra</Button> : null}
          </div>
        </Card>)}</div>}
    </section>

    <Card>
      <CardHeader className="flex flex-col gap-3 border-b py-3 lg:flex-row lg:items-end lg:justify-between">
        <CardTitle className="text-sm font-semibold">Saldo por local</CardTitle>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="sm:w-64"><Escolha id="estoque-local" label="Local" value={local} onChange={setLocal} options={[{ value: "", label: "Todos os locais" }, ...locais]} /></div>
          {canEdit ? <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!produtos.length} onClick={() => setMovimento({ kind: "entrada", location: local || undefined })}><ArrowDownToLine />Entrada</Button>
            <Button size="sm" variant="outline" disabled={!dados.balances.some((b) => b.balance > 0)} onClick={() => setMovimento({ kind: "baixa", location: local || undefined })}><ArrowUpFromLine />Baixa</Button>
            <Button size="sm" variant="ghost" disabled={!produtos.length} onClick={() => setAjuste({ location: local || undefined })}><SlidersHorizontal />Mínimo</Button>
          </div> : null}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {!produtos.length ? <p className="p-6 text-sm text-drap-500">Cadastre os produtos na aba Parâmetros. Só material cadastrado entra no estoque.</p>
          : !saldos.length ? <p className="p-6 text-sm text-drap-500">{dados.balances.length ? "Nada neste filtro." : "Nenhum movimento ainda. O recebimento de compras com produto cadastrado entra aqui sozinho; use Entrada para o que já está na obra."}</p>
          : <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead>Material</TableHead><TableHead>Local</TableHead><TableHead className="text-right">Saldo</TableHead><TableHead className="text-right">Mínimo</TableHead><TableHead>Situação</TableHead>{canEdit ? <TableHead><span className="sr-only">Ações</span></TableHead> : null}</TableRow></TableHeader>
            <TableBody>{saldos.map((s) => <TableRow key={`${s.productId}|${s.location}`}>
              <TableCell className="whitespace-normal"><span className="block font-medium text-drap-900">{s.productName}</span><span className="text-xs text-drap-500">{s.category}{s.lastMovementOn ? ` · último movimento ${dataCurta(s.lastMovementOn)}` : ""}</span></TableCell>
              <TableCell className="whitespace-normal text-sm">{s.locationName}</TableCell>
              <TableCell className="text-right tabular-nums font-medium">{numero(s.balance)} {s.unit}</TableCell>
              <TableCell className="text-right tabular-nums text-drap-600">{s.minimum ? `${numero(s.minimum)} ${s.unit}` : "—"}</TableCell>
              <TableCell>{s.state === "ok" ? <span className="text-xs text-drap-500">Ok</span> : <Badge variant={s.state === "abaixo" || s.state === "zerado" ? "outline" : "destructive"}>{rotuloSaldo[s.state]}</Badge>}</TableCell>
              {canEdit ? <TableCell><div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" aria-label={`Entrada de ${s.productName} em ${s.locationName}`} onClick={() => setMovimento({ kind: "entrada", productId: s.productId, location: s.location })}><ArrowDownToLine /></Button>
                <Button size="sm" variant="ghost" aria-label={`Baixa de ${s.productName} em ${s.locationName}`} disabled={s.balance <= 0} onClick={() => setMovimento({ kind: "baixa", productId: s.productId, location: s.location })}><ArrowUpFromLine /></Button>
                <Button size="sm" variant="ghost" aria-label={`Estoque mínimo de ${s.productName} em ${s.locationName}`} onClick={() => setAjuste({ productId: s.productId, location: s.location, minimum: s.minimum })}><SlidersHorizontal /></Button>
              </div></TableCell> : null}
            </TableRow>)}</TableBody>
          </Table></div>}
      </CardContent>
    </Card>

    <Card>
      <CardHeader className="border-b py-3"><CardTitle className="text-sm font-semibold">Últimos movimentos</CardTitle></CardHeader>
      <CardContent className="p-0">{!dados.movements.length ? <p className="p-6 text-sm text-drap-500">Nenhum movimento registrado.</p> : <div className="max-h-[28rem] overflow-auto"><Table>
        <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Material</TableHead><TableHead>Local</TableHead><TableHead className="text-right">Quantidade</TableHead><TableHead>Origem</TableHead></TableRow></TableHeader>
        <TableBody>{dados.movements.filter((m) => !termo || m.productName.toLocaleLowerCase("pt-BR").includes(termo)).map((m) => <TableRow key={m.id}>
          <TableCell className="whitespace-nowrap">{dataCurta(m.occurredOn)}</TableCell>
          <TableCell className="whitespace-normal">{m.productName}</TableCell>
          <TableCell className="whitespace-normal text-sm">{m.locationName}</TableCell>
          <TableCell className={`text-right tabular-nums ${m.kind === "baixa" ? "text-drap-700" : "font-medium text-drap-950"}`}>{m.kind === "entrada" ? "+" : "−"}{numero(Math.abs(m.quantity))} {m.unit}{m.unitCostCents !== null ? <span className="block text-xs text-drap-500">{dinheiro(m.unitCostCents)}/{m.unit}</span> : null}</TableCell>
          <TableCell className="whitespace-normal text-xs text-drap-600">{m.requestId ? <button type="button" className="underline underline-offset-2" onClick={() => onAbrirPedido(m.requestId!)}>{m.requestCode}</button> : m.kind === "entrada" ? "Entrada manual" : "Baixa"}{m.note ? ` · ${m.note}` : ""}<span className="block text-drap-500">{m.authorName}</span></TableCell>
        </TableRow>)}</TableBody>
      </Table></div>}</CardContent>
    </Card>

    <Dialog open={movimento !== null} onOpenChange={(aberto) => { if (!aberto && !salvando) setMovimento(null); }}>
      <DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>{movimento?.kind === "baixa" ? "Baixa de material" : "Entrada de material"}</DialogTitle><DialogDescription>{movimento?.kind === "baixa" ? "Material aplicado na obra, perdido ou devolvido. A baixa não passa do saldo do local." : "Material que chegou fora de um pedido de compra: sobra de outra obra, compra no balcão, doação. Recebimento de pedido entra sozinho."}</DialogDescription></DialogHeader>
        {movimento ? <form key={`${movimento.kind}-${movimento.productId}-${movimento.location}`} onSubmit={(e) => void registrar(e)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Escolha id="movimento-produto" name="produto" label="Material" defaultValue={movimento.productId ?? ""} required options={[{ value: "", label: "Escolha o material…" }, ...produtos.map((p) => ({ value: p.id, label: `${p.name} (${p.unit})` }))]} />
            <Escolha id="movimento-local" name="local" label="Local" defaultValue={movimento.location ?? "central"} options={locais} />
            <CampoTexto id="movimento-quantidade" name="quantidade" label="Quantidade" inputMode="decimal" required ajuda={movimento.kind === "baixa" && movimento.productId ? `Saldo: ${numero(saldoEscolhido(movimento.productId, movimento.location)?.balance ?? 0)} ${saldoEscolhido(movimento.productId, movimento.location)?.unit ?? ""}` : undefined} />
            {movimento.kind === "entrada" ? <CampoTexto id="movimento-custo" name="custo" label="Custo unitário (R$)" inputMode="decimal" placeholder="opcional" /> : null}
            <CampoTexto id="movimento-data" name="data" label="Data" type="date" />
          </div>
          <CampoArea id="movimento-nota" name="nota" label={movimento.kind === "baixa" ? "Para onde foi (serviço, frente ou motivo)" : "Observação"} required={movimento.kind === "baixa"} minLength={movimento.kind === "baixa" ? 3 : undefined} maxLength={500} />
          <Button type="submit" className="w-full" disabled={salvando}>{salvando ? <LoaderCircle className="animate-spin" /> : movimento.kind === "baixa" ? <ArrowUpFromLine /> : <ArrowDownToLine />}{movimento.kind === "baixa" ? "Registrar baixa" : "Registrar entrada"}</Button>
        </form> : null}
      </DialogContent>
    </Dialog>

    <Dialog open={ajuste !== null} onOpenChange={(aberto) => { if (!aberto && !salvando) setAjuste(null); }}>
      <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Estoque mínimo</DialogTitle><DialogDescription>Abaixo deste saldo o material entra em Atenção e nos lembretes do dia. Zero desliga o aviso.</DialogDescription></DialogHeader>
        {ajuste ? <form key={`${ajuste.productId}-${ajuste.location}`} onSubmit={(e) => void salvarMinimo(e)} className="space-y-4">
          <Escolha id="minimo-produto" name="produto" label="Material" defaultValue={ajuste.productId ?? ""} required options={[{ value: "", label: "Escolha o material…" }, ...produtos.map((p) => ({ value: p.id, label: `${p.name} (${p.unit})` }))]} />
          <Escolha id="minimo-local" name="local" label="Local" defaultValue={ajuste.location ?? "central"} options={locais} />
          <CampoTexto id="minimo-valor" name="minimo" label="Mínimo" inputMode="decimal" defaultValue={ajuste.minimum ? numero(ajuste.minimum) : ""} />
          <Button type="submit" className="w-full" disabled={salvando}>{salvando ? <LoaderCircle className="animate-spin" /> : <SlidersHorizontal />}Salvar mínimo</Button>
        </form> : null}
      </DialogContent>
    </Dialog>
  </div>;
}
