// Catálogo do criador de layout: móveis, marcenaria, alvenaria, eletrodomésticos, louças,
// veículos e área externa.
//
// Medidas em milímetro, as de mercado (cama queen 1580 × 1980, carro sedã 4600 × 1800,
// balcão americano a 1,10 m, vaga 2500 × 5000). É o que faz a prévia servir de noção de
// espaço: um carro que cabe na garagem do desenho cabe na garagem da obra. Cada item pode
// ter a medida ajustada na tela.
//
// `forma` escolhe o desenho em planta e o volume em 3D; itens parecidos compartilham a
// mesma forma com medidas diferentes. `materiais` lista os acabamentos que o item aceita
// (tampo da mesa, bancada, superfície do móvel); a cor continua valendo para a estrutura.

export type Forma =
  | "sofa" | "sofa-l" | "poltrona" | "puff" | "mesa" | "mesa-redonda" | "cadeira" | "banqueta" | "rack-tv" | "painel-tv" | "estante" | "tapete" | "mesa-centro"
  | "aparador" | "comoda" | "cristaleira" | "adega"
  | "cama" | "beliche" | "berco" | "criado" | "guarda-roupa" | "penteadeira" | "escrivaninha" | "cadeira-escritorio"
  | "geladeira" | "fogao" | "cooktop" | "bancada-pia" | "armario" | "armario-aereo" | "micro-ondas" | "lava-loucas" | "coifa" | "torre-quente"
  | "balcao" | "balcao-atendimento"
  | "vaso" | "lavatorio" | "box" | "banheira" | "hidro"
  | "maquina-lavar" | "tanque"
  | "banco-alvenaria" | "sofa-alvenaria" | "cama-alvenaria" | "mureta" | "floreira" | "nicho" | "lareira" | "bancada-churrasqueira"
  | "caixa-teto" | "caixa-torre" | "soundbar" | "subwoofer" | "receiver" | "projetor" | "tela-projecao" | "poltrona-cinema"
  | "ar-split" | "ar-condensadora" | "ar-cassete" | "ar-piso-teto"
  | "cortina" | "persiana"
  | "carro" | "moto" | "bicicleta" | "vaga" | "wallbox" | "bancada-ferramentas"
  | "arvore" | "planta" | "piscina" | "espreguicadeira" | "churrasqueira" | "pergolado" | "mesa-guarda-sol";

export type Categoria = "sala" | "quarto" | "cozinha" | "balcoes" | "alvenaria" | "banheiro" | "lavanderia" | "escritorio"
  | "audio" | "clima" | "cortinas" | "garagem" | "externo";

export const categoriaLabels: Record<Categoria, string> = {
  sala: "Sala e jantar", quarto: "Quarto", cozinha: "Cozinha", balcoes: "Balcões e bancadas", alvenaria: "Alvenaria",
  banheiro: "Banheiro", lavanderia: "Lavanderia", escritorio: "Escritório", audio: "Som e home cinema", clima: "Ar-condicionado",
  cortinas: "Cortinas e persianas", garagem: "Garagem e veículos", externo: "Área externa",
};

export const MATERIAIS = ["madeira", "vidro", "marmore", "granito", "quartzo", "laca", "metal", "concreto"] as const;
export type Material = typeof MATERIAIS[number];
export const materialLabels: Record<Material, string> = {
  madeira: "Madeira", vidro: "Vidro", marmore: "Mármore", granito: "Granito", quartzo: "Quartzo branco",
  laca: "Laca", metal: "Metal / inox", concreto: "Concreto",
};

/** Tom da madeira de tampo (bancada, balcão) quando o corpo da peça tem outra cor. */
export const MADEIRA_TAMPO = "#a07650";

// Conjuntos de acabamento por tipo de peça: o que faz sentido para cada uma.
const TAMPO_MESA: Material[] = ["madeira", "vidro", "marmore", "granito", "laca", "metal"];
const TAMPO_CENTRO: Material[] = ["madeira", "vidro", "marmore", "metal"];
const BANCADA: Material[] = ["granito", "marmore", "quartzo", "madeira", "concreto", "metal"];
const MARCENARIA: Material[] = ["madeira", "laca", "vidro", "marmore"];
const LAVATORIO: Material[] = ["marmore", "granito", "quartzo", "madeira"];
const TAMPO_ALVENARIA: Material[] = ["granito", "marmore", "quartzo", "concreto", "madeira"];

export type ItemCatalogo = {
  id: string; nome: string; categoria: Categoria; forma: Forma;
  largura: number; profundidade: number; altura: number;
  cor: string;
  /** Altura do chão até a base: armário aéreo, TV na parede, coifa. */
  elevacao?: number;
  /** Variante da forma: tipo de carro, número de lugares, de bocas, de banquetas. */
  variante?: string;
  /** Acabamentos aceitos e o que vem escolhido. */
  materiais?: Material[];
  material?: Material;
  /** Alvenaria: corpo em bloco rebocado, sem portas de marcenaria. */
  alvenaria?: boolean;
};

const REBOCO = "#e6dfd2";

export const CATALOGO: ItemCatalogo[] = [
  { id: "sofa-3", nome: "Sofá 3 lugares", categoria: "sala", forma: "sofa", largura: 2100, profundidade: 900, altura: 850, cor: "#8c7b6b", variante: "3" },
  { id: "sofa-2", nome: "Sofá 2 lugares", categoria: "sala", forma: "sofa", largura: 1600, profundidade: 900, altura: 850, cor: "#8c7b6b", variante: "2" },
  { id: "sofa-l", nome: "Sofá de canto (L)", categoria: "sala", forma: "sofa-l", largura: 2600, profundidade: 1700, altura: 850, cor: "#8c7b6b" },
  { id: "poltrona", nome: "Poltrona", categoria: "sala", forma: "poltrona", largura: 800, profundidade: 800, altura: 850, cor: "#b5835a" },
  { id: "puff", nome: "Puff", categoria: "sala", forma: "puff", largura: 500, profundidade: 500, altura: 420, cor: "#a8927a" },
  { id: "mesa-centro", nome: "Mesa de centro", categoria: "sala", forma: "mesa-centro", largura: 1000, profundidade: 600, altura: 400, cor: "#6b4f3a", materiais: TAMPO_CENTRO, material: "madeira" },
  { id: "mesa-lateral", nome: "Mesa lateral", categoria: "sala", forma: "mesa-centro", largura: 500, profundidade: 500, altura: 550, cor: "#3d3a36", materiais: TAMPO_CENTRO, material: "marmore" },
  { id: "rack-tv", nome: "Rack com TV 55\"", categoria: "sala", forma: "rack-tv", largura: 1800, profundidade: 450, altura: 1300, cor: "#5a4636", materiais: MARCENARIA, material: "madeira" },
  { id: "painel-tv", nome: "Painel com TV 65\"", categoria: "sala", forma: "painel-tv", largura: 2200, profundidade: 60, altura: 2200, cor: "#6b4f3a", materiais: ["madeira", "laca", "marmore"], material: "madeira" },
  { id: "estante", nome: "Estante", categoria: "sala", forma: "estante", largura: 1200, profundidade: 350, altura: 2000, cor: "#7a5c43", materiais: MARCENARIA, material: "madeira" },
  { id: "aparador", nome: "Aparador", categoria: "sala", forma: "aparador", largura: 1400, profundidade: 400, altura: 800, cor: "#3d3a36", materiais: MARCENARIA, material: "marmore" },
  { id: "buffet", nome: "Buffet", categoria: "sala", forma: "comoda", largura: 1800, profundidade: 450, altura: 850, cor: "#6b4f3a", materiais: MARCENARIA, material: "madeira" },
  { id: "cristaleira", nome: "Cristaleira", categoria: "sala", forma: "cristaleira", largura: 1000, profundidade: 450, altura: 1900, cor: "#6b4f3a", materiais: ["madeira", "laca", "metal"], material: "madeira" },
  { id: "adega", nome: "Adega climatizada", categoria: "sala", forma: "adega", largura: 600, profundidade: 600, altura: 850, cor: "#2b2b2b" },
  { id: "tapete", nome: "Tapete 2 × 3 m", categoria: "sala", forma: "tapete", largura: 3000, profundidade: 2000, altura: 10, cor: "#c9b79c" },
  { id: "mesa-8", nome: "Mesa de jantar 8 lugares", categoria: "sala", forma: "mesa", largura: 2200, profundidade: 1000, altura: 750, cor: "#7a5c43", variante: "8", materiais: TAMPO_MESA, material: "madeira" },
  { id: "mesa-6", nome: "Mesa de jantar 6 lugares", categoria: "sala", forma: "mesa", largura: 1800, profundidade: 900, altura: 750, cor: "#7a5c43", variante: "6", materiais: TAMPO_MESA, material: "madeira" },
  { id: "mesa-4", nome: "Mesa de jantar 4 lugares", categoria: "sala", forma: "mesa", largura: 1200, profundidade: 800, altura: 750, cor: "#7a5c43", variante: "4", materiais: TAMPO_MESA, material: "madeira" },
  { id: "mesa-redonda", nome: "Mesa redonda 4 lugares", categoria: "sala", forma: "mesa-redonda", largura: 1100, profundidade: 1100, altura: 750, cor: "#7a5c43", variante: "4", materiais: TAMPO_MESA, material: "madeira" },
  { id: "cadeira", nome: "Cadeira", categoria: "sala", forma: "cadeira", largura: 450, profundidade: 500, altura: 900, cor: "#6b4f3a" },

  { id: "cama-king", nome: "Cama king", categoria: "quarto", forma: "cama", largura: 1930, profundidade: 2030, altura: 550, cor: "#e8e1d4", variante: "casal" },
  { id: "cama-queen", nome: "Cama queen", categoria: "quarto", forma: "cama", largura: 1580, profundidade: 1980, altura: 550, cor: "#e8e1d4", variante: "casal" },
  { id: "cama-casal", nome: "Cama de casal", categoria: "quarto", forma: "cama", largura: 1380, profundidade: 1880, altura: 550, cor: "#e8e1d4", variante: "casal" },
  { id: "cama-solteiro", nome: "Cama de solteiro", categoria: "quarto", forma: "cama", largura: 880, profundidade: 1880, altura: 550, cor: "#e8e1d4", variante: "solteiro" },
  { id: "beliche", nome: "Beliche", categoria: "quarto", forma: "beliche", largura: 960, profundidade: 1960, altura: 1650, cor: "#dfe6ea" },
  { id: "berco", nome: "Berço", categoria: "quarto", forma: "berco", largura: 700, profundidade: 1300, altura: 950, cor: "#f2efe9" },
  { id: "criado", nome: "Criado-mudo", categoria: "quarto", forma: "criado", largura: 500, profundidade: 400, altura: 550, cor: "#7a5c43", materiais: MARCENARIA, material: "madeira" },
  { id: "comoda", nome: "Cômoda", categoria: "quarto", forma: "comoda", largura: 1000, profundidade: 450, altura: 900, cor: "#d9d2c5", materiais: MARCENARIA, material: "laca" },
  { id: "penteadeira", nome: "Penteadeira", categoria: "quarto", forma: "penteadeira", largura: 1000, profundidade: 450, altura: 760, cor: "#f0ebe3", materiais: MARCENARIA, material: "laca" },
  { id: "guarda-roupa", nome: "Guarda-roupa", categoria: "quarto", forma: "guarda-roupa", largura: 2000, profundidade: 600, altura: 2300, cor: "#d9d2c5", materiais: ["madeira", "laca", "vidro"], material: "laca" },
  { id: "sapateira", nome: "Sapateira", categoria: "quarto", forma: "comoda", largura: 800, profundidade: 350, altura: 1000, cor: "#d9d2c5", materiais: MARCENARIA, material: "laca" },

  { id: "geladeira", nome: "Geladeira duplex", categoria: "cozinha", forma: "geladeira", largura: 700, profundidade: 750, altura: 1800, cor: "#d5d7d8" },
  { id: "geladeira-inverse", nome: "Geladeira side by side", categoria: "cozinha", forma: "geladeira", largura: 910, profundidade: 750, altura: 1780, cor: "#b9bcbe", variante: "side" },
  { id: "freezer", nome: "Freezer vertical", categoria: "cozinha", forma: "geladeira", largura: 600, profundidade: 650, altura: 1700, cor: "#f1f1f1", variante: "uma" },
  { id: "frigobar", nome: "Frigobar", categoria: "cozinha", forma: "geladeira", largura: 480, profundidade: 500, altura: 850, cor: "#2f3133", variante: "uma" },
  { id: "fogao-4", nome: "Fogão 4 bocas", categoria: "cozinha", forma: "fogao", largura: 550, profundidade: 600, altura: 850, cor: "#dcdcdc", variante: "4" },
  { id: "fogao-6", nome: "Fogão 6 bocas", categoria: "cozinha", forma: "fogao", largura: 800, profundidade: 650, altura: 850, cor: "#c0c2c3", variante: "6" },
  { id: "cooktop", nome: "Cooktop 5 bocas em bancada", categoria: "cozinha", forma: "cooktop", largura: 1200, profundidade: 600, altura: 900, cor: "#e9e4dc", materiais: BANCADA, material: "granito" },
  { id: "bancada-pia", nome: "Bancada com pia", categoria: "cozinha", forma: "bancada-pia", largura: 1500, profundidade: 600, altura: 900, cor: "#e9e4dc", materiais: BANCADA, material: "granito" },
  { id: "bancada-cuba-dupla", nome: "Bancada com cuba dupla", categoria: "cozinha", forma: "bancada-pia", largura: 2000, profundidade: 600, altura: 900, cor: "#e9e4dc", variante: "dupla", materiais: BANCADA, material: "quartzo" },
  { id: "armario-baixo", nome: "Armário de cozinha", categoria: "cozinha", forma: "armario", largura: 1200, profundidade: 600, altura: 900, cor: "#e9e4dc", materiais: BANCADA, material: "granito" },
  { id: "armario-aereo", nome: "Armário aéreo", categoria: "cozinha", forma: "armario-aereo", largura: 1200, profundidade: 350, altura: 700, cor: "#e9e4dc", elevacao: 1500, materiais: ["madeira", "laca", "vidro"], material: "laca" },
  { id: "torre-quente", nome: "Torre quente (forno e micro-ondas)", categoria: "cozinha", forma: "torre-quente", largura: 650, profundidade: 600, altura: 2200, cor: "#e9e4dc", materiais: ["madeira", "laca"], material: "laca" },
  { id: "coifa", nome: "Coifa", categoria: "cozinha", forma: "coifa", largura: 900, profundidade: 500, altura: 800, cor: "#b9bcbe", elevacao: 1650 },
  { id: "micro-ondas", nome: "Micro-ondas", categoria: "cozinha", forma: "micro-ondas", largura: 500, profundidade: 400, altura: 300, cor: "#2f3133", elevacao: 900 },
  { id: "lava-loucas", nome: "Lava-louças", categoria: "cozinha", forma: "lava-loucas", largura: 600, profundidade: 600, altura: 850, cor: "#c9cbcc" },

  // Balcões: americano e de bar na altura de 1,10 m com banquetas; de cozinha e ilha na
  // altura da bancada; de atendimento com a frente alta e o tampo de trabalho atrás.
  { id: "balcao-americano", nome: "Balcão americano com 3 banquetas", categoria: "balcoes", forma: "balcao", largura: 1800, profundidade: 600, altura: 1100, cor: "#e9e4dc", variante: "3", materiais: BANCADA, material: "granito" },
  { id: "balcao-cozinha", nome: "Balcão de cozinha", categoria: "balcoes", forma: "balcao", largura: 1600, profundidade: 600, altura: 900, cor: "#e9e4dc", variante: "0", materiais: BANCADA, material: "quartzo" },
  { id: "ilha-gourmet", nome: "Ilha gourmet com 4 banquetas", categoria: "balcoes", forma: "balcao", largura: 2400, profundidade: 1000, altura: 900, cor: "#3d3a36", variante: "4", materiais: BANCADA, material: "marmore" },
  { id: "balcao-bar", nome: "Balcão de bar com 4 banquetas", categoria: "balcoes", forma: "balcao", largura: 2200, profundidade: 600, altura: 1100, cor: "#5a4636", variante: "4", materiais: BANCADA, material: "madeira" },
  { id: "balcao-atendimento", nome: "Balcão de atendimento", categoria: "balcoes", forma: "balcao-atendimento", largura: 1800, profundidade: 800, altura: 1100, cor: "#d9d2c5", materiais: BANCADA, material: "quartzo" },
  { id: "banqueta", nome: "Banqueta alta", categoria: "balcoes", forma: "banqueta", largura: 400, profundidade: 400, altura: 750, cor: "#3d3a36" },

  { id: "balcao-alvenaria", nome: "Balcão de alvenaria", categoria: "alvenaria", forma: "balcao", largura: 1800, profundidade: 600, altura: 1100, cor: REBOCO, variante: "3", materiais: TAMPO_ALVENARIA, material: "granito", alvenaria: true },
  { id: "bancada-alvenaria", nome: "Bancada de alvenaria com cuba", categoria: "alvenaria", forma: "bancada-pia", largura: 1800, profundidade: 600, altura: 900, cor: REBOCO, materiais: TAMPO_ALVENARIA, material: "granito", alvenaria: true },
  { id: "bancada-churrasqueira", nome: "Bancada gourmet com churrasqueira", categoria: "alvenaria", forma: "bancada-churrasqueira", largura: 2600, profundidade: 650, altura: 2400, cor: "#b7703f", materiais: TAMPO_ALVENARIA, material: "granito", alvenaria: true },
  { id: "banco-alvenaria", nome: "Banco de alvenaria", categoria: "alvenaria", forma: "banco-alvenaria", largura: 1800, profundidade: 450, altura: 450, cor: REBOCO, materiais: TAMPO_ALVENARIA, material: "madeira", alvenaria: true },
  { id: "sofa-alvenaria", nome: "Sofá de alvenaria", categoria: "alvenaria", forma: "sofa-alvenaria", largura: 2200, profundidade: 800, altura: 800, cor: REBOCO, alvenaria: true },
  { id: "cama-alvenaria", nome: "Cama de alvenaria (casal)", categoria: "alvenaria", forma: "cama-alvenaria", largura: 1580, profundidade: 2080, altura: 600, cor: REBOCO, alvenaria: true },
  { id: "mureta", nome: "Mureta / meia parede", categoria: "alvenaria", forma: "mureta", largura: 2000, profundidade: 150, altura: 1100, cor: REBOCO, materiais: TAMPO_ALVENARIA, material: "granito", alvenaria: true },
  { id: "floreira", nome: "Floreira de alvenaria", categoria: "alvenaria", forma: "floreira", largura: 1500, profundidade: 500, altura: 600, cor: REBOCO, alvenaria: true },
  { id: "nicho", nome: "Estante de alvenaria com nichos", categoria: "alvenaria", forma: "nicho", largura: 1500, profundidade: 350, altura: 2200, cor: REBOCO, alvenaria: true },
  { id: "lareira", nome: "Lareira", categoria: "alvenaria", forma: "lareira", largura: 1400, profundidade: 600, altura: 2600, cor: "#cfc7b8", materiais: ["marmore", "granito", "concreto"], material: "marmore", alvenaria: true },

  { id: "vaso", nome: "Vaso sanitário", categoria: "banheiro", forma: "vaso", largura: 380, profundidade: 650, altura: 780, cor: "#f7f7f5" },
  { id: "lavatorio", nome: "Gabinete com lavatório", categoria: "banheiro", forma: "lavatorio", largura: 800, profundidade: 450, altura: 850, cor: "#8a6a4f", materiais: LAVATORIO, material: "marmore" },
  { id: "lavatorio-duplo", nome: "Gabinete com 2 cubas", categoria: "banheiro", forma: "lavatorio", largura: 1400, profundidade: 500, altura: 850, cor: "#8a6a4f", variante: "dupla", materiais: LAVATORIO, material: "quartzo" },
  { id: "box", nome: "Box de chuveiro", categoria: "banheiro", forma: "box", largura: 900, profundidade: 1200, altura: 1900, cor: "#bfe0ea" },
  { id: "banheira", nome: "Banheira", categoria: "banheiro", forma: "banheira", largura: 1700, profundidade: 750, altura: 550, cor: "#f7f7f5" },
  { id: "hidro", nome: "Banheira de hidromassagem", categoria: "banheiro", forma: "hidro", largura: 1600, profundidade: 1600, altura: 550, cor: "#f7f7f5" },

  { id: "maquina-lavar", nome: "Máquina de lavar", categoria: "lavanderia", forma: "maquina-lavar", largura: 600, profundidade: 650, altura: 1000, cor: "#f1f1f1" },
  { id: "secadora", nome: "Secadora", categoria: "lavanderia", forma: "maquina-lavar", largura: 600, profundidade: 600, altura: 850, cor: "#f1f1f1" },
  { id: "tanque", nome: "Tanque", categoria: "lavanderia", forma: "tanque", largura: 600, profundidade: 550, altura: 900, cor: "#e9e9e6" },
  { id: "armario-lavanderia", nome: "Armário de lavanderia", categoria: "lavanderia", forma: "armario", largura: 800, profundidade: 450, altura: 900, cor: "#f0ebe3", materiais: BANCADA, material: "granito" },

  { id: "escrivaninha", nome: "Escrivaninha", categoria: "escritorio", forma: "escrivaninha", largura: 1400, profundidade: 700, altura: 750, cor: "#8a6a4f", materiais: TAMPO_MESA, material: "madeira" },
  { id: "mesa-reuniao", nome: "Mesa de reunião 8 lugares", categoria: "escritorio", forma: "mesa", largura: 2400, profundidade: 1100, altura: 750, cor: "#3d3a36", variante: "8", materiais: TAMPO_MESA, material: "vidro" },
  { id: "cadeira-escritorio", nome: "Cadeira de escritório", categoria: "escritorio", forma: "cadeira-escritorio", largura: 650, profundidade: 650, altura: 1100, cor: "#2f3133" },
  { id: "arquivo", nome: "Arquivo de aço", categoria: "escritorio", forma: "comoda", largura: 470, profundidade: 600, altura: 1330, cor: "#9aa0a3", materiais: ["metal"], material: "metal" },
  { id: "estante-livros", nome: "Estante de livros", categoria: "escritorio", forma: "estante", largura: 900, profundidade: 300, altura: 2100, cor: "#7a5c43", materiais: MARCENARIA, material: "madeira" },

  // Som ambiente e home cinema. Caixa de teto e projetor ficam no forro (elevação perto
  // dos 2,80 m do pé-direito padrão); soundbar e tela na parede.
  { id: "caixa-teto", nome: "Caixa de som de teto", categoria: "audio", forma: "caixa-teto", largura: 230, profundidade: 230, altura: 30, cor: "#f4f4f2", elevacao: 2740 },
  { id: "caixa-torre", nome: "Caixa de som torre", categoria: "audio", forma: "caixa-torre", largura: 250, profundidade: 320, altura: 1050, cor: "#2b2b2b", materiais: ["madeira", "laca"], material: "laca" },
  { id: "caixa-bookshelf", nome: "Caixa de som de parede", categoria: "audio", forma: "caixa-torre", largura: 200, profundidade: 230, altura: 330, cor: "#2b2b2b", elevacao: 1800, variante: "parede" },
  { id: "soundbar", nome: "Soundbar", categoria: "audio", forma: "soundbar", largura: 1000, profundidade: 120, altura: 80, cor: "#1f1f1f", elevacao: 650 },
  { id: "subwoofer", nome: "Subwoofer", categoria: "audio", forma: "subwoofer", largura: 380, profundidade: 400, altura: 400, cor: "#1f1f1f" },
  { id: "receiver", nome: "Receiver / amplificador", categoria: "audio", forma: "receiver", largura: 435, profundidade: 380, altura: 170, cor: "#1f1f1f" },
  { id: "projetor", nome: "Projetor no teto", categoria: "audio", forma: "projetor", largura: 400, profundidade: 350, altura: 450, cor: "#e8e8e6", elevacao: 2350 },
  { id: "tela-projecao", nome: "Tela de projeção 120\"", categoria: "audio", forma: "tela-projecao", largura: 2700, profundidade: 80, altura: 1500, cor: "#f7f7f5", elevacao: 700 },
  { id: "poltrona-cinema", nome: "Poltrona de cinema reclinável", categoria: "audio", forma: "poltrona-cinema", largura: 900, profundidade: 1000, altura: 1050, cor: "#3a2c2a", variante: "1" },
  { id: "fileira-cinema-3", nome: "Fileira de cinema 3 lugares", categoria: "audio", forma: "poltrona-cinema", largura: 2500, profundidade: 1000, altura: 1050, cor: "#3a2c2a", variante: "3" },
  { id: "fileira-cinema-4", nome: "Fileira de cinema 4 lugares", categoria: "audio", forma: "poltrona-cinema", largura: 3300, profundidade: 1000, altura: 1050, cor: "#3a2c2a", variante: "4" },

  // Ar-condicionado: evaporadoras na medida de catálogo das linhas de 9 a 36 mil BTU.
  { id: "ar-split", nome: "Split de parede 12.000 BTU", categoria: "clima", forma: "ar-split", largura: 850, profundidade: 210, altura: 290, cor: "#f7f7f5", elevacao: 2200 },
  { id: "ar-split-grande", nome: "Split de parede 24.000 BTU", categoria: "clima", forma: "ar-split", largura: 1100, profundidade: 250, altura: 330, cor: "#f7f7f5", elevacao: 2150 },
  { id: "ar-cassete", nome: "Cassete de teto 4 vias", categoria: "clima", forma: "ar-cassete", largura: 840, profundidade: 840, altura: 250, cor: "#f7f7f5", elevacao: 2550 },
  { id: "ar-piso-teto", nome: "Piso-teto 36.000 BTU", categoria: "clima", forma: "ar-piso-teto", largura: 1600, profundidade: 680, altura: 240, cor: "#f7f7f5", elevacao: 2560 },
  { id: "ar-condensadora", nome: "Condensadora (unidade externa)", categoria: "clima", forma: "ar-condensadora", largura: 800, profundidade: 300, altura: 550, cor: "#e9e9e6" },

  // Cortinas e persianas: a largura é a do vão com transpasse; a altura, do forro ao piso.
  { id: "cortina", nome: "Cortina de tecido", categoria: "cortinas", forma: "cortina", largura: 3000, profundidade: 150, altura: 2650, cor: "#e7dfcf" },
  { id: "cortina-blackout", nome: "Cortina blackout", categoria: "cortinas", forma: "cortina", largura: 3000, profundidade: 180, altura: 2650, cor: "#5b5750", variante: "blackout" },
  { id: "cortina-voil", nome: "Cortina de voil", categoria: "cortinas", forma: "cortina", largura: 3000, profundidade: 120, altura: 2650, cor: "#f6f3ec", variante: "voil" },
  { id: "persiana-rolo", nome: "Persiana rolô", categoria: "cortinas", forma: "persiana", largura: 1500, profundidade: 80, altura: 1500, cor: "#d9d2c5", elevacao: 900, variante: "rolo" },
  { id: "persiana-horizontal", nome: "Persiana horizontal", categoria: "cortinas", forma: "persiana", largura: 1500, profundidade: 60, altura: 1500, cor: "#c9c2b6", elevacao: 900, variante: "horizontal", materiais: ["madeira", "metal"], material: "metal" },
  { id: "persiana-vertical", nome: "Persiana vertical", categoria: "cortinas", forma: "persiana", largura: 2000, profundidade: 100, altura: 2400, cor: "#e2dccf", elevacao: 150, variante: "vertical" },

  { id: "carro-hatch", nome: "Carro hatch", categoria: "garagem", forma: "carro", largura: 1750, profundidade: 3900, altura: 1500, cor: "#b3261e", variante: "hatch" },
  { id: "carro-seda", nome: "Carro sedã", categoria: "garagem", forma: "carro", largura: 1800, profundidade: 4600, altura: 1480, cor: "#2b4c7e", variante: "seda" },
  { id: "carro-suv", nome: "SUV", categoria: "garagem", forma: "carro", largura: 1900, profundidade: 4700, altura: 1700, cor: "#3a3d40", variante: "suv" },
  { id: "picape", nome: "Picape", categoria: "garagem", forma: "carro", largura: 1900, profundidade: 5300, altura: 1850, cor: "#e7e5df", variante: "picape" },
  { id: "carro-esportivo", nome: "Carro esportivo", categoria: "garagem", forma: "carro", largura: 1900, profundidade: 4500, altura: 1250, cor: "#d9a40f", variante: "esportivo" },
  { id: "carro-eletrico", nome: "Carro elétrico", categoria: "garagem", forma: "carro", largura: 1850, profundidade: 4700, altura: 1450, cor: "#f2f2f0", variante: "seda" },
  { id: "minivan", nome: "Minivan / van", categoria: "garagem", forma: "carro", largura: 1950, profundidade: 5100, altura: 1900, cor: "#6c7a80", variante: "van" },
  { id: "moto", nome: "Moto", categoria: "garagem", forma: "moto", largura: 800, profundidade: 2000, altura: 1100, cor: "#1f1f1f" },
  { id: "bicicleta", nome: "Bicicleta", categoria: "garagem", forma: "bicicleta", largura: 600, profundidade: 1750, altura: 1000, cor: "#2d6a4f" },
  { id: "scooter", nome: "Scooter", categoria: "garagem", forma: "moto", largura: 700, profundidade: 1800, altura: 1150, cor: "#8fb3c7" },
  { id: "wallbox", nome: "Carregador de carro elétrico", categoria: "garagem", forma: "wallbox", largura: 250, profundidade: 120, altura: 400, cor: "#2f3133", elevacao: 1000 },
  { id: "bancada-ferramentas", nome: "Bancada de ferramentas", categoria: "garagem", forma: "bancada-ferramentas", largura: 1800, profundidade: 600, altura: 1900, cor: "#6f7478", materiais: ["madeira", "metal"], material: "madeira" },
  { id: "estante-garagem", nome: "Estante de aço", categoria: "garagem", forma: "estante", largura: 1000, profundidade: 400, altura: 2000, cor: "#9aa0a3", materiais: ["metal"], material: "metal" },
  { id: "vaga-dupla", nome: "Vagas duplas 5 × 5 m", categoria: "garagem", forma: "vaga", largura: 5000, profundidade: 5000, altura: 5, cor: "#f5f5f0", variante: "2" },
  { id: "vaga", nome: "Vaga de garagem 2,5 × 5 m", categoria: "garagem", forma: "vaga", largura: 2500, profundidade: 5000, altura: 5, cor: "#f5f5f0" },

  { id: "arvore", nome: "Árvore", categoria: "externo", forma: "arvore", largura: 3000, profundidade: 3000, altura: 5000, cor: "#4f7942" },
  { id: "planta", nome: "Vaso com planta", categoria: "externo", forma: "planta", largura: 600, profundidade: 600, altura: 1200, cor: "#5b8c51" },
  { id: "piscina", nome: "Piscina 6 × 3 m", categoria: "externo", forma: "piscina", largura: 6000, profundidade: 3000, altura: 20, cor: "#4fb0d6" },
  { id: "espreguicadeira", nome: "Espreguiçadeira", categoria: "externo", forma: "espreguicadeira", largura: 700, profundidade: 1900, altura: 400, cor: "#e0d6c3" },
  { id: "churrasqueira", nome: "Churrasqueira", categoria: "externo", forma: "churrasqueira", largura: 1000, profundidade: 600, altura: 2200, cor: "#9c5a3c" },
  { id: "pergolado", nome: "Pergolado 3 × 4 m", categoria: "externo", forma: "pergolado", largura: 4000, profundidade: 3000, altura: 2600, cor: "#7a5c43" },
  { id: "mesa-guarda-sol", nome: "Mesa externa com guarda-sol", categoria: "externo", forma: "mesa-guarda-sol", largura: 1000, profundidade: 1000, altura: 2300, cor: "#e7e1d3", materiais: ["madeira", "vidro", "metal"], material: "madeira" },
];

const porId = new Map(CATALOGO.map((item) => [item.id, item]));
export function itemDoCatalogo(id: string) { return porId.get(id) ?? null; }

/** O acabamento que vale para o item: o escolhido, se o catálogo aceitar, ou o padrão. */
export function materialDoItem(base: ItemCatalogo, escolhido?: Material | null): Material | null {
  if (!base.materiais?.length) return null;
  return escolhido && base.materiais.includes(escolhido) ? escolhido : base.material ?? base.materiais[0];
}
