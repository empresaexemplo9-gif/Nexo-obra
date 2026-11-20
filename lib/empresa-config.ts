import {
  permissionModules,
  PLATFORM_SUPERADMIN_ROLE,
  type PermissionModule,
  type PermissionSet,
} from "@/lib/permissions";

// Regras compartilhadas entre servidor e tela para três decisões por empresa:
// quais módulos ela contratou, como fica a identidade visual e quem pode criar login.
// Ficam num módulo sem dependência de servidor para a tela mostrar exatamente a mesma
// regra que a API aplica.

// ─── Ferramentas contratadas ───
//
// A unidade que o superadministrador escolhe é cada item do menu lateral. Por trás, cada
// ferramenta precisa de certos módulos de dados (a de Orçamentos lê projetos, a de
// Financeiro também). O servidor libera os dados que as ferramentas ligadas precisam e
// recusa o resto; a tela mostra só as ferramentas ligadas.

export const secoesDoMenu = ["Trabalho", "Negócio", "Organização"] as const;

export const ferramentasDoMenu = [
  { id: "overview", rotulo: "Visão geral", secao: "Trabalho", modulos: ["overview"] },
  { id: "reminders", rotulo: "Lembretes do dia", secao: "Trabalho", modulos: ["overview"] },
  { id: "projects", rotulo: "Projetos", secao: "Trabalho", modulos: ["projects"] },
  { id: "works", rotulo: "Obras", secao: "Trabalho", modulos: ["projects"] },
  { id: "budgets", rotulo: "Orçamentos", secao: "Trabalho", modulos: ["budgets", "projects"] },
  { id: "proposals", rotulo: "Propostas", secao: "Trabalho", modulos: ["budgets", "projects"] },
  { id: "purchases", rotulo: "Compras", secao: "Trabalho", modulos: ["purchases", "projects"] },
  { id: "schedule", rotulo: "Cronograma", secao: "Trabalho", modulos: ["schedule", "tasks", "projects"] },
  { id: "prancheta", rotulo: "Prancheta", secao: "Trabalho", modulos: ["studio", "projects"] },
  { id: "documentos", rotulo: "Documentos e PDF", secao: "Trabalho", modulos: ["studio", "projects"] },
  { id: "studio", rotulo: "Editor CAD", secao: "Trabalho", modulos: ["studio", "projects"] },
  { id: "layout", rotulo: "Criador de layout", secao: "Trabalho", modulos: ["studio", "projects"] },
  { id: "comunicacao", rotulo: "Comunicação", secao: "Trabalho", modulos: ["overview"] },
  { id: "crm", rotulo: "CRM e clientes", secao: "Negócio", modulos: ["crm"] },
  { id: "portal", rotulo: "Portal do cliente", secao: "Negócio", modulos: ["portal", "projects"] },
  { id: "finance", rotulo: "Financeiro", secao: "Negócio", modulos: ["finance", "projects"] },
  { id: "team", rotulo: "Equipe", secao: "Negócio", modulos: ["team"] },
  { id: "marca", rotulo: "Identidade visual", secao: "Negócio", modulos: [] },
  { id: "diary", rotulo: "Diário de obra", secao: "Organização", modulos: ["diary", "projects"] },
  { id: "tasks", rotulo: "Tarefas", secao: "Organização", modulos: ["tasks", "projects"] },
  { id: "files", rotulo: "Arquivos", secao: "Organização", modulos: ["files", "projects"] },
  { id: "sheets", rotulo: "Planilha e documento", secao: "Organização", modulos: ["overview"] },
  { id: "usage", rotulo: "Tempo de uso", secao: "Organização", modulos: ["overview"] },
] as const satisfies readonly { id: string; rotulo: string; secao: typeof secoesDoMenu[number]; modulos: readonly PermissionModule[] }[];

export type Ferramenta = typeof ferramentasDoMenu[number]["id"];
export const todasAsFerramentas: Ferramenta[] = ferramentasDoMenu.map((item) => item.id);

/**
 * Dados que continuam acessíveis mesmo com a tela desligada: sem Visão geral e Equipe o
 * servidor não sabe quem é a equipe (responsáveis de tarefa, autores de mensagem). Isso
 * não mostra as telas — só mantém os dados de base de pé.
 */
export const modulosEssenciais: readonly PermissionModule[] = ["overview", "team"];

/** O que cada grupo de dados cobre, para mensagens e documentação. */
export const ferramentasDoModulo: Record<PermissionModule, string> = Object.fromEntries(permissionModules.map((modulo) => [
  modulo,
  ferramentasDoMenu.filter((item) => (item.modulos as readonly PermissionModule[]).includes(modulo)).map((item) => item.rotulo).join(", "),
])) as Record<PermissionModule, string>;

export type ConfiguracaoDaEmpresa = { ferramentas: Ferramenta[]; modulos: PermissionModule[] };

export function modulosDasFerramentas(ferramentas: readonly Ferramenta[]): PermissionModule[] {
  const ligados = new Set<PermissionModule>(modulosEssenciais);
  for (const item of ferramentasDoMenu) if (ferramentas.includes(item.id)) for (const modulo of item.modulos) ligados.add(modulo);
  return permissionModules.filter((modulo) => ligados.has(modulo));
}

/**
 * Lê o que foi gravado. Ausente ou ilegível vale como "tudo liberado", o estado de antes.
 * Aceita também o formato anterior (lista de módulos): cada módulo vira as ferramentas dele.
 */
export function lerConfiguracao(valor: string | null | undefined): ConfiguracaoDaEmpresa {
  const tudo = { ferramentas: [...todasAsFerramentas], modulos: [...permissionModules] };
  if (!valor) return tudo;
  let lido: unknown;
  try { lido = JSON.parse(valor); } catch { return tudo; }
  let ferramentas: Ferramenta[];
  if (Array.isArray(lido)) {
    const modulos = new Set(lido);
    ferramentas = ferramentasDoMenu.filter((item) => item.modulos.length === 0 || item.modulos.every((modulo) => modulos.has(modulo) || modulosEssenciais.includes(modulo))).map((item) => item.id);
  } else if (lido && typeof lido === "object" && Array.isArray((lido as { ferramentas?: unknown }).ferramentas)) {
    const escolhidas = new Set((lido as { ferramentas: unknown[] }).ferramentas);
    ferramentas = todasAsFerramentas.filter((id) => escolhidas.has(id));
  } else return tudo;
  return { ferramentas, modulos: modulosDasFerramentas(ferramentas) };
}

/** Mantida para quem só precisa dos módulos de dados. */
export function lerModulosHabilitados(valor: string | null | undefined): PermissionModule[] {
  return lerConfiguracao(valor).modulos;
}

/** Permissão efetiva: o que o membro recebeu, recortado pelo que a empresa contratou. */
export function aplicarModulosDaEmpresa(permissoes: PermissionSet, habilitados: readonly PermissionModule[]): PermissionSet {
  const liberados = new Set(habilitados);
  return Object.fromEntries(permissionModules.map((modulo) => [
    modulo,
    liberados.has(modulo) ? permissoes[modulo] : { view: false, edit: false },
  ])) as PermissionSet;
}

// ─── Hierarquia para criar login ───

/**
 * Nível de cada perfil. Quem tem a ferramenta de criar login só cria perfis de nível
 * menor que o seu: um gestor cria colaborador, parceiro e prestador; nunca outro gestor.
 */
export const nivelDoPerfil: Record<string, number> = {
  [PLATFORM_SUPERADMIN_ROLE]: 100,
  owner: 90,
  admin: 70,
  manager: 50,
  finance: 50,
  hr: 50,
  accounting: 50,
  member: 30,
  service_provider: 20,
  partner: 20,
};

export const perfisCriaveis = ["admin", "manager", "finance", "hr", "accounting", "member", "service_provider", "partner"] as const;
export type PerfilCriavel = typeof perfisCriaveis[number];

/** Perfis que podem receber do contratante a ferramenta de criar login. */
export const perfisQueRecebemDelegacao = ["admin", "manager", "finance", "hr", "accounting"] as const;

export function podeCriarPerfil(perfilDeQuemCria: string, perfilNovo: string) {
  return (nivelDoPerfil[perfilDeQuemCria] ?? 0) > (nivelDoPerfil[perfilNovo] ?? Number.POSITIVE_INFINITY);
}

export function perfisAbaixoDe(perfil: string): PerfilCriavel[] {
  return perfisCriaveis.filter((novo) => podeCriarPerfil(perfil, novo));
}

// ─── Identidade visual ───

export type MarcaDaEmpresa = {
  menuColor: string | null;
  accentColor: string | null;
  bandColor: string | null;
  logoVersion: number;
  hasLogo: boolean;
};

export const marcaPadrao: MarcaDaEmpresa = { menuColor: null, accentColor: null, bandColor: null, logoVersion: 0, hasLogo: false };

const HEX = /^#[0-9a-f]{6}$/;

export function normalizarCor(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const limpo = valor.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(limpo)) return `#${limpo.slice(1).split("").map((c) => c + c).join("")}`;
  return HEX.test(limpo) ? limpo : null;
}

function canais(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function luminancia(hex: string) {
  const [r, g, b] = canais(hex).map((valor) => {
    const c = valor / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste WCAG entre duas cores. */
export function contraste(a: string, b: string) {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
}

/**
 * Toda a interface põe texto branco sobre estas três cores (menu, faixa e botão). Uma cor
 * clara da marca — amarelo, verde-limão — deixaria esse texto ilegível. Em vez de recusar,
 * a cor é escurecida no mesmo matiz até o branco atingir 4,5:1 (WCAG AA).
 */
export function ajustarParaTextoBranco(hex: string, minimo = 4.5): string {
  let [r, g, b] = canais(hex);
  let atual = hex;
  for (let passo = 0; passo < 60 && contraste(atual, "#ffffff") < minimo; passo += 1) {
    r = Math.floor(r * 0.94); g = Math.floor(g * 0.94); b = Math.floor(b * 0.94);
    atual = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  }
  return atual;
}

/**
 * "Ninguém libera mais do que tem", olhando só os módulos que a empresa contratou. A
 * permissão de quem concede já vem recortada pelo contrato; sem recortar também a de quem
 * recebe, um módulo desligado e ainda gravado no cadastro de alguém travava qualquer
 * administrador de mexer naquele acesso.
 */
export function excedeQuemConcede(concedido: PermissionSet, concedente: PermissionSet, habilitados: readonly PermissionModule[]): PermissionModule[] {
  const recortado = aplicarModulosDaEmpresa(concedido, habilitados);
  return permissionModules.filter((modulo) =>
    (recortado[modulo].view && !concedente[modulo].view) || (recortado[modulo].edit && !concedente[modulo].edit));
}
