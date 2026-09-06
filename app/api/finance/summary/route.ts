import { getDrapFinancialSummary } from '@/lib/integrations/drap/server';

const demoSummary = {
  receivable: 148000,
  payable: 63680,
  balance: 84320,
  source: 'demo' as const,
  notice: 'Dados demonstrativos até a homologação do contrato da API Drap.',
};

export async function GET(request: Request) {
  if (!process.env.DRAP_API_URL || !process.env.DRAP_API_TOKEN) {
    return Response.json(demoSummary);
  }
  const costCenterId = new URL(request.url).searchParams.get('costCenterId') ?? undefined;
  try {
    return Response.json(await getDrapFinancialSummary(costCenterId));
  } catch {
    return Response.json(demoSummary, { headers: { 'x-nexo-data-source': 'demo-fallback' } });
  }
}
