import { createLinkAccessCookie, linkAccessKeyMatches } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ chave: string }> };

// Sem cache e sem Referer: a chave está no próprio endereço.
const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };

export async function GET(_request: Request, route: RouteContext) {
  const { chave } = await route.params;
  if (!await linkAccessKeyMatches(decodeURIComponent(chave))) {
    return new Response("Link de acesso inválido ou expirado.", {
      status: 404, headers: { ...privateHeaders, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  // Página que segue sozinha para o início, em vez de redirecionar com 302: o link costuma
  // chegar por outro site (WhatsApp, e-mail), e assim o próximo pedido já é do próprio site.
  return new Response(
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/">'
      + '<title>Entrando · DRAP Backoffice</title></head><body><p>Entrando… <a href="/">Abrir a plataforma</a></p></body></html>',
    { headers: { ...privateHeaders, "Content-Type": "text/html; charset=utf-8", "Set-Cookie": await createLinkAccessCookie() } },
  );
}
