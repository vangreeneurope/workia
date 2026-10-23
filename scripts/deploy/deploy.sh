#!/usr/bin/env bash
# Interfaz de despliegue portable (docs/CI_CD.md, § Despliegue).
#
# Uso: scripts/deploy/deploy.sh <preview|staging|production>
#
# Delega en el adaptador scripts/deploy/proveedores/$DEPLOY_PROVIDER.sh, que
# define la función `desplegar <entorno>`, escribe su progreso en stderr y la
# URL pública final en la última línea de stdout. Este script valida las entradas comunes, publica la
# URL como salida del paso (GITHUB_OUTPUT) y no conoce ningún proveedor.
#
# Entradas comunes (las fija el workflow): APP_ENV, APP_COMMIT y las variables
# públicas NEXT_PUBLIC_*. Los secretos de ejecución (SUPABASE_SECRET_KEY,
# CRON_SECRET, METRICS_TOKEN…) viven en el gestor de secretos del hosting y no
# pasan por aquí.
set -euo pipefail

entorno="${1:-}"
case "$entorno" in
  preview | staging | production) ;;
  *)
    echo "Uso: $0 <preview|staging|production>" >&2
    exit 2
    ;;
esac

proveedor="${DEPLOY_PROVIDER:-}"
if [[ ! "$proveedor" =~ ^[a-z0-9-]+$ ]]; then
  echo "DEPLOY_PROVIDER no definido o no válido (ver scripts/deploy/proveedores/README.md)." >&2
  exit 1
fi
adaptador="$(dirname "$0")/proveedores/$proveedor.sh"
[[ -f "$adaptador" ]] || {
  echo "No existe el adaptador $adaptador." >&2
  exit 1
}

for name in APP_ENV APP_COMMIT NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY NEXT_PUBLIC_SITE_URL; do
  [[ -n "${!name:-}" ]] || {
    echo "Falta $name." >&2
    exit 1
  }
done
[[ "$APP_ENV" == "$entorno" ]] || {
  echo "APP_ENV ($APP_ENV) no coincide con el entorno ($entorno)." >&2
  exit 1
}

# shellcheck source=/dev/null
source "$adaptador"
# El adaptador escribe su progreso en stderr y la URL en stdout.
salida="$(desplegar "$entorno")"
url="$(tail -n 1 <<<"$salida")"
[[ "$url" =~ ^https?:// ]] || {
  echo "El adaptador no devolvió una URL válida." >&2
  exit 1
}
echo "url=$url" >>"${GITHUB_OUTPUT:-/dev/null}"
echo "Desplegado $APP_COMMIT en $entorno: $url"
