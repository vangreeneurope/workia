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

**Fecha**: 2026-10-21 · **Estado**: sustituida por ADR-017

**Contexto**: una persona puede estar en varias empresas y tener varios roles en cada una.

**Decisión**: `company_memberships` única por (empresa, persona) con `roles company_role[]`. El
administrador global es una tabla aparte (`platform_admins`), no un rol de empresa.

**Alternativa descartada**: tabla `membership_roles` (una fila por rol). Más normalizada, pero más
uniones en cada política RLS sin beneficio práctico con 4 roles fijos.

**Consecuencias**: políticas simples (`roles && array[...]`). Añadir un rol requiere migración del
enum.

## ADR-004 · Supervisión entre empresas con clave foránea compuesta

**Fecha**: 2026-10-21 · **Estado**: sustituida por ADR-017

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

**Fecha**: 2026-10-21 · **Estado**: sustituida por ADR-020

**Decisión**: `src/types/database.ts` replica el formato de `supabase gen types`. Se regenerará al
crear el proyecto y se añadirá una comprobación en CI que detecte divergencias.

## ADR-016 · Política de contraseñas

**Fecha**: 2026-10-21 · **Estado**: aceptada

**Decisión**: mínimo 12 caracteres con minúsculas, mayúsculas y dígitos, validado en el formulario
(zod) y en Supabase Auth (`supabase/config.toml` y panel). Mensajes de error genéricos en el acceso
para no revelar si un correo existe.

## ADR-017 · Autorización multiempresa por empresa y ámbito

**Fecha**: 2026-10-22 · **Estado**: aceptada · Sustituye a ADR-003 y ADR-004

**Contexto**: una persona puede pertenecer a varias empresas con roles distintos; los roles
previstos son administrador de grupo, administrador de empresa, RR. HH., manager, contabilidad,
empleado y auditor; algunos roles deben poder limitarse a un centro o equipo y todos necesitan
vigencia. El array de roles en la membresía (ADR-003) no admite ámbito, vigencia ni auditoría por
concesión.

**Decisión**:

- `role_assignments` (rol, ámbito `company`/`work_center`/`team`, estado, vigencia, `granted_by`)
  sustituye al array. La administración de grupo vive en `group_admins` (con vigencia) y la de
  plataforma en `platform_admins`.
- Una única función de decisión, `private.has_permission(empresa, permiso, centro?, equipo?)`,
  apoyada en `current_membership_id()` (membresía vigente en empresa y grupo activos) y en la matriz
  inmutable `role_has_permission()`. Las políticas expresan permisos (`employees.read`), no roles.
- La supervisión se modela sobre `employees` con `manager_assignments` vigentes; un manager puede
  supervisar a personas de otra empresa del mismo grupo, nunca de otro grupo.
- Techo de concesión (`can_grant_role`) y prohibición de autoconcesiones en las políticas.
- Los permisos nunca se leen de `user_metadata`/`app_metadata` ni de claims del JWT, solo de tablas
  controladas por el servidor; las políticas solo usan `auth.uid()`.
- Funciones `security definer` en `private`, `search_path = ''`, `execute` solo para
  `authenticated` y `service_role` en las que usan las políticas.

**Alternativas descartadas**: roles en `app_metadata` con un _custom access token hook_ (rápido de
evaluar, pero obliga a refrescar el token para revocar y duplica la fuente de verdad); una política
por rol y tabla (multiplica políticas y errores).

**Consecuencias**: añadir un permiso requiere migración del enum `private.app_permission`. Las
políticas llaman a funciones por fila; con volúmenes grandes habrá que revisar índices y, si hace
falta, cachear la membresía vigente por sentencia.

## ADR-018 · Aislamiento también frente a inferencia

**Fecha**: 2026-10-22 · **Estado**: aceptada

**Contexto**: las pruebas detectaron que un índice único sin `company_id` respondía "clave
duplicada" antes de evaluar la clave foránea, lo que permitía a un administrador de A deducir
roles de una persona de B.

**Decisión**: índices únicos siempre con `company_id` o `group_id`; claves foráneas compuestas
`(id, company_id)`; el cliente no elige `id` ni campos del servidor (`grant insert` por columna);
claves de empresa inmutables por trigger; `slug` de empresa único por grupo. Las pruebas comprueban
que los intentos sobre otra empresa fallan por RLS o por clave foránea, nunca por duplicado.

## ADR-019 · Reversiones obligatorias y verificadas

**Fecha**: 2026-10-22 · **Estado**: aceptada

**Decisión**: toda migración nueva incluye `supabase/rollbacks/<migración>.down.sql`. `npm run
test:db` compara una descripción normalizada del catálogo antes de la migración y después de
revertirla (deben ser idénticas) y comprueba que reaplicar reproduce el esquema. Migraciones y
reversiones destructivas abortan si perderían datos, salvo autorización explícita
(`app.allow_lossy_rollback`).

**Consecuencias**: más trabajo por migración a cambio de poder deshacer con garantías. Las tres
migraciones de la fase 0 no tienen reversión (anteriores a la norma).

## ADR-020 · Tipos TypeScript generados desde las migraciones

**Fecha**: 2026-10-22 · **Estado**: aceptada · Sustituye a ADR-015

**Contexto**: `supabase gen types` requiere Docker o un proyecto enlazado, no disponibles por ahora.

**Decisión**: `scripts/gen-db-types.mjs` lee el catálogo de un PostgreSQL desechable con las
migraciones aplicadas y produce el formato de `supabase gen types`. `npm run db:types:check` en CI
impide que tipos y esquema diverjan. Cuando haya proyecto o Docker, se puede usar la CLI oficial; si
el resultado difiere en forma, se ajustará el generador o se adoptará la CLI.

## ADR-021 · Semillas sintéticas solo en local

**Fecha**: 2026-10-22 · **Estado**: aceptada

**Decisión**: `supabase/seeds/` contiene solo datos ficticios (dominio `.example`, sin NIF, sin
contraseñas, sin permisos en metadatos) y se cargan únicamente con `supabase db reset` en local.
La regla de "sin datos simulados en pantallas productivas" sigue vigente: las semillas nunca se
aplican a un entorno real. Una prueba automática comprueba estas condiciones.

## ADR-022 · Administración de plataforma y de grupo separadas

**Fecha**: 2026-10-22 · **Estado**: aceptada

**Decisión**: `platform_admins` queda para soporte técnico (crea grupos y nombra administradores de
grupo, solo por SQL o por un administrador de plataforma). El administrador de grupo
(`group_admins`) administra las empresas de su grupo, puede crearlas y desactivarlas, pero no
nombra administradores de grupo ni actúa fuera de su grupo. Nadie se nombra a sí mismo.

## ADR-023 · Aprobadores por persona o equipo, sin ambigüedad por construcción

**Fecha**: 2026-10-23 · **Estado**: aceptada

**Contexto**: las aprobaciones deben resolverse a una única persona; el mismo aprobador puede
trabajar en varias empresas y hay suplencias temporales.

**Decisión**: `manager_assignments` admite ámbito persona o equipo y tipo de solicitud. Precedencia
fija (persona+tipo › persona+todas › equipo+tipo › equipo+todas) y restricciones de exclusión que
impiden dos asignaciones vigentes del mismo nivel. `resolve_approver` aplica después la suplencia
vigente y devuelve errores con código (`APROBADOR_*`) y pista. Detalle en
[VIGENCIA_Y_BAJAS.md](VIGENCIA_Y_BAJAS.md).

**Alternativa descartada**: detectar conflictos solo al resolver (los usuarios se encontrarían el
problema al pedir vacaciones, no al configurar).

## ADR-024 · La administración de plataforma no administra empresas

**Fecha**: 2026-10-23 · **Estado**: aceptada · Matiza ADR-022

**Decisión**: `has_permission` y `can_grant_role` dejan de conceder a `platform_admins`; las
empresas las crea la administración de grupo; la plataforma no ve auditoría con datos de empresa.
La plataforma conserva grupos, administradores de grupo y el listado de empresas.

**Consecuencias**: un administrador de plataforma que necesite operar en una empresa debe tener un
rol explícito (y auditado) en ella o ser administrador de su grupo.

## ADR-025 · Clave secreta solo para invitaciones

**Fecha**: 2026-10-23 · **Estado**: aceptada · Concreta ADR-011

**Decisión**: `SUPABASE_SECRET_KEY` (solo servidor, `src/lib/supabase/admin.ts`, `server-only`) se usa
exclusivamente para `auth.admin.inviteUserByEmail` y para localizar una cuenta por correo, después
de autorizar al usuario con su sesión (`members.manage`). La membresía se crea con el cliente del
usuario, de modo que RLS decide. Sin la variable, la invitación muestra un aviso y el resto funciona.

## ADR-026 · Auditoría minimizada en `audit_events`

**Fecha**: 2026-10-23 · **Estado**: aceptada

**Decisión**: nueva tabla inmutable con solo los campos cambiados y los datos personales sustituidos
por `[dato personal]`, escrita por triggers en las tablas sensibles y por `log_admin_event`
(exportaciones e importaciones, sin el texto buscado). `audit_log` se mantiene como traza técnica
completa e inmutable (no se puede reducir sin reescribir historia) y queda limitada a quien tiene
`audit.read` o administra el grupo.

**Consecuencias**: dos registros de auditoría. La interfaz mostrará `audit_events`; `audit_log` se
revisará con la asesoría para fijar su plazo de conservación.

## ADR-027 · Importación CSV de todo o nada

**Fecha**: 2026-10-23 · **Estado**: aceptada

**Decisión**: validar todo el archivo antes de escribir (en el servidor, con las mismas reglas que la
interfaz) y, solo si no hay errores, importar en una única transacción con `import_employees`
(SECURITY INVOKER, de modo que RLS valida cada fila). No se ofrece "importar solo las válidas" para no
dejar altas a medias.

## ADR-028 · Datos personales fuera de URLs y registros

**Fecha**: 2026-10-23 · **Estado**: aceptada

**Decisión**: la búsqueda de personas se envía por POST y se guarda en una cookie `httpOnly`
limitada a `/admin/personas` durante 15 minutos; las URLs solo llevan filtros sin datos personales
(situación, ids de centro o equipo, página). Los mensajes de las acciones no incluyen nombres ni
correos; el nombre del archivo exportado tampoco.

## ADR-029 · Fechas de efecto: qué se programa y qué no

**Fecha**: 2026-10-23 · **Estado**: aceptada (temporal)

**Decisión**: se programan con fecha de efecto las condiciones de empleo, roles, membresías,
asignaciones, suplencias y bajas. El cambio de centro o equipo de una ficha se aplica al guardarlo
(con auditoría): programarlo exigiría un historial de ubicación y un proceso que lo aplique en su
fecha, que se abordará con el módulo de turnos si se necesita.
