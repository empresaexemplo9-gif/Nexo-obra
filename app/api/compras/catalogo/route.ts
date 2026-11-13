import { after } from "next/server";

import { apiRoute, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { situacaoDaBusca, sincronizarGoinfra } from "@/lib/server/goinfra-fonte";
import { buscarNoCatalogo, FONTES_CATALOGO, tabelasGoinfra, type FonteCatalogo } from "@/lib/server/compras";
import { rotuloRegimeGoinfra, rotuloTabelaGoinfra } from "@/lib/integrations/goinfra-planilha";

export const dynamic = "force-dynamic";

// Busca nos catálogos que alimentam o cadastro de produtos: GOINFRA e SINAPI (referências
// oficiais importadas pelo superadministrador) e a biblioteca de orçamentos da empresa.
export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "purchases", "view");
    const url = new URL(request.url);
    const fonte = url.searchParams.get("fonte") ?? "goinfra";
    const busca = (url.searchParams.get("q") ?? "").trim();
    if (!(FONTES_CATALOGO as readonly string[]).includes(fonte)) throw validationError({ fonte: ["Fonte de catálogo inválida."] });
    if (fonte === "biblioteca") requireModulePermission(context, "budgets", "view");
    const tabelas = (await tabelasGoinfra(context)).map((t) => ({
      id: t.id, label: `${rotuloTabelaGoinfra[t.tabela] ?? t.tabela} · ${rotuloRegimeGoinfra[t.regime] ?? t.regime} · ${t.referencia.slice(5)}/${t.referencia.slice(0, 4)}`,
      totalItems: Number(t.total_itens),
    }));
    // Sem termo, a fonte abre inteira, em páginas.
    if (busca.length > 120) throw validationError({ q: ["Busca longa demais."] });
    const pagina = Number(url.searchParams.get("pagina") ?? 1);
    if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 10_000) throw validationError({ pagina: ["Página inválida."] });
    const resultado = await buscarNoCatalogo(context, fonte as FonteCatalogo, busca, {
      pagina, tabelaId: url.searchParams.get("tabela") ?? undefined, fornecedorId: url.searchParams.get("fornecedor") ?? undefined, uf: url.searchParams.get("uf")?.toUpperCase() ?? undefined, regime: url.searchParams.get("regime") ?? undefined,
    });
    // Nenhuma tabela GOINFRA no banco: em vez de esperar o agendamento ou o painel, a
    // primeira abertura da aba dispara a busca no site, depois de responder. A busca já se
    // limita a uma vez a cada 20 horas e tem trava, então abrir a aba várias vezes não
    // repete o download.
    if (fonte === "goinfra" && !tabelas.length) {
      const ultima = await situacaoDaBusca().catch(() => null);
      const recente = ultima && Date.now() - ultima.at < 20 * 60 * 60 * 1000;
      if (!recente) {
        const buscar = async () => {
          try { await sincronizarGoinfra("primeira abertura do catálogo"); }
          catch (error) { console.error("DRAP Backoffice busca GOINFRA falhou", error); }
        };
        // `after` só existe dentro de um pedido do Next; fora dele (testes), roda solto.
        try { after(buscar); } catch { void buscar(); }
        resultado.emptyReason = "Buscando agora as tabelas oficiais no site da GOINFRA. Reabra esta aba em cerca de um minuto.";
      } else if (ultima?.error) {
        resultado.emptyReason = `A busca no site da GOINFRA falhou em ${new Date(ultima.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: context.organization.timezone })}: ${ultima.error.slice(0, 300)} O superadministrador pode enviar a planilha oficial no painel da plataforma.`;
      }
    }
    return Response.json({ ...resultado, goinfraTables: tabelas }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
