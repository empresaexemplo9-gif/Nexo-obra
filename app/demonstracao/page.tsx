import { DemonstracaoApp } from "@/components/visitante/demonstracao-app";
import { areaValida } from "@/lib/demonstracao/areas";

export const metadata = {
  title: "Demonstração · DRAP Backoffice",
  description: "Teste o DRAP Backoffice com dados de exemplo: escritório fictício, Editor CAD, Criador de layout e Documentos. Nada é salvo.",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const { area } = await searchParams;
  return <DemonstracaoApp areaInicial={areaValida(area)} />;
}
