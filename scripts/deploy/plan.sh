#!/usr/bin/env bash
# Plan de despliegue (lo ejecuta .github/workflows/despliegue.yml).
# Decide entorno y commit, y comprueba las condiciones de seguridad:
#  - preview: commit de la PR; si la PR cambia supabase/migrations, no se despliega
#    (el esquema solo cambia en staging y producción, tras fusionar).
#  - staging: commit de main que acaba de pasar el CI.
#  - production: el commit indicado debe estar en main y tener «CI correcto» en verde.
# Entradas: EVENT, RUN_EVENT, RUN_SHA, INPUT_ENTORNO, INPUT_REF, GH_TOKEN, REPO.
set -euo pipefail

out="${GITHUB_OUTPUT:-/dev/stdout}"
# origin/main ya está en el checkout completo (fetch-depth: 0). No se vuelve a
# pedir a GitHub: el checkout no guarda credenciales y en un repositorio privado
# un "git fetch" fallaría (exit 128).
git rev-parse --verify --quiet origin/main >/dev/null || {
  echo "::error::Falta origin/main en el checkout (¿fetch-depth distinto de 0?)."
  exit 1
}

if [[ "$EVENT" == "workflow_dispatch" ]]; then
  entorno="$INPUT_ENTORNO"
  sha="$(git rev-parse --verify "${INPUT_REF}^{commit}")"
  if ! git merge-base --is-ancestor "$sha" origin/main; then
    echo "::error::$sha no está en main: solo se despliega código revisado y fusionado."
    exit 1
  fi
  estado="$(gh api "repos/$REPO/commits/$sha/check-runs?check_name=CI%20correcto" \
    --jq '[.check_runs[] | select(.conclusion == "success")] | length')"
  if [[ "$estado" == "0" ]]; then
    echo "::error::El commit $sha no tiene «CI correcto» en verde."
    exit 1
  fi
elif [[ "$RUN_EVENT" == "push" ]]; then
  entorno="staging"
  sha="$RUN_SHA"
else
  entorno="preview"
  sha="$RUN_SHA"
fi

desplegar=true
migraciones=false
if [[ "$entorno" == "preview" ]]; then
  if ! git diff --quiet "origin/main...$sha" -- supabase/migrations; then
    echo "::notice::La PR cambia el esquema: sin preview hasta fusionar (se valida en el CI)."
    desplegar=false
  fi
else
  # migrar.sh comprueba en la base del entorno qué falta por aplicar.
  migraciones=true
fi

{
  echo "entorno=$entorno"
  echo "sha=$sha"
  echo "desplegar=$desplegar"
  echo "migraciones=$migraciones"
} >>"$out"
echo "Plan: $entorno · $sha · desplegar=$desplegar · migraciones=$migraciones"
