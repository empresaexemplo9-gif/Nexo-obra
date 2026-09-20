import { PranchetaStandalone } from "@/components/prancheta-standalone";

export default async function Page({ params }: { params: Promise<{ drawingId: string }> }) {
  const { drawingId } = await params;
  return <PranchetaStandalone drawingId={drawingId} />;
}
