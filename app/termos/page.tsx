import type { Metadata } from "next";

import { TermsPage } from "@/components/terms-page";

export const metadata: Metadata = {
  title: "Termos de Uso | Drap Architector",
  description: "Regras de uso, acesso, confidencialidade e evolução do Nexo Obra.",
};

export default function TermsRoute() {
  return <TermsPage />;
}
