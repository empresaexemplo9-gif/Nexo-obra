import { createHash } from "node:crypto";

import { getDatabase } from "@/db";
import { interpretarGoinfra, type InterpretacaoGoinfra } from "@/lib/integrations/goinfra-planilha";

// Importação da tabela GOINFRA enviada pelo superadministrador.
//
// Uma tabela ativa por tipo e regime. A nova entra numa tabela própria e só no fim troca
// de lugar com a antiga, no mesmo lote que apaga a anterior: quem busca durante a
// importação vê a tabela velha inteira, nunca metade da nova.

const LOTE = 400;

export async function importarGoinfra(
  arquivo: { nome: string; bytes: Buffer },
  pedido: { referencia?: string; tabela: string; regime?: string },
  autor: string,
) {
  let interpretacao: InterpretacaoGoinfra;
  try { interpretacao = interpretarGoinfra(arquivo.bytes, arquivo.nome); }
  catch (error) { throw new Error(`Não foi possível ler a planilha: ${error instanceof Error ? error.message : String(error)}`); }
  if (interpretacao.itens.length < 10) throw new Error(`A planilha tem só ${interpretacao.itens.length} itens com preço. Confira se é a tabela completa da GOINFRA.`);

  // A planilha oficial diz a própria data-base e o regime. O que foi informado precisa
  // bater com ela: importar a tabela "com desoneração" no lugar da "sem" deixa todo preço
  // de mão de obra errado em silêncio.
  const { cabecalho } = interpretacao;
  const referencia = pedido.referencia ?? cabecalho.dataBase;
  const regime = pedido.regime ?? cabecalho.regime;
  if (!referencia) throw new Error("A planilha não traz a data-base. Informe a referência (mês e ano).");
  if (!regime) throw new Error("A planilha não diz se é com ou sem desoneração. Informe o regime.");
  if (cabecalho.dataBase && cabecalho.dataBase !== referencia) throw new Error(`A planilha é da data-base ${cabecalho.dataBase.slice(5)}/${cabecalho.dataBase.slice(0, 4)}, não ${referencia.slice(5)}/${referencia.slice(0, 4)}.`);
  if (cabecalho.regime && cabecalho.regime !== regime) throw new Error(`A planilha é ${cabecalho.regime === "Desonerado" ? "com" : "sem"} desoneração, diferente do regime informado.`);
  const alvo = { referencia, tabela: pedido.tabela, regime };

  const db = getDatabase();
  const sha = createHash("sha256").update(arquivo.bytes).digest("hex");
  const anterior = await db.prepare("SELECT id, referencia, arquivo_sha256 FROM goinfra_tabelas WHERE tabela = ?1 AND regime = ?2")
    .bind(alvo.tabela, alvo.regime).first<{ id: string; referencia: string; arquivo_sha256: string }>();
  if (anterior && anterior.referencia > alvo.referencia) throw new Error(`Já está ativa a referência ${anterior.referencia}, mais nova que ${alvo.referencia}.`);
  if (anterior?.arquivo_sha256 === sha && anterior.referencia === alvo.referencia) return { id: anterior.id, repetido: true, interpretacao, alvo };

  // Os itens novos nascem pendurados num id provisório; só a troca final os liga à tabela.
  const id = crypto.randomUUID();
  const provisorio = `importando-${id}`;
  await db.prepare(
    `INSERT INTO goinfra_tabelas (id, referencia, tabela, regime, arquivo_nome, arquivo_sha256, arquivo_bytes, aba, total_itens, ignoradas, importado_por, importado_em)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
  ).bind(id, alvo.referencia, provisorio, alvo.regime, arquivo.nome.slice(0, 200), sha, arquivo.bytes.length, interpretacao.aba.slice(0, 120), interpretacao.itens.length, interpretacao.ignoradas, autor, Date.now()).run();
  try {
    for (let inicio = 0; inicio < interpretacao.itens.length; inicio += LOTE) {
      await db.batch(interpretacao.itens.slice(inicio, inicio + LOTE).map((item) => db.prepare(
        "INSERT INTO goinfra_itens (id, tabela_id, codigo, descricao, unidade, custo_unitario_centavos) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      ).bind(crypto.randomUUID(), id, item.codigo, item.descricao, item.unidade, item.custoUnitarioCentavos)));
    }
    await db.batch([
      ...(anterior ? [
        db.prepare("DELETE FROM goinfra_itens WHERE tabela_id = ?1").bind(anterior.id),
        db.prepare("DELETE FROM goinfra_tabelas WHERE id = ?1").bind(anterior.id),
      ] : []),
      db.prepare("UPDATE goinfra_tabelas SET tabela = ?1 WHERE id = ?2").bind(alvo.tabela, id),
    ]);
  } catch (error) {
    await db.batch([
      db.prepare("DELETE FROM goinfra_itens WHERE tabela_id = ?1").bind(id),
      db.prepare("DELETE FROM goinfra_tabelas WHERE id = ?1").bind(id),
    ]).catch(() => undefined);
    throw error;
  }
  return { id, repetido: false, interpretacao, alvo };
}

/** Importação interrompida (função encerrada no meio) deixa uma tabela provisória: some aqui. */
export async function limparImportacoesInterrompidas() {
  const db = getDatabase();
  const { results } = await db.prepare("SELECT id FROM goinfra_tabelas WHERE tabela LIKE 'importando-%' AND importado_em < ?1").bind(Date.now() - 15 * 60_000).all<{ id: string }>();
  for (const { id } of results) {
    await db.batch([db.prepare("DELETE FROM goinfra_itens WHERE tabela_id = ?1").bind(id), db.prepare("DELETE FROM goinfra_tabelas WHERE id = ?1").bind(id)]);
  }
}
