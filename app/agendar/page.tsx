import { AgendarReuniao } from "@/components/visitante/agendar-reuniao";
import { origemValida } from "@/lib/reunioes";

export const metadata = {
  title: "Agendar reunião · DRAP Backoffice",
  description: "Peça uma reunião para implantar o DRAP Backoffice na sua empresa.",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ origem?: string }> }) {
  const { origem } = await searchParams;
  return <AgendarReuniao origem={origemValida(origem)} />;
}
