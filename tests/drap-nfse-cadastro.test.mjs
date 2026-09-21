import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = (path) => readFile(`${root}/${path}`, "utf8");

/**
 * Cadastro fiscal da empresa.
 *
 * O que atravessa esta tela é o certificado A1 — a chave privada de assinatura fiscal da
 * empresa. Quem a tem assina documento em nome dela. Os testes aqui protegem o caminho
 * dela: entra, atravessa, some.
 */

test("o certificado não fica guardado em lugar nenhum", async () => {
  const rota = await source("app/api/integrations/drap/nfse/config/route.ts");
  // Não vai para o banco: o único INSERT/UPDATE da rota é a auditoria.
  assert.doesNotMatch(rota, /INSERT INTO|UPDATE .* SET/i);
  // E a auditoria guarda só o fato de ter havido troca de credencial.
  const auditoria = rota.slice(rota.indexOf("auditStatement("), rota.indexOf("});", rota.indexOf("auditStatement(")));
  assert.match(auditoria, /certificadoEnviado: Boolean\(parsed\.data\.certificado_base64\)/);
  // Sem comentários e sem a própria flag: os dois EXPLICAM a garantia, e explicar exige
  // escrever a palavra. O que sobra é o que de fato vai para a linha de auditoria.
  const gravado = auditoria
    .replace(/\/\/[^\n]*/g, "")
    .replace(/certificadoEnviado: Boolean\([^)]*\),?/g, "");
  assert.doesNotMatch(gravado, /certificado|senha/i, "nada de credencial vira linha de auditoria");
});

test("a tela solta o certificado depois de enviar", async () => {
  // Se o base64 fosse para o estado do componente, ele ficaria vivo na aba aberta — e
  // uma extensão, um print ou um React DevTools alcançariam a chave da empresa.
  const tela = await source("components/nfse-dados-fiscais.tsx");
  assert.doesNotMatch(tela, /useState[^;]*certificado/i, "o certificado não vira estado");
  assert.match(tela, /const certificado = temArquivo \? await lerCertificado\(arquivo\) : null/);
});

test("cadastrar dado fiscal é ato de dono, com a trava cross-site", async () => {
  const rota = await source("app/api/integrations/drap/nfse/config/route.ts");
  assert.match(rota, /rejectCrossSiteMutation\(request\)/);
  assert.match(rota, /requireOrganizationContext\(request, \["owner", "admin"\]\)/);
  const trava = rota.indexOf("rejectCrossSiteMutation(request)");
  const contexto = rota.indexOf("await requireOrganizationContext(request, ");
  assert.ok(trava > -1 && trava < contexto);
});

test("o corpo é validado aqui, não repassado cego", async () => {
  // Encaminhar direto faria erro de digitação virar mensagem de outro produto, com
  // vocabulário de outro produto, na tela de quem nunca ouviu falar dele.
  const rota = await source("app/api/integrations/drap/nfse/config/route.ts");
  assert.match(rota, /cadastroSchema\.safeParse/);
  assert.match(rota, /\}\)\.strict\(\)/, "campo desconhecido é recusado, não repassado");
  assert.match(rota, /CEP tem 8 dígitos/);
  assert.match(rota, /código IBGE do município tem 7 dígitos/);
});

test("a recusa do serviço fiscal chega com o motivo, não virando 'erro ao salvar'", async () => {
  const rota = await source("app/api/integrations/drap/nfse/config/route.ts");
  const traduz = rota.slice(rota.indexOf("function traduzir"));
  // O motivo do serviço é preservado quando existe.
  assert.match(traduz, /motivo \?\? /);
  // E cada situação tem um código que a tela pode tratar.
  for (const codigo of ["emissao_nao_liberada", "sem_emissao_no_plano", "aceite_producao_required", "cadastro_recusado"]) {
    assert.match(traduz, new RegExp(codigo));
  }
});

test("produção exige aceite, e o aceite exige uma pessoa", async () => {
  /**
   * Emitir com valor fiscal real entra na apuração do ISS do município e só se desfaz
   * por cancelamento, com prazo. É ato jurídico: um registro sem pessoa atrás não prova
   * nada, e um registro que parece prova sem ser é pior do que registro nenhum.
   */
  const tela = await source("components/nfse-dados-fiscais.tsx");
  assert.match(tela, /disabled=\{salvando \|\| \(producao && !aceite\)\}/);
  assert.match(tela, /aceite \? <Campo name="aceite_responsavel"/);
  assert.match(tela, /aceite_producao_responsavel: so\(dados\.get\("aceite_responsavel"\)\)/);
});

test("o padrão é homologação: confere-se antes de valer", async () => {
  const tela = await source("components/nfse-dados-fiscais.tsx");
  assert.match(tela, /ambiente: \(producao \? "producao" : "homologacao"\)/);
  assert.match(tela, /não valem nada perante a prefeitura/);
});

test("o formulário é quebrado em partes, não uma parede de campos", async () => {
  // Vinte campos numa tela só é a definição do formulário que ninguém termina — e não dá
  // para cortar campo, porque quem corta é a prefeitura, recusando a nota inteira.
  const tela = await source("components/nfse-dados-fiscais.tsx");
  for (const parte of ["identificacao", "endereco", "tributacao", "certificado"]) {
    assert.match(tela, new RegExp(`AccordionItem value="${parte}"`));
  }
  assert.match(tela, /defaultValue="identificacao"/, "a primeira já vem aberta");
});

test("a tela de dados fiscais só aparece quando a emissão existe no plano", async () => {
  const financeiro = await source("components/finance-workspace.tsx");
  assert.match(financeiro, /canManageConnection && capabilities\.notas \? <Button variant="outline" onClick=\{\(\) => setFiscalOpen\(true\)\}/);
});

test("o certificado não aparece no que volta para a tela", async () => {
  // A leitura devolve o cadastro sem segredo: é o `stripConfigSecrets` do outro lado, e
  // aqui não se acrescenta nada.
  const rota = await source("app/api/integrations/drap/nfse/config/route.ts");
  const get = rota.slice(rota.indexOf("export async function GET"), rota.indexOf("export async function PUT"));
  assert.doesNotMatch(get, /certificado|senha/i);
});
