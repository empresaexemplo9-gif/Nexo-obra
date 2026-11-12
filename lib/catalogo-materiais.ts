// Catálogo de materiais padrão da construção, com a norma ABNT que define o produto e os
// parâmetros técnicos que a compra precisa especificar.
//
// Não há preço aqui, de propósito. Preço muda por mês, praça e loja, e um número escrito
// no código seria inventado no dia seguinte. Preço vem da SINAPI, da GOINFRA ou da lista
// de preços que o próprio fornecedor envia. O que este arquivo garante é que o item pedido
// existe, tem nome de mercado e a especificação que a nota fiscal e a obra conferem.
//
// Como os parâmetros normativos de `lib/parametros.ts`, a revisão é humana: a edição
// vigente de cada norma deve ser conferida no catálogo da ABNT antes de virar contrato.
// As massas lineares de aço são as nominais da tabela da ABNT NBR 7480.

export type MaterialPadrao = {
  codigo: string; nome: string; categoria: string; unidade: string; norma: string; especificacao: string;
};

const cimento = (codigo: string, tipo: string, nota: string): MaterialPadrao => ({
  codigo, nome: `Cimento Portland ${tipo} — saco 50 kg`, categoria: "Cimento e cal", unidade: "sc", norma: "ABNT NBR 16697",
  especificacao: `Cimento Portland tipo ${tipo}. ${nota} Saco de 50 kg com marca, tipo, classe e data de fabricação impressos.`,
});

const vergalhao = (codigo: string, categoria: "CA-50" | "CA-60", diametro: string, massa: string): MaterialPadrao => ({
  codigo, nome: `Vergalhão ${categoria} ${diametro} mm — barra 12 m`, categoria: "Aço para concreto", unidade: "br", norma: "ABNT NBR 7480",
  especificacao: `Aço ${categoria} (resistência característica de escoamento ${categoria === "CA-50" ? "500" : "600"} MPa), ${categoria === "CA-50" ? "nervurado" : "entalhado ou nervurado"}, diâmetro nominal ${diametro} mm, massa nominal ${massa} kg/m, barra reta de 12 m.`,
});

const tuboAgua = (codigo: string, diametro: number): MaterialPadrao => ({
  codigo, nome: `Tubo PVC soldável água fria ${diametro} mm — barra 6 m`, categoria: "Hidráulica", unidade: "br", norma: "ABNT NBR 5648",
  especificacao: `Tubo de PVC rígido soldável para água fria predial, diâmetro externo ${diametro} mm, barra de 6 m, cor marrom.`,
});

const tuboEsgoto = (codigo: string, diametro: number): MaterialPadrao => ({
  codigo, nome: `Tubo PVC esgoto série normal ${diametro} mm — barra 6 m`, categoria: "Hidráulica", unidade: "br", norma: "ABNT NBR 5688",
  especificacao: `Tubo de PVC para esgoto sanitário e ventilação, série normal, diâmetro nominal ${diametro} mm, ponta e bolsa, barra de 6 m, cor branca.`,
});

const cabo = (codigo: string, secao: string): MaterialPadrao => ({
  codigo, nome: `Cabo flexível ${secao} mm² 450/750 V — rolo 100 m`, categoria: "Elétrica", unidade: "rl", norma: "ABNT NBR NM 247-3",
  especificacao: `Cabo de cobre flexível, isolação em PVC 70 °C, tensão 450/750 V, seção nominal ${secao} mm², rolo de 100 m. Pedir a cor por circuito (fase, neutro azul-claro, proteção verde-amarelo).`,
});

export const MATERIAIS_PADRAO: MaterialPadrao[] = [
  cimento("MAT-001", "CP II-E-32", "Composto com escória, classe 32 MPa aos 28 dias."),
  cimento("MAT-002", "CP II-F-32", "Composto com fíler, classe 32 MPa aos 28 dias."),
  cimento("MAT-003", "CP II-Z-32", "Composto com pozolana, classe 32 MPa aos 28 dias."),
  cimento("MAT-004", "CP III-40 RS", "Alto-forno, classe 40 MPa, resistente a sulfatos."),
  cimento("MAT-005", "CP IV-32", "Pozolânico, classe 32 MPa."),
  cimento("MAT-006", "CP V-ARI", "Alta resistência inicial."),
  { codigo: "MAT-010", nome: "Cal hidratada CH-I — saco 20 kg", categoria: "Cimento e cal", unidade: "sc", norma: "ABNT NBR 7175", especificacao: "Cal hidratada tipo CH-I para argamassa, saco de 20 kg." },
  { codigo: "MAT-011", nome: "Cal hidratada CH-III — saco 20 kg", categoria: "Cimento e cal", unidade: "sc", norma: "ABNT NBR 7175", especificacao: "Cal hidratada tipo CH-III para argamassa, saco de 20 kg." },
  { codigo: "MAT-020", nome: "Areia média lavada", categoria: "Agregados", unidade: "m³", norma: "ABNT NBR 7211", especificacao: "Agregado miúdo para concreto e argamassa, lavado, livre de torrões de argila e matéria orgânica. Conferir volume pela caçamba na entrega." },
  { codigo: "MAT-021", nome: "Areia fina lavada", categoria: "Agregados", unidade: "m³", norma: "ABNT NBR 7211", especificacao: "Agregado miúdo fino para reboco e assentamento, lavado." },
  { codigo: "MAT-022", nome: "Brita 0 (pedrisco) — 4,8 a 9,5 mm", categoria: "Agregados", unidade: "m³", norma: "ABNT NBR 7211", especificacao: "Agregado graúdo de rocha britada, graduação comercial brita 0 (4,8 a 9,5 mm)." },
  { codigo: "MAT-023", nome: "Brita 1 — 9,5 a 19 mm", categoria: "Agregados", unidade: "m³", norma: "ABNT NBR 7211", especificacao: "Agregado graúdo de rocha britada, graduação comercial brita 1 (9,5 a 19 mm)." },
  { codigo: "MAT-030", nome: "Concreto usinado fck 20 MPa", categoria: "Concreto", unidade: "m³", norma: "ABNT NBR 7212 · ABNT NBR 8953", especificacao: "Concreto dosado em central, classe C20 (fck 20 MPa). Informar abatimento (slump), dimensão máxima do agregado e se haverá bombeamento." },
  { codigo: "MAT-031", nome: "Concreto usinado fck 25 MPa", categoria: "Concreto", unidade: "m³", norma: "ABNT NBR 7212 · ABNT NBR 8953", especificacao: "Concreto dosado em central, classe C25 (fck 25 MPa). Informar abatimento (slump), dimensão máxima do agregado e se haverá bombeamento." },
  { codigo: "MAT-032", nome: "Concreto usinado fck 30 MPa", categoria: "Concreto", unidade: "m³", norma: "ABNT NBR 7212 · ABNT NBR 8953", especificacao: "Concreto dosado em central, classe C30 (fck 30 MPa). Informar abatimento (slump), dimensão máxima do agregado e se haverá bombeamento." },
  vergalhao("MAT-040", "CA-60", "4,2", "0,109"),
  vergalhao("MAT-041", "CA-60", "5,0", "0,154"),
  vergalhao("MAT-042", "CA-50", "6,3", "0,245"),
  vergalhao("MAT-043", "CA-50", "8,0", "0,395"),
  vergalhao("MAT-044", "CA-50", "10,0", "0,617"),
  vergalhao("MAT-045", "CA-50", "12,5", "0,963"),
  vergalhao("MAT-046", "CA-50", "16,0", "1,578"),
  { codigo: "MAT-047", nome: "Tela soldada nervurada Q-92 — painel 2 × 3 m", categoria: "Aço para concreto", unidade: "pç", norma: "ABNT NBR 7481", especificacao: "Tela soldada de aço CA-60, tipo Q-92 (fios de 4,2 mm, malha 15 × 15 cm), painel de 2 × 3 m." },
  { codigo: "MAT-050", nome: "Bloco cerâmico de vedação 14 × 19 × 29 cm", categoria: "Alvenaria", unidade: "un", norma: "ABNT NBR 15270-1", especificacao: "Bloco cerâmico de vedação, furos na horizontal, 14 × 19 × 29 cm (L × A × C). Conferir esquadro e trincas no recebimento." },
  { codigo: "MAT-051", nome: "Bloco cerâmico de vedação 9 × 19 × 29 cm", categoria: "Alvenaria", unidade: "un", norma: "ABNT NBR 15270-1", especificacao: "Bloco cerâmico de vedação, furos na horizontal, 9 × 19 × 29 cm (L × A × C)." },
  { codigo: "MAT-052", nome: "Bloco de concreto 14 × 19 × 39 cm", categoria: "Alvenaria", unidade: "un", norma: "ABNT NBR 6136", especificacao: "Bloco vazado de concreto simples, 14 × 19 × 39 cm. Informar a classe (A, B ou C) conforme o projeto: estrutural ou vedação." },
  { codigo: "MAT-053", nome: "Bloco de concreto 19 × 19 × 39 cm", categoria: "Alvenaria", unidade: "un", norma: "ABNT NBR 6136", especificacao: "Bloco vazado de concreto simples, 19 × 19 × 39 cm. Informar a classe (A, B ou C) conforme o projeto." },
  { codigo: "MAT-060", nome: "Argamassa colante AC-I — saco 20 kg", categoria: "Argamassas", unidade: "sc", norma: "ABNT NBR 14081-1", especificacao: "Argamassa colante industrializada tipo AC-I, para revestimento cerâmico em áreas internas. Saco de 20 kg." },
  { codigo: "MAT-061", nome: "Argamassa colante AC-II — saco 20 kg", categoria: "Argamassas", unidade: "sc", norma: "ABNT NBR 14081-1", especificacao: "Argamassa colante industrializada tipo AC-II, para áreas internas e externas. Saco de 20 kg." },
  { codigo: "MAT-062", nome: "Argamassa colante AC-III — saco 20 kg", categoria: "Argamassas", unidade: "sc", norma: "ABNT NBR 14081-1", especificacao: "Argamassa colante industrializada tipo AC-III, de alta aderência (porcelanato, fachadas, piscinas). Saco de 20 kg." },
  { codigo: "MAT-063", nome: "Argamassa industrializada para assentamento e revestimento — saco 20 kg", categoria: "Argamassas", unidade: "sc", norma: "ABNT NBR 13281", especificacao: "Argamassa industrializada para assentamento de alvenaria e revestimento de paredes e tetos. Saco de 20 kg." },
  { codigo: "MAT-064", nome: "Rejunte cimentício — 1 kg", categoria: "Argamassas", unidade: "kg", norma: "ABNT NBR 14992", especificacao: "Argamassa à base de cimento Portland para rejuntamento de placas cerâmicas. Informar a cor e a largura da junta." },
  { codigo: "MAT-070", nome: "Porcelanato esmaltado retificado", categoria: "Revestimentos", unidade: "m²", norma: "ABNT NBR ISO 13006", especificacao: "Placa cerâmica de baixa absorção de água (grupo BIa). Informar formato, acabamento, classe de abrasão (PEI) e lote/tonalidade; comprar o lote inteiro de uma vez." },
  { codigo: "MAT-071", nome: "Piso cerâmico esmaltado", categoria: "Revestimentos", unidade: "m²", norma: "ABNT NBR ISO 13006", especificacao: "Placa cerâmica esmaltada para piso. Informar formato, classe de abrasão (PEI), coeficiente de atrito para área molhada e lote/tonalidade." },
  { codigo: "MAT-080", nome: "Telha cerâmica", categoria: "Cobertura", unidade: "un", norma: "ABNT NBR 15310", especificacao: "Telha cerâmica. Informar o modelo (colonial, portuguesa, romana, francesa) e o rendimento por m² do fabricante." },
  { codigo: "MAT-081", nome: "Telha de fibrocimento ondulada 6 mm", categoria: "Cobertura", unidade: "un", norma: "ABNT NBR 15210-1", especificacao: "Telha ondulada de fibrocimento sem amianto, espessura 6 mm. Informar o comprimento." },
  { codigo: "MAT-090", nome: "Manta asfáltica 4 mm — rolo 10 m²", categoria: "Impermeabilização", unidade: "rl", norma: "ABNT NBR 9952", especificacao: "Manta asfáltica para impermeabilização, espessura 4 mm, rolo de 1 × 10 m. Informar o tipo e a armadura (poliéster ou véu de vidro) do projeto." },
  tuboAgua("MAT-100", 20), tuboAgua("MAT-101", 25), tuboAgua("MAT-102", 32), tuboAgua("MAT-103", 50),
  tuboEsgoto("MAT-110", 40), tuboEsgoto("MAT-111", 50), tuboEsgoto("MAT-112", 100),
  { codigo: "MAT-120", nome: "Caixa d'água de polietileno 1.000 L", categoria: "Hidráulica", unidade: "un", norma: "ABNT NBR 14799", especificacao: "Reservatório de polietileno para água potável, 1.000 litros, com tampa." },
  { codigo: "MAT-121", nome: "Bacia sanitária com caixa acoplada", categoria: "Louças e metais", unidade: "un", norma: "ABNT NBR 15097-1", especificacao: "Bacia sanitária de louça com caixa acoplada e descarga de duplo acionamento. Informar a distância do esgoto à parede." },
  cabo("MAT-130", "1,5"), cabo("MAT-131", "2,5"), cabo("MAT-132", "4"), cabo("MAT-133", "6"), cabo("MAT-134", "10"),
  { codigo: "MAT-140", nome: "Eletroduto corrugado PVC 25 mm (3/4\") — rolo 50 m", categoria: "Elétrica", unidade: "rl", norma: "ABNT NBR 15465", especificacao: "Eletroduto flexível corrugado de PVC, diâmetro nominal 25 mm, rolo de 50 m. Amarelo para parede, laranja (reforçado) para laje." },
  { codigo: "MAT-141", nome: "Disjuntor termomagnético monopolar curva C", categoria: "Elétrica", unidade: "un", norma: "ABNT NBR NM 60898", especificacao: "Disjuntor termomagnético monopolar, curva C, padrão DIN. Informar a corrente nominal do projeto (10, 16, 20, 25, 32 A)." },
  { codigo: "MAT-142", nome: "Tomada 2P+T 10 A com placa", categoria: "Elétrica", unidade: "un", norma: "ABNT NBR 14136", especificacao: "Tomada de uso geral 2P+T, 10 A / 250 V, padrão brasileiro, com placa 4 × 2\"." },
  { codigo: "MAT-143", nome: "Tomada 2P+T 20 A com placa", categoria: "Elétrica", unidade: "un", norma: "ABNT NBR 14136", especificacao: "Tomada 2P+T, 20 A / 250 V, padrão brasileiro, para tomadas de uso específico, como cozinha e lavanderia, com placa 4 × 2\"." },
  { codigo: "MAT-150", nome: "Chapa de gesso para drywall ST 12,5 mm — 1,20 × 1,80 m", categoria: "Drywall", unidade: "pç", norma: "ABNT NBR 14715-1", especificacao: "Chapa de gesso standard (ST) para paredes e forros em área seca, 12,5 mm, 1,20 × 1,80 m." },
  { codigo: "MAT-151", nome: "Chapa de gesso para drywall RU 12,5 mm — 1,20 × 1,80 m", categoria: "Drywall", unidade: "pç", norma: "ABNT NBR 14715-1", especificacao: "Chapa de gesso resistente à umidade (RU, face verde) para áreas molháveis, 12,5 mm, 1,20 × 1,80 m." },
  { codigo: "MAT-152", nome: "Montante de aço galvanizado 70 mm — barra 3 m", categoria: "Drywall", unidade: "br", norma: "ABNT NBR 15217", especificacao: "Perfil montante de aço galvanizado para drywall, largura 70 mm, barra de 3 m." },
  { codigo: "MAT-160", nome: "Tinta látex acrílica — lata 18 L", categoria: "Pintura", unidade: "lt", norma: "ABNT NBR 15079", especificacao: "Tinta látex acrílica para paredes. Informar a cor, o acabamento (fosco, acetinado, semibrilho) e a categoria de desempenho (premium, standard, econômica)." },
];

const normalizar = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function buscarMaterialPadrao(termo: string, limite = 50): MaterialPadrao[] {
  const palavras = normalizar(termo).split(/\s+/).filter(Boolean);
  if (!palavras.length) return [];
  return MATERIAIS_PADRAO.filter((m) => {
    const alvo = normalizar(`${m.codigo} ${m.nome} ${m.categoria} ${m.norma}`);
    return palavras.every((p) => alvo.includes(p));
  }).slice(0, limite);
}

export const materialPadrao = (codigo: string) => MATERIAIS_PADRAO.find((m) => m.codigo === codigo) ?? null;
