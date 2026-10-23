# CI/CD, entornos, migraciones y secretos

Cómo llega un cambio desde una rama hasta producción de forma revisable, reproducible, desplegable
y recuperable. El proveedor de hosting **no está decidido**: el pipeline es portable y los puntos de
integración están señalados (§ 7). Supabase gestiona base de datos, Auth y Storage en cada entorno.

## 1. Recorrido de un cambio

```
rama ──PR──► CI (sin secretos) ──revisión + CI correcto──► main
                │                                           │
                └─► preview (solo ramas propias,            ├─► CI en main ──► staging
                    sin cambios de esquema)                 │                (migraciones + despliegue)
                                                            └─► a mano, con aprobación ──► production
                                                                 (mismo commit, copia confirmada)
```

## 2. Integración continua (`.github/workflows/ci.yml`)

| Trabajo       | Qué comprueba                                                                                                                                                                                           | Duración aprox. |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `calidad`     | `npm ci` reproducible (lockfile), tipos, lint sin avisos, formato y pruebas unitarias                                                                                                                   | 3 min           |
| `seguridad`   | Secretos versionados y `npm audit` de producción                                                                                                                                                        | 1 min           |
| `migraciones` | Validación de migraciones (§ 4), aplicación en PostgreSQL desechable, RLS y aislamiento, integración con sesiones simultáneas, escáner de catálogo, reversibilidad exacta y tipos                       | 10 min          |
| `build-e2e`   | Build de producción y E2E con sesión real contra PostgREST: **mínimo** en PR (acceso, seguridad, salud y flujos críticos); **completo** en main, cada noche y a mano (auditoría de vistas, rendimiento) | 8-15 min        |
| `ci-correcto` | Agregador: falla si cualquier trabajo falla o se cancela. **Es el check requerido** en la protección de main                                                                                            | segundos        |

Las duraciones son estimaciones a partir de las ejecuciones locales; se confirmarán con las primeras
ejecuciones en GitHub.

Decisiones de seguridad del workflow:

- **Sin secretos**: el CI no usa ninguno, así que se comporta igual en PR de forks. No se usa
  `pull_request_target`.
- **Permisos mínimos**: `contents: read` para todo el workflow; `persist-credentials: false` en cada
  checkout.
- **Acciones fijadas por commit** (la versión va en el comentario). Dependabot propone las
  actualizaciones de acciones y de npm cada semana (`.github/dependabot.yml`).
- **Cachés seguras**: npm (por `package-lock.json`), `.next/cache` (por lockfile y código) y el binario
  de PostgREST (versión y huella SHA-256 fijas). Ninguna contiene secretos; GitHub aísla las cachés
  escritas desde una PR, que no pueden contaminar las de main.
- **Concurrencia**: un grupo por PR o rama. En PR se cancela la ejecución obsoleta al llegar un
  commit nuevo; en main no se cancela (cada commit de main queda verificado).
- **Artefactos**: solo los resultados de Playwright si falla, 7 días. Contienen datos sintéticos
  y ningún secreto (el entorno E2E genera un secreto aleatorio en cada ejecución).
- `merge_group` está activado por si se usa cola de fusión.

Ejecutar en local lo mismo que el CI: `npm run check`, `npm run security`, `npm run db:check-migrations`,
`npm run test:db`, `npm run db:types:check`, `npm run build` y `npm run test:e2e:minimo` (o
`npm run test:e2e`).

## 3. Protección de la rama main (configuración documentada, no aplicada)

Debe configurarla una persona con permisos de administración del repositorio en GitHub ›
Settings › Rules › Rulesets (o Branches › Branch protection rules). **No se ha cambiado ningún
ajuste remoto** desde este trabajo.

| Ajuste                                         | Valor                                                  |
| ---------------------------------------------- | ------------------------------------------------------ |
| Rama objetivo                                  | `main`                                                 |
| Exigir pull request antes de fusionar          | Sí                                                     |
| Aprobaciones necesarias                        | 1 (de alguien distinto de quien abre la PR)            |
| Descartar aprobaciones al subir commits nuevos | Sí                                                     |
| Exigir aprobación del último push              | Sí                                                     |
| Exigir resolver todas las conversaciones       | Sí                                                     |
| Checks requeridos                              | `CI correcto` (trabajo `ci-correcto`)                  |
| Exigir rama actualizada antes de fusionar      | Sí (o cola de fusión)                                  |
| Bloquear pushes forzados y borrado             | Sí                                                     |
| Historial lineal                               | Recomendado (squash o rebase)                          |
| Sin excepciones para administradores           | Recomendado; si se permite, queda registrado en GitHub |

Además, en Settings › Actions › General: «Fork pull request workflows» sin acceso a secretos (valor
por defecto) y permisos del `GITHUB_TOKEN` por defecto en solo lectura.

**Entornos de GitHub** (Settings › Environments):

| Entorno      | Reglas de protección                                                          | Ramas que pueden desplegar |
| ------------ | ----------------------------------------------------------------------------- | -------------------------- |
| `preview`    | Ninguna (datos sintéticos)                                                    | Todas                      |
| `staging`    | Ninguna o 1 revisor (opcional)                                                | `main`                     |
| `production` | **Revisores obligatorios** (al menos 1, sin autoaprobación) y espera opcional | `main`                     |

## 4. Migraciones

Fuente de verdad: `supabase/migrations/`. Cada migración desde 2026-10-22 lleva su reversión en
`supabase/rollbacks/` (regla 4 de CLAUDE.md).

**Validar en CI** (`npm run db:check-migrations`, `npm run test:db`):

1. Nombres `AAAAMMDDHHMMSS_nombre.sql`, marcas únicas, reversión presente con la pérdida de datos
   declarada en su cabecera, sin reversiones huérfanas.
2. En PR, las migraciones que ya están en `main` son **inmutables** (no se editan ni se borran: se
   crea otra nueva) y las nuevas deben ser posteriores a la última de `main`.
3. Todas se aplican en una base nueva, pasan las pruebas de aislamiento y del catálogo, cada
   reversión restaura el esquema exacto y reaplicar lo reproduce; las reversiones que perderían
   datos exigen autorización explícita (`app.allow_lossy_rollback`).

**Aplicar una sola vez por entorno** (`scripts/db/migrar.sh`, desde el workflow de despliegue):

- `supabase db push` registra cada migración aplicada en `supabase_migrations.schema_migrations`;
  repetirlo no la vuelve a aplicar. Nunca se cargan semillas (sin `--include-seed`).
- Un grupo de concurrencia por entorno impide dos migraciones simultáneas.
- Primero se muestra el estado (`migration list`) y el plan (`db push --dry-run`) en el registro.
- Salvaguardas: staging o preview nunca apuntan al proyecto de producción
  (`SUPABASE_PRODUCTION_REF`); producción solo con su proyecto.
- **Producción**: solo desde un commit de `main` con `CI correcto` (por tanto revisado y aprobado),
  lanzado a mano y aprobado en el entorno `production`. Si hay migraciones pendientes, exige
  marcar «copia confirmada» (copia o punto de restauración verificado, § 6 de
  docs/COPIAS_Y_RESTAURACION.md). El resumen del workflow registra el punto de restauración (hora
  UTC previa) y la última migración aplicada.
- Las PR nunca migran: el preview no se despliega si la PR cambia el esquema.

**Compatibilidad durante el despliegue** (expandir y contraer): la migración se aplica antes de
desplegar el código nuevo, así que debe ser compatible con el código anterior mientras dura el
cambio. Cambios destructivos (borrar o renombrar columnas, endurecer restricciones) en dos pasos:
primero se añade y el código deja de usar lo antiguo; en un despliegue posterior se elimina.

**Si una migración falla o causa un problema**:

| Situación                                   | Acción                                                                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Falla al aplicarse                          | Cada migración es transaccional: no queda a medias. No se despliega el código. Corregir con una migración nueva (corrección hacia delante)                                                 |
| Aplicada, defecto sin pérdida de datos      | **Corrección hacia delante** (preferida): nueva migración por el flujo normal                                                                                                              |
| Aplicada, hay que volver atrás urgentemente | Reversión con su `.down.sql` en el entorno (runbook «Despliegue y migraciones»), registrando la fila en `schema_migrations` como revertida (`supabase migration repair --status reverted`) |
| Reversión que perdería datos                | Solo con decisión explícita y copia previa; si no, restaurar desde copia (docs/COPIAS_Y_RESTAURACION.md)                                                                                   |

## 5. Entornos

| Entorno      | Para qué                                   | Supabase                                               | Datos                                      | Se despliega                      |
| ------------ | ------------------------------------------ | ------------------------------------------------------ | ------------------------------------------ | --------------------------------- |
| `local`      | Desarrollo y pruebas                       | `supabase start` o el entorno E2E                      | Semillas sintéticas                        | —                                 |
| `preview`    | Revisar una PR en una URL                  | Proyecto propio de preview (no staging)                | Sintéticos                                 | Tras CI correcto de una PR propia |
| `staging`    | Ensayo de cada versión y piloto controlado | Proyecto propio                                        | Sintéticos (empresas y usuarios de piloto) | Tras CI correcto en `main`        |
| `production` | Uso real                                   | Proyecto propio, región UE, PITR si el plan lo permite | Reales (nunca semillas)                    | A mano, con aprobación            |

Cada entorno tiene su propio proyecto de Supabase, sus propias claves y su propio `APP_ENV`. Un mismo
commit se construye por entorno porque las `NEXT_PUBLIC_*` quedan fijadas en el build.

## 6. Secretos y variables por entorno

Nada de esto va en el YAML, en artefactos ni en registros. Los valores de ejecución viven en el
gestor de secretos del **hosting**; GitHub solo guarda lo que el workflow necesita.

**GitHub › Environments › (preview, staging, production)**:

| Nombre                                 | Tipo     | Uso                                             |
| -------------------------------------- | -------- | ----------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN`                | Secreto  | CLI para migrar (staging y production)          |
| `SUPABASE_DB_PASSWORD`                 | Secreto  | Contraseña de la base del entorno (migraciones) |
| `SUPABASE_PROJECT_REF`                 | Variable | Proyecto del entorno                            |
| `NEXT_PUBLIC_SUPABASE_URL`             | Variable | Pública por diseño                              |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Variable | Pública por diseño (la seguridad la da RLS)     |
| `NEXT_PUBLIC_SITE_URL`                 | Variable | URL pública del entorno                         |
| `DEPLOY_URL`, `CONTAINER_IMAGE`        | Variable | Según el adaptador de despliegue                |
| `DEPLOY_HOOK_URL`                      | Secreto  | Opcional, según el adaptador                    |

**GitHub › Repository variables**: `DEPLOY_PROVIDER` (vacío = no se despliega) y
`SUPABASE_PRODUCTION_REF`.

**Hosting (por entorno)**: `APP_ENV`, `SUPABASE_SECRET_KEY`, `CRON_SECRET`, `METRICS_TOKEN`,
`EMAIL_PROVIDER`, `EMAIL_FROM`, `EMAIL_WEBHOOK_SECRET`, `OCR_PROVIDER`, `RETENTION_MODE`,
`LOG_LEVEL` (ver `.env.example`). Producción nunca usa `fake` en OCR ni correo.

**Identidades de corta duración**: el trabajo de despliegue tiene `id-token: write` para usar OIDC
con proveedores que lo admiten (nubes con federación de identidades de GitHub). El token del CLI de
Supabase es de larga duración porque no consta que Supabase admita OIDC para su CLI: se limita al
entorno, se rota (RUNBOOKS, § 7) y solo lo leen los trabajos de migración tras la aprobación del
entorno.

## 7. Despliegue (`.github/workflows/despliegue.yml`)

- Se ejecuta siempre desde `main` (`workflow_run` tras el CI, o `workflow_dispatch`): una PR no
  puede modificarlo para obtener secretos. Los previews solo se hacen para PR de ramas de este
  repositorio, nunca de forks.
- `plan` decide entorno y commit; en producción comprueba que el commit está en `main` y tiene
  `CI correcto` en verde.
- `migraciones` (staging y producción) ejecuta `scripts/db/migrar.sh`.
- `desplegar` construye y publica con `scripts/deploy/deploy.sh <entorno>`, que delega en el
  adaptador `scripts/deploy/proveedores/$DEPLOY_PROVIDER.sh` (contrato en su README), y verifica con
  `scripts/deploy/verificar.sh` que la URL sirve **el commit y la migración esperados** y que
  `/api/salud/listo` responde 200. El resumen del workflow deja entorno, commit, migración y URL.
- Sin `DEPLOY_PROVIDER` el despliegue termina con un aviso y no publica nada.

**Puntos de integración** cuando se elija hosting (ADR nuevo):

1. Adaptador `scripts/deploy/proveedores/<nombre>.sh` con la función `desplegar`.
2. Paso de autenticación del proveedor en el trabajo `desplegar` (preferiblemente OIDC).
3. Secretos de ejecución en el gestor del hosting (§ 6) y `APP_ENV` por entorno.
4. Planificador que llame a `/api/tareas` cada 5-15 minutos con `CRON_SECRET`.
5. Sonda externa de `/api/salud` y `/api/salud/listo` y envío de registros a la herramienta de
   observabilidad (docs/OBSERVABILIDAD.md).
6. Dominio, TLS y cabeceras (las pone la app; verificar que el hosting no las elimina).

Existe un adaptador de ejemplo, `contenedor`, con el `Dockerfile` del repositorio (servidor autónomo
de Next.js, usuario sin privilegios y `HEALTHCHECK` sobre `/api/salud`).

**Identificación de cada despliegue**: `/api/salud` devuelve `version`, `commit`, `migration`
(última migración que espera el código) y `environment`; el arranque registra `app.start` con lo
mismo. `CHANGELOG.md` resume los cambios de cada versión.

## 8. Volver atrás

| Qué       | Cómo                                                                                     |
| --------- | ---------------------------------------------------------------------------------------- |
| Código    | Desplegar de nuevo el commit anterior con `workflow_dispatch` (su build es reproducible) |
| Migración | § 4 (corrección hacia delante, reversión o restauración)                                 |
| Datos     | docs/COPIAS_Y_RESTAURACION.md                                                            |
