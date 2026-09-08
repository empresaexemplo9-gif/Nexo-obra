import { apiRoute } from "@/lib/server/backend";
import { receiveActivation } from "@/lib/server/activation";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const response = await apiRoute(async () => Response.json(await receiveActivation(request)));
  response.headers.set("Cache-Control", "no-store"); return response;
}
