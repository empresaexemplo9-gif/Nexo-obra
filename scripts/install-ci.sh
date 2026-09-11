#!/usr/bin/env bash
set -euo pipefail

# Instalação de dependências para ambientes de sandbox, onde HOME e o cache do npm
# precisam ficar dentro do projeto. O Vercel não usa este script: o `vercel.json` declara
# `npm ci` direto.
#
# A versão anterior baixava e conferia à mão o tarball do vinext antes de instalar, porque
# aquele pacote vinha de fora do registro e travava o build da hospedagem antiga. O vinext
# saiu junto com o build da Cloudflare, e com ele essa preflight inteira.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

command -v flock >/dev/null || {
  echo "install-ci.sh requer flock." >&2
  exit 69
}

runtime_root="${SITES_PROJECT_ROOT}/.sites-runtime"

# Uma instalação por vez: duas sobrepostas corrompem node_modules pela metade.
lock_file="${runtime_root}/install.lock"
exec 9>"${lock_file}"
if ! flock -n 9; then
  echo "Outra instalação já está em andamento em ${SITES_PROJECT_ROOT}." >&2
  exit 75
fi

echo "[nexo] npm ci"
npm ci --cache "${runtime_root}/npm-cache"
echo "[nexo] dependências instaladas"
