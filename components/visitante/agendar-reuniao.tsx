"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowLeft, CalendarCheck, CalendarClock, FileText, LoaderCircle } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  erroDoDia, hojeEmBrasilia, origemLabels, pedidoReuniaoSchema, PERIODOS, periodoLabels, TAMANHOS_EQUIPE, tamanhoEquipeLabels,
  ultimoDiaAceito, type OrigemReuniao, type TipoPedido,
} from "@/lib/reunioes";

// Pedido de reunião de implantação ou de envio de proposta. O formulário registra o
// pedido; horário e proposta são tratados por uma pessoa depois, então a tela de sucesso
// não promete data nem valor.

type Campos = { name: string; company: string; email: string; phone: string; teamSize: string; preferredDay: string; preferredPeriod: string; message: string; website: string };
type Erros = Partial<Record<keyof Campos, string>>;
const vazio: Campos = { name: "", company: "", email: "", phone: "", teamSize: "", preferredDay: "", preferredPeriod: "", message: "", website: "" };

const primeiro = (erros: Record<string, string[] | undefined>): Erros =>
  Object.fromEntries(Object.entries(erros).filter(([, lista]) => lista?.length).map(([campo, lista]) => [campo, lista![0]]));

export function AgendarReuniao({ origem, tipoInicial = "meeting" }: { origem: OrigemReuniao; tipoInicial?: TipoPedido }) {
  const [tipo, setTipo] = useState<TipoPedido>(tipoInicial);
  const reuniao = tipo === "meeting";
  const [campos, setCampos] = useState<Campos>(vazio);
  const [erros, setErros] = useState<Erros>({});
  const [falha, setFalha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const hoje = hojeEmBrasilia();
  const voltar = origem === "home" ? "/" : "/demonstracao";

  const mudar = (campo: keyof Campos) => (evento: { target: { value: string } }) => {
    setCampos((atual) => ({ ...atual, [campo]: evento.target.value }));
    setErros((atual) => ({ ...atual, [campo]: undefined }));
  };

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setFalha("");
    // O que vai ao servidor é o que foi digitado; a validação daqui só antecipa a dele.
    const pedido = {
      ...campos, kind: tipo, message: campos.message.trim() || undefined, website: campos.website || undefined, origin: origem,
      preferredDay: reuniao ? campos.preferredDay : undefined, preferredPeriod: reuniao ? campos.preferredPeriod : undefined,
    };
    const validado = pedidoReuniaoSchema.safeParse(pedido);
    const locais: Erros = validado.success ? {} : primeiro(validado.error.flatten().fieldErrors);
    if (reuniao && !locais.preferredDay && campos.preferredDay) { const erroDia = erroDoDia(campos.preferredDay, hoje); if (erroDia) locais.preferredDay = erroDia; }
    if (Object.keys(locais).length) { setErros(locais); return; }
    setEnviando(true);
    try {
      const resposta = await fetch("/api/reunioes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pedido) });
      const corpo = await resposta.json().catch(() => ({})) as { received?: boolean; error?: string; code?: string; details?: Record<string, string[]> };
      if (!resposta.ok || !corpo.received) {
        if (corpo.code === "validation_error" && corpo.details) setErros(primeiro(corpo.details));
        // Banco fora do ar ou desatualizado é problema nosso: a mensagem técnica não ajuda o visitante.
        throw new Error(resposta.status >= 500 ? "Não foi possível registrar o pedido agora. Tente de novo em alguns minutos." : corpo.error ?? "Não foi possível registrar o pedido.");
      }
      setEnviado(true);
    } catch (causa) {
      // Falha de rede: nada foi registrado, e a tela diz isso em vez de fingir sucesso.
      setFalha(causa instanceof TypeError ? "Sem conexão. O pedido não foi enviado; tente de novo." : causa instanceof Error ? causa.message : "Não foi possível registrar o pedido.");
    } finally { setEnviando(false); }
  }

  const campo = (id: keyof Campos, rotulo: string, controle: React.ReactNode, ajuda?: string) => <div className="[&>div]:w-full">
    <Label htmlFor={`reuniao-${id}`} className="mb-2 block text-sm font-medium">{rotulo}</Label>
    {controle}
    {erros[id] ? <p id={`reuniao-${id}-erro`} role="alert" className="mt-1.5 text-sm text-drap-danger">{erros[id]}</p> : ajuda ? <p className="mt-1.5 text-xs text-drap-500">{ajuda}</p> : null}
  </div>;
  const aria = (id: keyof Campos) => ({ id: `reuniao-${id}`, "aria-invalid": erros[id] ? true : undefined, "aria-describedby": erros[id] ? `reuniao-${id}-erro` : undefined });

  const depois = reuniao ? [
    "Recebemos o pedido e conferimos a agenda.",
    "Confirmamos dia e horário por e-mail ou WhatsApp.",
    "Na reunião definimos plano, equipe e prazo de implantação.",
  ] : [
    "Recebemos o pedido com o tamanho da sua equipe.",
    "Montamos a proposta de implantação para a sua empresa.",
    "Enviamos por e-mail e ficamos à disposição para ajustar.",
  ];

  // Duas colunas na largura toda: à esquerda o que é a reunião, à direita o formulário,
  // com os campos lado a lado enquanto couberem.
  return <main className="min-h-svh bg-drap-50 px-4 py-6 text-drap-950 sm:px-6 sm:py-8 lg:px-10">
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-12">
      <div>
        <Link href="/" aria-label="Página inicial" className="block w-[200px]"><BrandLogo variant="signature" className="w-[200px]" /></Link>
        <h1 role={enviado ? "status" : undefined} className="display-heading mt-8 text-3xl sm:text-4xl">{enviado ? (reuniao ? "Pedido de reunião recebido" : "Pedido de proposta recebido") : reuniao ? "Agendar reunião de implantação" : "Pedir proposta de implantação"}</h1>
        {enviado ? null : <p className="mt-3 text-sm leading-6 text-drap-500">{reuniao ? "Conte quem é a sua empresa e quando prefere conversar" : "Conte quem é a sua empresa e enviamos a proposta por e-mail"}{origem !== "home" ? ` — você veio de ${origemLabels[origem]}` : ""}.</p>}
        {enviado ? null : <div role="group" aria-label="O que você quer pedir" className="mt-5 grid grid-cols-2 gap-2">
          <Button type="button" variant={reuniao ? "default" : "outline"} aria-pressed={reuniao} onClick={() => setTipo("meeting")} className="h-11"><CalendarClock />Reunião</Button>
          <Button type="button" variant={reuniao ? "outline" : "default"} aria-pressed={!reuniao} onClick={() => setTipo("proposal")} className="h-11"><FileText />Proposta</Button>
        </div>}
        <h2 className="mt-8 text-sm font-semibold">O que acontece depois</h2>
        <ol className="mt-3 divide-y divide-drap-200 border-y border-drap-200">
          {depois.map((texto, indice) => <li key={texto} className="flex gap-3 py-3 text-sm leading-6 text-drap-700"><span aria-hidden="true" className="metric-number w-5 shrink-0 text-drap-600">{indice + 1}</span>{texto}</li>)}
        </ol>
      </div>

      {enviado ? <Card className="self-start border-drap-200 shadow-none"><CardContent className="p-6 sm:p-8">
        <span className="grid size-12 place-items-center rounded-md bg-drap-50 text-drap-success"><CalendarCheck aria-hidden="true" className="size-6" /></span>
        {reuniao ? null : <p className="mt-5 text-base leading-7 text-drap-700">Vamos montar a proposta de implantação e enviar para <strong>{campos.email}</strong>. Ainda não há valor definido: ele depende do tamanho da equipe e dos módulos que a sua empresa vai usar.</p>}
        {!reuniao ? null : <p className="mt-5 text-base leading-7 text-drap-700">Registramos sua preferência por <strong>{new Date(`${campos.preferredDay}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}</strong>, {periodoLabels[campos.preferredPeriod as keyof typeof periodoLabels].toLowerCase()}. O horário ainda não está confirmado: entraremos em contato por {campos.email} ou pelo telefone informado para fechar a data.</p>}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button asChild><Link href="/demonstracao">Continuar testando</Link></Button>
          <Button asChild variant="outline"><Link href="/">Página inicial</Link></Button>
        </div>
      </CardContent></Card> : <Card className="self-start border-drap-200 shadow-none"><CardContent className="p-5 sm:p-7">
        <form onSubmit={enviar} noValidate className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-4">
            {campo("name", "Seu nome", <Input {...aria("name")} value={campos.name} onChange={mudar("name")} autoComplete="name" maxLength={120} required className="h-11" />)}
            {campo("company", "Empresa", <Input {...aria("company")} value={campos.company} onChange={mudar("company")} autoComplete="organization" maxLength={120} required className="h-11" />)}
            {campo("email", "E-mail", <Input {...aria("email")} type="email" value={campos.email} onChange={mudar("email")} autoComplete="email" maxLength={160} required className="h-11" />)}
            {campo("phone", "Telefone ou WhatsApp", <Input {...aria("phone")} type="tel" inputMode="tel" value={campos.phone} onChange={mudar("phone")} autoComplete="tel" maxLength={30} placeholder="(00) 00000-0000" required className="h-11" />)}
          </div>
          <div className={`grid gap-5 ${reuniao ? "sm:grid-cols-3" : ""}`}>
            {campo("teamSize", "Quantas pessoas vão usar", <NativeSelect {...aria("teamSize")} value={campos.teamSize} onChange={mudar("teamSize")} required className="h-11 w-full">
              <NativeSelectOption value="">Escolha</NativeSelectOption>
              {TAMANHOS_EQUIPE.map((valor) => <NativeSelectOption key={valor} value={valor}>{tamanhoEquipeLabels[valor]}</NativeSelectOption>)}
            </NativeSelect>)}
            {!reuniao ? null : campo("preferredDay", "Dia preferido", <Input {...aria("preferredDay")} type="date" value={campos.preferredDay} onChange={mudar("preferredDay")} min={hoje} max={ultimoDiaAceito(hoje)} required className="h-11" />, "Segunda a sexta, a partir de amanhã.")}
            {!reuniao ? null : campo("preferredPeriod", "Período", <NativeSelect {...aria("preferredPeriod")} value={campos.preferredPeriod} onChange={mudar("preferredPeriod")} required className="h-11 w-full">
              <NativeSelectOption value="">Escolha</NativeSelectOption>
              {PERIODOS.map((valor) => <NativeSelectOption key={valor} value={valor}>{periodoLabels[valor]}</NativeSelectOption>)}
            </NativeSelect>, "Horário de Brasília.")}
          </div>
          {campo("message", "O que você quer resolver (opcional)", <Textarea {...aria("message")} value={campos.message} onChange={mudar("message")} maxLength={1000} rows={3} />)}
          {/* Campo-isca para robôs: fora da tela, do teclado e dos leitores de tela. */}
          <div aria-hidden="true" className="hidden"><label>Site<input type="text" name="website" tabIndex={-1} autoComplete="off" value={campos.website} onChange={mudar("website")} /></label></div>
          {falha ? <p role="alert" className="rounded-md border border-drap-danger/30 bg-white p-3 text-sm text-drap-danger">{falha}</p> : null}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button asChild variant="ghost"><Link href={voltar}><ArrowLeft />Voltar</Link></Button>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <p className="text-xs leading-5 text-drap-500">Usamos estes dados só para responder ao seu pedido. <Link href="/termos" className="underline underline-offset-2">Termos e Privacidade</Link>.</p>
              <Button type="submit" disabled={enviando} className="h-11 shrink-0 px-6">{enviando ? <LoaderCircle className="animate-spin" /> : reuniao ? <CalendarClock /> : <FileText />}{reuniao ? "Pedir reunião" : "Pedir proposta"}</Button>
            </div>
          </div>
        </form>
      </CardContent></Card>}
    </div>
  </main>;
}
