#!/usr/bin/env node
// Homologa uma credencial DRAP real contra o contrato que a H.OIKOS consome.
//
// Roda à mão, nunca no CI: precisa de rede e de uma chave de verdade. Use o
// tenant de teste da DRAP, não a empresa do cliente — a fase de escrita grava
// lançamento de R$ 0,01 e nem toda chave tem escopo pra apagar depois.
//
//   DRAP_API_TOKEN=drap_live_... node scripts/homologar-drap.mjs
//   DRAP_API_TOKEN=drap_live_... node scripts/homologar-drap.mjs --escrita
//
// A chave nunca é impressa, nem em erro. Sai 0 quando tudo que é obrigatório
// passou; 1 quando algo que a H.OIKOS depende está quebrado.

const ESCRITA = process.argv.includes("--escrita");
const BASE = (process.env.DRAP_API_URL ?? "https://empresa.drap.app.br").replace(/\/+$/, "");
const TOKEN = process.env.DRAP_API_TOKEN?.trim();
const HEADER = process.env.DRAP_API_KEY_HEADER?.trim();

if (!TOKEN) {
  console.error("Falta DRAP_API_TOKEN. Emita a chave em Configurações → Integrações da DRAP.");
  process.exit(2);
}
if (!BASE.startsWith("https://")) {
  console.error(`DRAP_API_URL precisa ser HTTPS. Recebido: ${BASE}`);
  process.exit(2);
}

const resultados = [];

function registrar(nome, estado, detalhe) {
  resultados.push({ nome, estado, detalhe });
  const marca = { ok: "  ok  ", falha: " FALHA", aviso: " aviso", info: "  --  " }[estado];
  console.log(`[${marca}] ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
}

function headers(extra = {}) {
  const h = { Accept: "application/json", "Content-Type": "application/json", ...extra };
  if (HEADER) h[HEADER] = TOKEN;
  else h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

async function chamar(caminho, init = {}) {
  const url = `${BASE}/api/v1${caminho}`;
  const resposta = await fetch(url, {
    ...init,
    headers: headers(init.headers),
    signal: AbortSignal.timeout(15000),
  });
  const texto = resposta.status === 204 ? "" : await resposta.text();
  let corpo = null;
  if (texto) {
    try { corpo = JSON.parse(texto); } catch { corpo = { erro: texto.slice(0, 200) }; }
  }
  return { status: resposta.status, corpo, headers: resposta.headers };
}

// ─────────────── 1. A chave autentica ───────────────

const lista = await chamar("/lancamentos?limit=1");
if (lista.status === 401) {
  registrar("Autenticação", "falha", `401 ${lista.corpo?.error ?? ""} — chave inválida, revogada ou vencida`);
  encerrar();
} else if (lista.status !== 200) {
  registrar("Autenticação", "falha", `esperado 200, veio ${lista.status}`);
  encerrar();
} else {
  registrar("Autenticação", "ok", "200 em GET /lancamentos");
}

// ─────────────── 2. Sem chave tem que fechar ───────────────

const semChave = await fetch(`${BASE}/api/v1/lancamentos?limit=1`, {
  headers: { Accept: "application/json" },
  signal: AbortSignal.timeout(15000),
});
registrar(
  "Rota fechada sem chave",
  semChave.status === 401 ? "ok" : "falha",
  `esperado 401, veio ${semChave.status}`,
);

// ─────────────── 3. O envelope que o adaptador desempacota ───────────────

const envelope = lista.corpo ?? {};
const temItems = Array.isArray(envelope.items);
registrar(
  "Envelope { items, total, limit, offset }",
  temItems && typeof envelope.total === "number" ? "ok" : "falha",
  temItems ? `${envelope.items.length} item(ns), total ${envelope.total}` : "sem array `items`",
);

// ─────────────── 4. Os campos que a H.OIKOS lê de cada lançamento ───────────────

const amostra = temItems ? envelope.items[0] : null;
if (!amostra) {
  registrar(
    "Campos do lançamento",
    "aviso",
    "tenant sem lançamento — crie um no DRAP ou rode com --escrita pra conferir os campos",
  );
} else {
  const esperados = ["id", "data", "descricao", "tipo", "valor", "status", "contraparte", "centro_custo"];
  const faltando = esperados.filter((campo) => !(campo in amostra));
  registrar(
    "Campos do lançamento",
    faltando.length === 0 ? "ok" : "falha",
    faltando.length === 0 ? esperados.join(", ") : `faltando: ${faltando.join(", ")}`,
  );

  // O adaptador lê `centro_custo` (texto livre) como chave da obra. Se a DRAP
  // parar de devolver o campo, o recorte por obra volta VAZIO sem erro nenhum.
  registrar(
    "Vínculo de obra (centro de custo)",
    "centro_custo" in amostra ? "ok" : "falha",
    "centro_custo" in amostra
      ? "a DRAP devolve `centro_custo`, que é o campo que a H.OIKOS usa como chave da obra"
      : "sem `centro_custo` na resposta — o recorte por obra não tem como funcionar",
  );
}

// ─────────────── 5. Filtro por centro de custo ───────────────

// Filtro ignorado responde 200 com a lista inteira — parece que funcionou. A
// única forma de distinguir é comparar o `total` com o da consulta sem filtro,
// usando um centro de custo que não existe: se o total não cai, o servidor
// ignorou o parâmetro e a H.OIKOS vai paginar a empresa toda pra filtrar na mão.
const inexistente = `hoikos:nao-existe-${Date.now()}`;
const filtrado = await chamar(`/lancamentos?limit=1&centro_custo=${encodeURIComponent(inexistente)}`);
const totalGeral = envelope.total;
const totalFiltrado = filtrado.corpo?.total;

if (filtrado.status !== 200) {
  registrar("Filtro ?centro_custo", "aviso", `veio ${filtrado.status}`);
} else if (typeof totalGeral !== "number" || typeof totalFiltrado !== "number") {
  registrar("Filtro ?centro_custo", "info", "sem `total` nas duas respostas — inconclusivo");
} else if (totalGeral === 0) {
  registrar("Filtro ?centro_custo", "info", "tenant vazio — inconclusivo");
} else if (totalFiltrado === 0) {
  registrar("Filtro ?centro_custo", "ok", "o servidor aplica o filtro");
} else {
  registrar(
    "Filtro ?centro_custo",
    "aviso",
    `ignorado (${totalFiltrado} de ${totalGeral} com centro de custo inexistente) — a H.OIKOS recorta na memória até a DRAP publicar o filtro`,
  );
}

// ─────────────── 6. Os outros recursos que a H.OIKOS usa ───────────────

for (const [nome, caminho] of [["Parceiros", "/parceiros?limit=1"], ["Categorias", "/categorias"]]) {
  const r = await chamar(caminho);
  registrar(nome, r.status === 200 ? "ok" : "falha", `GET ${caminho} → ${r.status}`);
}

// ─────────────── 7. Resumo financeiro somado pela Drap ───────────────

const resumo = await chamar("/resumo");
if (resumo.status === 404) {
  registrar(
    "Resumo financeiro",
    "aviso",
    "endpoint ainda não publicado — a H.OIKOS soma pelos lançamentos e trunca em 500",
  );
} else if (resumo.status !== 200) {
  registrar("Resumo financeiro", "falha", `GET /resumo → ${resumo.status}`);
} else if (!resumo.corpo?.realizado) {
  registrar("Resumo financeiro", "falha", "200 sem o campo `realizado` — a H.OIKOS trata como ausente");
} else {
  const campos = ["realizado", "em_aberto", "vencido", "proximos_30_dias"];
  const faltando = campos.filter((campo) => !(campo in resumo.corpo));
  registrar(
    "Resumo financeiro",
    faltando.length === 0 ? "ok" : "falha",
    faltando.length === 0
      ? `saldo ${resumo.corpo.realizado.saldo}, a receber ${resumo.corpo.em_aberto?.a_receber}`
      : `faltando: ${faltando.join(", ")}`,
  );
  if (resumo.corpo.truncado === true) {
    registrar("Resumo financeiro: cobertura", "aviso", "a Drap marcou `truncado` — o recorte passa do teto de leitura");
  }
}

// ─────────────── 8. Cobrança ───────────────
//
// Só leitura: emitir cobrança de teste mandaria boleto real pra alguém.

const cobrancas = await chamar("/cobrancas?limit=1");
if (cobrancas.status === 200) {
  registrar("Cobranças", "ok", "a chave lê cobranças e o módulo está ativo");
} else if (cobrancas.status === 403) {
  const motivo = cobrancas.corpo?.error === "module-required"
    ? "módulo Cobranças inativo nesta empresa"
    : "a chave não tem o escopo cobrancas:read";
  registrar("Cobranças", "aviso", motivo);
} else if (cobrancas.status === 404) {
  registrar("Cobranças", "aviso", "endpoint ainda não publicado nesta instalação");
} else {
  registrar("Cobranças", "falha", `GET /cobrancas → ${cobrancas.status}`);
}

// ─────────────── 9. Qual é o escopo real desta chave ───────────────
//
// Sonda sem destruir: DELETE num id que não existe. Com escopo vem 404
// (não achou), sem escopo vem 403 (não pode). Nada é apagado nos dois casos.

const sonda = await chamar("/lancamentos/00000000-0000-0000-0000-000000000000", { method: "DELETE" });
if (sonda.status === 403) {
  registrar("Escopo de exclusão", "ok", "403 — a chave NÃO apaga lançamento (é o que queremos)");
} else if (sonda.status === 404) {
  registrar(
    "Escopo de exclusão",
    "aviso",
    "404 — a chave APAGA lançamento. Reemita com o preset 'Leitura e escrita'",
  );
} else {
  registrar("Escopo de exclusão", "info", `resposta ${sonda.status} — inconclusivo`);
}

// ─────────────── 10. Escrita (opt-in) ───────────────

if (!ESCRITA) {
  registrar("Escrita", "info", "pulada — rode com --escrita pra homologar POST e PATCH");
} else {
  const marcador = `hoikos:homologacao ${new Date().toISOString()}`;
  const criado = await chamar("/lancamentos", {
    method: "POST",
    body: JSON.stringify({
      data: new Date().toISOString().slice(0, 10),
      descricao: "Homologação H.OIKOS — pode apagar",
      tipo: "receita",
      valor: 0.01,
      status: "em_aberto",
      centro_custo: marcador,
    }),
  });

  if (criado.status !== 201 && criado.status !== 200) {
    registrar("Escrita: criar lançamento", "falha", `esperado 201, veio ${criado.status} ${criado.corpo?.error ?? ""}`);
  } else {
    const item = criado.corpo?.item ?? criado.corpo;
    registrar("Escrita: criar lançamento", "ok", `id ${item?.id ?? "?"}`);
    registrar(
      "Escrita: centro de custo persistido",
      item?.centro_custo === marcador ? "ok" : "falha",
      `gravado: ${item?.centro_custo ?? "(vazio)"}`,
    );

    if (item?.id) {
      const editado = await chamar(`/lancamentos/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ descricao: "Homologação H.OIKOS — editado" }),
      });
      registrar("Escrita: editar lançamento", editado.status === 200 ? "ok" : "falha", `PATCH → ${editado.status}`);

      const apagado = await chamar(`/lancamentos/${item.id}`, { method: "DELETE" });
      if (apagado.status === 403) {
        registrar("Limpeza", "aviso", `a chave não apaga. Remova o lançamento ${item.id} pelo app da DRAP`);
      } else {
        registrar("Limpeza", apagado.status === 200 || apagado.status === 204 ? "ok" : "aviso", `DELETE → ${apagado.status}`);
      }
    }
  }
}

encerrar();

function encerrar() {
  const falhas = resultados.filter((r) => r.estado === "falha");
  const avisos = resultados.filter((r) => r.estado === "aviso");
  console.log(
    `\n${resultados.length} verificações · ${falhas.length} falha(s) · ${avisos.length} aviso(s)`,
  );
  if (falhas.length > 0) {
    console.log("\nO que quebra a H.OIKOS se não for resolvido:");
    for (const f of falhas) console.log(`  · ${f.nome} — ${f.detalhe ?? ""}`);
  }
  console.log(`\nBase homologada: ${BASE}/api/v1`);
  process.exit(falhas.length > 0 ? 1 : 0);
}
