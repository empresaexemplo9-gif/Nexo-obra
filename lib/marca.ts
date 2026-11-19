// Marca exibida na interface. A plataforma é a mesma para todas as empresas; o que muda é
// a identidade visual de uma empresa contratante que trabalha com a marca própria dela.
//
// Seguro para o navegador: nada aqui autoriza coisa alguma. A marca vem do servidor, que a
// deriva da empresa resolvida pela sessão — nunca de um valor enviado pelo navegador.

export type Marca = "drap" | "oikos";

/** Empresa reservada do espaço Oikos. Fixa, como a do ambiente de manutenção. */
export const OIKOS_ORGANIZATION_ID = "00000000-0000-4000-9000-000000000002";

export const MARCAS: Record<Marca, { nome: string; assinatura: string; titulo: string; corTema: string }> = {
  drap: {
    nome: "DRAP Backoffice",
    assinatura: "DRAP · Backoffice para arquitetos",
    titulo: "DRAP Backoffice para Arquitetos",
    corTema: "#0D151F",
  },
  oikos: {
    nome: "H.OIKOS",
    assinatura: "H.OIKOS · Ecossistema para arquitetos",
    titulo: "H.OIKOS | Ecossistema para arquitetos",
    corTema: "#1C190F",
  },
};

export function marcaDaOrganizacao(organizationId: string | null | undefined): Marca {
  return organizationId === OIKOS_ORGANIZATION_ID ? "oikos" : "drap";
}

/** Chave local só de aparência: evita piscar o tema errado antes de a sessão responder. */
export const MARCA_STORAGE_KEY = "nexo-marca";

/**
 * Aplica a marca no documento. Somente cosmético: o atributo troca cores, logo e título;
 * permissões e dados continuam vindo do servidor.
 */
export function aplicarMarca(marca: Marca) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (marca === "drap") delete root.dataset.marca;
  else root.dataset.marca = marca;
  document.title = MARCAS[marca].titulo;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", MARCAS[marca].corTema);
  try {
    if (marca === "drap") window.localStorage.removeItem(MARCA_STORAGE_KEY);
    else window.localStorage.setItem(MARCA_STORAGE_KEY, marca);
  } catch { /* armazenamento bloqueado: a marca vale só para esta página */ }
}

/** Script curto do <head>: lê a marca guardada e marca o documento antes da primeira pintura. */
export const MARCA_BOOT_SCRIPT = `try{var m=localStorage.getItem(${JSON.stringify(MARCA_STORAGE_KEY)});if(m==="oikos"){document.documentElement.dataset.marca=m;}}catch(e){}`;
