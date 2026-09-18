import type { Metadata } from "next";
import "./globals.css";
import "./hoikos-polish.css";
import "./hoikos-workspaces.css";

export const metadata: Metadata = {
  title: "H.OIKOS | Ecossistema para arquitetos",
  description:
    "Projetos, obras, orçamentos, clientes e equipe em um fluxo simples e conectado.",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <head>
        {/* A primeira tela carrega diretamente a sans e a serifada reais da marca. */}
        <link rel="preload" href="/fonts/jost-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/ador-hairline-light.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        <meta name="theme-color" content="#1C190F" />
      </head>
      <body>{children}</body>
    </html>
  );
}
