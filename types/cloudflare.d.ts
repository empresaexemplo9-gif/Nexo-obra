/**
 * Tipos do runtime Cloudflare Workers.
 *
 * O projeto roda como Worker e importa `cloudflare:workers` (em `db/index.ts` e
 * `lib/integrations/drap.ts`), além de usar `D1Database` e `Fetcher` em
 * `worker/index.ts`. Sem esta referência o `tsc` não resolve nenhum dos três: o
 * Vite compila porque resolve o módulo em tempo de build, mas qualquer etapa que
 * rode verificação de tipos falha — foi o que quebrou a primeira implantação.
 *
 * O driver D1 do próprio Drizzle também espera este pacote: ele declara
 * `/// <reference types="@cloudflare/workers-types" />` na origem.
 *
 * Este arquivo é declaração ambiente, sem `import`/`export` de nível superior —
 * é o que permite a fusão de declarações com o namespace `Cloudflare`.
 */

/// <reference types="@cloudflare/workers-types" />

/**
 * Bindings e variáveis do Worker, fundidos com `Cloudflare.Env`.
 *
 * Os nomes dos bindings vêm de `.openai/hosting.json`, que o `vite.config.ts`
 * converte na configuração local do Wrangler. São opcionais de propósito: em um
 * ambiente sem banco `getDbOrNull()` precisa poder detectar a ausência em vez de
 * confiar que o binding existe.
 *
 * As variáveis da Drap ficam aqui porque são lidas no ambiente do Worker, no
 * servidor. Nenhuma delas pode ganhar o prefixo `NEXT_PUBLIC_`.
 */
declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;

    DRAP_API_URL?: string;
    DRAP_API_TOKEN?: string;
    DRAP_API_KEY_HEADER?: string;
    DRAP_SUMMARY_PATH?: string;
    DRAP_WEBHOOK_SECRET?: string;

    /** Identidade de desenvolvimento — ver `lib/auth/identity.ts`. */
    NEXO_DEV_USER_EMAIL?: string;
    NEXO_DEV_USER_NAME?: string;
    NEXO_ALLOW_DEV_LOGIN?: string;
  }
}
