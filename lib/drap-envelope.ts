// Leitura do envelope de listagem da Drap.
//
// Módulo puro de propósito: sem `fetch`, sem credencial, sem `runtimeEnv`. É o que permite
// que o servidor e a tela usem a MESMA regra sem que o componente cliente importe o
// adaptador da Drap — o que a regra 4 do CLAUDE.md proíbe.
//
// As formas aceitas não são chute: saíram da homologação contra a API real, que confirmou
// `{ items, total }`. As outras ficam porque já foram observadas em respostas da Drap e
// tirá-las só reintroduziria a leitura vazia silenciosa que custou o financeiro por obra.

export type EnvelopeLido = { itens: unknown[]; total: number | null };

function registro(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor as Record<string, unknown> : {};
}

// O total declarado chega como número ou como texto, conforme a rota.
function totalDeclarado(raiz: Record<string, unknown>): number | null {
  const bruto = raiz.total;
  if (typeof bruto === "number" && Number.isFinite(bruto) && bruto >= 0) return bruto;
  if (typeof bruto === "string") {
    const numero = Number(bruto);
    if (Number.isFinite(numero) && numero >= 0) return numero;
  }
  return null;
}

/** Devolve `null` quando o corpo não tem nenhuma lista reconhecível — quem chama decide
 *  se isso é erro a mostrar ou lista vazia. Tratar as duas coisas como "vazio" foi o que
 *  escondeu, por semanas, o financeiro por obra voltando sem nada. */
export function lerEnvelope(corpo: unknown): EnvelopeLido | null {
  if (Array.isArray(corpo)) return { itens: corpo, total: corpo.length };
  if (!corpo || typeof corpo !== "object") return null;
  const raiz = registro(corpo);
  const lista = [raiz.items, raiz.transactions, raiz.results, raiz.lancamentos, registro(raiz.data).items, raiz.data]
    .find(Array.isArray);
  if (!lista) return null;
  return { itens: lista, total: totalDeclarado(raiz) };
}

/** Os campos do corpo, para a mensagem de erro dizer o que a Drap devolveu. */
export function camposDoCorpo(corpo: unknown): string[] {
  return corpo && typeof corpo === "object" && !Array.isArray(corpo) ? Object.keys(corpo) : [];
}
