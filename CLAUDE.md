# CLAUDE.md

Guía para Claude Code (y para cualquier persona del equipo) al trabajar en este repositorio.
Plataforma web multiempresa de control horario, vacaciones y ausencias, y gastos comerciales con OCR.

@AGENTS.md

## Antes de empezar cualquier tarea

1. Lee `docs/ESTADO_PROYECTO.md` para saber en qué fase estamos y qué está pendiente.
2. Si la tarea toca datos o permisos, lee `docs/BASE_DATOS.md` y `docs/PERMISOS.md`.
3. Si toca jornada, ausencias, gastos o datos personales, lee `docs/NORMATIVA.md`; si toca
   horarios, turnos o festivos, `docs/HORARIOS.md` (nunca horas decimales ni horas locales sin zona).
4. Esta versión de Next.js (16.4) cambia APIs respecto a versiones anteriores: consulta la guía en
   `node_modules/next/dist/docs/` antes de usar una API que no hayas visto en este código.
5. Al terminar, actualiza `docs/ESTADO_PROYECTO.md` y, si tomaste una decisión de arquitectura,
   añade un ADR en `docs/DECISIONES.md`.

No empieces un módulo funcional nuevo sin que el anterior esté verificado (ver `docs/PLAN_DESARROLLO.md`).

## Comandos

| Comando             | Qué hace                                                                        |
| ------------------- | ------------------------------------------------------------------------------- |
| `npm run dev`       | Servidor de desarrollo en http://localhost:3000                                 |
| `npm run build`     | Build de producción (necesita las variables de `.env.example`)                  |
| `npm run start`     | Sirve el build                                                                  |
| `npm run typecheck` | Genera tipos de rutas y ejecuta `tsc --noEmit`                                  |
| `npm run lint`      | ESLint sin avisos permitidos                                                    |
| `npm run format`    | Prettier (escribe) · `npm run format:check` solo comprueba                      |
| `npm test`          | Pruebas unitarias (Vitest + Testing Library)                                    |
| `npm run test:e2e`  | Pruebas E2E (Playwright, móvil y escritorio). Requiere `npm run build`          |
| `npm run test:db`   | Migraciones, aislamiento RLS, semillas y reversibilidad (PostgreSQL desechable) |
| `npm run db:types`  | Regenera `src/types/database.ts` desde las migraciones (`:check` en CI)         |
| `npm run check`     | typecheck + lint + formato + unitarias (ejecutar antes de cada commit)          |
| `npm run security`  | Escaneo de secretos versionados y `npm audit` de producción                     |

## Arquitectura en una frase

Next.js App Router (Server Components y Server Actions) sobre Supabase (Postgres + Auth + Storage),
con la autorización aplicada en tres capas: proxy (redirección optimista), capa de acceso a datos
en servidor (`src/lib/auth/dal.ts`) y Row Level Security en la base de datos, que es la barrera
definitiva. Detalle en `docs/ARQUITECTURA.md`.

## Estructura

```
src/app/            Rutas. (auth) = público, (app) = privado con AppShell, auth/ = callbacks
src/components/ui/  Componentes shadcn/ui (no editar su API; personalizar con className)
src/components/     Componentes compartidos (layout, formularios, estados vacíos)
src/features/<x>/   Lógica por dominio: actions.ts (Server Actions), schemas.ts (zod), components/
src/features/admin/ Administración: action-helpers.ts (adminAction), schemas.ts compartidos
src/lib/            Infraestructura: supabase/, auth/ (dal, permisos, rutas), admin/ (contexto y
                    áreas), dates (Madrid), csv, forms, db-errors, env, navegación
src/types/          Tipos (database.ts refleja las migraciones)
src/proxy.ts        Proxy de Next.js 16 (antes "middleware"): refresco de sesión y redirección
supabase/migrations Migraciones SQL versionadas (fuente de verdad del esquema)
supabase/rollbacks  Reversión de cada migración (obligatoria desde 2026-10-22)
supabase/seeds      Datos SINTÉTICOS solo para desarrollo local (supabase db reset)
supabase/tests      Pruebas SQL (helpers/ = aserciones y escenario) · 00_shim solo para Postgres local
tests/unit          Vitest · tests/e2e Playwright
docs/               Documentación funcional y técnica
```

## Convenciones

- TypeScript estricto (`strict`, `noUncheckedIndexedAccess`). Prohibido `any`; usa `unknown` y valida.
- Interfaz, rutas (URLs), mensajes y documentación en **español**. Identificadores de código y de
  base de datos en **inglés** (`companies`, `company_memberships`). Comentarios en español.
- Mobile-first: diseña primero para 360 px; objetivos táctiles de 44 px mínimo; respeta
  `env(safe-area-inset-*)` en elementos fijos.
- Server Components por defecto. `"use client"` solo para interactividad.
- Formularios: Server Action + `useActionState` + esquema zod en `features/<x>/schemas.ts`.
  Devuelve `FormState`; nunca lances errores con detalles internos al cliente.
- Cache Components está activo: cualquier componente que lea cookies, sesión o `searchParams`
  debe estar dentro de `<Suspense>`. No uses `"use cache"` con datos de una empresa o persona sin
  revisarlo y documentarlo (riesgo de servir datos de un usuario a otro).
- Accesibilidad: cada página tiene un `<h1>`; etiquetas asociadas a sus campos; `aria-current` en
  navegación.
- Estilo: Prettier (100 columnas) con orden de clases Tailwind. Importaciones de tipos con `type`.
- Commits pequeños y descriptivos en español (`feat(fichajes): …`, `fix(auth): …`, `docs: …`).

## Reglas de seguridad (obligatorias)

1. **Toda tabla nueva** en `public` lleva `company_id` (o `group_id`), RLS activada,
   `revoke all … from anon, authenticated`, `grant` por columna sin `delete`, claves foráneas
   compuestas `(x_id, company_id)`, índices únicos que incluyan `company_id`, trigger
   `prevent_key_change` y pruebas positivas y negativas en `supabase/tests/` (incluidas "otra
   empresa" y "membresía caducada"). Sin pruebas de aislamiento no se fusiona.
2. Las políticas se expresan con permisos: `private.has_permission(company_id, '<permiso>', …)`,
   `employee_permission()`, `manages_employee()`. Funciones nuevas en `private`, `security definer`,
   `set search_path = ''`, `execute` solo a `authenticated` y `service_role`, y que devuelvan
   booleanos relativos al usuario actual. Ver `docs/PERMISOS.md`.
3. **Los permisos viven solo en tablas del servidor** (`platform_admins`, `group_admins`,
   `role_assignments`, `manager_assignments`). Nunca leas permisos de `user_metadata`,
   `app_metadata` ni claims del JWT. Nadie se concede nada a sí mismo.
4. Cada migración nueva lleva su `supabase/rollbacks/<migración>.down.sql`; `npm run test:db`
   verifica que restaura el esquema exacto. Después, `npm run db:types`.
5. **Cada Server Action y Route Handler** obtiene la identidad con `getUserContext()` /
   `requireUserId()` / `requireSection()` de `src/lib/auth/dal.ts` (en administración,
   `adminAction()` o `requireAdminArea()`). Excepciones: el terminal `/terminal` (ADR-036) y las rutas
   de máquina `/api/tareas` (CRON_SECRET) y `/api/correo/webhook` (firma), ADR-048. El `company_id` de una escritura sale siempre de
   `ctx.companyId`, nunca del formulario. Nunca confíes en ids que lleguen del cliente.
6. Usa `getClaims()` (valida el JWT), nunca `getSession()` en servidor para autorizar.
7. **Sin secretos en el frontend ni en el repositorio.** Solo `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `NEXT_PUBLIC_SITE_URL` son públicas. La clave secreta
   (`service_role`) solo en servidor, solo si un ADR lo justifica, y nunca en un Client Component.
8. **Registros horarios inmutables**: las tablas de fichajes no tendrán `update`/`delete`; las
   correcciones son filas nuevas enlazadas y auditadas (ver `docs/BASE_DATOS.md`).
9. **Auditoría**: todo cambio relevante pasa por `private.audit_row_change()`. `audit_log` no se
   modifica ni se borra.
10. **Archivos privados** (logotipos, justificantes, tickets) en buckets privados, ruta
    `<company_id>/…`, y acceso con URL firmada de corta duración. Nunca buckets públicos.
11. Redirecciones con destino de usuario siempre a través de `safeRedirectPath()`.
12. **Datos personales fuera de URLs, avisos y registros**: búsquedas por cookie o POST, mensajes
    sin nombres ni correos, exportaciones auditadas sin el texto buscado.
13. Prohibido: reconocimiento facial o biometría, rastreo GPS continuo, datos simulados en
    pantallas productivas o entornos reales (las semillas sintéticas son solo locales), y
    registrar en logs datos personales o tokens.
14. **Registro técnico solo con `src/lib/log.ts`** (redacción y `request_id`); nunca `console.*`.
15. **MFA por rol** (ADR-053): los permisos de administración, RR. HH., contabilidad y auditoría
    solo cuentan con sesión aal2. Una función de permisos nueva debe usar `private.role_auth_ok()`.
    Los escáneres `97_seguridad_catalogo` y `tests/unit/security-static.test.ts` deben seguir en
    verde: no los relajes para que pase un cambio.

## Documentación técnica

- `docs/PRD.md`: requisitos de producto y preguntas abiertas.
- `docs/ARQUITECTURA.md`: capas, flujo de autenticación, PWA, despliegue.
- `docs/BASE_DATOS.md`: esquema actual y previsto, convenciones SQL.
- `docs/PERMISOS.md`: matriz de roles y cómo se aplica en cada capa.
- `docs/VIGENCIA_Y_BAJAS.md`: fechas de efecto, bajas, aprobadores y suplencias.
- `docs/HORARIOS.md`: calendarios, plantillas de turno, precedencia, zonas horarias y cambios de hora.
- `docs/CONTROL_HORARIO.md`: fichajes, terminal con PIN, correcciones, incidencias y operación.
- `docs/AUSENCIAS.md`: tipos, políticas versionadas, libro de saldos, aprobación y privacidad.
- `docs/GASTOS.md`: captura de tickets, OCR intercambiable, cola y reintentos, duplicados y reglas.
- `docs/LIQUIDACION_GASTOS.md`: informes mensuales, aprobación por pasos, cierre en lotes y
  esquema de exportación (PDF, CSV, XLSX, ZIP).
- `docs/AVISOS.md`: bandeja, correo, outbox, reintentos, tareas programadas y guía de proveedor.
- `docs/INFORMES.md`: diccionario de informes y cálculos, filtros, exportaciones, auditoría,
  índices y límites medidos.
- `docs/NORMATIVA.md`: registro de jornada, RGPD/LOPDGDD, conservación.
- `docs/SEGURIDAD.md`: modelo de amenazas, auditoría de seguridad, cabeceras, MFA, registros.
- `docs/PRIVACIDAD.md`: matriz de datos, retención, derechos, soporte y EIPD.
- `docs/RUNBOOKS.md`: incidentes, brechas, restauración, soporte, MFA y secretos.
- `docs/PENDIENTES_LEGALES.md`: decisiones abiertas para legal y privacidad.
- `docs/PLAN_DESARROLLO.md`: fases y criterios de salida.
- `docs/DECISIONES.md`: registro de decisiones de arquitectura (ADR).
- `docs/ESTADO_PROYECTO.md`: estado actual, resultados de verificación y bloqueantes.
