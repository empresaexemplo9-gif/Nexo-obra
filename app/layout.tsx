import type { Metadata } from "next";
import "./globals.css";

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
        {/* As duas famílias da marca abrem a primeira tela; o resto dos pesos vem do arquivo variável. */}
        <link rel="preload" href="/fonts/jost-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/cormorant-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <meta name="theme-color" content="#38301B" />
      </head>
      <body>{children}</body>
    </html>
  );
}
