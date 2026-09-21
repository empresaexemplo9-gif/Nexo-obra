import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
const drap = await vite.ssrLoadModule("/lib/integrations/drap.ts");
test.after(() => vite.close());

const source = (path) => readFile(`${root}/${path}`, "utf8");

globalThis.__platformEnvOverride = {
  DRAP_API_URL: "https://empresa.drap.app.br",
  DRAP_API_TOKEN: "drap_live_credencial_de_teste",
  // Sem isto o token da empresa é procurado no banco cifrado, e o teste morre em
  // "database_not_configured" — que é a resolução de credencial funcionando, não o
  // mapeamento que este arquivo quer medir.
  DRAP_LEGACY_COMPANY_ID: "empresa-1",
  DRAP_PARTNER_TOKEN: "drap_partner_credencial_de_teste",
};

const fetchOriginal = globalThis.fetch;
test.after(() => { globalThis.fetch = fetchOriginal; });

function drapFalsa(resposta, status = 200) {
  const chamadas = [];
  globalThis.fetch = async (url, init) => {
    chamadas.push({ url: new URL(url), init });
    return new Response(JSON.stringify(resposta), { status, headers: { "content-type": "application/json" } });
  };
  return chamadas;
}

/**
 * O plano da empresa e a porta para a conta dela.
 *
 * Duas perguntas que a tela não conseguia responder: "por que não consigo emitir nota?"
 * — a resposta só vinha tentando e levando 403 — e "como eu entro na Drap?", que não
 * tinha resposta nenhuma, porque a empresa provisionada por aqui nasce sem usuário.
 */

test("o estado dos módulos chega mapeado, sem nome remoto vazando", async () => {
  drapFalsa({
    ativos: ["sheets-sync"],
    modulos: [
      { id: "sheets-sync", nome: "Integrações", descricao_curta: "Conecta sistemas", ativo: true, preco_mensal: 29.9, status: "stable" },
      { id: "emissao-nf", nome: "Emissão de Nota Fiscal", descricao_curta: "NFS-e", ativo: false, preco_mensal: 49.9, status: "stable" },
    ],
    url_assinatura: "https://empresa.drap.app.br/configuracoes/modulos",
  });

  const plano = await drap.fetchDrapModules("empresa-1");

  assert.deepEqual(plano.ativos, ["sheets-sync"]);
  assert.equal(plano.modulos.length, 2);
  assert.equal(plano.modulos[1].descricaoCurta, "NFS-e", "descricao_curta vira descricaoCurta na borda");
  assert.equal(plano.modulos[1].precoMensal, 49.9);
  assert.equal(plano.urlAssinatura, "https://empresa.drap.app.br/configuracoes/modulos");
});

test("preço ausente vira null, nunca zero", async () => {
  // Um zero inventado aqui é uma promessa de gratuidade que a Drap não fez, e ela
  // apareceria na tela com cara de preço conferido.
  drapFalsa({ ativos: [], modulos: [{ id: "x", nome: "X", ativo: false }], url_assinatura: null });
  const plano = await drap.fetchDrapModules("empresa-1");
  assert.equal(plano.modulos[0].precoMensal, null);
  assert.equal(plano.urlAssinatura, null);
});

test("resposta malformada não derruba a tela nem inventa módulo", async () => {
  drapFalsa({ ativos: "nao-e-lista", modulos: [{ nome: "Sem id" }, { id: "ok", nome: "Ok", ativo: true }] });
  const plano = await drap.fetchDrapModules("empresa-1");
  assert.deepEqual(plano.ativos, [], "lista inválida vira lista vazia, não explode");
  assert.deepEqual(plano.modulos.map((m) => m.id), ["ok"], "módulo sem id é descartado, não recebe um id inventado");
});

test("a rota de módulos é só leitura", async () => {
  // Contratar módulo é assinatura recorrente no cartão de quem paga. A plataforma não
  // assina em nome de ninguém: mostra o preço e leva até a conta.
  const rota = await source("app/api/integrations/drap/modulos/route.ts");
  assert.match(rota, /export async function GET/);
  assert.doesNotMatch(rota, /export async function (POST|PUT|PATCH|DELETE)/);
});

test("a rota de módulos traduz o 403 de escopo em instrução", async () => {
  // 403 aqui é quase sempre uma chave emitida antes de `modulos:read` existir. "Erro ao
  // consultar" mandaria a pessoa abrir um chamado para descobrir isso.
  const rota = await source("app/api/integrations/drap/modulos/route.ts");
  assert.match(rota, /cause\.status === 403/);
  assert.match(rota, /Reconecte a empresa/);
});

test("o convite da conta NÃO aceita e-mail do formulário", async () => {
  /**
   * O convite dá papel de ADMINISTRADOR da empresa na Drap: quem aceita vê o financeiro
   * inteiro, troca de plano e pode remover a própria H.OIKOS. Aceitar um endereço
   * digitado deixaria um administrador daqui entregar as finanças da empresa para
   * qualquer caixa de entrada — inclusive uma criada no minuto anterior.
   */
  const rota = await source("app/api/integrations/drap/conta/route.ts");
  assert.match(rota, /email: context\.user\.email/);
  assert.match(rota, /nome: context\.user\.displayName/);
  assert.doesNotMatch(rota, /jsonBody\(request\)/, "não existe corpo para o cliente escolher o destinatário");
});

test("pedir a conta é ato de dono", async () => {
  const rota = await source("app/api/integrations/drap/conta/route.ts");
  assert.match(rota, /requireOrganizationContext\(request, \["owner", "admin"\]\)/);
});

test("a rota de conta tem a mesma trava cross-site das outras mutações", async () => {
  // Sem ela, um site de terceiro dispara a entrega da empresa com o cookie de quem está
  // logado aqui. A convenção chegou no #19 e vale para toda mutação da integração.
  const rota = await source("app/api/integrations/drap/conta/route.ts");
  assert.match(rota, /rejectCrossSiteMutation\(request\)/);
  // Contra a CHAMADA, não contra o import: `requireOrganizationContext` aparece no topo
  // do arquivo e a comparação daria sempre o contrário.
  const inicio = rota.indexOf("rejectCrossSiteMutation(request)");
  const contexto = rota.indexOf("await requireOrganizationContext(request");
  assert.ok(inicio > -1 && inicio < contexto, "a trava vem antes de qualquer trabalho");
});

test("a auditoria registra o pedido sem guardar o link", async () => {
  // O link é credencial de acesso de administrador enquanto vale, e a auditoria é lida
  // por mais gente do que quem poderia usá-lo.
  const rota = await source("app/api/integrations/drap/conta/route.ts");
  const bloco = rota
    .slice(rota.indexOf("auditStatement("), rota.indexOf("return Response.json"))
    // Sem os comentários: eles EXPLICAM por que o link não entra, e explicar exige
    // escrever a palavra.
    .replace(/\/\/[^\n]*/g, "");
  assert.match(bloco, /drap_conta_solicitada/);
  assert.match(bloco, /externalCompanyId/);
  assert.doesNotMatch(bloco, /link/i, "o link não pode virar linha de auditoria");
});

test("convite sem link é falha, não sucesso", async () => {
  // Sem link a pessoa não tem como aceitar, e o e-mail pode nunca chegar. Dizer "convite
  // enviado" ali seria anunciar uma porta que não existe.
  drapFalsa({ id: "c1", email: "a@b.com", expires_at: "2026-09-27T00:00:00Z", email_enviado: true });
  const parceiro = await vite.ssrLoadModule("/lib/integrations/drap-partner.ts");
  await assert.rejects(
    () => parceiro.convidarDonoDaEmpresa({ tenantId: "t1", email: "a@b.com", nome: "Ana" }),
    /resposta-sem-link|link/i,
  );
});

test("o convite chega com o tenant e o papel que a Drap espera", async () => {
  const chamadas = drapFalsa({ id: "c1", link: "https://empresa.drap.app.br/signup?invite=abc", expires_at: "2026-09-27T00:00:00Z", email_enviado: false });
  const parceiro = await vite.ssrLoadModule("/lib/integrations/drap-partner.ts");
  const convite = await parceiro.convidarDonoDaEmpresa({ tenantId: "t1", email: "ana@obra.com", nome: "Ana" });

  assert.equal(chamadas[0].url.pathname, "/api/partner/v1/convites");
  const corpo = JSON.parse(chamadas[0].init.body);
  assert.deepEqual(corpo, { tenant_id: "t1", email: "ana@obra.com", nome: "Ana" });
  // O papel não vai no corpo: quem decide que é administrador é a Drap, e mandar daqui
  // abriria a porta para pedir um papel menor e criar um dono que não consegue nada.
  assert.equal("role" in corpo, false);
  assert.equal(convite.emailEnviado, false);
});

test("a tela mostra o link mesmo quando o e-mail saiu", async () => {
  // A pessoa está olhando para a tela agora. Mandá-la esperar uma mensagem que pode cair
  // no spam é trocar um caminho que funciona por um que talvez funcione.
  const tela = await source("components/finance-workspace.tsx");
  const bloco = tela.slice(tela.indexOf("function PlanoNaDrap"));
  assert.match(bloco, /conta\.link/);
  assert.match(bloco, /Convite enviado para/);
});

test("a tela não inventa preço nem some com o erro", async () => {
  const tela = await source("components/finance-workspace.tsx");
  const bloco = tela.slice(tela.indexOf("function PlanoNaDrap"));
  assert.match(bloco, /precoMensal === null\s*\?\s*"consultar"/);
  assert.match(bloco, /ainda não informa o plano da empresa/, "Drap sem módulos publicados diz isso, não finge lista vazia");
});
