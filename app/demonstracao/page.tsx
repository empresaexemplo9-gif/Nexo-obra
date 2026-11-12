import { DemonstracaoApp } from "@/components/visitante/demonstracao-app";

export const metadata = {
  title: "Demonstração · DRAP Backoffice",
  description: "A plataforma inteira com dados de exemplo: projetos, obras, orçamentos, funil, Editor CAD, layout e documentos. Nada é salvo.",
};

export default function Page() {
  return <DemonstracaoApp />;
}
