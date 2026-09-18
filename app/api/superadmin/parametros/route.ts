import { z } from "zod";

import { FONTES, PARAMETROS } from "@/lib/parametros";
import { EstadoDaFonte, buscaHttp, conferirTodas } from "@/lib/parametros-vigilancia";
import { ApiError, apiRoute, jsonBody, validationError } from "@/lib/server/backend";
import { requireSuperAdmin } from "@/lib/server/superadmin";
import { getDatabase } from "@/db";

export const dynamic = "force-dynamic";

// Só o superadministrador. Parâmetro normativo é compartilhado por todas as empresas:
// deixar cada contratante mexer faria a mesma norma valer diferente em cada uma.

type Linha = {
  id: string; assinatura: string | null; estado: string | null;
  detalhe: string | null; conferido_em: number | null;
  revisado_em: number | null; revisado_por: string | null;
};

const marcarSchema = z.object({ fonteId: z.string().min(1).max(64) }).strict();

async function estadoAtual() {
  const db = getDatabase();
  const resultado = await db.prepare(
    "SELECT id, assinatura, estado, detalhe, conferido_em, revisado_em, revisado_por FROM parametro_fontes",
  ).bind().all<Linha>();
  return resultado.results;
}

function resposta(linhas: Linha[]) {
  const porId = new Map(linhas.map((linha) => [linha.id, linha]));
  return {
    // Os parâmetros vão junto para a tela poder mostrar o que exatamente depende de cada
    // fonte: "esta norma mudou" só é acionável quando se sabe o que ela governa.
    fontes: FONTES.map((fonte) => {
      const linha = porId.get(fonte.id);
      const mudou = linha?.estado === "mudou";
      return {
        id: fonte.id,
        nome: fonte.nome,
        url: fonte.url,
        revisaoEmUso: fonte.revisao,
        ritmo: fonte.ritmo,
        estado: linha?.estado ?? null,
        detalhe: linha?.detalhe ?? null,
        conferidoEm: linha?.conferido_em ?? null,
        // A mudança fica de pé até alguém dizer que olhou — e some se a página voltar ao
        // que era, porque aí não há mais o que revisar.
        pendente: mudou && (!linha?.revisado_em || linha.revisado_em < (linha.conferido_em ?? 0)),
        revisadoEm: linha?.revisado_em ?? null,
        revisadoPor: linha?.revisado_por ?? null,
        parametros: PARAMETROS.filter((parametro) => parametro.fonteId === fonte.id)
          .map((parametro) => ({ id: parametro.id, item: parametro.item, descricao: parametro.descricao, valor: parametro.valor, unidade: parametro.unidade })),
      };
    }),
  };
}

export async function GET(request: Request) {
  return apiRoute(async () => {
    await requireSuperAdmin(request);
    return Response.json(resposta(await estadoAtual()), { headers: { "Cache-Control": "private, no-store" } });
  });
}

// POST confere as fontes agora. A conferência NUNCA altera parâmetro: ela grava a
// assinatura e o estado, e é uma pessoa que decide se a norma mudou de verdade.
export async function POST(request: Request) {
  return apiRoute(async () => {
    const identidade = await requireSuperAdmin(request);
    const db = getDatabase();
    const anteriores: EstadoDaFonte[] = (await estadoAtual()).map((linha) => ({
      fonteId: linha.id, assinatura: linha.assinatura,
      conferidoEm: linha.conferido_em, falha: null,
    }));
    const vereditos = await conferirTodas(anteriores, buscaHttp);
    await db.batch(vereditos.map((veredito) => db.prepare(
      `INSERT INTO parametro_fontes (id, assinatura, estado, detalhe, conferido_em)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(id) DO UPDATE SET
         assinatura = excluded.assinatura, estado = excluded.estado,
         detalhe = excluded.detalhe, conferido_em = excluded.conferido_em`,
    ).bind(veredito.fonteId, veredito.assinatura, veredito.estado, veredito.detalhe, veredito.conferidoEm)));
    void identidade;
    return Response.json(resposta(await estadoAtual()));
  });
}

// PATCH marca que alguém olhou a mudança. Não mexe na assinatura: se a página mudar de
// novo, o aviso volta sozinho.
export async function PATCH(request: Request) {
  return apiRoute(async () => {
    const identidade = await requireSuperAdmin(request);
    const analisado = marcarSchema.safeParse(await jsonBody(request));
    if (!analisado.success) throw validationError(analisado.error.flatten().fieldErrors);
    if (!FONTES.some((fonte) => fonte.id === analisado.data.fonteId)) {
      throw new ApiError(404, "not_found", "Fonte desconhecida.");
    }
    const db = getDatabase();
    const gravado = await db.prepare(
      "UPDATE parametro_fontes SET revisado_em = ?1, revisado_por = ?2 WHERE id = ?3",
    ).bind(Date.now(), identidade.email, analisado.data.fonteId).run();
    if (!gravado.meta.changes) {
      throw new ApiError(409, "sem_conferencia", "Confira as fontes antes de marcar uma como revisada.");
    }
    return Response.json(resposta(await estadoAtual()));
  });
}
