# shellcheck shell=bash
# Adaptador de ejemplo: imagen de contenedor genérica (docs/CI_CD.md).
#
# Variables del entorno de GitHub:
#   CONTAINER_IMAGE   (variable) registro/repositorio, p. ej. registro.example/portal
#   DEPLOY_URL        (variable) URL pública del entorno
#   DEPLOY_HOOK_URL   (secreto, opcional) webhook del hosting que despliega la nueva imagen
# El inicio de sesión en el registro lo hace un paso previo del workflow propio del
# proveedor (preferiblemente con OIDC). Este adaptador no gestiona credenciales.

desplegar() {
  local entorno="$1"
  : "${CONTAINER_IMAGE:?Define la variable CONTAINER_IMAGE del entorno}"
  : "${DEPLOY_URL:?Define la variable DEPLOY_URL del entorno}"
  local tag="$CONTAINER_IMAGE:$entorno-$APP_COMMIT"

  docker build \
    --build-arg NEXT_PUBLIC_SUPABASE_URL \
    --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    --build-arg NEXT_PUBLIC_SITE_URL \
    --build-arg APP_COMMIT \
    --label "org.opencontainers.image.revision=$APP_COMMIT" \
    --label "org.opencontainers.image.source=${GITHUB_SERVER_URL:-}/${GITHUB_REPOSITORY:-}" \
    --tag "$tag" . >&2
  docker push "$tag" >&2

  if [[ -n "${DEPLOY_HOOK_URL:-}" ]]; then
    # El cuerpo solo lleva la imagen y el entorno; el secreto va en la URL del hook.
    curl -fsS -X POST -H "Content-Type: application/json" \
      --data "{\"image\":\"$tag\",\"environment\":\"$entorno\"}" "$DEPLOY_HOOK_URL" >/dev/null
  fi
  echo "$DEPLOY_URL"
}
