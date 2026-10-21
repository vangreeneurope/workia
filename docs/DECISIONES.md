# Registro de decisiones de arquitectura (ADR)

Formato: contexto, decisión, consecuencias. Una decisión solo se cambia con un ADR nuevo que la
sustituya (se indica "Sustituida por ADR-XXX").

---

## ADR-001 · Next.js 16 con Cache Components y Partial Prefetching activados

**Fecha**: 2026-10-21 · **Estado**: aceptada

**Contexto**: el proyecto generado con Next.js 16.4 activa `cacheComponents` y
`partialPrefetching`. La documentación indica que ambos serán obligatorios en la próxima versión
mayor. Con Cache Components, leer cookies fuera de `<Suspense>` es un error de build.

**Decisión**: mantenerlos activos desde el inicio. Todo lo que lee la sesión vive dentro de
`<Suspense>` (el armazón privado y los componentes que leen `searchParams`). No se usa `"use cache"`
con datos personales o de empresa.

**Consecuencias**: evita una migración futura; el build actúa como salvaguarda frente a lecturas de
sesión mal ubicadas. Obliga al equipo a entender el modelo de streaming (documentado en CLAUDE.md).

## ADR-002 · Autenticación con Supabase Auth en cookies y defensa en tres capas

**Fecha**: 2026-10-21 · **Estado**: aceptada

**Decisión**: `@supabase/ssr` con cookies; `getClaims()` (validación del JWT) en servidor; proxy
para refresco y redirección optimista; DAL (`src/lib/auth/dal.ts`) como única fuente de identidad;
RLS como barrera definitiva. Sin registro público.

**Consecuencias**: un fallo en una capa superior no expone datos. Toda página y acción debe pasar
por la DAL (regla en CLAUDE.md).

## ADR-003 · Modelo multiempresa con membresías y roles en array

**Fecha**: 2026-10-21 · **Estado**: aceptada

**Contexto**: una persona puede estar en varias empresas y tener varios roles en cada una.

**Decisión**: `company_memberships` única por (empresa, persona) con `roles company_role[]`. El
administrador global es una tabla aparte (`platform_admins`), no un rol de empresa.

**Alternativa descartada**: tabla `membership_roles` (una fila por rol). Más normalizada, pero más
uniones en cada política RLS sin beneficio práctico con 4 roles fijos.

**Consecuencias**: políticas simples (`roles && array[...]`). Añadir un rol requiere migración del
enum.

## ADR-004 · Supervisión entre empresas con clave foránea compuesta

**Fecha**: 2026-10-21 · **Estado**: aceptada

**Decisión**: `manager_assignments(manager_user_id, employee_membership_id, company_id)` con FK
compuesta `(employee_membership_id, company_id)` hacia `company_memberships(id, company_id)`.

**Consecuencias**: el responsable puede ser de otra empresa; la empresa de la asignación no puede
falsearse (la FK lo impide) y RLS puede filtrar por `company_id` sin uniones.

## ADR-005 · Funciones de autorización en el esquema `private`

**Fecha**: 2026-10-21 · **Estado**: aceptada

**Decisión**: funciones `security definer`, `stable`, `set search_path = ''`, en un esquema no
expuesto por la API REST.

**Consecuencias**: no son invocables por RPC desde el cliente; evitan recursión de RLS; un único
punto para la lógica de roles.

## ADR-006 · Auditoría mediante triggers en una tabla append-only

**Fecha**: 2026-10-21 · **Estado**: aceptada

**Decisión**: `private.audit_row_change()` en las tablas relevantes; `audit_log` sin permisos de
escritura para la API y con triggers que bloquean `UPDATE`, `DELETE` y `TRUNCATE`.

**Consecuencias**: la auditoría no depende de que el código de la aplicación la recuerde. Un
superusuario podría desactivar los triggers: se mitiga restringiendo el acceso al panel de Supabase
y, en el futuro, con exportación periódica a un almacenamiento externo de solo escritura.

## ADR-007 · Idiomas: código en inglés, producto en español

**Fecha**: 2026-10-21 · **Estado**: aceptada

**Decisión**: identificadores de código y base de datos en inglés; interfaz, URLs, mensajes,
comentarios y documentación en español.

**Consecuencias**: coherencia con librerías y tipos generados; URLs comprensibles para la plantilla.

## ADR-008 · PWA sin caché de datos personales

**Fecha**: 2026-10-21 · **Estado**: aceptada

**Decisión**: service worker propio y mínimo (página sin conexión e iconos). No se cachean
respuestas autenticadas. No se usa Serwist ni librerías de precaché por ahora.

**Consecuencias**: sin modo sin conexión para fichar (decisión prudente: el fichaje debe registrar
hora de servidor). Se puede revisar si negocio necesita fichar sin cobertura (requeriría ADR sobre
cola local, firma temporal y riesgos).

## ADR-009 · CSP provisional con `'unsafe-inline'` en scripts

**Fecha**: 2026-10-21 · **Estado**: aceptada (temporal)

**Contexto**: una CSP estricta con nonce exige generar el nonce en el proxy y renderizar
dinámicamente todas las páginas.

**Decisión**: CSP estática en `next.config.ts` con orígenes restringidos, `frame-ancestors 'none'`,
`object-src 'none'`, pero `'unsafe-inline'` en `script-src`.

**Consecuencias**: protección parcial frente a XSS. Revisar en la fase 5 (CSP con nonce).

## ADR-010 · Componentes shadcn/ui escritos manualmente

**Fecha**: 2026-10-21 · **Estado**: aceptada

**Contexto**: la política de red del entorno de desarrollo bloquea `ui.shadcn.com`, por lo que la
CLI de shadcn no pudo descargar componentes.

**Decisión**: escribir los componentes necesarios siguiendo la implementación de shadcn/ui (estilo
new-york, paquete `radix-ui`), con `components.json` preparado.

**Consecuencias**: cuando haya acceso, `npx shadcn@latest add <componente> --overwrite` permite
regenerarlos y comparar diferencias.

## ADR-011 · Sin clave `service_role` en la fase base

**Fecha**: 2026-10-21 · **Estado**: aceptada

**Decisión**: la aplicación solo usa la clave publicable con la sesión del usuario. La invitación de
personas (fase 1) necesitará privilegios de administración de Auth: se decidirá entre una Server
Action con la clave secreta en servidor o una Edge Function, con su propio ADR.

## ADR-012 · Pruebas de RLS en PostgreSQL local con emulación mínima de Supabase

**Fecha**: 2026-10-21 · **Estado**: aceptada

**Contexto**: el entorno no tiene Docker operativo para `supabase start` ni pgTAP instalado.

**Decisión**: `scripts/test-db.sh` crea un clúster PostgreSQL desechable, carga
`supabase/tests/00_shim_supabase.sql` y ejecuta pruebas SQL con aserciones propias.

**Consecuencias**: pruebas rápidas y reproducibles sin Docker. No sustituyen la validación en un
proyecto Supabase real (pendiente). Se puede migrar a pgTAP y `supabase test db` cuando haya Docker.

## ADR-013 · Sin biometría ni geolocalización continua

**Fecha**: 2026-10-21 · **Estado**: aceptada

**Decisión**: excluidas por requisito y por proporcionalidad (ver NORMATIVA). `Permissions-Policy`
desactiva la geolocalización. La ubicación puntual al fichar queda como pregunta abierta.

## ADR-014 · Registros horarios inmutables (diseño para la fase 1)

**Fecha**: 2026-10-21 · **Estado**: aceptada

**Decisión**: los fichajes originales no se actualizan ni se borran (sin permisos y con trigger
`prevent_mutation()`, ya disponible). Las correcciones son filas nuevas enlazadas, con motivo,
aprobación y auditoría. La hora la fija el servidor.

## ADR-015 · Tipos de base de datos escritos a mano hasta tener proyecto

**Fecha**: 2026-10-21 · **Estado**: aceptada (temporal)

**Decisión**: `src/types/database.ts` replica el formato de `supabase gen types`. Se regenerará al
crear el proyecto y se añadirá una comprobación en CI que detecte divergencias.

## ADR-016 · Política de contraseñas

**Fecha**: 2026-10-21 · **Estado**: aceptada

**Decisión**: mínimo 12 caracteres con minúsculas, mayúsculas y dígitos, validado en el formulario
(zod) y en Supabase Auth (`supabase/config.toml` y panel). Mensajes de error genéricos en el acceso
para no revelar si un correo existe.
