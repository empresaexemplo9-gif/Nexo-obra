"use client";

import { useMemo, useState } from "react";
import { ArrowRight, DraftingCompass, Sofa } from "lucide-react";

import type { AreaDemo } from "@/lib/demonstracao/areas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BDI_EXEMPLO, EMPRESA_EXEMPLO, etapasFunil, itensOrcamentoExemplo, oportunidadesExemplo, projetosExemplo, tarefasExemplo, totalDoOrcamento,
} from "@/lib/demonstracao/dados";

// Escritório fictício: mostra como o dia de trabalho aparece na plataforma. O visitante
// conclui tarefas, avança negócios no funil e muda o BDI do orçamento; cada mudança vale
// só nesta aba.

const reais = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const dia = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR");

export function PainelExemplo({ abrir }: { abrir: (area: AreaDemo) => void }) {
  const [tarefas, setTarefas] = useState(tarefasExemplo);
  const [oportunidades, setOportunidades] = useState(oportunidadesExemplo);
  const [bdi, setBdi] = useState(String(BDI_EXEMPLO));

  const abertas = tarefas.filter((tarefa) => !tarefa.feita);
  const atrasadas = abertas.filter((tarefa) => tarefa.atrasada).length;
  const emNegociacao = oportunidades.filter((item) => item.etapa !== "fechado");
  const fechado = oportunidades.filter((item) => item.etapa === "fechado").reduce((soma, item) => soma + item.valorCentavos, 0);
  const bdiValido = Math.min(100, Math.max(0, Number(bdi.replace(",", ".")) || 0));
  const orcamento = useMemo(() => totalDoOrcamento(itensOrcamentoExemplo, bdiValido), [bdiValido]);

  function avancar(id: string) {
    setOportunidades((lista) => lista.map((item) => {
      if (item.id !== id) return item;
      const indice = etapasFunil.findIndex((etapa) => etapa.id === item.etapa);
      return { ...item, etapa: etapasFunil[Math.min(indice + 1, etapasFunil.length - 1)].id };
    }));
  }

  // Página inteira: três faixas que usam a largura toda e se reorganizam em colunas.
  return <div className="space-y-5">
    <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
      <h2 className="display-heading text-3xl sm:text-4xl">{EMPRESA_EXEMPLO}</h2>
      <p className="text-sm leading-6 text-drap-500">Empresa, pessoas e valores inventados para a demonstração. Mexa à vontade: conclua tarefas, avance negócios e ajuste o orçamento.</p>
    </div>

    <dl className="grid gap-3 sm:grid-cols-3">
      {[
        { rotulo: "Tarefas abertas", valor: String(abertas.length), detalhe: atrasadas ? `${atrasadas} atrasada${atrasadas > 1 ? "s" : ""}` : "Nenhuma atrasada" },
        { rotulo: "Em negociação", valor: reais(emNegociacao.reduce((soma, item) => soma + item.valorCentavos, 0)), detalhe: `${emNegociacao.length} oportunidade${emNegociacao.length === 1 ? "" : "s"}` },
        { rotulo: "Fechado no teste", valor: reais(fechado), detalhe: "Avance um negócio até “Fechado”" },
      ].map((item) => <div key={item.rotulo} className="rounded-lg border border-drap-200 bg-white p-5">
        <dt className="text-sm text-drap-500">{item.rotulo}</dt>
        <dd className="metric-number mt-2 text-3xl">{item.valor}</dd>
        <dd className="mt-1 text-xs text-drap-500">{item.detalhe}</dd>
      </div>)}
    </dl>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <Card className="workspace-card">
        <CardHeader><CardTitle className="text-lg">O que fazer hoje</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y divide-drap-200">
            {tarefas.map((tarefa) => <li key={tarefa.id} className="flex items-start gap-3 py-3">
              <Checkbox id={`tarefa-${tarefa.id}`} checked={tarefa.feita} className="mt-1"
                onCheckedChange={(valor) => setTarefas((lista) => lista.map((item) => item.id === tarefa.id ? { ...item, feita: valor === true } : item))} />
              <label htmlFor={`tarefa-${tarefa.id}`} className="min-w-0 flex-1 cursor-pointer">
                <span className={`block text-sm font-medium ${tarefa.feita ? "text-drap-500 line-through" : ""}`}>{tarefa.titulo}</span>
                <span className="mt-0.5 block text-xs text-drap-500">{tarefa.projeto} · {tarefa.responsavel}</span>
              </label>
              {tarefa.feita ? <Badge variant="outline">Feita</Badge> : <Badge variant={tarefa.atrasada ? "destructive" : "outline"}>{tarefa.atrasada ? "Atrasada" : tarefa.prazo}</Badge>}
            </li>)}
          </ul>
        </CardContent>
      </Card>

      <Card className="workspace-card">
        <CardHeader><CardTitle className="text-lg">Funil de vendas</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
          {etapasFunil.map((etapa) => {
            const itens = oportunidades.filter((item) => item.etapa === etapa.id);
            return <section key={etapa.id} aria-label={etapa.nome}>
              <h3 className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-drap-500"><span>{etapa.nome}</span><span>{itens.length}</span></h3>
              {itens.length ? <ul className="mt-2 space-y-2">
                {itens.map((item) => <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-drap-200 bg-drap-50 p-3">
                  <div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.nome}</p><p className="text-xs text-drap-500">{item.contato} · {reais(item.valorCentavos)}</p></div>
                  {etapa.id !== "fechado" ? <Button size="sm" variant="outline" onClick={() => avancar(item.id)} aria-label={`Avançar ${item.nome}`}>Avançar<ArrowRight /></Button> : null}
                </li>)}
              </ul> : <p className="mt-2 text-xs text-drap-500">Nenhum negócio nesta etapa.</p>}
            </section>;
          })}
        </CardContent>
      </Card>
    </div>

    <div className="grid gap-5 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
    <Card className="overflow-hidden workspace-card">
      <CardHeader><CardTitle className="text-lg">Projetos e obras</CardTitle></CardHeader>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow className="bg-drap-50"><TableHead className="pl-6">Projeto</TableHead><TableHead>Etapa</TableHead><TableHead className="min-w-36">Avanço</TableHead><TableHead>Entrega</TableHead><TableHead className="text-right">Orçado</TableHead><TableHead className="pr-6 text-right">Realizado</TableHead></TableRow></TableHeader>
          <TableBody>
            {projetosExemplo.map((projeto) => <TableRow key={projeto.id}>
              <TableCell className="pl-6"><p className="font-medium">{projeto.nome}</p><p className="text-xs text-drap-500">{projeto.codigo} · {projeto.tipo} · {projeto.cliente}</p></TableCell>
              <TableCell>{projeto.etapa}</TableCell>
              <TableCell><div className="flex items-center gap-2"><Progress value={projeto.avanco} aria-label={`Avanço de ${projeto.nome}`} className="h-2 flex-1" /><span className="metric-number w-9 text-right text-xs">{projeto.avanco}%</span></div></TableCell>
              <TableCell>{dia(projeto.entrega)}</TableCell>
              <TableCell className="metric-number text-right">{reais(projeto.orcadoCentavos)}</TableCell>
              <TableCell className="metric-number pr-6 text-right">{reais(projeto.realizadoCentavos)}</TableCell>
            </TableRow>)}
          </TableBody>
        </Table>
      </div>
    </Card>

    <Card className="overflow-hidden workspace-card">
      <CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><CardTitle className="text-lg">Orçamento da obra PRJ-014</CardTitle><p className="mt-1 text-sm text-drap-500">Mude o BDI e veja o preço de venda recalcular.</p></div>
        <div className="w-28"><Label htmlFor="bdi-exemplo" className="mb-1.5 block text-xs">BDI (%)</Label><Input id="bdi-exemplo" inputMode="decimal" value={bdi} onChange={(evento) => setBdi(evento.target.value)} className="h-10" /></div>
      </CardHeader>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow className="bg-drap-50"><TableHead className="pl-6">Serviço</TableHead><TableHead className="text-right">Qtd.</TableHead><TableHead className="text-right">Custo unit.</TableHead><TableHead className="pr-6 text-right">Custo</TableHead></TableRow></TableHeader>
          <TableBody>
            {itensOrcamentoExemplo.map((item) => <TableRow key={item.id}>
              <TableCell className="pl-6">{item.descricao}</TableCell>
              <TableCell className="metric-number text-right">{item.quantidade.toLocaleString("pt-BR")} {item.unidade}</TableCell>
              <TableCell className="metric-number text-right">{(item.custoCentavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
              <TableCell className="metric-number pr-6 text-right">{reais(Math.round(item.quantidade * item.custoCentavos))}</TableCell>
            </TableRow>)}
          </TableBody>
        </Table>
      </div>
      <CardContent className="flex flex-wrap justify-end gap-x-8 gap-y-2 border-t border-drap-200 pt-4 text-sm">
        <p>Custo direto <span className="metric-number ml-2 font-semibold">{reais(orcamento.custo)}</span></p>
        <p role="status">Preço de venda com BDI de {bdiValido.toLocaleString("pt-BR")}% <span className="metric-number ml-2 text-base font-semibold">{reais(orcamento.venda)}</span></p>
      </CardContent>
    </Card>
    </div>

    <div className="grid gap-3 sm:grid-cols-2">
      <Button variant="outline" className="h-auto min-h-12 justify-between whitespace-normal bg-white py-2 text-left" onClick={() => abrir("cad")}><span className="flex items-center gap-2"><DraftingCompass />Desenhar a planta no Editor CAD</span><ArrowRight /></Button>
      <Button variant="outline" className="h-auto min-h-12 justify-between whitespace-normal bg-white py-2 text-left" onClick={() => abrir("layout")}><span className="flex items-center gap-2"><Sofa />Mobiliar a casa no Criador de layout</span><ArrowRight /></Button>
    </div>
  </div>;
}
