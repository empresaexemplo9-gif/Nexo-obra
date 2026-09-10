// Gera o hash da senha administrativa no formato que a plataforma verifica.
//
// Uso: npm run superadmin:hash -- "sua senha"
//
// A saída usa dois-pontos como separador de propósito: painéis de publicação e leitores
// de .env costumam expandir "$" como variável e mutilam o hash sem avisar, o que faz o
// login responder "senha inválida" com a senha correta.

const senha = process.argv.slice(2).join(" ");
if (!senha) {
  console.error('Informe a senha: npm run superadmin:hash -- "sua senha"');
  process.exit(1);
}
if (senha.length < 12) {
  console.error("Use ao menos 12 caracteres.");
  process.exit(1);
}

const base64url = (bytes) =>
  Buffer.from(bytes).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, key, 256);

console.log(`pbkdf2-sha256:100000:${base64url(salt)}:${base64url(new Uint8Array(bits))}`);
