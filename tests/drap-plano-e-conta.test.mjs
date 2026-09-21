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
 * O motor financeiro é invisível para quem usa a H.OIKOS.
 *
 * O plano e o valor são daqui. O que a plataforma consulta lá é binário — esta empresa
 * pode emitir nota, ou não pode — e sem isso a pessoa só descobriria tentando e levando
 * erro, na frente do cliente dela.
 */

test("a consulta devolve só os identificadores dos módulos ativos", async () => {
  // Preço nenhum atravessa: uma segunda tabela de preços dentro do produto nasce pronta
  // para divergir da real e para vazar na tela.
  drapFalsa({
    ativos: ["sheets-sync", "emissao-nf"],
    modulos: [{ id: "emissao-nf", nome: "Emissão de Nota Fiscal", preco_mensal: 49.9, ativo: true }],
    url_assinatura: "https://empresa.drap.app.br/configuracoes/modulos",
  });

  const ativos = await drap.fetchDrapActiveModules("empresa-1");
  assert.deepEqual(ativos, ["sheets-sync", "emissao-nf"]);
});

test("resposta malformada vira lista vazia, não exceção", async () => {
  drapFalsa({ ativos: "nao-e-lista" });
  assert.deepEqual(await drap.fetchDrapActiveModules("empresa-1"), []);
});

test("o cliente não carrega preço nem link de assinatura de outro produto", async () => {
  const cliente = await source("lib/integrations/drap.ts");
  const bloco = cliente.slice(cliente.indexOf("export async function fetchDrapActiveModules"));
  assert.doesNotMatch(bloco, /preco_mensal|url_assinatura/);
});

test("emitir nota é capacidade, não seção de plano com marca de fora", async () => {
  const rota = await source("app/api/integrations/drap/connection/route.ts");
  assert.match(rota, /notas: ativos\.includes\("emissao-nf"\)/);
});

test("a consulta de módulos que falha não derruba o Financeiro", async () => {
  // O motor pode não responder sobre um recurso que talvez nem seja usado hoje. Isso não
  // pode apagar saldo, contas e cobranças da tela.
  const rota = await source("app/api/integrations/drap/connection/route.ts");
  assert.match(rota, /fetchDrapActiveModules\(connection\.external_company_id\)\.catch\(\(\) => \[\]\)/);
});

test("não existe rota que leve o usuário para fora do produto", async () => {
  // A opção de abrir a conta no motor financeiro foi removida de propósito: para quem
  // usa a H.OIKOS, ele não existe.
  await assert.rejects(() => source("app/api/integrations/drap/conta/route.ts"), /ENOENT/);
  await assert.rejects(() => source("app/api/integrations/drap/modulos/route.ts"), /ENOENT/);

  const parceiro = await source("lib/integrations/drap-partner.ts");
  assert.doesNotMatch(parceiro, /convidarDonoDaEmpresa|partner\/v1\/convites/);
});

test("a tela não mostra preço nem marca do motor na parte de nota", async () => {
  const tela = await source("components/finance-workspace.tsx");
  const bloco = tela.slice(tela.indexOf("function EmissaoDeNota"));
  assert.doesNotMatch(bloco, /Drap/, "o fornecedor não é problema de quem usa");
  assert.doesNotMatch(bloco, /R\$|preco|preço/i);
  // E só aparece quando há o que dizer: com emissão disponível, a seção some.
  assert.match(bloco, /if \(disponivel\) return null/);
});

test("vincular conta existente continua possível, e discreto", async () => {
  /**
   * Quase todo mundo que chega aqui não tem conta no motor financeiro e nem precisa
   * saber que ele existe. Duas opções do mesmo tamanho obrigavam a escolher entre uma
   * coisa que a pessoa quer e outra de que ela nunca ouviu falar — e a dúvida sozinha já
   * custa mais do que a opção vale.
   */
  const tela = await source("components/drap-conectar.tsx");
  assert.match(tela, /Já tenho uma conta para vincular/);
  // Link de texto, não botão de mesmo peso ao lado do caminho comum.
  assert.match(tela, /text-xs text-hoikos-500 underline/);
  assert.doesNotMatch(tela, /grid grid-cols-2 gap-2/, "os dois caminhos não têm mais o mesmo peso");
  // Continua funcionando: o campo de código e o envio seguem lá.
  assert.match(tela, /name="codigo"/);
  assert.match(tela, /Vincular empresa/);
});
