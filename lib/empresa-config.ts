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

// ─── Módulos contratados ───

/** Sem estes a empresa não abre nem administra a própria equipe; nunca são desligados. */
export const modulosEssenciais: readonly PermissionModule[] = ["overview", "team"];

export const modulosContrataveis: PermissionModule[] = permissionModules.filter((modulo) => !modulosEssenciais.includes(modulo));

/** O que cada módulo leva junto no menu, para o superadmin saber o que está desligando. */
export const ferramentasDoModulo: Record<PermissionModule, string> = {
  overview: "Visão geral, lembretes, comunicação, planilhas e tempo de uso",
  projects: "Projetos e obras",
  budgets: "Orçamentos e propostas",
  schedule: "Cronograma",
  diary: "Diário de obra",
  portal: "Portal do cliente",
  crm: "CRM e clientes",
  finance: "Financeiro, cobranças e notas",
  team: "Equipe e acessos",
  tasks: "Tarefas",
  files: "Arquivos",
  studio: "Prancheta, Documentos e PDF, Editor CAD e Criador de layout",
  purchases: "Compras e suprimentos",
};

/** Lê o que foi gravado. Ausente ou ilegível vale como "tudo liberado", o estado de antes. */
export function lerModulosHabilitados(valor: string | null | undefined): PermissionModule[] {
  if (!valor) return [...permissionModules];
  try {
    const lista = JSON.parse(valor) as unknown;
    if (!Array.isArray(lista)) return [...permissionModules];
    const escolhidos = new Set(lista.filter((item): item is PermissionModule => permissionModules.includes(item as PermissionModule)));
    for (const essencial of modulosEssenciais) escolhidos.add(essencial);
    return permissionModules.filter((modulo) => escolhidos.has(modulo));
  } catch {
    return [...permissionModules];
  }
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
