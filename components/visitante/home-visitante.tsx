"use client";

import Link from "next/link";
import { ArrowRight, CalendarClock, DraftingCompass, FileText, LayoutDashboard, LogIn, Sofa, type LucideIcon } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";

// Primeira tela de quem chega sem conta. A tarefa é uma só: testar a plataforma agora,
// sem cadastro, e sair com uma reunião marcada. Quem já tem conta entra pelo botão do
// topo, que abre o mesmo formulário de sempre.

const testes: { href: string; icone: LucideIcon; titulo: string; texto: string; acao: string }[] = [
  { href: "/demonstracao?area=painel", icone: LayoutDashboard, titulo: "Escritório de exemplo", texto: "Projetos, tarefas, funil de vendas e orçamento de uma empresa fictícia. Conclua tarefas, avance negócios e mude o BDI.", acao: "Abrir o escritório" },
  { href: "/demonstracao?area=cad", icone: DraftingCompass, titulo: "Editor CAD", texto: "Uma planta pronta em camadas. Desenhe paredes, use a linha de comando e exporte em DXF ou SVG.", acao: "Desenhar no CAD" },
  { href: "/demonstracao?area=layout", icone: Sofa, titulo: "Criador de layout", texto: "Uma casa mobiliada com prévia 3D. Mova os móveis, troque acabamentos e baixe a prancha em PDF.", acao: "Montar um layout" },
  { href: "/demonstracao?area=documentos", icone: FileText, titulo: "Documentos e PDF", texto: "Escreva um memorial, junte e divida PDFs ou converta imagens. Tudo roda no seu navegador.", acao: "Abrir documentos" },
];

const passos = [
  { titulo: "Teste sem cadastro", texto: "Use as ferramentas com dados de exemplo. Nada do que você fizer é salvo." },
  { titulo: "Agende a reunião", texto: "Conte o tamanho da equipe e escolha um dia. Confirmamos o horário por e-mail ou WhatsApp." },
  { titulo: "Implante na sua empresa", texto: "Sua empresa entra com os dados reais, os acessos da equipe e as permissões por módulo." },
];

export function HomeVisitante({ onEntrar }: { onEntrar: () => void }) {
  // Largura toda da página: o conteúdo se distribui em colunas e desce quando o espaço
  // acaba. Nada de coluna estreita centralizada com as laterais vazias.
  const margem = "px-4 sm:px-6 lg:px-10";
  return <div className="flex min-h-svh flex-col bg-drap-50 text-drap-950">
    <header className="bg-drap-deep">
      <div className={`flex items-center justify-between gap-3 py-4 ${margem}`}>
        <BrandLogo variant="lockup" dark className="w-[140px]" />
        <Button variant="outline" onClick={onEntrar} className="h-10 border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"><LogIn />Entrar</Button>
      </div>
    </header>

    <main className="flex-1">
      <section className="bg-drap-deep text-white">
        <div className={`grid gap-10 pb-12 pt-8 sm:pb-16 sm:pt-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-end lg:gap-14 ${margem}`}>
          <div>
            <p className="text-sm font-medium text-drap-300">Para escritórios de arquitetura, engenharia e construção</p>
            <h1 className="display-heading mt-4 text-4xl leading-tight sm:text-6xl 2xl:text-7xl">Do primeiro contato à entrega da obra, em um só lugar.</h1>
            <p className="mt-5 text-base leading-7 text-drap-300 sm:text-lg">Clientes, propostas, orçamentos, projetos, obra e desenho técnico no mesmo fluxo. Teste agora com dados de exemplo — sem cadastro e sem salvar nada.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild className="h-12 bg-white px-6 text-base text-drap-950 hover:bg-drap-100"><Link href="/demonstracao">Testar com dados de exemplo<ArrowRight /></Link></Button>
              <Button asChild variant="outline" className="h-12 border-white/25 bg-transparent px-6 text-base text-white hover:bg-white/10 hover:text-white"><Link href="/agendar"><CalendarClock />Agendar reunião</Link></Button>
            </div>
          </div>
          <div aria-labelledby="titulo-passos">
            <h2 id="titulo-passos" className="text-sm font-medium text-drap-300">Como a plataforma chega à sua empresa</h2>
            <ol className="mt-4 divide-y divide-white/10 border-y border-white/10">
              {passos.map((passo, indice) => <li key={passo.titulo} className="flex gap-4 py-4">
                <span aria-hidden="true" className="metric-number w-6 shrink-0 text-2xl text-drap-300">{indice + 1}</span>
                <div><h3 className="text-base font-semibold">{passo.titulo}</h3><p className="mt-1 text-sm leading-6 text-drap-300">{passo.texto}</p></div>
              </li>)}
            </ol>
          </div>
        </div>
      </section>

      <section aria-labelledby="titulo-testes" className={`py-10 sm:py-12 ${margem}`}>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
          <h2 id="titulo-testes" className="display-heading text-3xl sm:text-4xl">O que você pode testar agora</h2>
          <p className="text-sm leading-6 text-drap-500">Cada teste abre a ferramenta de verdade, com dados fictícios. Ao fechar a aba, tudo é descartado.</p>
        </div>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {testes.map(({ href, icone: Icone, titulo, texto, acao }) => <li key={href}>
            <Link href={href} className="group flex h-full flex-col rounded-lg border border-drap-200 bg-white p-5 transition-colors hover:border-drap-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-drap-600 sm:p-6">
              <span className="grid size-11 place-items-center rounded-md bg-drap-50 text-drap-700"><Icone aria-hidden="true" className="size-5" /></span>
              <span className="mt-4 text-lg font-semibold">{titulo}</span>
              <span className="mt-2 flex-1 text-sm leading-6 text-drap-500">{texto}</span>
              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-drap-700">{acao}<ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" /></span>
            </Link>
          </li>)}
        </ul>
      </section>

      <section aria-label="Reunião de implantação" className="border-y border-drap-200 bg-white">
        <div className={`flex flex-col gap-4 py-6 lg:flex-row lg:items-center lg:justify-between ${margem}`}>
          <p className="text-base leading-7"><strong className="font-semibold">Gostou do que testou?</strong> <span className="text-drap-500">A reunião define plano, equipe e prazo para a plataforma entrar em uso na sua empresa. Sem compromisso.</span></p>
          <Button asChild className="h-11 shrink-0 px-5"><Link href="/agendar"><CalendarClock />Agendar reunião de implantação</Link></Button>
        </div>
      </section>
    </main>

    <footer className={`flex flex-wrap items-center justify-between gap-3 py-5 text-sm text-drap-500 ${margem}`}>
      <span>DRAP · Backoffice para arquitetos</span>
      <Link href="/termos" className="underline underline-offset-2 hover:text-drap-950">Termos de Uso e Privacidade</Link>
    </footer>
  </div>;
}
