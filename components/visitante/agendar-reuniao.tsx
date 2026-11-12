"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowLeft, CalendarCheck, CalendarClock, LoaderCircle } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  erroDoDia, hojeEmBrasilia, origemLabels, pedidoReuniaoSchema, PERIODOS, periodoLabels, TAMANHOS_EQUIPE, tamanhoEquipeLabels,
  ultimoDiaAceito, type OrigemReuniao,
} from "@/lib/reunioes";

// Pedido de reunião de implantação. O formulário registra o pedido; o horário é
// confirmado por uma pessoa depois, então a tela de sucesso não promete data.

type Campos = { name: string; company: string; email: string; phone: string; teamSize: string; preferredDay: string; preferredPeriod: string; message: string; website: string };
type Erros = Partial<Record<keyof Campos, string>>;
const vazio: Campos = { name: "", company: "", email: "", phone: "", teamSize: "", preferredDay: "", preferredPeriod: "", message: "", website: "" };

const primeiro = (erros: Record<string, string[] | undefined>): Erros =>
  Object.fromEntries(Object.entries(erros).filter(([, lista]) => lista?.length).map(([campo, lista]) => [campo, lista![0]]));

export function AgendarReuniao({ origem }: { origem: OrigemReuniao }) {
  const [campos, setCampos] = useState<Campos>(vazio);
  const [erros, setErros] = useState<Erros>({});
  const [falha, setFalha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const hoje = hojeEmBrasilia();
  const voltar = origem === "home" ? "/" : `/demonstracao?area=${origem}`;

  const mudar = (campo: keyof Campos) => (evento: { target: { value: string } }) => {
    setCampos((atual) => ({ ...atual, [campo]: evento.target.value }));
    setErros((atual) => ({ ...atual, [campo]: undefined }));
  };

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setFalha("");
    // O que vai ao servidor é o que foi digitado; a validação daqui só antecipa a dele.
    const pedido = { ...campos, message: campos.message.trim() || undefined, website: campos.website || undefined, origin: origem };
    const validado = pedidoReuniaoSchema.safeParse(pedido);
    const locais: Erros = validado.success ? {} : primeiro(validado.error.flatten().fieldErrors);
    if (!locais.preferredDay && campos.preferredDay) { const erroDia = erroDoDia(campos.preferredDay, hoje); if (erroDia) locais.preferredDay = erroDia; }
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

  const campo = (id: keyof Campos, rotulo: string, controle: React.ReactNode, ajuda?: string) => <div>
    <Label htmlFor={`reuniao-${id}`} className="mb-2 block text-sm font-medium">{rotulo}</Label>
    {controle}
    {erros[id] ? <p id={`reuniao-${id}-erro`} role="alert" className="mt-1.5 text-sm text-drap-danger">{erros[id]}</p> : ajuda ? <p className="mt-1.5 text-xs text-drap-500">{ajuda}</p> : null}
  </div>;
  const aria = (id: keyof Campos) => ({ id: `reuniao-${id}`, "aria-invalid": erros[id] ? true : undefined, "aria-describedby": erros[id] ? `reuniao-${id}-erro` : undefined });

  return <main className="min-h-svh bg-drap-50 px-4 py-8 text-drap-950 sm:py-12">
    <div className="mx-auto max-w-2xl">
      <Link href="/" aria-label="Página inicial"><BrandLogo variant="signature" className="w-[200px]" /></Link>
      {enviado ? <Card className="mt-8 border-drap-200 shadow-none"><CardContent className="p-6 sm:p-8">
        <span className="grid size-12 place-items-center rounded-md bg-drap-50 text-drap-success"><CalendarCheck aria-hidden="true" className="size-6" /></span>
        <h1 role="status" className="display-heading mt-5 text-3xl">Pedido de reunião recebido</h1>
        <p className="mt-3 text-sm leading-6 text-drap-700">Registramos sua preferência por <strong>{new Date(`${campos.preferredDay}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}</strong>, {periodoLabels[campos.preferredPeriod as keyof typeof periodoLabels].toLowerCase()}. O horário ainda não está confirmado: entraremos em contato por {campos.email} ou pelo telefone informado para fechar a data.</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button asChild><Link href="/demonstracao">Continuar testando</Link></Button>
          <Button asChild variant="outline"><Link href="/">Página inicial</Link></Button>
        </div>
      </CardContent></Card> : <>
        <h1 className="display-heading mt-8 text-3xl sm:text-4xl">Agendar reunião de implantação</h1>
        <p className="mt-3 text-sm leading-6 text-drap-500">Conte quem é a sua empresa e quando prefere conversar. Na reunião definimos plano, equipe e prazo para a plataforma entrar em uso{origem !== "home" ? ` — vimos que você testou ${origemLabels[origem]}` : ""}.</p>
        <Card className="mt-6 border-drap-200 shadow-none"><CardContent className="p-5 sm:p-7">
          <form onSubmit={enviar} noValidate className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              {campo("name", "Seu nome", <Input {...aria("name")} value={campos.name} onChange={mudar("name")} autoComplete="name" maxLength={120} required className="h-11" />)}
              {campo("company", "Empresa", <Input {...aria("company")} value={campos.company} onChange={mudar("company")} autoComplete="organization" maxLength={120} required className="h-11" />)}
              {campo("email", "E-mail", <Input {...aria("email")} type="email" value={campos.email} onChange={mudar("email")} autoComplete="email" maxLength={160} required className="h-11" />)}
              {campo("phone", "Telefone ou WhatsApp", <Input {...aria("phone")} type="tel" inputMode="tel" value={campos.phone} onChange={mudar("phone")} autoComplete="tel" maxLength={30} placeholder="(00) 00000-0000" required className="h-11" />)}
            </div>
            {campo("teamSize", "Quantas pessoas vão usar", <NativeSelect {...aria("teamSize")} value={campos.teamSize} onChange={mudar("teamSize")} required className="h-11 w-full">
              <NativeSelectOption value="">Escolha</NativeSelectOption>
              {TAMANHOS_EQUIPE.map((valor) => <NativeSelectOption key={valor} value={valor}>{tamanhoEquipeLabels[valor]}</NativeSelectOption>)}
            </NativeSelect>)}
            <div className="grid gap-5 sm:grid-cols-2">
              {campo("preferredDay", "Dia preferido", <Input {...aria("preferredDay")} type="date" value={campos.preferredDay} onChange={mudar("preferredDay")} min={hoje} max={ultimoDiaAceito(hoje)} required className="h-11" />, "Segunda a sexta, a partir de amanhã.")}
              {campo("preferredPeriod", "Período", <NativeSelect {...aria("preferredPeriod")} value={campos.preferredPeriod} onChange={mudar("preferredPeriod")} required className="h-11 w-full">
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
              <Button type="submit" disabled={enviando} className="h-11 px-6">{enviando ? <LoaderCircle className="animate-spin" /> : <CalendarClock />}Pedir reunião</Button>
            </div>
            <p className="text-xs leading-5 text-drap-500">Usamos estes dados só para combinar a reunião. Consulte os <Link href="/termos" className="underline underline-offset-2">Termos de Uso e Privacidade</Link>.</p>
          </form>
        </CardContent></Card>
      </>}
    </div>
  </main>;
}
