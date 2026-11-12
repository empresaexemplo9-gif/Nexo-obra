import { DemonstracaoProjeto } from "@/components/visitante/demonstracao-app";

export const metadata = { title: "Demonstração · DRAP Backoffice" };

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <DemonstracaoProjeto projectId={projectId} />;
}
