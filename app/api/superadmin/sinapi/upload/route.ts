import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { apiRoute } from "@/lib/server/backend";
import { requireSuperAdmin } from "@/lib/server/superadmin";
import { checkPortalOrigin } from "@/lib/server/portal";
import { runtimeEnv } from "@/lib/server/runtime";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return apiRoute(async () => {
    const body = await request.json() as HandleUploadBody;
    return Response.json(await handleUpload({ request, body, token: runtimeEnv().BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname) => {
        checkPortalOrigin(request); await requireSuperAdmin(request);
        if (!/^sinapi-imports\/[0-9a-f-]{36}\/files\/[\w.-]+\.(?:zip|xlsx|csv)$/i.test(pathname)) throw new Error("Nome de arquivo inválido.");
        return { maximumSizeInBytes: 80 * 1024 * 1024, addRandomSuffix: false, allowOverwrite: false, validUntil: Date.now() + 30 * 60000 };
      },
    }));
  });
}
