import { apiRoute, requireOrganizationContext } from "@/lib/server/backend";
import { readChunk, storeChunk } from "@/lib/server/org-files";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ fileId: string; index: string }> };

const partIndex = (value: string) => (/^\d{1,4}$/.test(value) ? Number(value) : -1);

// Os bytes da parte, decifrados. O navegador junta as partes e salva o arquivo com o
// nome e o tipo originais; nada aqui é interpretado ou exibido pelo servidor.
export async function GET(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const { fileId, index } = await route.params;
    const body = await readChunk(context, fileId, partIndex(index));
    return new Response(body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  });
}

export async function PUT(request: Request, route: RouteContext) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    const { fileId, index } = await route.params;
    return Response.json({ part: await storeChunk(context, fileId, partIndex(index), request) });
  });
}
