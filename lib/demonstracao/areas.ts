// Áreas da demonstração pública. Fica fora do componente cliente porque a página, no
// servidor, valida o parâmetro `area` antes de montar a tela.
export const AREAS_DEMO = ["painel", "cad", "layout", "documentos"] as const;
export type AreaDemo = typeof AREAS_DEMO[number];
export const areaValida = (valor: string | null | undefined): AreaDemo =>
  (AREAS_DEMO as readonly string[]).includes(valor ?? "") ? valor as AreaDemo : "painel";
