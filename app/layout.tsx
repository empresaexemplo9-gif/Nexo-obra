import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "H.OIKOS | Ecossistema para arquitetos",
  description:
    "Projetos, obras, orçamentos, clientes e equipe em um fluxo simples e conectado.",
  icons: {
    icon: [
      { url: "/brand/hoikos-symbol-light.svg", media: "(prefers-color-scheme: light)" },
      { url: "/brand/hoikos-symbol-dark.svg", media: "(prefers-color-scheme: dark)" },
    ],
    shortcut: "/brand/hoikos-symbol-light.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
