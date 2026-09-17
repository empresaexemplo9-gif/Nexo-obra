import { ApiError } from "@/lib/server/api-error";
import { runtimeEnv } from "@/lib/server/runtime";

// Segredo de terceiro guardado no banco desta plataforma.
//
// A chave `drap_live_…` de cada empresa opera o financeiro dela na Drap. Ela chega quando
// a empresa é provisionada — uma resposta HTTP, uma vez só — e precisa sobreviver a isso
// para as chamadas seguintes. Guardar em variável de ambiente resolveria a cifra e
// quebraria o produto: cada empresa nova exigiria um deploy, e "sem segundo login" viraria
// "sem segundo login, mas com um deploy".
//
// ## Por que cifrado, se o banco já é privado
//
// Pelo mesmo motivo das fotos do diário: uma tranca só é uma tranca. Cópia de backup,
// engano de permissão, credencial de banco vazada — em qualquer um desses o conteúdo em
// claro seria a chave do financeiro de todas as empresas atendidas. Cifrado, é ruído sem
// `SECRETS_ENCRYPTION_KEY`, que vive no painel de publicação e nunca no banco.
//
// ## Por que uma chave própria, e não a das fotos
//
// `MEDIA_ENCRYPTION_KEY` protege imagem; esta protege credencial de acesso a dinheiro.
// Compartilhar as duas amarraria a rotação de uma à outra: girar a chave das fotos
// deixaria as empresas sem integração no mesmo instante. Propósitos diferentes, prazos de
// rotação diferentes, chaves diferentes.
//
// ## O formato
//
// AES-256-GCM: cabeçalho `NXS1`, vetor de inicialização de 12 bytes sorteado por segredo,
// texto cifrado com a etiqueta de autenticação, tudo em base64 para caber numa coluna de
// texto. Segredo adulterado falha na verificação da etiqueta em vez de virar uma chave
// meio certa que produz erro incompreensível na Drap.

const MAGIC = new Uint8Array([0x4e, 0x58, 0x53, 0x31]); // "NXS1"
const IV_BYTES = 12;

function indisponivel(detalhe: string): never {
  throw new ApiError(503, "secrets_unavailable", "A guarda de credenciais não está configurada nesta instalação.", detalhe);
}

function deBase64(valor: string) {
  const binario = atob(valor);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function paraBase64(bytes: Uint8Array) {
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario);
}

/** `subtle` recusa view de buffer compartilhado; devolve sempre um buffer só dele. */
function bufferProprio(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

async function chave() {
  const configurada = runtimeEnv().SECRETS_ENCRYPTION_KEY?.trim();
  // Sem chave não se grava credencial nenhuma. O caminho alternativo seria gravar em
  // claro, e isso não é algo para acontecer por omissão de configuração.
  if (!configurada) indisponivel("SECRETS_ENCRYPTION_KEY não está configurada.");
  const bruta = deBase64(configurada);
  if (bruta.byteLength !== 32) indisponivel("SECRETS_ENCRYPTION_KEY precisa ter 32 bytes em base64.");
  return crypto.subtle.importKey("raw", bufferProprio(bruta), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Cifra um segredo para guardar no banco. Devolve base64. */
export async function cifrarSegredo(texto: string): Promise<string> {
  const key = await chave();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cifra = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bufferProprio(iv) },
    key,
    new TextEncoder().encode(texto),
  ));
  const envelope = new Uint8Array(MAGIC.byteLength + IV_BYTES + cifra.byteLength);
  envelope.set(MAGIC, 0);
  envelope.set(iv, MAGIC.byteLength);
  envelope.set(cifra, MAGIC.byteLength + IV_BYTES);
  return paraBase64(envelope);
}

/**
 * Decifra. Devolve `null` quando o valor não é um envelope desta chave — trocado,
 * truncado, cifrado com chave antiga ou simplesmente lixo.
 *
 * `null` e não exceção porque quem chama precisa distinguir "esta empresa não tem
 * credencial guardada" de "o servidor caiu": o primeiro caso vira uma tela dizendo para
 * reconectar, o segundo viraria um 500 sem explicação.
 */
export async function decifrarSegredo(guardado: string): Promise<string | null> {
  let envelope: Uint8Array;
  try {
    envelope = deBase64(guardado.trim());
  } catch {
    return null;
  }
  if (envelope.byteLength <= MAGIC.byteLength + IV_BYTES) return null;
  if (!MAGIC.every((byte, indice) => envelope[indice] === byte)) return null;

  const key = await chave();
  const iv = envelope.subarray(MAGIC.byteLength, MAGIC.byteLength + IV_BYTES);
  const cifra = envelope.subarray(MAGIC.byteLength + IV_BYTES);
  try {
    const aberto = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bufferProprio(iv) }, key, bufferProprio(cifra));
    return new TextDecoder().decode(aberto);
  } catch {
    // Etiqueta inválida. Devolver conteúdo não verificado seria usar como credencial
    // bytes que alguém pode ter escolhido.
    return null;
  }
}

/** A instalação sabe guardar segredo? Serve para a tela explicar antes de tentar. */
export function guardaDeSegredosConfigurada(): boolean {
  const configurada = runtimeEnv().SECRETS_ENCRYPTION_KEY?.trim();
  if (!configurada) return false;
  try {
    return deBase64(configurada).byteLength === 32;
  } catch {
    return false;
  }
}
