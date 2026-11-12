"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { CalendarClock, FileText, FlaskConical, LoaderCircle, RotateCcw } from "lucide-react";

import { NexoApp } from "@/components/nexo-app";
import { PranchetaEditor, type Prancha } from "@/components/prancheta-editor";
import { ProjectHub } from "@/components/project-hub";
import { Button } from "@/components/ui/button";
import { ServidorDemo } from "@/lib/demonstracao/servidor";

// Demonstração pública: as telas REAIS da plataforma, sobre dados fictícios.
//
// Enquanto esta moldura está montada, todo pedido `/api/...` da página é respondido pelo
// servidor da demonstração, que vive nesta aba do navegador. Nada chega ao servidor de
// verdade: o que o visitante cria ou edita vale só aqui e some ao fechar a aba. A faixa
// fixa no rodapé diz isso o tempo todo e oferece a reunião e o pedido de proposta.

/** Pedidos que precisam chegar ao servidor de verdade mesmo dentro da demonstração. */
const REAIS = ["/api/reunioes"];

function instalar() {
  const servidor = new ServidorDemo();
  const original = window.fetch;
  const abrirOriginal = window.open;

  window.fetch = async (entrada: RequestInfo | URL, opcoes?: RequestInit) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const endereco = new URL(url, window.location.origin);
    if (endereco.origin !== window.location.origin || !endereco.pathname.startsWith("/api/") || REAIS.includes(endereco.pathname)) return original(entrada, opcoes);
    const metodo = (opcoes?.method ?? (entrada instanceof Request ? entrada.method : "GET")).toUpperCase();
    let corpo: unknown = null;
    if (typeof opcoes?.body === "string") { try { corpo = JSON.parse(opcoes.body); } catch { corpo = null; } }
    const resposta = servidor.responder(metodo, endereco.pathname + endereco.search, corpo);
    return new Response(JSON.stringify(resposta.body), { status: resposta.status, headers: { "Content-Type": "application/json" } });
  };

  // Na plataforma, projeto e prancha abrem em páginas próprias (a prancha, em outra aba).
  // Aqui tudo fica na mesma aba e sob /demonstracao, onde o estado de exemplo existe.
  const destino = (href: string) => {
    if (href === "/" || href.startsWith("/?")) return `/demonstracao${href.slice(1)}`;
    if (/^\/(projetos|prancheta)\//.test(href)) return `/demonstracao${href}`;
    return null;
  };
  const aoClicar = (evento: MouseEvent) => {
    const ancora = (evento.target as Element | null)?.closest?.("a[href]");
    const para = ancora ? destino(ancora.getAttribute("href") ?? "") : null;
    if (!para || evento.defaultPrevented) return;
    evento.preventDefault(); evento.stopPropagation();
    window.location.assign(para);
  };
  document.addEventListener("click", aoClicar, true);
  window.open = ((url?: string | URL, alvo?: string, recursos?: string) => {
    const texto = url ? String(url) : "";
    const para = destino(texto);
    if (para) { window.location.assign(para); return null; }
    if (texto) return abrirOriginal.call(window, url, alvo, recursos);
    // "Abrir em outra aba" com o endereço definido depois: devolve um alvo que navega nesta aba.
    return { opener: null, close() { /* nada a fechar */ }, location: { set href(valor: string) { window.location.assign(destino(valor) ?? valor); } } } as unknown as Window;
  }) as typeof window.open;

  document.body.classList.add("modo-demonstracao");
  return () => {
    window.fetch = original; window.open = abrirOriginal;
    document.removeEventListener("click", aoClicar, true);
    document.body.classList.remove("modo-demonstracao");
  };
}

const assinarNada = () => () => undefined;

function Moldura({ children }: { children: React.ReactNode }) {
  // No servidor não há o que interceptar: as telas só entram no navegador.
  const pronto = useSyncExternalStore(assinarNada, () => true, () => false);
  // Antes de qualquer tela pedir dados: os efeitos de layout rodam antes dos demais.
  useLayoutEffect(() => instalar(), []);

  function recomecar() {
    ServidorDemo.recomecar();
    window.location.assign("/demonstracao");
  }

  return <>
    {pronto ? children : <main role="status" aria-label="Abrindo a demonstração" className="grid min-h-svh place-items-center bg-drap-deep"><LoaderCircle className="size-7 animate-spin text-drap-300" /></main>}
    <aside aria-label="Demonstração" className="barra-demonstracao fixed inset-x-0 bottom-0 z-50 flex items-center gap-2 border-t border-white/15 bg-drap-deep px-3 text-white sm:gap-3 sm:px-5">
      <p role="status" className="flex min-w-0 flex-1 items-center gap-2 text-sm leading-5">
        <FlaskConical aria-hidden="true" className="size-4 shrink-0 text-drap-300" />
        <span className="truncate"><strong className="font-medium"><span className="sm:hidden">Teste</span><span className="hidden sm:inline">Demonstração.</span></strong><span className="hidden text-drap-300 md:inline"> Dados fictícios. O que você editar vale só nesta aba e não é salvo.</span></span>
      </p>
      <Button variant="ghost" size="sm" onClick={recomecar} className="hidden text-drap-300 hover:bg-white/10 hover:text-white sm:inline-flex"><RotateCcw />Recomeçar</Button>
      <Button asChild size="sm" variant="outline" className="border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"><Link href="/agendar?tipo=proposta&origem=demonstracao"><FileText /><span><span className="hidden sm:inline">Pedir </span>proposta</span></Link></Button>
      <Button asChild size="sm" className="bg-white text-drap-950 hover:bg-drap-100"><Link href="/agendar?origem=demonstracao"><CalendarClock /><span><span className="hidden sm:inline">Agendar </span>reunião</span></Link></Button>
    </aside>
  </>;
}

/** Área de trabalho inteira da plataforma, com a empresa fictícia. */
export function DemonstracaoApp() {
  return <Moldura><NexoApp /></Moldura>;
}

/** Central do projeto ou da obra, dentro da demonstração. */
export function DemonstracaoProjeto({ projectId }: { projectId: string }) {
  return <Moldura><ProjectHub projectId={projectId} /></Moldura>;
}

/** Editor CAD em página inteira, como na plataforma, sem sair da demonstração. */
export function DemonstracaoPrancha({ drawingId }: { drawingId: string }) {
  return <Moldura><PranchaAberta drawingId={drawingId} /></Moldura>;
}

function PranchaAberta({ drawingId }: { drawingId: string }) {
  const [prancha, setPrancha] = useState<Prancha | null>(null);
  const [erro, setErro] = useState("");
  const voltar = () => window.location.assign("/demonstracao?module=studio");
  useEffect(() => {
    let ativa = true;
    void (async () => {
      const resposta = await fetch(`/api/studio/${drawingId}`, { cache: "no-store" });
      const corpo = await resposta.json().catch(() => ({})) as { prancha?: Prancha; error?: string };
      if (!ativa) return;
      if (resposta.ok && corpo.prancha) setPrancha(corpo.prancha); else setErro(corpo.error ?? "Não foi possível abrir a prancha.");
    })();
    return () => { ativa = false; };
  }, [drawingId]);
  if (erro) return <main className="grid min-h-svh place-items-center p-6"><div className="space-y-4 text-center"><p role="alert">{erro}</p><Button variant="outline" onClick={voltar}>Voltar à demonstração</Button></div></main>;
  if (!prancha) return <main role="status" aria-label="Carregando prancha" className="grid min-h-svh place-items-center"><LoaderCircle className="size-7 animate-spin" /></main>;
  return <main className="prancheta-autonoma min-h-svh bg-drap-50 p-3 sm:p-4">
    <PranchetaEditor prancha={prancha} canEdit onVoltar={voltar} onSalvo={setPrancha} fullPage />
  </main>;
}
