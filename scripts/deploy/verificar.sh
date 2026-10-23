#!/usr/bin/env bash
# Verificación posterior al despliegue (docs/CI_CD.md): la URL sirve el commit
# esperado con la migración esperada y sus dependencias responden.
#
# Uso: scripts/deploy/verificar.sh <url> <commit> [intentos]
set -euo pipefail

url="${1:?url}"
commit="${2:?commit}"
intentos="${3:-30}"
migracion="$(find supabase/migrations -name '*.sql' -printf '%f\n' | sort | tail -1 | sed 's/\.sql$//')"

for ((i = 1; i <= intentos; i++)); do
  if salud="$(curl -fsS --max-time 10 "$url/api/salud")"; then
    servido="$(jq -r .commit <<<"$salud")"
    if [[ "$servido" == "$commit" ]]; then
      [[ "$(jq -r .migration <<<"$salud")" == "$migracion" ]] || {
        echo "El despliegue espera otra migración: $(jq -r .migration <<<"$salud")" >&2
        exit 1
      }
      codigo="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url/api/salud/listo")"
      [[ "$codigo" == "200" ]] || {
        echo "La aplicación responde pero no está lista (/api/salud/listo = $codigo)." >&2
        exit 1
      }
      {
        echo "### Despliegue verificado"
        echo "- URL: $url"
        echo "- Commit: \`$commit\`"
        echo "- Migración: \`$migracion\`"
        echo "- Entorno: \`$(jq -r .environment <<<"$salud")\`"
      } >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
      echo "Verificado: $url sirve $commit ($migracion)."
      exit 0
    fi
  fi
  sleep 10
done
echo "La URL no sirve el commit $commit tras $intentos intentos." >&2
exit 1
