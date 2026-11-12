"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, CalendarClock, DraftingCompass, FileText, FlaskConical, LayoutDashboard, LoaderCircle, Sofa, type LucideIcon } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { SemBibliotecaContext } from "@/components/documentos/comum";
import type { LayoutAberto } from "@/components/layout/layout-workspace";
import type { Prancha } from "@/components/prancheta-editor";
import { PainelExemplo } from "@/components/visitante/painel-exemplo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AreaDemo } from "@/lib/demonstracao/areas";
import { EMPRESA_EXEMPLO, plantaDeExemplo } from "@/lib/demonstracao/dados";
import { areaM2, layoutDoModelo } from "@/lib/layout";
import type { OrigemReuniao } from "@/lib/reunioes";

// Demonstração pública. Tudo aqui vive na memória desta aba: nenhuma chamada ao
// servidor, nenhum dado de empresa real, nada gravado. As ferramentas são as mesmas da
// plataforma, abertas em modo de demonstração; quando a pessoa tenta salvar, a tela
// explica que ali não se salva e oferece a reunião de implantação.

const areasDemo: { id: AreaDemo; nome: string; icone: LucideIcon }[] = [
  { id: "painel", nome: "Escritório de exemplo", icone: LayoutDashboard },
  { id: "cad", nome: "Editor CAD", icone: DraftingCompass },
  { id: "layout", nome: "Criador de layout", icone: Sofa },
  { id: "documentos", nome: "Documentos e PDF", icone: FileText },
];

const Carregando = () => <div role="status" aria-label="Carregando ferramenta" className="grid min-h-80 place-items-center"><LoaderCircle className="size-7 animate-spin text-drap-600" /></div>;

// Os editores são pesados (desenho, 3D, PDF): só baixam quando a aba deles é aberta.
const PranchetaEditor = dynamic(() => import("@/components/prancheta-editor").then((modulo) => modulo.PranchetaEditor), { ssr: false, loading: Carregando });
const LayoutEditor = dynamic(() => import("@/components/layout/layout-workspace").then((modulo) => modulo.LayoutEditor), { ssr: false, loading: Carregando });
const DocumentosWorkspace = dynamic(() => import("@/components/documentos/documentos-workspace").then((modulo) => modulo.DocumentosWorkspace), { ssr: false, loading: Carregando });

const avisoDeSalvar: Record<"cad" | "layout", string> = {
  cad: "Na conta da sua empresa, este desenho ficaria gravado com histórico de revisões, ligado ao projeto e aberto para a equipe.",
  layout: "Na conta da sua empresa, este layout ficaria salvo, ligado ao projeto, e a prancha iria direto para a biblioteca de arquivos.",
};

export function DemonstracaoApp({ areaInicial }: { areaInicial: AreaDemo }) {
  const [area, setArea] = useState<AreaDemo>(areaInicial);
  const [aviso, setAviso] = useState<"cad" | "layout" | null>(null);

  const prancha = useMemo<Prancha>(() => ({
    id: "demonstracao", nome: "Planta de exemplo", especie: "planta", revisao: 1, projectId: null, projectName: null,
    documento: plantaDeExemplo(), atualizadoEm: "", autor: null,
  }), []);
  const layout = useMemo<LayoutAberto>(() => {
    const content = layoutDoModelo("casa-garagem");
    return {
      id: "demonstracao", name: "Casa térrea de exemplo", projectId: null, projectCode: null, projectName: null, revision: 1,
      updatedByName: "", updatedAt: "", itens: content.itens.length, comodos: content.comodos.length,
      areaM2: content.comodos.reduce((soma, comodo) => soma + areaM2(comodo.pontos), 0), content,
    };
  }, []);

  function abrir(proxima: AreaDemo) {
    setArea(proxima);
    window.history.replaceState(null, "", `/demonstracao?area=${proxima}`);
  }
  const agendar = (origem: OrigemReuniao) => `/agendar?origem=${origem}`;

  return <div className="min-h-svh bg-drap-50 text-drap-950">
    <header className="sticky top-0 z-30 bg-drap-deep text-white">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:px-5">
        <Link href="/" aria-label="Voltar à página inicial" className="shrink-0"><BrandLogo variant="symbol" dark className="w-7" /></Link>
        <p role="status" className="order-last flex min-w-0 basis-full items-center gap-2 text-sm leading-5 text-drap-300 sm:order-none sm:flex-1 sm:basis-0">
          <FlaskConical aria-hidden="true" className="size-4 shrink-0" />
          <span><strong className="font-medium text-white">Demonstração.</strong> Dados fictícios; nada é salvo.</span>
        </p>
        <Button asChild className="ml-auto h-10 bg-drap-400 text-drap-950 hover:bg-drap-200"><Link href={agendar(area)}><CalendarClock />Agendar reunião</Link></Button>
      </div>
      <nav aria-label="Áreas da demonstração" className="flex gap-1 overflow-x-auto border-t border-white/10 px-2 py-1.5 sm:px-4">
        {areasDemo.map(({ id, nome, icone: Icone }) => <button key={id} type="button" onClick={() => abrir(id)} aria-current={area === id ? "page" : undefined}
          className="flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm text-drap-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white aria-[current=page]:bg-white aria-[current=page]:text-drap-950">
          <Icone aria-hidden="true" className="size-4" />{nome}
        </button>)}
      </nav>
    </header>

    <main className="p-3 sm:p-5">
      <h1 className="sr-only">Demonstração do DRAP Backoffice</h1>
      {area === "painel" ? <PainelExemplo abrir={abrir} /> : null}
      {area === "cad" ? <div className="prancheta-autonoma">
        <PranchetaEditor prancha={prancha} canEdit onVoltar={() => abrir("painel")} onSalvo={() => undefined} fullPage demonstracao={{ aoGravar: () => setAviso("cad") }} />
      </div> : null}
      {area === "layout" ? <LayoutEditor inicial={layout} projects={[]} canEdit empresa={EMPRESA_EXEMPLO} fechar={() => abrir("painel")} demonstracao={{ aoSalvar: () => setAviso("layout") }} /> : null}
      {area === "documentos" ? <div className="space-y-4">
        <p className="rounded-md border border-drap-200 bg-white p-4 text-sm leading-6 text-drap-700">Os arquivos são processados neste navegador e baixados para o seu computador. Na conta da empresa, o resultado também pode ser guardado na biblioteca, ligado ao projeto.</p>
        <SemBibliotecaContext.Provider value><DocumentosWorkspace projects={[]} canEdit={false} /></SemBibliotecaContext.Provider>
      </div> : null}

      <aside aria-label="Próximo passo" className="mt-6 flex flex-col gap-3 rounded-lg border border-drap-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-6 text-drap-700"><strong className="font-semibold text-drap-950">Terminou de testar?</strong> Agende uma reunião para implantar a plataforma na sua empresa, com os seus dados e a sua equipe.</p>
        <Button asChild className="h-11 shrink-0"><Link href={agendar(area)}>Agendar reunião<ArrowRight /></Link></Button>
      </aside>
    </main>

    <Dialog open={aviso !== null} onOpenChange={(aberto) => { if (!aberto) setAviso(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Na demonstração nada é salvo</DialogTitle>
          <DialogDescription>{aviso ? avisoDeSalvar[aviso] : ""} Seu teste continua na tela enquanto esta aba estiver aberta.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAviso(null)}>Continuar testando</Button>
          <Button asChild><Link href={agendar(aviso ?? area)}><CalendarClock />Agendar reunião</Link></Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
