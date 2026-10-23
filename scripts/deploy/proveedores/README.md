# Adaptadores de despliegue

`scripts/deploy/deploy.sh <entorno>` no conoce ningún proveedor: carga
`proveedores/$DEPLOY_PROVIDER.sh` y llama a su función `desplegar <entorno>`.

## Contrato

- Recibe el entorno (`preview`, `staging` o `production`) y dispone de `APP_ENV`, `APP_COMMIT`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `NEXT_PUBLIC_SITE_URL`.
- Construye la app para ese entorno (las `NEXT_PUBLIC_*` se fijan en el build, así que cada entorno
  tiene su build del mismo commit) y la publica.
- Define en el hosting `APP_ENV` y los secretos de ejecución del entorno (`SUPABASE_SECRET_KEY`,
  `CRON_SECRET`, `METRICS_TOKEN`, `EMAIL_*`, `OCR_PROVIDER`, `RETENTION_MODE`). Esos secretos se
  guardan en el gestor del hosting, no en GitHub.
- Escribe su progreso en stderr y la URL pública final en la **última línea** de stdout. `verificar.sh` comprobará que esa
  URL sirve `APP_COMMIT` con la migración esperada.
- No imprime secretos. Si el proveedor admite identidad federada (OIDC), el workflow ya concede
  `id-token: write` al trabajo de despliegue: úsala en lugar de tokens de larga duración.

## Adaptadores incluidos

| Nombre       | Qué hace                                                                                       | Estado                                        |
| ------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `contenedor` | Construye la imagen del `Dockerfile`, la sube a un registro y avisa a un webhook de despliegue | Ejemplo genérico; requiere registro y hosting |

Para un proveedor concreto (Vercel, Netlify, Cloud Run, Fly.io, Azure, un servidor propio…) se añade
`proveedores/<nombre>.sh` con la misma función y se documenta en un ADR. Ningún proveedor está
decidido todavía (docs/CI_CD.md, § Puntos de integración).
