import { del, get, put } from "@vercel/blob";

import { ApiError } from "@/lib/server/api-error";
import { runtimeEnv } from "@/lib/server/runtime";

// Armazenamento das fotos do diário.
//
// Antes era um bucket R2, que só existe dentro do runtime da Cloudflare. Fora dele o
// binding não existe e nenhuma foto abre. Aqui o armazenamento é o Vercel Blob, com a
// mesma superfície mínima que o produto usava: gravar, ler e apagar por chave.
//
// Dependência nova (`@vercel/blob`): depois de sair do R2 a plataforma não tem
// armazenamento de objeto nenhum, e nem o banco libSQL nem o disco da função serverless
// servem — o disco é efêmero e o banco não é lugar de binário de 5 MB.
//
// ## Por que o conteúdo vai cifrado
//
// O R2 tornava o objeto inalcançável sem credencial. O objeto aqui sobe como privado
// (`access: "private"`), então a URL sozinha não devolve nada: a leitura passa pelo token
// do armazenamento. Isso recupera a garantia que o R2 dava — mas guardar a foto em claro
// mesmo assim seria apostar tudo numa única tranca, do lado do fornecedor.
//
// Então o que sobe é AES-256-GCM: cabeçalho `NXO1`, vetor de inicialização de 12 bytes
// sorteado por objeto, e o texto cifrado com a etiqueta de autenticação. A chave fica em
// `MEDIA_ENCRYPTION_KEY`, no ambiente de publicação, e nunca no armazenamento. Um objeto
// que escape do armazenamento — token vazado, engano de configuração, cópia de backup —
// devolve bytes inúteis; um objeto adulterado falha na verificação da etiqueta em vez de
// ser servido como imagem.
//
// A autorização continua nas rotas — empresa, registro e permissão são conferidos antes
// de devolver os bytes. A cifra é a segunda tranca, não a primeira.

export type StoredObject = { body: ReadableStream | null };

const MAGIC = new Uint8Array([0x4e, 0x58, 0x4f, 0x31]); // "NXO1"
const IV_BYTES = 12;

// Armazenamento injetado. Em teste, os bytes ficam em memória e nada sai pela rede;
// autorização, permissão, consultas, handlers e a cifra continuam sendo os reais.
type ObjectStore = {
  put(path: string, bytes: ArrayBuffer, contentType: string): Promise<string>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
};

function injected(): ObjectStore | null {
  return (runtimeEnv() as unknown as { FILES?: ObjectStore }).FILES ?? null;
}

function unavailable(detail: string): never {
  // A mensagem para o usuário não muda com o motivo: ele não configura nada disso, e o
  // registro em texto continua salvo. O motivo vai no código do erro, para o diagnóstico.
  throw new ApiError(503, "storage_unavailable", "O armazenamento de fotos está indisponível. O registro em texto continua salvo.", detail);
}

function token() {
  const value = runtimeEnv().BLOB_READ_WRITE_TOKEN;
  if (!value) unavailable("BLOB_READ_WRITE_TOKEN não está configurada.");
  return value;
}

async function encryptionKey() {
  const configured = runtimeEnv().MEDIA_ENCRYPTION_KEY?.trim();
  // Sem chave não se grava foto nenhuma. O caminho alternativo seria subir em claro,
  // e um armazenamento de URL pública em claro não é algo para acontecer por omissão.
  if (!configured) unavailable("MEDIA_ENCRYPTION_KEY não está configurada.");
  const raw = fromBase64(configured);
  if (raw.byteLength !== 32) unavailable("MEDIA_ENCRYPTION_KEY precisa ter 32 bytes em base64.");
  return crypto.subtle.importKey("raw", ownedBuffer(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function seal(bytes: ArrayBuffer) {
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: ownedBuffer(iv) }, key, bytes));
  const envelope = new Uint8Array(MAGIC.byteLength + IV_BYTES + cipher.byteLength);
  envelope.set(MAGIC, 0);
  envelope.set(iv, MAGIC.byteLength);
  envelope.set(cipher, MAGIC.byteLength + IV_BYTES);
  return envelope;
}

async function open(envelope: Uint8Array) {
  if (envelope.byteLength <= MAGIC.byteLength + IV_BYTES) return null;
  if (!MAGIC.every((byte, index) => envelope[index] === byte)) return null;
  const key = await encryptionKey();
  const iv = envelope.subarray(MAGIC.byteLength, MAGIC.byteLength + IV_BYTES);
  const cipher = envelope.subarray(MAGIC.byteLength + IV_BYTES);
  try {
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ownedBuffer(iv) }, key, ownedBuffer(cipher),
    ));
  } catch {
    // Etiqueta inválida: o objeto foi trocado, truncado ou é de outra chave. Não se
    // devolve conteúdo não verificado como se fosse a foto original.
    return null;
  }
}

// Devolve a chave a guardar no banco. É o que `getObject` e `deleteObject` recebem.
export async function putObject(path: string, bytes: ArrayBuffer, contentType: string) {
  const envelope = await seal(bytes);
  const store = injected();
  // O que é gravado é sempre o envelope cifrado, inclusive no armazenamento em memória
  // dos testes: é assim que a volta inteira fica coberta.
  if (store) return store.put(path, ownedBuffer(envelope), contentType);
  // `Blob` porque o cliente do Vercel Blob não aceita `Uint8Array` direto.
  const result = await put(path, new Blob([ownedBuffer(envelope)]), {
    // Objeto privado: sem o token do armazenamento a URL não devolve nada. A cifra
    // continua sendo a segunda tranca, não a única.
    access: "private",
    // O tipo real nunca é anunciado: o objeto é um envelope opaco, e o tipo da imagem
    // vem do banco na hora de servir.
    contentType: "application/octet-stream",
    token: token(),
    // Sufixo aleatório: duas fotos com o mesmo caminho não se sobrescrevem, e a chave
    // não é dedutível a partir dos identificadores da empresa.
    addRandomSuffix: true,
    cacheControlMaxAge: 0,
  });
  return result.url;
}

export async function getObject(key: string): Promise<StoredObject | null> {
  const envelope = await readEnvelope(key);
  if (!envelope) return null;
  const plain = await open(envelope);
  if (!plain) return null;
  return { body: new Response(ownedBuffer(plain)).body };
}

async function readEnvelope(key: string) {
  const store = injected();
  if (store) {
    const stored = await store.get(key);
    if (!stored?.body) return null;
    return new Uint8Array(await new Response(stored.body).arrayBuffer());
  }
  // Leitura autenticada: `get` usa o token do armazenamento e devolve `null` quando o
  // objeto não existe, o que substitui a conferência por `head` e o `fetch` da URL.
  let stored;
  try {
    stored = await get(key, { access: "private", token: token(), useCache: false });
  } catch {
    return null;
  }
  if (!stored?.stream) return null;
  return new Uint8Array(await new Response(stored.stream).arrayBuffer());
}

export async function deleteObject(key: string) {
  const store = injected();
  if (store) { await store.delete(key); return; }
  await del(key, { token: token() });
}

function ownedBuffer(value: Uint8Array) { return Uint8Array.from(value).buffer; }

function fromBase64(value: string) {
  try {
    return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (character) => character.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}
