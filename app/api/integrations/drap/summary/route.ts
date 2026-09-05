import { demoFinancialSummary } from "@/lib/demo-data";
import {
  fetchDrapFinancialSummary,
  isDrapConfigured,
} from "@/lib/integrations/drap";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const externalCompanyId =
    request.headers.get("x-drap-company-id") ??
    url.searchParams.get("company_id") ??
    "demo-company";

  if (!isDrapConfigured()) {
    return Response.json({
      ...demoFinancialSummary,
      warning: "DRAP_API_URL e DRAP_API_TOKEN ainda não foram configurados.",
    });
  }

  try {
    const summary = await fetchDrapFinancialSummary(externalCompanyId);
    return Response.json(summary, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json(
      {
        ...demoFinancialSummary,
        warning: "A Drap não respondeu. Os valores exibidos são demonstrativos.",
      },
      {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
