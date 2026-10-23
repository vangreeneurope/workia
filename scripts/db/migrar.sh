#!/usr/bin/env bash
# Aplica las migraciones pendientes a UN entorno de Supabase (docs/CI_CD.md, § Migraciones).
#
# Uso: scripts/db/migrar.sh <preview|staging|production> [--dry-run]
#
# Variables (secretos y variables del entorno de GitHub; nunca en el YAML):
#   SUPABASE_ACCESS_TOKEN   token del CLI (secreto del entorno)
#   SUPABASE_PROJECT_REF    proyecto del entorno (variable del entorno)
#   SUPABASE_DB_PASSWORD    contraseña de la base (secreto del entorno)
#   SUPABASE_PRODUCTION_REF proyecto de producción (variable del repositorio): impide
#                           aplicar a producción algo pensado para otro entorno
#   COPIA_CONFIRMADA        "true" en producción: quien aprueba confirma que hay copia
#                           o punto de restauración (PITR) válido antes de migrar
#
# Garantías: `supabase db push` registra cada migración aplicada en
# supabase_migrations.schema_migrations, así que cada una se aplica una sola vez
# por entorno; nunca se cargan semillas (sin --include-seed). El workflow usa un
# grupo de concurrencia por entorno: dos migraciones no corren a la vez.
set -euo pipefail

entorno="${1:-}"
dry_run="${2:-}"
case "$entorno" in
  preview | staging | production) ;;
  *)
    echo "Uso: $0 <preview|staging|production> [--dry-run]" >&2
    exit 2
    ;;
esac

for name in SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF SUPABASE_DB_PASSWORD; do
  if [[ -z "${!name:-}" ]]; then
    echo "Falta $name para el entorno $entorno (configúralo en GitHub › Environments)." >&2
    exit 1
  fi
done

if [[ "$entorno" == "production" ]]; then
  if [[ "${SUPABASE_PRODUCTION_REF:-}" != "$SUPABASE_PROJECT_REF" ]]; then
    echo "El proyecto no coincide con SUPABASE_PRODUCTION_REF: no se migra producción." >&2
    exit 1
  fi
elif [[ -n "${SUPABASE_PRODUCTION_REF:-}" && "$SUPABASE_PROJECT_REF" == "$SUPABASE_PRODUCTION_REF" ]]; then
  echo "El entorno $entorno apunta al proyecto de producción: se aborta." >&2
  exit 1
fi

ultima="$(find supabase/migrations -name '*.sql' -printf '%f\n' | sort | tail -1)"
punto="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"

supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD" >/dev/null
echo "> Estado de migraciones en $entorno (local frente a remoto)"
supabase migration list --linked --password "$SUPABASE_DB_PASSWORD"
echo "> Plan (sin aplicar)"
plan="$(supabase db push --linked --dry-run --password "$SUPABASE_DB_PASSWORD" 2>&1)"
echo "$plan"

if [[ "$dry_run" == "--dry-run" ]]; then
  echo "Simulación: no se ha aplicado nada."
  exit 0
fi
# Texto del CLI 2.120.0 cuando no hay nada pendiente. Si cambiara, el script
# pediría la confirmación de copia de todos modos (fallo seguro).
if grep -qi "up to date" <<<"$plan"; then
  echo "Sin migraciones pendientes en $entorno."
  echo "### Migraciones · $entorno: sin cambios" >>"$summary"
  exit 0
fi
if [[ "$entorno" == "production" && "${COPIA_CONFIRMADA:-}" != "true" ]]; then
  echo "Hay migraciones pendientes: producción exige confirmar la copia o el punto de restauración." >&2
  exit 1
fi

{
  echo "### Migraciones · $entorno"
  echo "- Punto de restauración previo (UTC): \`$punto\`"
  echo "- Última migración del código: \`$ultima\`"
} >>"$summary"

supabase db push --linked --password "$SUPABASE_DB_PASSWORD"
echo "- Resultado: aplicadas" >>"$summary"
echo "Migraciones aplicadas en $entorno. Punto de restauración previo: $punto"
