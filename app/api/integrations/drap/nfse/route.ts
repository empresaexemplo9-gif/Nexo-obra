import { z } from "zod";

import { DrapApiError, emitirNotaNaDrap, listarNotasNaDrap, type NotaFiscalRemota } from "@/lib/integrations/drap";
import { ApiError, apiRoute, auditStatement, jsonBody, requireModulePermission, requireOrganizationContext, validationError } from "@/lib/server/backend";
import { requireActiveDrapConnection } from "@/lib/server/drap";
import { rejectCrossSiteMutation } from "@/lib/server/superadmin";

export const dynamic = "force-dynamic";

/**
 * Notas fiscais de serviço emitidas a partir de uma obra.
 *
 * ─── A NOTA NÃO É DAQUI ───
 *
 * Quem autoriza é a prefeitura. O serviço fiscal enfileira o pedido e responde "aceito",
 * nunca "emitida" — e é por isso que nada nesta rota apresenta uma nota como emitida sem
 * a situação ter vindo de lá. O que a plataforma guarda é o PEDIDO: qual obra, qual
 * cliente, qual valor e com que chave de idempotência, para que uma tentativa repetida
 * não vire a segunda nota do mesmo serviço.
 *
 * ─── TEMPO ESGOTADO NÃO É RECUSA ───
 *
 * Uma recusa explícita (4xx) significa que nada foi emitido. Uma conexão que caiu no meio
 * não significa nada disso: a nota pode ter saído. Os dois casos ficam separados —
 * `failed` e `unknown` — porque dizer "não foi emitida" quando ninguém sabe é o caminho
 * mais curto para emitir a segunda.
 *
 * Um pedido em `unknown` se resolve reenviando com a MESMA chave: o serviço fiscal
 * reconhece o pedido anterior e devolve a nota de antes em vez de emitir outra.
 */

const emissaoSchema = z.object({
  projectId: z.string().uuid(),
  descricao: z.string().trim().min(5, "Descreva o serviço prestado (mínimo 5 caracteres).").max(2000),
  // Centavos no banco, como todo dinheiro aqui. A conversão para reais acontece na
  // fronteira com o serviço fiscal, que trabalha em reais.
  amountCents: z.number().int().positive("O valor precisa ser maior que zero.").max(1_000_000_000),
  idempotencyKey: z.string().uuid(),
}).strict();

type NotaRow = {
  id: string; project_id: string; project_name: string; project_code: string;
  client_name: string | null; description: string; amount_cents: number;
  status: string; external_note_id: string | null; ambiente: string | null;
  fiscal_status: string | null; fiscal_synced_at: string | null;
  numero: string | null; url_pdf: string | null; last_error: string | null;
  idempotency_key: string; created_at: string;
};

const SELECT = `SELECT n.id, n.project_id, p.name AS project_name, p.code AS project_code, c.name AS client_name,
  n.description, n.amount_cents, n.status, n.external_note_id, n.ambiente,
  n.fiscal_status, n.fiscal_synced_at, n.numero, n.url_pdf, n.last_error, n.idempotency_key, n.created_at
  FROM fiscal_note_requests n
  INNER JOIN projects p ON p.id = n.project_id AND p.organization_id = n.organization_id
  LEFT JOIN clients c ON c.id = n.client_id AND c.organization_id = n.organization_id`;

function resposta(row: NotaRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    projectCode: row.project_code,
    clientName: row.client_name,
    descricao: row.description,
    amountCents: row.amount_cents,
    /** Do pedido: `pending`, `sent`, `failed` ou `unknown`. */
    status: row.status,
    ambiente: row.ambiente,
    /** Da prefeitura, e só dela. `null` enquanto ninguém confirmou nada. */
    situacao: row.fiscal_status,
    /** Quando essa situação foi confirmada. A tela mostra os dois juntos. */
    confirmadaEm: row.fiscal_synced_at,
    numero: row.numero,
    urlPdf: row.url_pdf,
    motivo: row.last_error,
    /** A chave do pedido, devolvida para que “Verificar” reenvie a MESMA e o serviço
     *  fiscal reconheça o pedido anterior em vez de emitir a segunda nota. Não é
     *  segredo: é o identificador que o próprio navegador sorteou. */
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
  };
}

export async function GET(request: Request) {
  return apiRoute(async () => {
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "finance", "view");

    const projectId = new URL(request.url).searchParams.get("projectId");
    const valores: unknown[] = [context.organization.id];
    const filtro = projectId ? (valores.push(projectId), " AND n.project_id = ?2") : "";
    const { results } = await context.db
      .prepare(`${SELECT} WHERE n.organization_id = ?1${filtro} ORDER BY n.created_at DESC LIMIT 100`)
      .bind(...valores).all<NotaRow>();
    const linhas = results ?? [];

    /**
     * Uma consulta para a lista inteira, não uma por linha.
     *
     * O estado guardado aqui é espelho: a prefeitura muda de ideia sobre uma nota horas
     * depois, e mostrar "processando" para sempre faria a pessoa achar que o pedido
     * travou. Quando a consulta falha, as linhas continuam aparecendo com o que se sabia
     * — e `sincronizado: false` diz que ninguém conferiu agora.
     */
    const pendentes = linhas.filter((linha) => linha.external_note_id && linha.fiscal_status !== "cancelada" && linha.fiscal_status !== "autorizada");
    let sincronizado = pendentes.length === 0;
    if (pendentes.length > 0) {
      try {
        const connection = await requireActiveDrapConnection(context);
        const remotas = new Map<string, NotaFiscalRemota>();
        for (const nota of await listarNotasNaDrap(connection.external_company_id)) remotas.set(nota.id, nota);

        const updates = [];
        for (const linha of pendentes) {
          const remota = remotas.get(linha.external_note_id!);
          if (!remota) continue;
          updates.push(context.db.prepare(
            `UPDATE fiscal_note_requests SET fiscal_status = ?1, fiscal_synced_at = CURRENT_TIMESTAMP,
             numero = ?2, url_pdf = ?3, last_error = ?4, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?5 AND organization_id = ?6`,
          ).bind(remota.situacao, remota.numero, remota.urlPdf, remota.motivoDoErro, linha.id, context.organization.id));
          Object.assign(linha, {
            fiscal_status: remota.situacao,
            fiscal_synced_at: new Date().toISOString(),
            numero: remota.numero,
            url_pdf: remota.urlPdf,
            last_error: remota.motivoDoErro,
          });
        }
        if (updates.length > 0) await context.db.batch(updates);
        sincronizado = true;
      } catch {
        sincronizado = false;
      }
    }

    return Response.json(
      { notas: linhas.map(resposta), sincronizado },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    rejectCrossSiteMutation(request);
    const context = await requireOrganizationContext(request);
    requireModulePermission(context, "finance", "edit");

    const parsed = emissaoSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw validationError(parsed.error.flatten().fieldErrors);
    const dados = parsed.data;

    const anterior = await context.db
      .prepare(`${SELECT} WHERE n.organization_id = ?1 AND n.idempotency_key = ?2`)
      .bind(context.organization.id, dados.idempotencyKey).first<NotaRow>();
    // Pedido já resolvido: devolve o que aconteceu, sem tocar no serviço fiscal.
    // `pending` e `unknown` NÃO param aqui — são exatamente os casos em que ninguém sabe
    // se a nota saiu, e reenviar com a mesma chave é o que descobre.
    if (anterior && (anterior.status === "sent" || anterior.status === "failed")) {
      return Response.json({ nota: resposta(anterior), repetida: true });
    }
    /**
     * Mesma chave, conteúdo diferente.
     *
     * A chave é a promessa de que os dois pedidos são o MESMO. Deixar passar mandaria o
     * novo valor com a chave antiga: o serviço fiscal reconheceria o pedido anterior e
     * devolveria a nota de antes, e a plataforma passaria a exibir como emitido um valor
     * que nunca saiu em nota nenhuma.
     */
    if (anterior && (anterior.description !== dados.descricao || anterior.amount_cents !== dados.amountCents)) {
      throw new ApiError(409, "chave_ja_usada", "Esta chave pertence a outro pedido de emissão. Recarregue a lista antes de tentar de novo.");
    }

    const projeto = await context.db.prepare(
      `SELECT p.id, p.client_id, c.external_financial_id
       FROM projects p LEFT JOIN clients c ON c.id = p.client_id AND c.organization_id = p.organization_id
       WHERE p.id = ?1 AND p.organization_id = ?2`,
    ).bind(dados.projectId, context.organization.id).first<{ id: string; client_id: string | null; external_financial_id: string | null }>();
    if (!projeto) throw new ApiError(404, "not_found", "Projeto ou obra não encontrado.");
    // O tomador da nota é o cliente da obra. Sem o vínculo financeiro dele não há para
    // quem emitir — e inventar um tomador é falsificar documento fiscal.
    if (!projeto.client_id || !projeto.external_financial_id) {
      throw new ApiError(409, "client_financial_link_required", "Vincule o cliente desta obra ao cadastro financeiro antes de emitir a nota.");
    }

    const connection = await requireActiveDrapConnection(context);
    const id = anterior?.id ?? crypto.randomUUID();
    if (!anterior) {
      try {
        await context.db.prepare(
          `INSERT INTO fiscal_note_requests (id, organization_id, project_id, client_id, idempotency_key, description, amount_cents, status, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        ).bind(id, context.organization.id, dados.projectId, projeto.client_id, dados.idempotencyKey, dados.descricao, dados.amountCents).run();
      } catch (erro) {
        if (String(erro).includes("UNIQUE constraint")) throw new ApiError(409, "emissao_em_andamento", "Esta emissão já está sendo processada.");
        throw erro;
      }
    }

    try {
      const aceita = await emitirNotaNaDrap(connection.external_company_id, {
        parceiroId: projeto.external_financial_id,
        // Centavos daqui, reais lá. A conversão fica nesta linha e em nenhuma outra.
        valor: dados.amountCents / 100,
        discriminacao: dados.descricao,
        idempotencyKey: dados.idempotencyKey,
      });
      await context.db.batch([
        context.db.prepare(
          `UPDATE fiscal_note_requests SET status = 'sent', external_note_id = ?1, ambiente = ?2,
           fiscal_status = ?3, fiscal_synced_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?4 AND organization_id = ?5`,
        ).bind(aceita.id, aceita.ambiente, aceita.situacao, id, context.organization.id),
        auditStatement(context, "fiscal_note.requested", "fiscal_note", id, {
          projectId: dados.projectId,
          ambiente: aceita.ambiente,
          repetida: aceita.repetida,
        }),
      ]);
    } catch (causa) {
      const recusa = causa instanceof DrapApiError;
      // Recusa explícita: nada foi emitido, e o motivo é acionável. Queda de conexão:
      // ninguém sabe, e afirmar que não saiu é o caminho mais curto para a segunda nota.
      const motivo = recusa ? motivoDaRecusa(causa) : "A emissão não foi confirmada. Nenhuma nota foi dada como emitida.";
      await context.db.prepare(
        `UPDATE fiscal_note_requests SET status = ?1, last_error = ?2, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?3 AND organization_id = ?4`,
      ).bind(recusa ? "failed" : "unknown", motivo, id, context.organization.id).run();

      if (recusa) throw new ApiError(422, "emissao_recusada", motivo);
      throw new ApiError(502, "emissao_nao_confirmada", "A emissão não foi confirmada pelo serviço fiscal. Use “Verificar” antes de tentar de novo: a nota pode ter sido emitida.");
    }

    const criada = await context.db.prepare(`${SELECT} WHERE n.id = ?1 AND n.organization_id = ?2`)
      .bind(id, context.organization.id).first<NotaRow>();
    return Response.json({ nota: resposta(criada!) }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  });
}

/**
 * O motivo da recusa, como veio do serviço fiscal.
 *
 * Ele costuma ser acionável — "cadastro fiscal não configurado", "município exige CNAE",
 * "franquia de notas esgotada". Trocar por "erro ao emitir" obrigaria a pessoa a abrir um
 * chamado para descobrir o que ela mesma resolveria.
 */
function motivoDaRecusa(causa: DrapApiError): string {
  const corpo = causa.detail && typeof causa.detail === "object" ? causa.detail as Record<string, unknown> : {};
  const texto = [corpo.message, corpo.detail, corpo.error].find((valor) => typeof valor === "string" && valor.trim());
  if (typeof texto === "string") return texto.slice(0, 400);
  if (causa.status === 403) return "Emissão de nota fiscal não está liberada para esta empresa.";
  if (causa.status === 409) return "Configure os dados fiscais da empresa antes de emitir.";
  return "O serviço fiscal recusou a emissão.";
}
