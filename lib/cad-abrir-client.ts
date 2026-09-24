"use client";

import { uploadOrgFile } from "@/lib/org-files-client";

// Abrir um DWG ou DXF no Editor CAD: cria uma prancha e abre o editor em outra aba, já
// importando o arquivo da biblioteca da Prancheta. A aba é aberta antes de qualquer
// espera, no próprio clique — senão o navegador a bloqueia como janela não pedida.

async function mensagem(resposta: Response) {
  const corpo = await resposta.json().catch(() => ({})) as { error?: string };
  return corpo.error ?? "Não foi possível criar a prancha.";
}

export async function abrirNoEditorCad(arquivo: { id: string; name: string; projectId?: string | null }, abaJaAberta?: Window | null) {
  const aba = abaJaAberta === undefined ? window.open("", "_blank") : abaJaAberta;
  if (aba) aba.opener = null;
  try {
    const nome = arquivo.name.replace(/\.[^.]+$/, "").trim().slice(0, 120) || "Desenho importado";
    const resposta = await fetch("/api/studio", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome, especie: "planta", projectId: arquivo.projectId ?? null }),
    });
    if (!resposta.ok) throw new Error(await mensagem(resposta));
    const { prancha } = await resposta.json() as { prancha: { id: string } };
    const destino = `/prancheta/${prancha.id}?importar=${encodeURIComponent(arquivo.id)}&nome=${encodeURIComponent(arquivo.name)}`;
    if (aba) aba.location.href = destino; else window.open(destino, "_self");
    return prancha.id;
  } catch (erro) {
    aba?.close();
    throw erro;
  }
}

/** Envia o arquivo à biblioteca (em partes) e abre no Editor CAD. */
export async function enviarEAbrirNoEditorCad(arquivo: File, projectId: string | null, onProgress?: (fracao: number) => void) {
  const aba = window.open("", "_blank");
  try {
    const guardado = await uploadOrgFile(arquivo, arquivo.name, { area: "prancheta", projectId, onProgress });
    return await abrirNoEditorCad({ id: guardado.id, name: guardado.name, projectId }, aba);
  } catch (erro) {
    aba?.close();
    throw erro;
  }
}
