import { AgendarReuniao } from "@/components/visitante/agendar-reuniao";
import { origemValida, tipoValido } from "@/lib/reunioes";

export const metadata = {
  title: "Reunião ou proposta · DRAP Backoffice",
  description: "Peça uma reunião ou o envio de uma proposta para implantar o DRAP Backoffice na sua empresa.",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ origem?: string; tipo?: string }> }) {
  const { origem, tipo } = await searchParams;
  return <AgendarReuniao origem={origemValida(origem)} tipoInicial={tipoValido(tipo)} />;
}
