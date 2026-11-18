"use client";

import { useEffect } from "react";

import type { MarcaDaEmpresa } from "@/lib/empresa-config";
import { aplicarCoresNaPagina } from "@/lib/marca-cliente";

/** Pinta a interface com as cores da empresa aberta e devolve as da plataforma ao sair. */
export function useCoresDaEmpresa(marca: MarcaDaEmpresa | null | undefined) {
  const menu = marca?.menuColor ?? null, accent = marca?.accentColor ?? null, band = marca?.bandColor ?? null;
  useEffect(() => {
    aplicarCoresNaPagina({ menuColor: menu, accentColor: accent, bandColor: band });
    return () => aplicarCoresNaPagina(null);
  }, [menu, accent, band]);
}

/**
 * Logotipo da empresa sobre o menu escuro. Vai numa placa clara: a marca enviada pode ser
 * escura, colorida ou ter fundo próprio, e precisa ser legível sobre qualquer cor de menu.
 */
export function LogoDaEmpresa({ marca, empresa, compacto = false }: { marca: MarcaDaEmpresa; empresa: string; compacto?: boolean }) {
  const src = `/api/organization/branding/logo?v=${marca.logoVersion}`;
  return <div className={compacto ? "grid size-8 place-items-center overflow-hidden rounded bg-white p-0.5" : "grid h-14 w-full place-items-center rounded-md bg-white px-2 py-1.5"}>
    {/* eslint-disable-next-line @next/next/no-img-element -- imagem privada da empresa, servida pela própria API */}
    <img src={src} alt={`Logotipo de ${empresa}`} className={compacto ? "max-h-7 w-auto max-w-full object-contain" : "max-h-11 w-auto max-w-full object-contain"} />
  </div>;
}
