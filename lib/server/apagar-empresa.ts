import type { getDatabase } from "@/db";

/**
 * Apagar uma empresa, e o que isso significa de verdade.
 *
 * ─── POR QUE A LISTA DE TABELAS NÃO É ESCRITA AQUI ───
 *
 * O dado de uma empresa está espalhado por dezenas de tabelas, e a lista muda toda vez
 * que o produto ganha uma funcionalidade. Uma lista escrita à mão fica desatualizada
 * exatamente no pior momento: a tabela nova é a que ninguém lembra, e o que sobra dela é
 * linha órfã apontando para uma empresa que não existe mais.
 *
 * Duas tabelas deste projeto provam o ponto. `audit_events` e `organization_members`
 * guardam dado de empresa, estão vivas, e NÃO existem em `db/schema.ts` — vieram da
 * primeira migração e nunca foram declaradas. Qualquer lista derivada do schema deixaria
 * as duas para trás.
 *
 * Por isso a fonte é o banco. `sqlite_master` diz quais tabelas existem, `table_info` diz
 * quais têm `organization_id`, e `foreign_key_list` diz quem depende de quem. Tabela nova
 * entra sozinha, sem ninguém lembrar de nada.
 *
 * ─── ORDEM ───
 *
 * As chaves estrangeiras estão ligadas (`PRAGMA foreign_keys = 1`), então apagar o pai
 * antes do filho falha. A ordem sai de uma ordenação topológica do grafo de dependências,
 * também lido do banco: quem depende vai primeiro.
 *
 * ─── FILHA SEM A COLUNA ───
 *
 * `budget_items` guarda item de orçamento e não tem `organization_id` — ela pendura em
 * `budget_versions`. Apagar só pelas tabelas que têm a coluna deixaria os itens para
 * trás. Essas filhas são descobertas pelo mesmo `foreign_key_list` e apagadas por
 * subconsulta na mãe.
 */

type Db = ReturnType<typeof getDatabase>;
type Prepared = ReturnType<Db["prepare"]>;

/** Tabela do sistema e as que não pertencem a nenhuma empresa ficam fora. */
const FORA = new Set(["_platform_migrations", "organizations", "users", "user_credentials"]);

async function tabelas(db: Db): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all<{ name: string }>();
  return (results ?? []).map((linha) => linha.name).filter((nome) => !FORA.has(nome));
}

async function colunas(db: Db, tabela: string): Promise<string[]> {
  // `PRAGMA` não aceita parâmetro; o nome vem de `sqlite_master`, nunca de entrada de
  // usuário, e o filtro de tabelas acima já descartou qualquer coisa fora do catálogo.
  const { results } = await db.prepare(`PRAGMA table_info(${tabela})`).all<{ name: string }>();
  return (results ?? []).map((linha) => linha.name);
}

async function dependencias(db: Db, tabela: string): Promise<{ mae: string; coluna: string; referida: string }[]> {
  const { results } = await db
    .prepare(`PRAGMA foreign_key_list(${tabela})`)
    .all<{ table: string; from: string; to: string | null }>();
  return (results ?? []).map((linha) => ({ mae: linha.table, coluna: linha.from, referida: linha.to ?? "id" }));
}

type Alvo = {
  tabela: string;
  /** Como achar as linhas desta empresa. */
  onde: "coluna" | "mae";
  /** Quando `mae`: a subconsulta que liga esta tabela à empresa. */
  via?: { coluna: string; mae: string; referida: string };
};

/**
 * O mapa do que sai junto com a empresa, lido do banco agora.
 *
 * Devolvido em ordem de exclusão: quem depende de alguém vem antes de quem é dependido.
 */
export async function mapaDaExclusao(db: Db): Promise<Alvo[]> {
  const nomes = await tabelas(db);
  const temOrg = new Set<string>();
  for (const nome of nomes) {
    if ((await colunas(db, nome)).includes("organization_id")) temOrg.add(nome);
  }

  const alvos = new Map<string, Alvo>();
  for (const nome of temOrg) alvos.set(nome, { tabela: nome, onde: "coluna" });

  // Filhas sem a coluna: entram pela mãe. Uma passada resolve o caso real
  // (`budget_items`); repetir até estabilizar cobre uma neta que venha a existir.
  for (let volta = 0; volta < 5; volta += 1) {
    let cresceu = false;
    for (const nome of nomes) {
      if (alvos.has(nome)) continue;
      const elo = (await dependencias(db, nome)).find((d) => alvos.has(d.mae));
      if (!elo) continue;
      alvos.set(nome, { tabela: nome, onde: "mae", via: { coluna: elo.coluna, mae: elo.mae, referida: elo.referida } });
      cresceu = true;
    }
    if (!cresceu) break;
  }

  return ordenar(await grafo(db, [...alvos.keys()]), alvos);
}

async function grafo(db: Db, nomes: string[]): Promise<Map<string, Set<string>>> {
  const dentro = new Set(nomes);
  const arestas = new Map<string, Set<string>>();
  for (const nome of nomes) {
    const maes = (await dependencias(db, nome)).map((d) => d.mae).filter((mae) => dentro.has(mae) && mae !== nome);
    arestas.set(nome, new Set(maes));
  }
  return arestas;
}

/** Dependente primeiro. Um ciclo (auto-referência que escapou) não trava: o que sobra
 *  entra no fim, e o pior caso é uma exclusão que falha alto em vez de silenciar. */
function ordenar(arestas: Map<string, Set<string>>, alvos: Map<string, Alvo>): Alvo[] {
  const ordem: string[] = [];
  const posto = new Set<string>();
  let restantes = [...arestas.keys()];
  while (restantes.length > 0) {
    const prontos = restantes.filter((nome) => [...(arestas.get(nome) ?? [])].every((mae) => posto.has(mae) || !arestas.has(mae)));
    if (prontos.length === 0) { ordem.push(...restantes); break; }
    // Quem só depende de tabelas já posicionadas entra agora — e como "posicionado"
    // significa "será apagado depois", a lista final fica com o dependente na frente.
    for (const nome of prontos) posto.add(nome);
    ordem.push(...prontos);
    restantes = restantes.filter((nome) => !posto.has(nome));
  }
  // `ordem` saiu com a mãe antes da filha (a mãe é quem não depende de ninguém do grupo).
  // Apagar exige o contrário.
  return ordem.reverse().map((nome) => alvos.get(nome)!).filter(Boolean);
}

/** As instruções que apagam a empresa inteira, prontas para um `batch` — que é
 *  transacional: ou some tudo, ou não some nada. Meia empresa apagada é pior do que
 *  nenhuma, porque ninguém sabe o que sobrou. */
export async function instrucoesParaApagarEmpresa(db: Db, organizationId: string): Promise<Prepared[]> {
  const mapa = await mapaDaExclusao(db);
  const instrucoes = mapa.map((alvo) => alvo.onde === "coluna"
    ? db.prepare(`DELETE FROM ${alvo.tabela} WHERE organization_id = ?1`).bind(organizationId)
    : db.prepare(
      `DELETE FROM ${alvo.tabela} WHERE ${alvo.via!.coluna} IN (SELECT ${alvo.via!.referida} FROM ${alvo.via!.mae} WHERE organization_id = ?1)`,
    ).bind(organizationId));
  instrucoes.push(db.prepare("DELETE FROM organizations WHERE id = ?1").bind(organizationId));
  return instrucoes;
}

/**
 * Quem fica sem empresa nenhuma quando esta sair.
 *
 * Uma conta que existe e não pertence a lugar nenhum consegue entrar e não vê nada — a
 * pessoa fica olhando uma tela vazia sem saber se perdeu acesso ou se o produto quebrou.
 * Quem também é membro de outra empresa não aparece aqui: perde este vínculo e continua
 * entrando no resto.
 *
 * Roda ANTES da exclusão: depois, as linhas que respondem a pergunta já não existem.
 */
export async function contasQueFicamSemEmpresa(db: Db, organizationId: string): Promise<string[]> {
  const { results } = await db.prepare(
    `SELECT DISTINCT u.id
       FROM users u
      WHERE (
              EXISTS (SELECT 1 FROM organization_members om WHERE om.user_id = u.id AND om.organization_id = ?1)
           OR EXISTS (SELECT 1 FROM members m WHERE m.external_user_id = u.id AND m.organization_id = ?1)
            )
        AND NOT EXISTS (SELECT 1 FROM organization_members om WHERE om.user_id = u.id AND om.organization_id <> ?1)
        AND NOT EXISTS (SELECT 1 FROM members m WHERE m.external_user_id = u.id AND m.organization_id <> ?1)`,
  ).bind(organizationId).all<{ id: string }>();
  return (results ?? []).map((linha) => linha.id);
}

/** Apaga a pessoa da plataforma: credencial de acesso e o registro dela.
 *  Os vínculos com empresas saem antes, junto da empresa ou por conta própria. */
export function instrucoesParaApagarContas(db: Db, userIds: string[]): Prepared[] {
  if (userIds.length === 0) return [];
  const marcadores = userIds.map((_, indice) => `?${indice + 1}`).join(", ");
  return [
    db.prepare(`DELETE FROM user_credentials WHERE user_id IN (${marcadores})`).bind(...userIds),
    db.prepare(`DELETE FROM users WHERE id IN (${marcadores})`).bind(...userIds),
  ];
}

/** Tira a pessoa de todas as empresas. Usado ao apagar a conta por inteiro — as duas
 *  tabelas de vínculo existem e esquecer uma deixaria a pessoa listada como membro de uma
 *  empresa cujo login não existe mais. */
export function instrucoesParaDesvincularContas(db: Db, userIds: string[]): Prepared[] {
  if (userIds.length === 0) return [];
  const marcadores = userIds.map((_, indice) => `?${indice + 1}`).join(", ");
  return [
    db.prepare(`DELETE FROM organization_members WHERE user_id IN (${marcadores})`).bind(...userIds),
    db.prepare(`DELETE FROM members WHERE external_user_id IN (${marcadores})`).bind(...userIds),
  ];
}
