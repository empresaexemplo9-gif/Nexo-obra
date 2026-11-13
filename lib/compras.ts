// Regras de Compras que valem dos dois lados: o servidor decide com elas e a tela mostra
// o mesmo resultado. Nada aqui lê banco nem rede.

export const STATUS_COMPRA = ["a_orcar", "a_comprar", "comprado", "em_entrega", "entregue", "cancelado"] as const;
export type StatusCompra = typeof STATUS_COMPRA[number];

export const rotuloStatus: Record<StatusCompra, string> = {
  a_orcar: "A orçar",
  a_comprar: "A comprar",
  comprado: "Comprado",
  em_entrega: "Em entrega",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

/** O que cada etapa pergunta a quem abre a fila. */
export const perguntaDoStatus: Record<StatusCompra, string> = {
  a_orcar: "Faltam cotações ou a escolha do fornecedor.",
  a_comprar: "Fornecedor escolhido; falta fazer o pedido.",
  comprado: "Pedido feito; aguardando o envio do fornecedor.",
  em_entrega: "Material a caminho ou entregue em parte.",
  entregue: "Tudo recebido na obra.",
  cancelado: "Compra cancelada.",
};

export const PRIORIDADES = ["baixa", "normal", "alta", "urgente"] as const;
export type PrioridadeCompra = typeof PRIORIDADES[number];
export const rotuloPrioridade: Record<PrioridadeCompra, string> = { baixa: "Baixa", normal: "Normal", alta: "Alta", urgente: "Urgente" };

/** Itens só mudam enquanto nada foi escolhido: depois disso a cotação é o contrato. */
export const itensEditaveis = (status: StatusCompra) => status === "a_orcar";
/** Cotação muda até o pedido sair. */
export const cotacoesEditaveis = (status: StatusCompra) => status === "a_orcar" || status === "a_comprar";
/** Logística (transportadora, rastreio, previsão) muda enquanto o material não chegou. */
export const logisticaEditavel = (status: StatusCompra) => status === "comprado" || status === "em_entrega";
export const emAndamento = (status: StatusCompra) => status === "comprado" || status === "em_entrega";
export const encerrada = (status: StatusCompra) => status === "entregue" || status === "cancelado";

export function numeroDoPedido(numero: number) { return `PC-${String(numero).padStart(4, "0")}`; }

export function somarDias(dia: string, dias: number): string {
  const data = new Date(`${dia}T12:00:00.000Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00.000Z`) - Date.parse(`${de}T12:00:00.000Z`)) / 86_400_000);
}

/** Quantidade × preço unitário, arredondado ao centavo na linha (como a nota fiscal). */
export function totalDaLinha(quantidade: number, unitarioCentavos: number): number {
  return Math.round(quantidade * unitarioCentavos);
}

export type ItemParaComparar = { id: string; description: string; quantity: number; referenceCostCents: number | null };
export type CotacaoParaComparar = {
  id: string; supplierId: string; supplierName: string;
  deliveryDays: number; paymentDays: number; freightCents: number; discountCents: number;
  negotiationScore: number; validUntil: string | null;
  prices: Record<string, number>;
};

/**
 * Pesos do comparativo. Preço pesa mais, mas o material que chega depois da concretagem
 * custa mais caro do que a diferença de preço — por isso prazo vem logo atrás.
 * Prazo de pagamento e disposição para negociar desempatam.
 */
export const PESOS = { preco: 0.45, prazo: 0.3, pagamento: 0.1, negociacao: 0.15 } as const;

export type LinhaDoComparativo = {
  quoteId: string; supplierId: string; supplierName: string;
  subtotalCents: number; totalCents: number; itensCotados: number; completa: boolean;
  deliveryDays: number; paymentDays: number; negotiationScore: number;
  /** Previsão de chegada contando a partir de hoje, quando o pedido sair agora. */
  chegadaPrevista: string;
  chegaATempo: boolean | null;
  vencida: boolean;
  /** Diferença em relação ao custo de referência (GOINFRA, SINAPI ou biblioteca). */
  diferencaReferenciaPercent: number | null;
  nota: number | null;
  menorPreco: boolean; menorPrazo: boolean; melhorPagamento: boolean; melhorNegociacao: boolean; recomendada: boolean;
};

export type Comparativo = {
  linhas: LinhaDoComparativo[];
  /** Menor preço de cada item entre todas as cotações. */
  melhorPorItem: Record<string, { quoteId: string; unitPriceCents: number } | null>;
  /** Quanto custaria comprar cada item do fornecedor mais barato para ele (sem frete). */
  totalItemAItemCents: number | null;
  referenciaCents: number | null;
};

export function compararCotacoes(itens: ItemParaComparar[], cotacoes: CotacaoParaComparar[], hoje: string, necessarioEm: string | null): Comparativo {
  const referenciaCompleta = itens.length > 0 && itens.every((item) => item.referenceCostCents !== null);
  const referenciaCents = referenciaCompleta ? itens.reduce((soma, item) => soma + totalDaLinha(item.quantity, item.referenceCostCents!), 0) : null;

  const base = cotacoes.map((cotacao) => {
    let subtotal = 0; let cotados = 0;
    for (const item of itens) {
      const preco = cotacao.prices[item.id];
      if (preco === undefined) continue;
      subtotal += totalDaLinha(item.quantity, preco);
      cotados += 1;
    }
    const completa = itens.length > 0 && cotados === itens.length;
    const total = Math.max(0, subtotal + cotacao.freightCents - cotacao.discountCents);
    const chegadaPrevista = somarDias(hoje, cotacao.deliveryDays);
    return {
      quoteId: cotacao.id, supplierId: cotacao.supplierId, supplierName: cotacao.supplierName,
      subtotalCents: subtotal, totalCents: total, itensCotados: cotados, completa,
      deliveryDays: cotacao.deliveryDays, paymentDays: cotacao.paymentDays, negotiationScore: cotacao.negotiationScore,
      chegadaPrevista,
      chegaATempo: necessarioEm ? chegadaPrevista <= necessarioEm : null,
      vencida: Boolean(cotacao.validUntil && cotacao.validUntil < hoje),
      diferencaReferenciaPercent: completa && referenciaCents ? Math.round(((subtotal - referenciaCents) / referenciaCents) * 1000) / 10 : null,
    };
  });

  // Só cotação completa e válida concorre: comparar total de quem cotou metade dos itens
  // premiaria justamente quem deixou de cotar.
  const concorrentes = base.filter((linha) => linha.completa && !linha.vencida);
  const menorTotal = Math.min(...concorrentes.map((l) => l.totalCents));
  const menorPrazo = Math.min(...concorrentes.map((l) => l.deliveryDays));
  const maiorPagamento = Math.max(...concorrentes.map((l) => l.paymentDays));
  const maiorNegociacao = Math.max(...concorrentes.map((l) => l.negotiationScore));

  const linhas: LinhaDoComparativo[] = base.map((linha) => {
    const concorre = concorrentes.includes(linha);
    const nota = concorre
      ? Math.round(100 * (
        PESOS.preco * (linha.totalCents > 0 ? menorTotal / linha.totalCents : 1) +
        PESOS.prazo * (Math.max(1, menorPrazo) / Math.max(1, linha.deliveryDays)) +
        PESOS.pagamento * (maiorPagamento > 0 ? linha.paymentDays / maiorPagamento : 1) +
        PESOS.negociacao * (linha.negotiationScore / 5)
      ))
      : null;
    return {
      ...linha, nota,
      menorPreco: concorre && linha.totalCents === menorTotal,
      menorPrazo: concorre && linha.deliveryDays === menorPrazo,
      melhorPagamento: concorre && maiorPagamento > 0 && linha.paymentDays === maiorPagamento,
      melhorNegociacao: concorre && linha.negotiationScore === maiorNegociacao,
      recomendada: false,
    };
  });

  // Recomendada: maior nota entre as que chegam a tempo; se nenhuma chega, a maior nota.
  const candidatas = linhas.filter((l) => l.nota !== null);
  const aTempo = candidatas.filter((l) => l.chegaATempo !== false);
  const escolha = (aTempo.length ? aTempo : candidatas).sort((a, b) => (b.nota! - a.nota!) || (a.totalCents - b.totalCents))[0];
  if (escolha) escolha.recomendada = true;

  const melhorPorItem: Comparativo["melhorPorItem"] = {};
  let itemAItem = 0; let todosCotados = itens.length > 0;
  for (const item of itens) {
    let melhor: { quoteId: string; unitPriceCents: number } | null = null;
    for (const cotacao of cotacoes) {
      if (cotacao.validUntil && cotacao.validUntil < hoje) continue;
      const preco = cotacao.prices[item.id];
      if (preco !== undefined && (!melhor || preco < melhor.unitPriceCents)) melhor = { quoteId: cotacao.id, unitPriceCents: preco };
    }
    melhorPorItem[item.id] = melhor;
    if (melhor) itemAItem += totalDaLinha(item.quantity, melhor.unitPriceCents); else todosCotados = false;
  }

  return { linhas: linhas.sort((a, b) => (b.nota ?? -1) - (a.nota ?? -1) || a.totalCents - b.totalCents), melhorPorItem, totalItemAItemCents: todosCotados ? itemAItem : null, referenciaCents };
}

export type SituacaoDaEntrega = "sem_previsao" | "atrasada" | "hoje" | "no_prazo" | "depois_da_necessidade" | "entregue" | "parcial";

/** Como a entrega está em relação à previsão do fornecedor e à data em que a obra precisa. */
export function situacaoDaEntrega(pedido: { status: StatusCompra; expectedDeliveryDate: string | null; neededBy: string | null; parcial: boolean }, hoje: string): SituacaoDaEntrega | null {
  if (pedido.status === "entregue") return "entregue";
  if (!emAndamento(pedido.status)) return null;
  if (!pedido.expectedDeliveryDate) return pedido.parcial ? "parcial" : "sem_previsao";
  if (pedido.expectedDeliveryDate < hoje) return "atrasada";
  if (pedido.expectedDeliveryDate === hoje) return "hoje";
  if (pedido.neededBy && pedido.expectedDeliveryDate > pedido.neededBy) return "depois_da_necessidade";
  return pedido.parcial ? "parcial" : "no_prazo";
}

export const rotuloSituacao: Record<SituacaoDaEntrega, string> = {
  sem_previsao: "Sem previsão",
  atrasada: "Atrasada",
  hoje: "Chega hoje",
  no_prazo: "No prazo",
  depois_da_necessidade: "Chega depois da necessidade",
  entregue: "Entregue",
  parcial: "Entrega parcial",
};
