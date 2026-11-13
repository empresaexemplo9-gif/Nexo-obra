// DADOS FICTÍCIOS DA DEMONSTRAÇÃO PÚBLICA.
//
// A pasta `lib/demonstracao/` é o único lugar do runtime onde existe dado inventado, e só
// a rota `/demonstracao` o usa. Ele nunca alimenta API, banco ou tela de empresa: a
// demonstração roda inteira no navegador do visitante e some ao fechar a aba. Os
// cadastros fictícios estão em `respostas.json`; aqui fica o desenho de exemplo do CAD.
// `tests/demonstracao.test.mjs` garante que nenhum outro módulo importa desta pasta.

import { documentoSchema, documentoVazio, type Documento, type Elemento } from "@/lib/prancheta";
import { compararCotacoes, situacaoDaEntrega, type StatusCompra } from "@/lib/compras";

/**
 * Planta de exemplo do Editor CAD: sala, cozinha, quarto e banheiro, em milímetros, com
 * pontos elétricos, luminárias e cotas — cada disciplina na camada dela, para o
 * visitante ligar e desligar. Passa pelo mesmo esquema que valida uma prancha real.
 */
export function plantaDeExemplo(): Documento {
  const doc = documentoVazio();
  let n = 0;
  const id = () => `demo-${(n += 1)}`;
  const el: Elemento[] = [];
  const parede = (ax: number, ay: number, bx: number, by: number, espessuraMm = 150) => el.push({ id: id(), camada: "layout", tipo: "parede", a: { x: ax, y: ay }, b: { x: bx, y: by }, espessuraMm });
  const comodo = (x1: number, y1: number, x2: number, y2: number, nome: string) => el.push({ id: id(), camada: "layout", tipo: "comodo", nome, pontos: [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }] });
  const abertura = (especie: "porta" | "janela", x: number, y: number, larguraMm: number, rotacaoGraus = 0) => el.push({ id: id(), camada: "layout", tipo: "abertura", especie, posicao: { x, y }, larguraMm, rotacaoGraus });
  const simbolo = (camada: "eletrico" | "luminotecnico", familia: string, x: number, y: number, rotacaoGraus = 0) => el.push({ id: id(), camada, tipo: "simbolo", familia, posicao: { x, y }, rotacaoGraus });
  const movel = (rotulo: string, x: number, y: number, larguraMm: number, alturaMm: number) => el.push({ id: id(), camada: "mobiliario", tipo: "mobilia", rotulo, posicao: { x, y }, larguraMm, alturaMm, rotacaoGraus: 0 });
  const cota = (ax: number, ay: number, bx: number, by: number, deslocamentoMm: number) => el.push({ id: id(), camada: "anotacao", tipo: "cota", a: { x: ax, y: ay }, b: { x: bx, y: by }, deslocamentoMm });

  comodo(0, 0, 5000, 4000, "Sala");
  comodo(5000, 0, 8000, 4000, "Cozinha");
  comodo(0, 4000, 4500, 7500, "Quarto");
  comodo(4500, 4000, 8000, 7500, "Banheiro e serviço");
  // Contorno e divisórias.
  parede(0, 0, 8000, 0); parede(8000, 0, 8000, 7500); parede(8000, 7500, 0, 7500); parede(0, 7500, 0, 0);
  parede(5000, 0, 5000, 4000, 120); parede(0, 4000, 8000, 4000, 120); parede(4500, 4000, 4500, 7500, 120);
  abertura("porta", 1200, 0, 900); abertura("janela", 3400, 0, 1800); abertura("janela", 6500, 0, 1200);
  abertura("porta", 2200, 4000, 800); abertura("porta", 6000, 4000, 700); abertura("janela", 2200, 7500, 1500);
  abertura("porta", 5000, 2000, 800, 90);

  movel("Sofá", 2500, 3300, 2200, 900); movel("Rack", 2500, 500, 1800, 450); movel("Mesa 4 lugares", 6500, 2600, 1200, 1200);
  movel("Bancada", 6500, 450, 2600, 600); movel("Cama casal", 2250, 6300, 1600, 2000); movel("Guarda-roupa", 500, 5600, 600, 2200);

  simbolo("eletrico", "tomada-baixa", 300, 1500); simbolo("eletrico", "tomada-baixa", 4700, 2800); simbolo("eletrico", "tv", 2500, 250);
  simbolo("eletrico", "tomada-media", 6000, 250); simbolo("eletrico", "tomada-media", 7200, 250); simbolo("eletrico", "interruptor-simples", 1900, 250);
  simbolo("eletrico", "tomada-baixa", 300, 6000); simbolo("eletrico", "interruptor-simples", 2900, 4250); simbolo("eletrico", "quadro", 7750, 5200, 90);
  simbolo("luminotecnico", "plafon", 2500, 2000); simbolo("luminotecnico", "pendente", 6500, 2600); simbolo("luminotecnico", "plafon", 2250, 5750);
  simbolo("luminotecnico", "spot", 5600, 5750); simbolo("luminotecnico", "spot", 7000, 5750);

  cota(0, 0, 8000, 0, -900); cota(0, 0, 0, 7500, 900);
  el.push({ id: id(), camada: "anotacao", tipo: "texto", posicao: { x: 0, y: -1800 }, texto: "PLANTA DE EXEMPLO — desenhe, mova e apague à vontade", alturaMm: 220, rotacaoGraus: 0 });

  return documentoSchema.parse({ ...doc, elementos: el });
}

/**
 * Compras fictícias: fornecedores, produtos e pedidos em cada etapa, para o visitante ver
 * o quadro, o comparativo e as entregas. Só leitura — lançar cotação ou comprar é recusado
 * pelo servidor da demonstração. O comparativo sai da mesma regra da plataforma.
 */
export function comprasDeExemplo(projetos: { id: string; code: string; name: string; kind: string }[]): Record<string, unknown> {
  const hoje = new Date().toISOString().slice(0, 10);
  const dia = (n: number) => new Date(Date.parse(`${hoje}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const obra = projetos.find((p) => p.kind === "work") ?? projetos[0] ?? null;
  const agora = new Date().toISOString();
  const dataBr = (d: string) => d.split("-").reverse().join("/");
  const fornecedores = [
    { id: "demo-forn-1", name: "Depósito Exemplo Materiais (exemplo)", document: "", contactName: "Rita", email: "", phone: "(62) 3000-0001", city: "Goiânia", uf: "GO", categories: "Cimento, areia, brita, blocos", paymentTerms: "28 dias", leadTimeDays: 5, negotiationScore: 3, notes: "", active: true, stats: { quotes: 3, won: 2, delivered: 1, onTime: 1, averageLeadDays: 4, purchasedCents: 1_248_000 } },
    { id: "demo-forn-2", name: "Casa do Construtor Modelo (exemplo)", document: "", contactName: "Paulo", email: "", phone: "(62) 3000-0002", city: "Aparecida de Goiânia", uf: "GO", categories: "Hidráulica, elétrica, ferragens", paymentTerms: "30/60", leadTimeDays: 2, negotiationScore: 5, notes: "", active: true, stats: { quotes: 2, won: 1, delivered: 0, onTime: 0, averageLeadDays: null, purchasedCents: 386_500 } },
    { id: "demo-forn-3", name: "Aço Forte Distribuidora (exemplo)", document: "", contactName: "", email: "", phone: "", city: "Anápolis", uf: "GO", categories: "Aço, telas, arame", paymentTerms: "À vista", leadTimeDays: 7, negotiationScore: 2, notes: "", active: true, stats: { quotes: 1, won: 0, delivered: 0, onTime: 0, averageLeadDays: null, purchasedCents: 0 } },
  ];
  const produto = (id: string, name: string, unit: string, category: string, ref: number | null, source = "manual") => ({ id, code: "", name, category, unit, brand: "", specification: "", source, sourceReference: null, referenceCostCents: ref, referenceLabel: ref ? (source === "manual" ? "Custo informado pela empresa" : "Referência de exemplo") : "", lastQuotedCents: null, quoteCount: 0, active: true, createdAt: agora, updatedAt: agora });
  const produtos = [
    produto("demo-prod-1", "Cimento CP-II 50 kg", "sc", "Básico", 3_250, "goinfra"),
    produto("demo-prod-2", "Areia média lavada", "m³", "Básico", 11_800),
    produto("demo-prod-3", "Vergalhão CA-50 10 mm (barra 12 m)", "br", "Aço", 5_690),
    produto("demo-prod-4", "Tubo PVC soldável 25 mm (barra 6 m)", "br", "Hidráulica", null),
  ];
  type ItemDemo = { id: string; productId: string | null; description: string; unit: string; quantity: number; receivedQuantity: number; referenceCostCents: number | null };
  type CotacaoDemo = { id: string; supplierId: string; deliveryDays: number; paymentTerms: string; paymentDays: number; freightCents: number; discountCents: number; validUntil: string | null; negotiationScore: number; prices: Record<string, number> };
  const pedidos: { base: Record<string, unknown>; itens: ItemDemo[]; cotacoes: CotacaoDemo[]; eventos: string[] }[] = [
    { base: { id: "demo-pc-1", number: 4, title: "Concreto da laje — cimento e areia", status: "a_orcar", priority: "alta", neededBy: dia(4), selectedQuoteId: null },
      itens: [
        { id: "demo-pc1-i1", productId: "demo-prod-1", description: "Cimento CP-II 50 kg", unit: "sc", quantity: 120, receivedQuantity: 0, referenceCostCents: 3_250 },
        { id: "demo-pc1-i2", productId: "demo-prod-2", description: "Areia média lavada", unit: "m³", quantity: 9, receivedQuantity: 0, referenceCostCents: 11_800 },
      ],
      cotacoes: [
        { id: "demo-q1", supplierId: "demo-forn-1", deliveryDays: 6, paymentTerms: "28 dias", paymentDays: 28, freightCents: 0, discountCents: 0, validUntil: dia(10), negotiationScore: 3, prices: { "demo-pc1-i1": 3_190, "demo-pc1-i2": 11_500 } },
        { id: "demo-q2", supplierId: "demo-forn-2", deliveryDays: 2, paymentTerms: "30/60", paymentDays: 45, freightCents: 18_000, discountCents: 5_000, validUntil: dia(7), negotiationScore: 5, prices: { "demo-pc1-i1": 3_350, "demo-pc1-i2": 12_200 } },
      ], eventos: ["Cotação lançada: Casa do Construtor Modelo (exemplo)", "Cotação lançada: Depósito Exemplo Materiais (exemplo)", "PC-0004 criado com 2 itens"] },
    { base: { id: "demo-pc-2", number: 3, title: "Aço das vigas do térreo", status: "a_comprar", priority: "normal", neededBy: dia(12), selectedQuoteId: "demo-q3" },
      itens: [{ id: "demo-pc2-i1", productId: "demo-prod-3", description: "Vergalhão CA-50 10 mm (barra 12 m)", unit: "br", quantity: 80, receivedQuantity: 0, referenceCostCents: 5_690 }],
      cotacoes: [{ id: "demo-q3", supplierId: "demo-forn-3", deliveryDays: 7, paymentTerms: "À vista", paymentDays: 0, freightCents: 25_000, discountCents: 0, validUntil: dia(5), negotiationScore: 2, prices: { "demo-pc2-i1": 5_480 } }],
      eventos: ["Fornecedor escolhido: Aço Forte Distribuidora (exemplo)", "PC-0003 criado com 1 item"] },
    { base: { id: "demo-pc-3", number: 2, title: "Hidráulica do banheiro social", status: "em_entrega", priority: "normal", neededBy: dia(1), selectedQuoteId: "demo-q4", orderNumber: "8812", orderedAt: dia(-4), purchasedTotalCents: 386_500, expectedDeliveryDate: dia(-1), carrier: "Entrega própria do fornecedor", trackingCode: "", dispatchedAt: dia(-2) },
      itens: [{ id: "demo-pc3-i1", productId: "demo-prod-4", description: "Tubo PVC soldável 25 mm (barra 6 m)", unit: "br", quantity: 50, receivedQuantity: 0, referenceCostCents: null }],
      cotacoes: [{ id: "demo-q4", supplierId: "demo-forn-2", deliveryDays: 2, paymentTerms: "30/60", paymentDays: 45, freightCents: 0, discountCents: 0, validUntil: null, negotiationScore: 5, prices: { "demo-pc3-i1": 7_730 } }],
      eventos: ["Saiu do fornecedor · Entrega própria do fornecedor", "Pedido feito · nº 8812", "PC-0002 criado com 1 item"] },
    { base: { id: "demo-pc-4", number: 1, title: "Blocos e argamassa — alvenaria", status: "entregue", priority: "normal", neededBy: dia(-10), selectedQuoteId: "demo-q5", orderNumber: "5531", orderedAt: dia(-16), purchasedTotalCents: 1_248_000, expectedDeliveryDate: dia(-11), dispatchedAt: dia(-12), deliveredAt: dia(-12) },
      itens: [{ id: "demo-pc4-i1", productId: null, description: "Bloco cerâmico 9×19×29", unit: "mil", quantity: 12, receivedQuantity: 12, referenceCostCents: null }],
      cotacoes: [{ id: "demo-q5", supplierId: "demo-forn-1", deliveryDays: 5, paymentTerms: "28 dias", paymentDays: 28, freightCents: 0, discountCents: 0, validUntil: null, negotiationScore: 3, prices: { "demo-pc4-i1": 104_000 } }],
      eventos: ["Entrega concluída", "Pedido feito · nº 5531", "PC-0001 criado com 1 item"] },
  ];
  const nomeDe = (id: string) => fornecedores.find((f) => f.id === id)?.name ?? "";
  const respostas: Record<string, unknown> = {};
  const resumos = pedidos.map(({ base, itens, cotacoes, eventos }) => {
    const comparison = compararCotacoes(itens, cotacoes.map((c) => ({ ...c, supplierName: nomeDe(c.supplierId) })), hoje, (base.neededBy as string) ?? null);
    const escolhida = comparison.linhas.find((l) => l.quoteId === base.selectedQuoteId);
    const status = base.status as StatusCompra;
    const request = {
      code: `PC-${String(base.number).padStart(4, "0")}`, projectId: obra?.id ?? null, projectName: obra?.name ?? null, projectCode: obra?.code ?? null,
      deliveryAddress: "Endereço da obra de exemplo", notes: "", orderNumber: "", orderedAt: null, purchasedTotalCents: null, expectedDeliveryDate: null,
      carrier: "", trackingCode: "", dispatchedAt: null, deliveredAt: null, cancelReason: "", revision: 1, createdByName: "Equipe de exemplo", createdAt: agora, updatedAt: agora,
      ...base,
      supplierId: escolhida?.supplierId ?? null, supplierName: escolhida?.supplierName ?? null,
      itemCount: itens.length, quoteCount: cotacoes.length,
      totalCents: (base.purchasedTotalCents as number | undefined) ?? escolhida?.totalCents ?? null,
      bestQuoteCents: comparison.linhas.filter((l) => l.nota !== null).reduce<number | null>((m, l) => m === null || l.totalCents < m ? l.totalCents : m, null),
      referenceCents: comparison.referenciaCents, partial: false,
      delivery: situacaoDaEntrega({ status, expectedDeliveryDate: (base.expectedDeliveryDate as string) ?? null, neededBy: (base.neededBy as string) ?? null, parcial: false }, hoje),
    };
    const quemCotou = new Set(cotacoes.map((c) => c.supplierId));
    const alternativas = status === "entregue" ? [] : fornecedores.filter((f) => !quemCotou.has(f.id)).slice(0, 2).map((f) => ({
      supplierId: f.id, name: f.name, phone: f.phone, email: f.email, reason: `Fornece ${f.categories}`, lastPriceCents: null, deliveryDays: f.leadTimeDays, onTime: f.stats.onTime, delivered: f.stats.delivered,
    }));
    respostas[`/api/compras/${base.id}`] = {
      alternatives: alternativas, request, items: itens, comparison, today: hoje,
      quotes: cotacoes.map((c) => ({ ...c, supplierName: nomeDe(c.supplierId), supplierPhone: "", supplierEmail: "", notes: "", createdByName: "Equipe de exemplo", updatedAt: agora })),
      events: eventos.map((detail, i) => ({ id: `${base.id}-ev-${i}`, kind: "registro", detail, authorName: "Equipe de exemplo", createdAt: agora })),
    };
    return request;
  });
  const local = obra?.id ?? "central";
  const nomeLocal = obra ? `${obra.code} · ${obra.name}` : "Depósito central";
  const sugestao = (f: typeof fornecedores[number], reason: string) => ({ supplierId: f.id, name: f.name, phone: f.phone, email: f.email, reason, lastPriceCents: null, deliveryDays: f.leadTimeDays, onTime: f.stats.onTime, delivered: f.stats.delivered });
  const saldo = (p: typeof produtos[number], balance: number, minimum: number | null, location = local, locationName = nomeLocal) => ({
    productId: p.id, productName: p.name, unit: p.unit, category: p.category, location, locationName, balance, minimum, lastMovementOn: dia(-2),
    state: minimum && balance < minimum ? (balance <= 0 ? "falta" : "abaixo") : balance <= 0 ? "zerado" : "ok",
  });
  respostas["/api/compras/estoque"] = {
    balances: [saldo(produtos[0], 18, 40), saldo(produtos[1], 0, 3), saldo(produtos[2], 22, 10), saldo(produtos[0], 35, null, "central", "Depósito central")],
    attention: [
      { key: "demo-at-1", kind: "falta", title: produtos[1].name, locationName: nomeLocal, detail: "Saldo 0 m³ de mínimo 3 · nenhuma compra aberta", productId: produtos[1].id, location: local, requestId: null, requestCode: null, suggestions: [sugestao(fornecedores[0], "Fornece Cimento, areia, brita, blocos")], suggestedQuantity: 3, unit: "m³" },
      { key: "demo-at-2", kind: "atrasada", title: "Hidráulica do banheiro social", locationName: nomeLocal, detail: `PC-0002 · 1 item pendente · previsão era ${dataBr(dia(-1))}`, productId: null, location: local, requestId: "demo-pc-3", requestCode: "PC-0002", suggestions: [], suggestedQuantity: null, unit: null },
      { key: "demo-at-3", kind: "abaixo", title: produtos[0].name, locationName: nomeLocal, detail: "Saldo 18 sc de mínimo 40 · PC-0004 ainda não comprado", productId: produtos[0].id, location: local, requestId: "demo-pc-1", requestCode: "PC-0004", suggestions: [sugestao(fornecedores[2], "Já cotou material parecido")], suggestedQuantity: null, unit: "sc" },
    ],
    movements: [
      { id: "demo-mov-1", productId: produtos[0].id, productName: produtos[0].name, unit: "sc", location: local, locationName: nomeLocal, kind: "baixa", quantity: -22, unitCostCents: null, source: "manual", requestId: null, requestCode: null, note: "Contrapiso da sala", occurredOn: dia(-2), authorName: "Equipe de exemplo", createdAt: agora },
      { id: "demo-mov-2", productId: produtos[2].id, productName: produtos[2].name, unit: "br", location: local, locationName: nomeLocal, kind: "entrada", quantity: 22, unitCostCents: 5_480, source: "manual", requestId: null, requestCode: null, note: "Sobra de outra obra", occurredOn: dia(-5), authorName: "Equipe de exemplo", createdAt: agora },
    ],
  };
  respostas["/api/compras"] = { requests: resumos, today: hoje, canEdit: true, canImportBudget: true };
  respostas["/api/compras/fornecedores"] = { suppliers: fornecedores };
  respostas["/api/compras/produtos"] = { products: produtos };
  respostas["/api/compras/catalogo"] = { items: [], emptyReason: "Na demonstração o catálogo GOINFRA e SINAPI não é consultado. Na conta da empresa a busca traz a tabela oficial importada.", goinfraTables: [] };
  return respostas;
}
