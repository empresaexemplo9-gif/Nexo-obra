import { DemonstracaoPrancha } from "@/components/visitante/demonstracao-app";

export const metadata = { title: "Demonstração · DRAP Backoffice" };

export default async function Page({ params }: { params: Promise<{ drawingId: string }> }) {
  const { drawingId } = await params;
  return <DemonstracaoPrancha drawingId={drawingId} />;
}
