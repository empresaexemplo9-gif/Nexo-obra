// Catálogo do criador de layout: móveis, eletrodomésticos, louças, veículos e área externa.
//
// Medidas em milímetro, as de mercado (cama queen 1580 × 1980, carro sedã 4600 × 1800,
// vaga 2500 × 5000). É o que faz a prévia servir de noção de espaço: um carro que cabe na
// garagem do desenho cabe na garagem da obra. Cada item pode ter a medida ajustada na tela.
//
// `forma` escolhe o desenho em planta e o volume em 3D; itens parecidos compartilham a
// mesma forma com medidas diferentes.

export type Forma =
  | "sofa" | "poltrona" | "mesa" | "mesa-redonda" | "cadeira" | "rack-tv" | "estante" | "tapete" | "mesa-centro"
  | "cama" | "berco" | "criado" | "guarda-roupa" | "escrivaninha" | "cadeira-escritorio"
  | "geladeira" | "fogao" | "cooktop" | "bancada-pia" | "armario" | "armario-aereo" | "micro-ondas" | "lava-loucas"
  | "vaso" | "lavatorio" | "box" | "banheira"
  | "maquina-lavar" | "tanque"
  | "carro" | "moto" | "bicicleta" | "vaga"
  | "arvore" | "planta" | "piscina" | "espreguicadeira" | "churrasqueira";

export type Categoria = "sala" | "quarto" | "cozinha" | "banheiro" | "lavanderia" | "escritorio" | "garagem" | "externo";

export const categoriaLabels: Record<Categoria, string> = {
  sala: "Sala e jantar", quarto: "Quarto", cozinha: "Cozinha", banheiro: "Banheiro", lavanderia: "Lavanderia",
  escritorio: "Escritório", garagem: "Garagem e veículos", externo: "Área externa",
};

export type ItemCatalogo = {
  id: string; nome: string; categoria: Categoria; forma: Forma;
  largura: number; profundidade: number; altura: number;
  cor: string;
  /** Altura do chão até a base: armário aéreo, TV na parede. */
  elevacao?: number;
  /** Variante da forma: tipo de carro, número de lugares, número de bocas. */
  variante?: string;
};

export const CATALOGO: ItemCatalogo[] = [
  { id: "sofa-3", nome: "Sofá 3 lugares", categoria: "sala", forma: "sofa", largura: 2100, profundidade: 900, altura: 850, cor: "#8c7b6b", variante: "3" },
  { id: "sofa-2", nome: "Sofá 2 lugares", categoria: "sala", forma: "sofa", largura: 1600, profundidade: 900, altura: 850, cor: "#8c7b6b", variante: "2" },
  { id: "poltrona", nome: "Poltrona", categoria: "sala", forma: "poltrona", largura: 800, profundidade: 800, altura: 850, cor: "#b5835a" },
  { id: "mesa-centro", nome: "Mesa de centro", categoria: "sala", forma: "mesa-centro", largura: 1000, profundidade: 600, altura: 400, cor: "#6b4f3a" },
  { id: "rack-tv", nome: "Rack com TV 55\"", categoria: "sala", forma: "rack-tv", largura: 1800, profundidade: 450, altura: 1300, cor: "#5a4636" },
  { id: "estante", nome: "Estante", categoria: "sala", forma: "estante", largura: 1200, profundidade: 350, altura: 2000, cor: "#7a5c43" },
  { id: "tapete", nome: "Tapete 2 × 3 m", categoria: "sala", forma: "tapete", largura: 3000, profundidade: 2000, altura: 10, cor: "#c9b79c" },
  { id: "mesa-6", nome: "Mesa de jantar 6 lugares", categoria: "sala", forma: "mesa", largura: 1800, profundidade: 900, altura: 750, cor: "#7a5c43", variante: "6" },
  { id: "mesa-4", nome: "Mesa de jantar 4 lugares", categoria: "sala", forma: "mesa", largura: 1200, profundidade: 800, altura: 750, cor: "#7a5c43", variante: "4" },
  { id: "mesa-redonda", nome: "Mesa redonda 4 lugares", categoria: "sala", forma: "mesa-redonda", largura: 1100, profundidade: 1100, altura: 750, cor: "#7a5c43", variante: "4" },
  { id: "cadeira", nome: "Cadeira", categoria: "sala", forma: "cadeira", largura: 450, profundidade: 500, altura: 900, cor: "#6b4f3a" },

  { id: "cama-king", nome: "Cama king", categoria: "quarto", forma: "cama", largura: 1930, profundidade: 2030, altura: 550, cor: "#e8e1d4", variante: "casal" },
  { id: "cama-queen", nome: "Cama queen", categoria: "quarto", forma: "cama", largura: 1580, profundidade: 1980, altura: 550, cor: "#e8e1d4", variante: "casal" },
  { id: "cama-casal", nome: "Cama de casal", categoria: "quarto", forma: "cama", largura: 1380, profundidade: 1880, altura: 550, cor: "#e8e1d4", variante: "casal" },
  { id: "cama-solteiro", nome: "Cama de solteiro", categoria: "quarto", forma: "cama", largura: 880, profundidade: 1880, altura: 550, cor: "#e8e1d4", variante: "solteiro" },
  { id: "berco", nome: "Berço", categoria: "quarto", forma: "berco", largura: 700, profundidade: 1300, altura: 950, cor: "#f2efe9" },
  { id: "criado", nome: "Criado-mudo", categoria: "quarto", forma: "criado", largura: 500, profundidade: 400, altura: 550, cor: "#7a5c43" },
  { id: "guarda-roupa", nome: "Guarda-roupa", categoria: "quarto", forma: "guarda-roupa", largura: 2000, profundidade: 600, altura: 2300, cor: "#d9d2c5" },

  { id: "geladeira", nome: "Geladeira duplex", categoria: "cozinha", forma: "geladeira", largura: 700, profundidade: 750, altura: 1800, cor: "#d5d7d8" },
  { id: "geladeira-inverse", nome: "Geladeira side by side", categoria: "cozinha", forma: "geladeira", largura: 910, profundidade: 750, altura: 1780, cor: "#b9bcbe", variante: "side" },
  { id: "fogao-4", nome: "Fogão 4 bocas", categoria: "cozinha", forma: "fogao", largura: 550, profundidade: 600, altura: 850, cor: "#dcdcdc", variante: "4" },
  { id: "fogao-6", nome: "Fogão 6 bocas", categoria: "cozinha", forma: "fogao", largura: 800, profundidade: 650, altura: 850, cor: "#c0c2c3", variante: "6" },
  { id: "cooktop", nome: "Cooktop 5 bocas em bancada", categoria: "cozinha", forma: "cooktop", largura: 1200, profundidade: 600, altura: 900, cor: "#e9e4dc" },
  { id: "bancada-pia", nome: "Bancada com pia", categoria: "cozinha", forma: "bancada-pia", largura: 1500, profundidade: 600, altura: 900, cor: "#e9e4dc" },
  { id: "armario-baixo", nome: "Armário de cozinha", categoria: "cozinha", forma: "armario", largura: 1200, profundidade: 600, altura: 900, cor: "#e9e4dc" },
  { id: "armario-aereo", nome: "Armário aéreo", categoria: "cozinha", forma: "armario-aereo", largura: 1200, profundidade: 350, altura: 700, cor: "#e9e4dc", elevacao: 1500 },
  { id: "micro-ondas", nome: "Micro-ondas", categoria: "cozinha", forma: "micro-ondas", largura: 500, profundidade: 400, altura: 300, cor: "#2f3133", elevacao: 900 },
  { id: "lava-loucas", nome: "Lava-louças", categoria: "cozinha", forma: "lava-loucas", largura: 600, profundidade: 600, altura: 850, cor: "#c9cbcc" },

  { id: "vaso", nome: "Vaso sanitário", categoria: "banheiro", forma: "vaso", largura: 380, profundidade: 650, altura: 780, cor: "#f7f7f5" },
  { id: "lavatorio", nome: "Gabinete com lavatório", categoria: "banheiro", forma: "lavatorio", largura: 800, profundidade: 450, altura: 850, cor: "#f7f7f5" },
  { id: "box", nome: "Box de chuveiro", categoria: "banheiro", forma: "box", largura: 900, profundidade: 1200, altura: 1900, cor: "#bfe0ea" },
  { id: "banheira", nome: "Banheira", categoria: "banheiro", forma: "banheira", largura: 1700, profundidade: 750, altura: 550, cor: "#f7f7f5" },

  { id: "maquina-lavar", nome: "Máquina de lavar", categoria: "lavanderia", forma: "maquina-lavar", largura: 600, profundidade: 650, altura: 1000, cor: "#f1f1f1" },
  { id: "secadora", nome: "Secadora", categoria: "lavanderia", forma: "maquina-lavar", largura: 600, profundidade: 600, altura: 850, cor: "#f1f1f1" },
  { id: "tanque", nome: "Tanque", categoria: "lavanderia", forma: "tanque", largura: 600, profundidade: 550, altura: 900, cor: "#e9e9e6" },

  { id: "escrivaninha", nome: "Escrivaninha", categoria: "escritorio", forma: "escrivaninha", largura: 1400, profundidade: 700, altura: 750, cor: "#8a6a4f" },
  { id: "cadeira-escritorio", nome: "Cadeira de escritório", categoria: "escritorio", forma: "cadeira-escritorio", largura: 650, profundidade: 650, altura: 1100, cor: "#2f3133" },

  { id: "carro-hatch", nome: "Carro hatch", categoria: "garagem", forma: "carro", largura: 1750, profundidade: 3900, altura: 1500, cor: "#b3261e", variante: "hatch" },
  { id: "carro-seda", nome: "Carro sedã", categoria: "garagem", forma: "carro", largura: 1800, profundidade: 4600, altura: 1480, cor: "#2b4c7e", variante: "seda" },
  { id: "carro-suv", nome: "SUV", categoria: "garagem", forma: "carro", largura: 1900, profundidade: 4700, altura: 1700, cor: "#3a3d40", variante: "suv" },
  { id: "picape", nome: "Picape", categoria: "garagem", forma: "carro", largura: 1900, profundidade: 5300, altura: 1850, cor: "#e7e5df", variante: "picape" },
  { id: "moto", nome: "Moto", categoria: "garagem", forma: "moto", largura: 800, profundidade: 2000, altura: 1100, cor: "#1f1f1f" },
  { id: "bicicleta", nome: "Bicicleta", categoria: "garagem", forma: "bicicleta", largura: 600, profundidade: 1750, altura: 1000, cor: "#2d6a4f" },
  { id: "vaga", nome: "Vaga de garagem 2,5 × 5 m", categoria: "garagem", forma: "vaga", largura: 2500, profundidade: 5000, altura: 5, cor: "#f5f5f0" },

  { id: "arvore", nome: "Árvore", categoria: "externo", forma: "arvore", largura: 3000, profundidade: 3000, altura: 5000, cor: "#4f7942" },
  { id: "planta", nome: "Vaso com planta", categoria: "externo", forma: "planta", largura: 600, profundidade: 600, altura: 1200, cor: "#5b8c51" },
  { id: "piscina", nome: "Piscina 6 × 3 m", categoria: "externo", forma: "piscina", largura: 6000, profundidade: 3000, altura: 20, cor: "#4fb0d6" },
  { id: "espreguicadeira", nome: "Espreguiçadeira", categoria: "externo", forma: "espreguicadeira", largura: 700, profundidade: 1900, altura: 400, cor: "#e0d6c3" },
  { id: "churrasqueira", nome: "Churrasqueira", categoria: "externo", forma: "churrasqueira", largura: 1000, profundidade: 600, altura: 2200, cor: "#9c5a3c" },
];

const porId = new Map(CATALOGO.map((item) => [item.id, item]));
export function itemDoCatalogo(id: string) { return porId.get(id) ?? null; }
