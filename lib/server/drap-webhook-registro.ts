import { runtimeEnv } from "@/lib/server/runtime";

// Registro automático do webhook desta empresa na Drap, no momento de conectar.
//
// Sem isto, a H.OIKOS só sabia de mudança perguntando: cada tela refazia
// `GET /api/v1/lancamentos` para descobrir, na maioria das vezes, que nada mudou. E o
// caminho para deixar de perguntar era um humano abrir o painel da Drap, empresa por
// empresa, colar uma URL e copiar um segredo — o mesmo "segundo login adiado" que o
// provisionamento existe para eliminar.
//
// O segredo devolvido aqui é o que o receptor usa para conferir o `X-DRAP-Signature` de
// cada entrega. Ele aparece UMA vez, na resposta da criação, e por isso vai direto para a
// cifra do banco. Perder esse segredo não é recuperável: a assinatura de lá passa a não
// bater com nada aqui, e a única saída é remover a assinatura na Drap e registrar outra.

/**
 * Os eventos que a plataforma realmente trata hoje — `processDrapEvent` age sobre
 * `lancamento.*` e `cobranca.*`, e arquiva todo o resto como `ignored`.
 *
 * Assinar o catálogo inteiro custaria dos dois lados: a Drap entregaria (e, no erro,
 * repetiria com backoff) eventos que este lado joga fora. Quando uma regra de domínio
 * existir para parceiro, categoria, NFS-e ou orçamento, o evento entra aqui.
 */
export const EVENTOS_ASSINADOS = [
  "lancamento.created",
  "lancamento.updated",
  "lancamento.deleted",
  "lancamento.paid",
  "lancamento.unpaid",
  "cobranca.criada",
  "cobranca.paga",
  "cobranca.cancelada",
] as const;

/**
 * Escopos pedidos para a chave de cada empresa.
 *
 * `cobrancas:*` e `webhooks:*` são recursos sensíveis na Drap: não vêm no escopo padrão
 * do parceiro, e nenhum preset da interface de lá os concede. São pedidos aqui, de forma
 * explícita, porque cada um é uma concessão real — emitir cobrança mexe em dinheiro,
 * assinar webhook é dizer "mande o dado desta empresa para esta URL". Pedir no código que
 * usa mantém a concessão à vista, em vez de alargar o padrão da Drap para todo parceiro
 * que ela vier a ter.
 *
 * `webhooks:delete` entra porque a plataforma agora CRIA a assinatura ao conectar: quem
 * cria precisa conseguir remover. Sem ele, desconectar deixaria a Drap postando o
 * financeiro de uma empresa para um endereço que ninguém mais opera.
 *
 * `lancamentos:delete` e `parceiros:delete` ficam de fora: a plataforma não apaga nenhum
 * dos dois, e escopo que ninguém usa só aumenta o estrago de uma chave vazada.
 */
export const ESCOPOS_DA_PLATAFORMA = [
  "lancamentos:write",
  "parceiros:write",
  "categorias:read",
  "cobrancas:read",
  "cobrancas:write",
  "webhooks:read",
  "webhooks:write",
  "webhooks:delete",
] as const;

const NOME_DA_ASSINATURA = "H.OIKOS";
const CAMINHO_DO_RECEPTOR = "/api/integrations/drap/webhook";

type DrapEnv = { DRAP_API_URL?: string; HOIKOS_PUBLIC_URL?: string; VERCEL_PROJECT_PRODUCTION_URL?: string };

function env() {
  return runtimeEnv() as DrapEnv;
}

/**
 * A URL pública deste servidor, para onde a Drap vai postar.
 *
 * Não é derivada do `Host` da requisição de propósito: esse cabeçalho vem do cliente, e
 * aceitá-lo deixaria quem conecta escolher para onde o financeiro da empresa é enviado.
 * Vem de configuração — explícita quando há domínio próprio, ou o domínio de produção que
 * a Vercel preenche sozinha, que cobre a instalação padrão sem pedir nada a ninguém.
 */
export function urlDoReceptor(): string | null {
  const config = env();
  const explicita = config.HOIKOS_PUBLIC_URL?.trim();
  const daVercel = config.VERCEL_PROJECT_PRODUCTION_URL?.trim();

  const base = explicita || (daVercel ? `https://${daVercel.replace(/^https?:\/\//, "")}` : "");
  if (!base) return null;

  let url: URL;
  try { url = new URL(base); } catch { return null; }
  // A Drap recusa destino que não seja HTTPS, e recusa endereço interno. Falhar aqui, com
  // a configuração à vista, é melhor do que levar um 400 de lá sem saber por quê.
  if (url.protocol !== "https:") return null;

  return new URL(CAMINHO_DO_RECEPTOR, url.origin).toString();
}

export type RegistroResultado =
  | { ok: true; segredo: string; url: string }
  | { ok: false; codigo: string; motivo: string };

function api(caminho: string) {
  const base = env().DRAP_API_URL;
  if (!base) return null;
  return new URL(caminho.replace(/^\//, ""), base.endsWith("/") ? base : `${base}/`).toString();
}

async function lerJson(resposta: Response): Promise<Record<string, unknown>> {
  const bruto = await resposta.text().catch(() => "");
  if (!bruto) return {};
  try { return JSON.parse(bruto) as Record<string, unknown>; }
  catch { return { detail: bruto.slice(0, 200) }; }
}

function detalhe(dados: Record<string, unknown>, padrao: string) {
  if (typeof dados.detail === "string" && dados.detail) return dados.detail;
  if (typeof dados.error === "string" && dados.error) return dados.error;
  return padrao;
}

/**
 * Cria a assinatura de webhook desta empresa na Drap e devolve o segredo.
 *
 * Não lança: quem chama acabou de conectar a empresa e essa conexão continua válida sem
 * webhook — o que se perde é a notificação automática, não o acesso. Por isso a falha
 * volta como valor, com motivo em português, para virar estado visível na tela em vez de
 * quebrar o fluxo de conexão.
 *
 * Consulta antes de criar porque `POST /api/v1/webhooks` não é idempotente na Drap: uma
 * segunda tentativa criaria uma segunda assinatura para a mesma URL, e as entregas
 * passariam a chegar em dobro até alguém notar.
 */
export async function registrarWebhookNaDrap(token: string): Promise<RegistroResultado> {
  const url = urlDoReceptor();
  if (!url) {
    return {
      ok: false,
      codigo: "url-publica-ausente",
      motivo: "Configure HOIKOS_PUBLIC_URL com o endereço HTTPS público desta instalação para a Drap saber para onde enviar os eventos.",
    };
  }

  const listar = api("/api/v1/webhooks");
  const criar = listar;
  if (!listar || !criar) {
    return { ok: false, codigo: "drap-nao-configurada", motivo: "DRAP_API_URL não está configurada nesta instalação." };
  }

  const cabecalhos = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  });

  try {
    const existentes = await fetch(listar, { headers: cabecalhos, signal: AbortSignal.timeout(15000) });
    if (!existentes.ok) {
      const dados = await lerJson(existentes);
      // 403 aqui quase sempre é escopo: a chave desta empresa foi emitida antes de a
      // plataforma passar a pedir `webhooks:*`. Dizer isso poupa uma investigação.
      return {
        ok: false,
        codigo: existentes.status === 403 ? "sem-escopo-de-webhook" : "consulta-recusada",
        motivo: detalhe(dados, `A Drap recusou a consulta de webhooks (HTTP ${existentes.status}).`),
      };
    }

    const lista = await lerJson(existentes);
    const itens = Array.isArray(lista.items) ? (lista.items as Record<string, unknown>[]) : [];
    if (itens.some((item) => typeof item.url === "string" && item.url === url)) {
      // Existe assinatura para esta URL, mas o segredo dela não é recuperável — a Drap só
      // mostra uma vez. Criar outra deixaria duas entregas por evento, então o caminho é
      // remover a antiga lá e registrar de novo aqui.
      return {
        ok: false,
        codigo: "assinatura-duplicada",
        motivo: "Esta empresa já tem uma assinatura de webhook para este endereço na Drap, e o segredo dela não pode ser recuperado. Remova-a na Drap (Configurações → Integrações) e tente de novo.",
      };
    }

    const resposta = await fetch(criar, {
      method: "POST",
      headers: cabecalhos,
      body: JSON.stringify({ url, name: NOME_DA_ASSINATURA, events: EVENTOS_ASSINADOS }),
      signal: AbortSignal.timeout(15000),
    });

    const dados = await lerJson(resposta);
    if (!resposta.ok) {
      return {
        ok: false,
        codigo: typeof dados.error === "string" && dados.error ? dados.error : `http-${resposta.status}`,
        motivo: detalhe(dados, `A Drap recusou o registro do webhook (HTTP ${resposta.status}).`),
      };
    }

    const segredo = typeof dados.secret === "string" ? dados.secret.trim() : "";
    if (!segredo) {
      // Sem segredo não há como conferir assinatura nenhuma. A assinatura pode ter sido
      // criada lá, então o motivo aponta para a limpeza manual.
      return {
        ok: false,
        codigo: "resposta-sem-segredo",
        motivo: "A Drap criou a assinatura mas não devolveu o segredo. Remova-a na Drap e tente de novo.",
      };
    }

    return { ok: true, segredo, url };
  } catch {
    return { ok: false, codigo: "drap-indisponivel", motivo: "A Drap não respondeu ao registro do webhook." };
  }
}

/**
 * Remove a assinatura que a plataforma criou para esta empresa.
 *
 * Só apaga a que aponta para o receptor desta instalação. Uma empresa pode ter assinaturas
 * próprias, criadas pelo dono dela no painel da Drap para outros sistemas; desconectar da
 * H.OIKOS não é motivo para derrubá-las.
 *
 * Não lança, pela mesma razão do registro: quem chama está desfazendo a conexão a pedido
 * do usuário, e uma Drap fora do ar não pode prender ninguém a um vínculo que ele mandou
 * desfazer. A falha volta como valor para virar instrução na tela.
 */
export async function removerWebhookNaDrap(token: string): Promise<{ removido: boolean; motivo?: string }> {
  const url = urlDoReceptor();
  const listar = api("/api/v1/webhooks");
  if (!url || !listar) return { removido: false, motivo: "Sem endereço público configurado para identificar a assinatura." };

  const cabecalhos = new Headers({ Accept: "application/json", Authorization: `Bearer ${token}` });

  try {
    const existentes = await fetch(listar, { headers: cabecalhos, signal: AbortSignal.timeout(15000) });
    if (!existentes.ok) {
      return { removido: false, motivo: `A Drap recusou a consulta de webhooks (HTTP ${existentes.status}).` };
    }

    const lista = await lerJson(existentes);
    const itens = Array.isArray(lista.items) ? (lista.items as Record<string, unknown>[]) : [];
    const nossa = itens.find((item) => typeof item.url === "string" && item.url === url);
    if (!nossa || typeof nossa.id !== "string") return { removido: false, motivo: "Nenhuma assinatura desta plataforma encontrada na Drap." };

    const apagar = api(`/api/v1/webhooks/${encodeURIComponent(nossa.id)}`);
    if (!apagar) return { removido: false, motivo: "DRAP_API_URL não está configurada." };

    const resposta = await fetch(apagar, { method: "DELETE", headers: cabecalhos, signal: AbortSignal.timeout(15000) });
    if (!resposta.ok) {
      const dados = await lerJson(resposta);
      return {
        removido: false,
        motivo: detalhe(dados, `A Drap recusou remover a assinatura (HTTP ${resposta.status}). Remova-a na Drap, em Configurações → Integrações.`),
      };
    }
    return { removido: true };
  } catch {
    return { removido: false, motivo: "A Drap não respondeu. Remova a assinatura na Drap, em Configurações → Integrações." };
  }
}
