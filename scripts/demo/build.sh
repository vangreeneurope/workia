#!/usr/bin/env bash
# Demostración estática de Workia para GitHub Pages (ADR-070). Construye la app
# en modo demo, arranca el entorno E2E (PostgreSQL desechable, semillas
# SINTÉTICAS, PostgREST y la pasarela de pruebas), recorre las pantallas y deja
# el sitio en ${DEMO_OUT:-demo-out}. Nunca usa ni toca Supabase real.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PORT="${DEMO_PORT:-3200}"
export DEMO_BUILD=1
export DEMO_BASE_PATH="${DEMO_BASE_PATH:-/workia}"
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_placeholder_solo_para_build
export NEXT_PUBLIC_SITE_URL="https://vangreeneurope.github.io${DEMO_BASE_PATH}"
export DEMO_APP_URL="http://localhost:${PORT}"

pids=()
# Cada servicio en su propio grupo de procesos: al salir se cierra el grupo
# entero (el entorno E2E arranca PostgreSQL, PostgREST y la pasarela).
cleanup() {
  for p in "${pids[@]}"; do kill -- "-$p" 2>/dev/null || kill "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT

wait_for() {
  for _ in $(seq 1 120); do curl -fs -o /dev/null "$1" 2>/dev/null && return 0; sleep 1; done
  echo "No responde: $1" >&2
  return 1
}

echo "> Build en modo demostración (${DEMO_BASE_PATH})"
npm run build

echo "> Entorno E2E con datos sintéticos"
setsid bash scripts/e2e/stack.sh >/tmp/demo-stack.log 2>&1 &
pids+=($!)
wait_for http://127.0.0.1:54321/health

echo "> App en el puerto ${PORT}"
setsid node node_modules/next/dist/bin/next start -p "$PORT" >/tmp/demo-app.log 2>&1 &
pids+=($!)
wait_for "${DEMO_APP_URL}${DEMO_BASE_PATH}/acceder"

echo "> Recorrido de pantallas"
node scripts/demo/crawl.mjs
