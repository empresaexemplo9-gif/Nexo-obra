export const ESPECIES = ["planta", "corte", "elevacao", "detalhe", "apresentacao"] as const;

type Linha = {
  id: string; nome: string; especie: string; revisao: number;
  project_id: string | null; project_name: string | null; project_code: string | null;
  autor: string | null; created_at: string; updated_at: string;
};

export function resposta(linha: Linha) {
  return {
    id: linha.id,
    nome: linha.nome,
    especie: linha.especie,
    revisao: linha.revisao,
    projectId: linha.project_id,
    projectName: linha.project_name,
    projectCode: linha.project_code,
    autor: linha.autor,
    criadoEm: linha.created_at,
    atualizadoEm: linha.updated_at,
  };
}
