import type { Metadata } from "next";
import "./globals.css";
import "./drap-polish.css";
import "./drap-workspaces.css";
import "./oikos-tema.css";

import { Toaster } from "@/components/ui/sonner";
import { MARCA_BOOT_SCRIPT } from "@/lib/marca";

export const metadata: Metadata = {
  title: "DRAP Backoffice para Arquitetos",
  applicationName: "DRAP Backoffice",
  description:
    "DRAP · Backoffice para arquitetos. Projetos, obras, orçamentos, clientes e equipe em um fluxo simples e conectado.",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/favicon.ico", sizes: "any" }],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // O atributo data-marca pode ser aplicado antes da hidratação (script abaixo).
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/* Empresa com marca própria (espaço Oikos): o tema dela entra antes da primeira
            pintura. Só aparência — a marca de verdade vem da sessão, no servidor. */}
        <script dangerouslySetInnerHTML={{ __html: MARCA_BOOT_SCRIPT }} />
        {/* A primeira tela carrega diretamente a sans e a serifada reais da marca. */}
        <link rel="preload" href="/fonts/jost-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/ador-hairline-light.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        <meta name="theme-color" content="#0D151F" />
      </head>
      {/* Avisos em todas as páginas: o Editor CAD e a página de projeto abrem fora do
          aplicativo principal, e sem isto seus erros e confirmações não apareciam. */}
      <body>{children}<Toaster position="bottom-right" /></body>
    </html>
  );
}
