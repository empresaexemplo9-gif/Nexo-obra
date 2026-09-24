import { PranchetaStandalone } from "@/components/prancheta-standalone";

export default async function Page({ params, searchParams }: {
  params: Promise<{ drawingId: string }>;
  searchParams: Promise<{ importar?: string; nome?: string }>;
}) {
  const { drawingId } = await params;
  const { importar, nome } = await searchParams;
  // "Editar no Editor CAD" a partir da biblioteca: o arquivo é lido quando o editor abre.
  const arquivo = importar && /^[A-Za-z0-9-]{1,80}$/.test(importar) ? { id: importar, nome: (nome ?? "arquivo").slice(0, 180) } : null;
  return <PranchetaStandalone drawingId={drawingId} importar={arquivo} />;
}
