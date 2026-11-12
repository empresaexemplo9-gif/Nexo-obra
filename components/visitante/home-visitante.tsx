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
  return <div className="min-h-svh bg-drap-50 text-drap-950">
    <header className="bg-drap-deep">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <BrandLogo variant="lockup" dark className="w-[140px]" />
        <Button variant="outline" onClick={onEntrar} className="h-10 border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"><LogIn />Entrar</Button>
      </div>
    </header>

    <main>
      <section className="bg-drap-deep text-white">
        <div className="mx-auto max-w-6xl px-4 pb-14 pt-10 sm:px-6 sm:pb-20 sm:pt-16">
          <p className="text-sm font-medium text-drap-300">Para escritórios de arquitetura, engenharia e construção</p>
          <h1 className="display-heading mt-4 max-w-3xl text-4xl leading-tight sm:text-6xl">Do primeiro contato à entrega da obra, em um só lugar.</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-drap-300 sm:text-lg">Clientes, propostas, orçamentos, projetos, obra e desenho técnico no mesmo fluxo. Teste agora com dados de exemplo — sem cadastro e sem salvar nada.</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild className="h-12 bg-drap-400 px-6 text-base text-drap-950 hover:bg-drap-200"><Link href="/demonstracao">Testar com dados de exemplo<ArrowRight /></Link></Button>
            <Button asChild variant="outline" className="h-12 border-white/25 bg-transparent px-6 text-base text-white hover:bg-white/10 hover:text-white"><Link href="/agendar"><CalendarClock />Agendar reunião</Link></Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="titulo-testes" className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <h2 id="titulo-testes" className="display-heading text-3xl sm:text-4xl">O que você pode testar agora</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-drap-500">Cada teste abre a ferramenta de verdade, com dados fictícios. Ao fechar a aba, tudo é descartado.</p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
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

      <section aria-labelledby="titulo-passos" className="border-y border-drap-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 id="titulo-passos" className="display-heading text-3xl sm:text-4xl">Como a plataforma chega à sua empresa</h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-3">
            {passos.map((passo, indice) => <li key={passo.titulo}>
              <span aria-hidden="true" className="metric-number text-3xl text-drap-600">{indice + 1}</span>
              <h3 className="mt-2 text-lg font-semibold">{passo.titulo}</h3>
              <p className="mt-2 text-sm leading-6 text-drap-500">{passo.texto}</p>
            </li>)}
          </ol>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild className="h-11 px-5"><Link href="/agendar"><CalendarClock />Agendar reunião de implantação</Link></Button>
            <p className="text-sm text-drap-500">Sem compromisso. A conversa define plano, equipe e prazo.</p>
          </div>
        </div>
      </section>
    </main>

    <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-drap-500 sm:px-6">
      <span>DRAP · Backoffice para arquitetos</span>
      <Link href="/termos" className="underline underline-offset-2 hover:text-drap-950">Termos de Uso e Privacidade</Link>
    </footer>
  </div>;
}
