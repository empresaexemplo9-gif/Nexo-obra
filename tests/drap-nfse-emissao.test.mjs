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
const semComentarios = (texto) => texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

globalThis.__platformEnvOverride = {
  DRAP_API_URL: "https://empresa.drap.app.br",
  DRAP_API_TOKEN: "drap_live_credencial_de_teste",
  DRAP_LEGACY_COMPANY_ID: "empresa-1",
};

const fetchOriginal = globalThis.fetch;
test.after(() => { globalThis.fetch = fetchOriginal; });

function servicoFalso(resposta, status = 200) {
  const chamadas = [];
  globalThis.fetch = async (url, init) => {
    chamadas.push({ url: new URL(url), init });
    return new Response(JSON.stringify(resposta), { status, headers: { "content-type": "application/json" } });
  };
  return chamadas;
}

/**
 * Emissão de nota fiscal de serviço.
 *
 * Uma nota é documento com efeito legal. Duas notas pelo mesmo serviço só se desfazem com
 * cancelamento, que tem prazo, justificativa e às vezes substituição — e quem paga o
 * conserto é o cliente de quem usa a plataforma. Os testes aqui guardam três promessas:
 * nada é anunciado como emitido antes da prefeitura, uma tentativa repetida não vira a
 * segunda nota, e "não deu resposta" nunca é lido como "não foi emitida".
 */

test("aceito não é autorizado: a resposta do pedido sai como processando", async () => {
  // 202 é "entrou na fila da prefeitura". Ler isso como nota pronta faria a plataforma
  // anunciar ao cliente final um documento que ainda pode voltar rejeitado.
  servicoFalso({ id: "nota-1", status: "processando", ambiente: "homologacao" }, 202);
  const aceita = await drap.emitirNotaNaDrap("empresa-1", { parceiroId: "p-1", valor: 100, discriminacao: "Projeto", idempotencyKey: "k-1" });
  assert.equal(aceita.situacao, "processando");
  assert.equal(aceita.repetida, false);
});

test("situação que a plataforma não conhece nunca vira autorizada", async () => {
  // Campo novo, versão diferente, resposta truncada: o desfecho seguro é o que não
  // afirma nada sobre a prefeitura.
  servicoFalso({ id: "nota-2", status: "situacao-que-ninguem-mapeou" }, 202);
  const aceita = await drap.emitirNotaNaDrap("empresa-1", { parceiroId: "p-1", valor: 10, discriminacao: "x", idempotencyKey: "k-2" });
  assert.equal(aceita.situacao, "processando");
});

test("a chave de idempotência vai no cabeçalho, e o valor vai em reais", async () => {
  const chamadas = servicoFalso({ id: "nota-3", status: "processando" }, 202);
  await drap.emitirNotaNaDrap("empresa-1", { parceiroId: "p-1", valor: 1234.56, discriminacao: "Etapa 2", idempotencyKey: "chave-fixa" });
  const [chamada] = chamadas;
  assert.equal(new Headers(chamada.init.headers).get("Idempotency-Key"), "chave-fixa");
  assert.deepEqual(JSON.parse(chamada.init.body), { parceiro_id: "p-1", valor: 1234.56, discriminacao: "Etapa 2" });
});

test("resposta 200 significa pedido já conhecido, não nota nova", async () => {
  // É o retry funcionando: o serviço fiscal reconheceu a chave e devolveu a nota de antes.
  servicoFalso({ id: "nota-1", status: "autorizada", repetida: true }, 200);
  const aceita = await drap.emitirNotaNaDrap("empresa-1", { parceiroId: "p-1", valor: 10, discriminacao: "x", idempotencyKey: "k-1" });
  assert.equal(aceita.repetida, true);
  assert.equal(aceita.id, "nota-1");
});

test("sucesso sem identificador é falha", async () => {
  // Sem id não há como consultar a situação depois. Aceitar isso deixaria uma nota
  // possivelmente emitida fora do alcance de qualquer consulta.
  servicoFalso({ status: "processando" }, 202);
  await assert.rejects(
    () => drap.emitirNotaNaDrap("empresa-1", { parceiroId: "p-1", valor: 10, discriminacao: "x", idempotencyKey: "k" }),
    /no id/,
  );
});

test("link de PDF fora de https é descartado", async () => {
  // Um endereço de outra origem colado numa tela de nota fiscal é phishing pronto: o
  // cliente final clica porque veio junto da nota dele.
  servicoFalso({ items: [{ id: "n-1", status: "autorizada", url_pdf: "http://sitio-qualquer/nota.pdf" }] });
  const [nota] = await drap.listarNotasNaDrap("empresa-1");
  assert.equal(nota.urlPdf, null);
});

test("a consulta diz se a situação foi conferida agora", async () => {
  // "processando" guardado há seis horas e "processando" confirmado agora são coisas
  // diferentes para quem espera a nota.
  servicoFalso({ nota: { id: "n-1", status: "processando" }, sincronizado: false });
  const resultado = await drap.consultarNotaNaDrap("empresa-1", "n-1");
  assert.equal(resultado.sincronizado, false);
  assert.equal(resultado.nota.situacao, "processando");
});

test("tempo esgotado não é recusa", async () => {
  /**
   * Os dois desfechos chegam ao mesmo lugar — a nota não apareceu — e a causa é oposta.
   * Uma recusa explícita significa que nada foi emitido. Uma conexão que caiu no meio não
   * significa nada disso: a nota pode ter saído. Gravar os dois como "falhou" faria a
   * tela convidar a tentar de novo, e a segunda tentativa emitiria a segunda nota.
   */
  const rota = await source("app/api/integrations/drap/nfse/route.ts");
  assert.match(rota, /const recusa = causa instanceof DrapApiError/);
  assert.match(rota, /recusa \? "failed" : "unknown"/);
  assert.doesNotMatch(semComentarios(rota), /Nenhuma nota foi emitida\./);
});

test("o pedido sem confirmação é reenviado com a MESMA chave", async () => {
  // Reenviar com outra chave seria pedir a segunda nota. Com a mesma, o serviço fiscal
  // reconhece a tentativa anterior e devolve a de antes.
  const rota = await source("app/api/integrations/drap/nfse/route.ts");
  assert.match(rota, /anterior\.status === "sent" \|\| anterior\.status === "failed"/);
  assert.match(rota, /idempotencyKey: dados\.idempotencyKey/);
  const tela = await source("components/finance-workspace.tsx");
  assert.match(tela, /idempotencyKey: nota\.idempotencyKey/, "Verificar reenvia a chave do pedido original");
});

test("sem cliente vinculado não se emite nota", async () => {
  // O tomador é o cliente da obra. Inventar um tomador é falsificar documento fiscal.
  const rota = await source("app/api/integrations/drap/nfse/route.ts");
  assert.match(rota, /client_financial_link_required/);
  assert.match(rota, /parceiroId: projeto\.external_financial_id/);
});

test("centavos no banco, reais na fronteira", async () => {
  const rota = await source("app/api/integrations/drap/nfse/route.ts");
  assert.match(rota, /valor: dados\.amountCents \/ 100/);
  // E a conversão acontece uma vez só: espalhada, uma das cópias vira nota com valor errado.
  assert.equal(semComentarios(rota).match(/amountCents \/ 100/g)?.length, 1);
});

test("a listagem consulta a situação real uma vez, não uma por linha", async () => {
  const rota = await source("app/api/integrations/drap/nfse/route.ts");
  assert.match(rota, /listarNotasNaDrap\(connection\.external_company_id\)/);
  // Falha na consulta não apaga a lista — declara que não foi conferida.
  assert.match(rota, /sincronizado = false/);
});

test("a tela não chama de emitida a nota que a prefeitura ainda não confirmou", async () => {
  const tela = await source("components/finance-workspace.tsx");
  const bloco = tela.slice(tela.indexOf("async function emitirNota"), tela.indexOf("async function verificarNota"));
  assert.doesNotMatch(semComentarios(bloco), /[Nn]ota emitida/);
  assert.match(bloco, /Pedido enviado/);
});

test("pedido sem confirmação e nota em processamento não têm o mesmo selo", async () => {
  // O primeiro talvez nem exista do outro lado; o segundo a prefeitura já recebeu.
  const tela = await source("components/finance-workspace.tsx");
  const bloco = tela.slice(tela.indexOf("function SituacaoDaNota"));
  assert.match(bloco, /nota\.status === "unknown"/);
  assert.match(bloco, /Não confirmada/);
});

test("a chave da empresa pede os acessos que a plataforma passou a usar", async () => {
  /**
   * Sem isto, emitir nota e consultar o plano voltam 403 para toda empresa conectada por
   * aqui — e o recurso ficaria invisível na tela sem ninguém entender por quê.
   */
  const registro = await source("lib/server/drap-webhook-registro.ts");
  const escopos = registro.slice(registro.indexOf("export const ESCOPOS_DA_PLATAFORMA"));
  for (const escopo of ["nfse:read", "nfse:write", "modulos:read"]) {
    assert.match(escopos, new RegExp(`"${escopo}"`), `falta ${escopo}`);
  }
  // Cancelar nota não entra: tem prazo legal e justificativa registrada, e é decisão de
  // quem responde pela empresa.
  assert.doesNotMatch(escopos, /nfse:delete/);
});

test("credencial que não alcança a consulta não passa por plano sem o recurso", async () => {
  // Os dois chegam na tela como "não dá para emitir", e a causa é oposta: um é o plano da
  // empresa, o outro é a chave guardada aqui. Confundir manda a pessoa pedir ao suporte um
  // módulo que ela já tem.
  servicoFalso({ error: "escopo-insuficiente" }, 403);
  const resultado = await drap.fetchDrapActiveModules("empresa-1");
  assert.deepEqual(resultado, { ativos: [], credencialDesatualizada: true });

  const rota = await source("app/api/integrations/drap/connection/route.ts");
  assert.match(rota, /credencialDesatualizada/);
});

test("renovar a credencial é ato de dono, com a trava cross-site", async () => {
  const rota = await source("app/api/integrations/drap/renovar-chave/route.ts");
  const semCabecalho = semComentarios(rota);
  assert.ok(
    semCabecalho.indexOf("rejectCrossSiteMutation(request)") < semCabecalho.indexOf("await requireOrganizationContext(request"),
    "a trava cross-site vem antes de resolver a sessão",
  );
  assert.match(rota, /requireOrganizationContext\(request, \["owner", "admin"\]\)/);
  // A chave nova é cifrada antes de encostar no banco, e nunca entra na auditoria.
  assert.match(rota, /cifrarSegredo\(chave\)/);
  // Só o que vai GRAVADO: o nome da ação diz "chave renovada", e isso é o registro
  // existindo, não a credencial vazando.
  const inicio = rota.indexOf("auditStatement(");
  const gravado = rota.slice(rota.indexOf("{", rota.indexOf("conexao.id,", inicio)), rota.indexOf("}),", inicio));
  assert.doesNotMatch(gravado, /chave/i, "nenhuma credencial vira linha de auditoria");
});

test("a mesma chave com outro conteúdo é recusada", async () => {
  /**
   * A chave é a promessa de que os dois pedidos são o MESMO. Deixar passar mandaria o
   * valor novo com a chave antiga: o serviço fiscal devolveria a nota de antes, e a
   * plataforma exibiria como emitido um valor que nunca saiu em nota nenhuma.
   */
  const rota = await source("app/api/integrations/drap/nfse/route.ts");
  assert.match(rota, /anterior\.description !== dados\.descricao \|\| anterior\.amount_cents !== dados\.amountCents/);
  assert.match(rota, /chave_ja_usada/);
});
