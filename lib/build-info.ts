// Identificação do build que está realmente servindo a aplicação.
//
// O domínio público (`nexo-obra-jet.vercel.app`) apenas reescreve as rotas para o alvo
// do OpenAI Sites; ele não compila o repositório. Isso já causou horas de confusão:
// o código estava publicado no GitHub e o site continuava servindo uma versão antiga.
// Este selo responde na tela qual commit está no ar.

declare const __PLATFORM_BUILD__: string | undefined;
declare const __PLATFORM_BUILT_AT__: string | undefined;

export const PLATFORM_BUILD = typeof __PLATFORM_BUILD__ === "string" ? __PLATFORM_BUILD__ : "desconhecido";
export const PLATFORM_BUILT_AT = typeof __PLATFORM_BUILT_AT__ === "string" ? __PLATFORM_BUILT_AT__ : "";
