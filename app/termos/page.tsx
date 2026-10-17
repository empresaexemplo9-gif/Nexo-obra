import type { Metadata } from "next";

import { TermsPage } from "@/components/terms-page";

export const metadata: Metadata = {
  title: "Termos de Uso | DRAP Backoffice",
  description: "Regras de uso, acesso, confidencialidade e evolução do DRAP Backoffice.",
};

export default function TermsRoute() {
  return <TermsPage />;
}
