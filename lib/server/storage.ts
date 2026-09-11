import { del, head, put } from "@vercel/blob";

import { ApiError } from "@/lib/server/api-error";
import { runtimeEnv } from "@/lib/server/runtime";

// Armazenamento das fotos do diário.
//
// Antes era um bucket R2, que só existe dentro do runtime da Cloudflare. Fora dele o
// binding não existe e nenhuma foto abre. Aqui o armazenamento é o Vercel Blob, com a
// mesma superfície mínima que o produto usava: gravar, ler e apagar por chave.
//
// Dependência nova (`@vercel/blob`): depois de sair do R2 a plataforma não tem
// armazenamento de objeto nenhum, e nem o banco libSQL nem o sistema de arquivos da
// função serverless servem — o disco é efêmero e o banco não é lugar de binário de 5 MB.
//
// Sobre privacidade: o Vercel Blob publica cada objeto numa URL aleatória. A autorização
// continua sendo feita pelas rotas, que conferem empresa, registro e permissão antes de
// devolver os bytes, e a URL nunca sai do servidor. É uma garantia mais fraca que a do
// R2, onde o objeto era inalcançável sem credencial: quem descobrir a URL exata alcança
// o arquivo. Por isso a chave é tratada como segredo e nunca aparece em resposta, log
// ou auditoria.

export type StoredObject = { body: ReadableStream | null };

// Armazenamento injetado. Em teste, os bytes ficam em memória e nada sai pela rede;
// autorização, permissão, consultas e handlers continuam sendo os reais.
type ObjectStore = {
  put(path: string, bytes: ArrayBuffer, contentType: string): Promise<string>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
};

function injected(): ObjectStore | null {
  return (runtimeEnv() as unknown as { FILES?: ObjectStore }).FILES ?? null;
}

function token() {
  const value = runtimeEnv().BLOB_READ_WRITE_TOKEN;
  if (!value) {
    throw new ApiError(
      503,
      "storage_unavailable",
      "O armazenamento de fotos está indisponível. O registro em texto continua salvo.",
    );
  }
  return value;
}

// Devolve a chave a guardar no banco: a URL do objeto. É o que `getObject` e
// `deleteObject` recebem de volta.
export async function putObject(path: string, bytes: ArrayBuffer, contentType: string) {
  const store = injected();
  if (store) return store.put(path, bytes, contentType);
  const result = await put(path, bytes, {
    access: "public",
    contentType,
    token: token(),
    // Sufixo aleatório: duas fotos com o mesmo caminho não se sobrescrevem, e a chave
    // não é dedutível a partir dos identificadores da empresa.
    addRandomSuffix: true,
    cacheControlMaxAge: 0,
  });
  return result.url;
}

export async function getObject(key: string): Promise<StoredObject | null> {
  const store = injected();
  if (store) return store.get(key);
  const configured = token();
  try {
    // `head` confirma que o objeto existe neste armazenamento antes de buscar os bytes.
    await head(key, { token: configured });
  } catch {
    return null;
  }
  const response = await fetch(key, { cache: "no-store" });
  if (!response.ok) return null;
  return { body: response.body };
}

export async function deleteObject(key: string) {
  const store = injected();
  if (store) { await store.delete(key); return; }
  await del(key, { token: token() });
}
