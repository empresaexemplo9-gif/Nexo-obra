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
  // Array puro não declara total. Dizer que o total é o tamanho da página faria o
  // adaptador — que usa `total` como teto de paginação — parar na primeira página e
  // descartar o resto em silêncio.
  if (Array.isArray(corpo)) return { itens: corpo, total: null };
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

/** Número como a Drap escreve: "1.234,56" (brasileiro) e "1234.56" (ponto decimal)
 *  convivem. O ponto é milhar com vírgula presente ou em grupos de três dígitos — tirá-lo sempre
 *  transforma 1500.50 em 150050, que num sistema financeiro é dinheiro errado gravado. */
export function lerValorBrasileiro(bruto: string): number | null {
  const limpo = bruto.trim().replace(/\s|R\$/g, "");
  if (!limpo) return null;
  // Sem vírgula, ponto seguido de grupos de exatamente três dígitos é milhar, como no
  // Excel em português e na planilha da plataforma: "1.500" é mil e quinhentos, não 1,5.
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".")
    : /^[+-]?\d{1,3}(\.\d{3})+$/.test(limpo) ? limpo.replace(/\./g, "") : limpo;
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}
