"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { origemLabels, periodoLabels, STATUS_REUNIAO, statusReuniaoLabels, tamanhoEquipeLabels, tipoPedidoLabels, type StatusReuniao } from "@/lib/reunioes";

// Pedidos de reunião vindos da demonstração pública: quem pediu, quando prefere e em
// que pé está o contato. É a fila de quem quer implantar a plataforma.

type Pedido = {
  id: string; kind: string; name: string; company: string; email: string; phone: string; teamSize: string;
  preferredDay: string; preferredPeriod: string; message: string | null; origin: string; status: StatusReuniao; createdAt: number;
};
const rotulo = (mapa: Record<string, string>, chave: string) => mapa[chave] ?? chave;

export function ReunioesPanel() {
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState("");

  const carregar = useCallback(async () => {
    try {
      const resposta = await fetch("/api/superadmin/reunioes", { cache: "no-store" });
      const corpo = await resposta.json().catch(() => ({})) as { requests?: Pedido[]; error?: string };
      if (!resposta.ok) throw new Error(corpo.error ?? "Não foi possível carregar os pedidos de reunião.");
      setPedidos(corpo.requests ?? []); setErro("");
    } catch (causa) { setErro(causa instanceof Error ? causa.message : "Não foi possível carregar os pedidos de reunião."); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void carregar(), 0); return () => window.clearTimeout(timer); }, [carregar]);

  async function mudarStatus(pedido: Pedido, status: StatusReuniao) {
    setSalvando(pedido.id);
    try {
      const resposta = await fetch(`/api/superadmin/reunioes/${pedido.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const corpo = await resposta.json().catch(() => ({})) as { error?: string };
      if (!resposta.ok) throw new Error(corpo.error ?? "Não foi possível atualizar o pedido.");
      setPedidos((lista) => lista?.map((item) => item.id === pedido.id ? { ...item, status } : item) ?? lista);
      toast.success(`${pedido.company}: ${statusReuniaoLabels[status].toLowerCase()}`);
    } catch (causa) { toast.error(causa instanceof Error ? causa.message : "Não foi possível atualizar o pedido."); }
    finally { setSalvando(""); }
  }

  const novos = pedidos?.filter((pedido) => pedido.status === "new").length ?? 0;
  return <Card className="mt-6 overflow-hidden workspace-card">
    <CardHeader className="border-b bg-white">
      <CardTitle className="flex flex-wrap items-center gap-2 text-lg"><CalendarClock className="size-5 text-drap-600" />Pedidos de reunião e de proposta{novos ? <Badge>{novos} novo{novos > 1 ? "s" : ""}</Badge> : null}</CardTitle>
      <p className="text-sm leading-6 text-drap-500">Visitantes que testaram a demonstração e pediram reunião ou proposta de implantação. Confirme o horário ou envie a proposta e marque o contato.</p>
    </CardHeader>
    {erro ? <CardContent className="p-5"><p role="alert" className="text-sm text-drap-700">{erro}</p></CardContent>
      : !pedidos ? <CardContent className="grid min-h-24 place-items-center"><LoaderCircle aria-label="Carregando pedidos" className="size-5 animate-spin text-drap-600" /></CardContent>
      : !pedidos.length ? <CardContent className="p-5"><p className="text-sm text-drap-500">Nenhum pedido ainda.</p></CardContent>
      : <div className="overflow-x-auto"><Table>
        <TableHeader><TableRow className="bg-drap-50"><TableHead className="pl-6">Empresa e contato</TableHead><TableHead>Pedido</TableHead><TableHead>Equipe</TableHead><TableHead>Testou</TableHead><TableHead>Pedido em</TableHead><TableHead className="pr-5">Andamento</TableHead></TableRow></TableHeader>
        <TableBody>{pedidos.map((pedido) => <TableRow key={pedido.id}>
          <TableCell className="pl-6 align-top"><p className="font-medium">{pedido.company}</p><p className="text-sm">{pedido.name}</p><p className="text-xs text-drap-500"><a href={`mailto:${pedido.email}`} className="underline underline-offset-2">{pedido.email}</a> · <a href={`tel:${pedido.phone.replace(/[^\d+]/g, "")}`} className="underline underline-offset-2">{pedido.phone}</a></p>{pedido.message ? <p className="mt-1 max-w-sm whitespace-pre-wrap text-xs text-drap-700">{pedido.message}</p> : null}</TableCell>
          <TableCell className="align-top"><Badge variant="outline">{rotulo(tipoPedidoLabels, pedido.kind)}</Badge>{pedido.preferredDay ? <p className="mt-1 text-sm">{new Date(`${pedido.preferredDay}T12:00:00`).toLocaleDateString("pt-BR")}<span className="block text-xs text-drap-500">{rotulo(periodoLabels, pedido.preferredPeriod)}</span></p> : <p className="mt-1 text-xs text-drap-500">Enviar por e-mail</p>}</TableCell>
          <TableCell className="align-top">{rotulo(tamanhoEquipeLabels, pedido.teamSize)}</TableCell>
          <TableCell className="align-top">{rotulo(origemLabels, pedido.origin)}</TableCell>
          <TableCell className="align-top">{new Date(pedido.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</TableCell>
          <TableCell className="pr-5 align-top"><NativeSelect aria-label={`Andamento do pedido de ${pedido.company}`} value={pedido.status} disabled={salvando === pedido.id} onChange={(evento) => void mudarStatus(pedido, evento.target.value as StatusReuniao)} className="h-9">
            {STATUS_REUNIAO.map((status) => <NativeSelectOption key={status} value={status}>{statusReuniaoLabels[status]}</NativeSelectOption>)}
          </NativeSelect></TableCell>
        </TableRow>)}</TableBody>
      </Table></div>}
  </Card>;
}
