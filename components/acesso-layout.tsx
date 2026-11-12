import Link from "next/link";
import { ArrowRight, CalendarClock } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";

/**
 * Moldura das telas de acesso (entrar, convite, nova senha, escolha de empresa…).
 *
 * A página inteira é usada: à esquerda fica o que a plataforma é e os dois caminhos de
 * quem ainda não tem conta; à direita, o formulário na largura da própria coluna. Antes
 * era um cartão estreito no meio da tela, com o resto vazio. No celular a coluna da
 * esquerda some e o formulário ocupa a tela.
 */
export function AcessoLayout({ children, claro = false }: { children: React.ReactNode; claro?: boolean }) {
  return <main className="grid min-h-svh bg-drap-deep lg:grid-cols-[minmax(0,1fr)_minmax(26rem,38rem)]">
    <aside aria-label="Sobre a plataforma" className="hidden flex-col justify-between gap-10 border-r border-white/10 p-10 text-white lg:flex xl:p-14">
      <BrandLogo variant="lockup" dark className="w-[150px]" />
      <div>
        <p className="display-heading text-5xl leading-tight xl:text-6xl">Do primeiro contato à entrega da obra, em um só lugar.</p>
        <p className="mt-5 text-base leading-7 text-drap-300">Clientes, propostas, orçamentos, projetos, obra e desenho técnico no mesmo fluxo.</p>
      </div>
      <div className="flex flex-wrap gap-x-8 gap-y-3 border-t border-white/10 pt-6 text-sm">
        <span className="text-drap-300">Ainda não usa a plataforma?</span>
        <Link href="/demonstracao" className="inline-flex items-center gap-1.5 font-medium text-white underline-offset-4 hover:underline">Testar com dados de exemplo<ArrowRight aria-hidden="true" className="size-4" /></Link>
        <Link href="/agendar" className="inline-flex items-center gap-1.5 font-medium text-white underline-offset-4 hover:underline"><CalendarClock aria-hidden="true" className="size-4" />Agendar reunião</Link>
      </div>
    </aside>
    <div className={`flex min-w-0 items-center p-5 sm:p-8 lg:p-10 ${claro ? "bg-drap-50 text-drap-950" : ""}`}>{children}</div>
  </main>;
}
