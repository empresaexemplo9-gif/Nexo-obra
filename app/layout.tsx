import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Drap Architector | Nexo Obra",
  description:
    "Projetos, obras, orçamentos, clientes e equipe em um fluxo simples e conectado.",
  icons: {
    icon: "/drap-architector-logo.png",
    shortcut: "/drap-architector-logo.png",
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
