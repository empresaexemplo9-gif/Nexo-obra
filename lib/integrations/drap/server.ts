type DrapSummary = {
  receivable: number;
  payable: number;
  balance: number;
  source: 'drap';
};

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Configuração ${name} ausente.`);
  return value;
}

export async function getDrapFinancialSummary(costCenterId?: string): Promise<DrapSummary> {
  const baseUrl = requiredEnv('DRAP_API_URL');
  const token = requiredEnv('DRAP_API_TOKEN');
  const path = process.env.DRAP_SUMMARY_PATH ?? '/api/v1/finance/summary';
  const url = new URL(path, baseUrl);
  if (costCenterId) url.searchParams.set('costCenterId', costCenterId);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`A Drap respondeu com status ${response.status}.`);

  const payload = (await response.json()) as Record<string, unknown>;
  const receivable = Number(payload.receivable ?? payload.aReceber ?? 0);
  const payable = Number(payload.payable ?? payload.aPagar ?? 0);
  return { receivable, payable, balance: receivable - payable, source: 'drap' };
}
