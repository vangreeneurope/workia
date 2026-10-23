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

## ADR-030 · Permisos de horarios en una matriz propia

**Fecha**: 2026-10-24 · **Estado**: aceptada

**Contexto**: añadir permisos al enum `private.app_permission` obliga a reescribir funciones y
complica la reversión. **Decisión**: `private.role_has_schedule_permission(rol, 'read'|'manage')`
(administración de empresa y RR. HH. gestionan; auditoría lee) y `has_schedule_permission(empresa,
acción, centro, equipo)` con el mismo cálculo de vigencias y ámbitos que `has_permission`. El
manager no gestiona horarios: ve los publicados de quien supervisa (`manages_employee`). Plantillas
y calendarios exigen ámbito empresa; las asignaciones, el ámbito de la persona o del equipo. La
interfaz los recibe como `schedule.read`/`schedule.manage` (`my_schedule_access`).
**Consecuencia**: si se quiere que un manager publique excepciones, se añadirá con su ADR.

## ADR-031 · Minutos enteros, zona del centro y reglas de cambio de hora

**Fecha**: 2026-10-24 · **Estado**: aceptada

**Decisión**: los tramos son minutos enteros desde la medianoche local del día del turno (0–2880),
nunca horas decimales ni instantes fijos. La zona es la del centro (o la de la empresa), validada
contra `pg_timezone_names`. La conversión a instantes la hace un resolvedor puro en TypeScript con
dos reglas: hora inexistente → desfase anterior al cambio (se desplaza hacia delante); hora repetida
→ primera ocurrencia. Se devuelven horas de reloj, reales y objetivo, sin clasificar diferencias.
Detalle en docs/HORARIOS.md.

## ADR-032 · Versionado sin efecto retroactivo

**Fecha**: 2026-10-24 · **Estado**: aceptada

**Decisión**: las plantillas tienen versiones; una versión publicada es inmutable (trigger) y la
siguiente cierra su vigencia en su fecha de efecto, que debe ser hoy o futura. Las asignaciones
publicadas solo se finalizan (nunca hacia el pasado) o se anulan antes de empezar; los festivos
pasados son inmutables. Versiones, tramos, asignaciones y eventos se escriben solo mediante
funciones RPC con comprobación de permisos (sin `grant` de escritura directa), porque la operación
afecta a varias filas a la vez y debe ser atómica.

## ADR-033 · Precedencia del horario y festivos

**Fecha**: 2026-10-24 · **Estado**: aceptada

**Decisión**: excepción individual › festivo › persona › equipo › patrón del contrato. Un festivo
anula los niveles ordinarios, pero una excepción individual permite planificar trabajo ese día.
Un único horario publicado por nivel y día (exclusión). Una ausencia aprobada se muestra sin borrar
el plan. Las ausencias llegan por `leave_periods`, tabla de integración que rellenará el módulo de
ausencias (hoy no tiene escritura desde la API).

## ADR-034 · Avisos de cambio como bandeja de salida

**Fecha**: 2026-10-24 · **Estado**: aceptada

**Decisión**: no hay proveedor de correo. Cada publicación o cambio crea filas en
`schedule_events` (una por persona afectada, sin datos personales) dentro de la misma transacción.
La persona las ve en su horario; el futuro proveedor las leerá con `service_role` y marcará
`delivered_at`. Nadie más puede modificarlas.

## ADR-035 · Permisos y escritura del control horario

**Fecha**: 2026-10-25 · **Estado**: aceptada

**Decisión**: matriz propia `private.role_has_time_permission` (administración de empresa y RR. HH.
leen y gestionan; auditoría lee), como en ADR-030. El manager lee a quien supervisa y decide
correcciones cuando es su aprobador de `time_corrections` (mismo cálculo y suplencias que el resto
de aprobaciones). Fichajes, jornadas, solicitudes, ajustes e incidencias **no tienen `grant` de
escritura**: solo funciones `security definer` que comprueban identidad, ámbito y máquina de
estados. Los fichajes y ajustes llevan triggers de inmutabilidad que aplican también a la clave de
servicio (salvo retirar la foto caducada).

## ADR-036 · Terminal compartido con token de dispositivo

**Fecha**: 2026-10-25 · **Estado**: aceptada (decidida con la responsable del proyecto)

**Contexto**: el terminal ficha en nombre de personas que no tienen sesión abierta.
**Decisión**: token aleatorio de 256 bits por terminal, mostrado una vez y guardado solo como
SHA-256; cookie httpOnly en `/terminal`. Dos funciones accesibles para `anon`:
`kiosk_device_info` (comprobar el token) y `kiosk_punch` (token + código + PIN bcrypt). Límites:
5 fallos seguidos bloquean el PIN 15 min; 20 fallos en 10 min bloquean el terminal 10 min; mismo
mensaje y coste para códigos inexistentes. Las respuestas no contienen datos personales.
**Alternativas descartadas**: cuenta técnica por terminal (más gestión de cuentas y roles) y clave
de servicio en el servidor (salta RLS y amplía ADR-025).
**Consecuencia**: es la única excepción a "toda Server Action obtiene la identidad de la sesión".

## ADR-037 · Selfie opcional: sin biometría y 30 días

**Fecha**: 2026-10-25 · **Estado**: aceptada (plazo decidido con la responsable; validar con la asesoría)

**Decisión**: interruptor por política, solo JPEG ≤ 2 MB, metadatos eliminados en servidor (EXIF
puede contener GPS), bucket privado `punch-selfies` con ruta `<empresa>/<persona>/<clave>.jpg`,
subida solo a la ruta propia y con la política activa; lectura para la persona, su manager y
RR. HH. Ningún análisis de la imagen. Conservación 30 días: la base de datos lista las caducadas y
marca la retirada; el borrado del archivo lo hace una tarea con la API de Storage (pendiente de
programar).

## ADR-038 · Hora oficial, idempotencia y jornadas olvidadas

**Fecha**: 2026-10-25 · **Estado**: aceptada

**Decisión**: hora oficial = `now()` del servidor; la del dispositivo solo se declara y, con más de
5 min de diferencia, genera incidencia. Clave de idempotencia única por persona; bloqueo
consultivo por persona para serializar fichajes (probado con sesiones simultáneas). La jornada es
del día local de su entrada en la zona del centro. Una jornada abierta más de 16 h se cierra como
incompleta al fichar una nueva entrada (sin inventar la salida). Sin conexión, el cliente reintenta
con la misma clave y sin ubicación ni foto.

## ADR-039 · Permisos de ausencias y justificantes

**Fecha**: 2026-10-26 · **Estado**: aceptada

**Decisión**: matriz propia `private.role_has_absence_permission` con tres acciones: `read`
(administración de empresa, RR. HH., auditoría), `manage` (administración de empresa y RR. HH.) y
`attachments` (solo RR. HH.). La administración de grupo tiene `read` y `manage` en sus empresas,
pero **no** `attachments`. El manager ve y decide por su asignación de aprobador (con suplencias);
abre justificantes solo si el tipo los marca como no sensibles. Solicitudes, saldos, movimientos y
justificantes se escriben solo mediante funciones `security definer`.

## ADR-040 · Saldo como libro de movimientos

**Fecha**: 2026-10-26 · **Estado**: aceptada

**Decisión**: `vacation_balances` no guarda importes; el saldo es la suma de `balance_movements`
(inmutable, con clave de deduplicación). Cantidades enteras en medios días o minutos; redondeo con
aritmética entera. Cada periodo fija la versión de política con la que se abrió. Reservar exige
bloquear el saldo (`FOR UPDATE`) y la persona (bloqueo consultivo); dos solicitudes simultáneas
no consumen el mismo saldo (probado con dos sesiones). Arrastre FIFO con caducidad.
**Alternativa descartada**: una columna de saldo actualizada con cada operación (difícil de
auditar y propensa a descuadres).

## ADR-041 · Privacidad de las ausencias

**Fecha**: 2026-10-26 · **Estado**: aceptada

**Decisión**: justificantes en un bucket separado (`absence-attachments`), contenido comprobado,
metadatos de fotos eliminados y nombre original descartado; URL firmada de 60 s emitida solo si la
política de Storage lo permite. Compañeros: solo "Ausente" en ausencias aprobadas (función
`absence_calendar`, sin acceso a la tabla). Tipos reservados: "Ausencia" para managers y sin tipo en
avisos. Las solicitudes no se copian a `audit_log` (el comentario podría contener datos sensibles
pese al aviso); su rastro es `absence_request_events`. La configuración y los ajustes manuales sí
van a `audit_log`.

## ADR-042 · Permisos de gastos y tickets

**Fecha**: 2026-10-27 · **Estado**: aceptada

**Decisión**: matriz propia `private.role_has_expense_permission` con dos acciones: `read`
(administración de empresa y Contabilidad) y `manage` (administración de empresa). La
administración de grupo tiene `manage` (configura categorías y política) pero **no** `read`: no
abre tickets de las personas. Leen un gasto y su ticket la persona, quien la supervisa (o su
suplente) y Contabilidad de su ámbito; RR. HH. y auditoría no, salvo que tengan además uno de esos
roles. Solo la persona edita sus borradores (columnas concretas, RLS sobre `status = 'draft'`); el
estado, los tickets, los trabajos y el OCR cambian solo mediante funciones `security definer`.

## ADR-043 · OCR intercambiable, sin proveedor elegido

**Fecha**: 2026-10-27 · **Estado**: aceptada

**Contexto**: el proveedor de OCR no está decidido y los tickets contienen datos personales y
fiscales.

**Decisión**: interfaz `OcrProvider` (`src/features/expenses/ocr/types.ts`) que devuelve textos por
campo con confianza; la normalización (fecha, importes en céntimos, moneda, NIF) es común. Hay un
proveedor falso determinista para desarrollo y pruebas, que nunca se activa en producción. Sin
proveedor aprobado (`OCR_PROVIDER` vacío) no hay OCR: el ticket no sale de la plataforma y el gasto
se completa a mano. No se ha implementado ningún adaptador real: elegirlo requiere un ADR con
contrato de encargo, ubicación de los datos y credenciales.
El OCR se ejecuta en el servidor con la **sesión de la persona** (reclamar trabajo, descargar su
ticket y guardar el resultado mediante funciones que comprueban que es suyo), sin clave de
servicio: el resultado es solo una propuesta que la misma persona confirma, así que no concede nada
que no pudiera escribir a mano.
Cola `jobs` con un trabajo por ticket (`dedupe_key`), bloqueo de fila al reclamar (dos sesiones a la
vez: una sola ejecución, probado), hasta 3 intentos con espera creciente y 2 reintentos manuales.
Se guardan solo campos normalizados con su confianza (nunca el texto completo) y el resultado no
pasa a `audit_log`.
**Pendiente**: un trabajador programado que procese la cola sin que la persona abra la pantalla
(necesitaría la clave de servicio y su propio ADR).

## ADR-044 · Duplicados de tickets

**Fecha**: 2026-10-27 · **Estado**: aceptada

**Decisión**: huella SHA-256 del archivo guardado (tras quitar metadatos), única por empresa. El
mismo archivo de la misma persona devuelve su gasto (reintento); de otra persona se bloquea sin
revelar de quién es. La similitud (mismo proveedor normalizado, fecha, total y moneda entre los
gastos de la persona) no bloquea: al confirmar pide marcar "no es un duplicado" y queda registrada
como desviación. Clave de idempotencia por gasto y nombre de archivo igual a la clave: reenviar no
duplica ni el objeto ni el gasto (probado con dos sesiones simultáneas).

## ADR-045 · Aprobación y cierre de gastos: permisos

**Fecha**: 2026-10-28 · **Estado**: aceptada

**Decisión**: se amplía la matriz de gastos con `approve` (administración de empresa: respaldo sin
manager o por autoaprobación y pasos por rol) y `close` (solo Contabilidad, a nivel de empresa:
cerrar periodos, generar y descargar el paquete). El paso 1 lo decide el manager vigente para
"gastos" con el resolvedor de aprobadores existente (suplencias incluidas, registradas como
delegación). Reglas configurables añaden pasos por umbral de importe y moneda (y categoría opcional).
Nadie actúa sobre sus propios gastos ni en dos pasos del mismo informe.

## ADR-046 · Informes con snapshot y versiones

**Fecha**: 2026-10-28 · **Estado**: aceptada

**Decisión**: al enviar, cada gasto se copia en `expense_report_items.snapshot` con su huella
SHA-256; la copia es inmutable (trigger). Una devolución congela esa versión; el reenvío crea la
versión siguiente enlazada (`previous_version_id`) y hereda las aprobaciones de las líneas cuya
huella no ha cambiado. Los estados del informe y sus transiciones están en un trigger, no en la
aplicación. Un rechazo de línea es definitivo.
**Alternativa descartada**: editar el informe devuelto en el sitio (se perdería lo que se revisó).

## ADR-047 · Lotes contables y exportación determinista

**Fecha**: 2026-10-28 · **Estado**: aceptada

**Decisión**: cierre transaccional por empresa y periodo con bloqueo consultivo, secuencia sin
huecos y clave de idempotencia; un único cierre ordinario por periodo (índice único parcial). Las
líneas del lote son inmutables y llevan copiados empleado, categoría y cuentas del mapeo genérico
por categoría; los ajustes van en lotes correctores. PDF (pdf-lib), CSV, XLSX (escrito a mano) y ZIP
(fflate) se generan con fecha fija y orden estable, de modo que son reproducibles; se registra su
SHA-256 y la base de datos rechaza un archivo distinto para el mismo lote y formato. Los totales se
calculan en la base de datos y la aplicación comprueba que cuadran con las líneas antes de generar.
Dependencias nuevas fijadas a versión exacta: `pdf-lib` 1.17.1 y `fflate` 0.8.3.
**Alternativa descartada**: formato de un ERP concreto (no está decidido; no se inventa su esquema).

## ADR-048 · Tareas programadas y webhook de correo con clave de servicio

**Fecha**: 2026-10-29 · **Estado**: aceptada

**Contexto**: recordatorios, proceso de avisos, envío de correo, liquidación diaria de saldos y
borrado de selfies no tienen sesión de usuario y cruzan empresas.

**Decisión**: dos rutas de máquina, fuera de la redirección del proxy (`MACHINE_PATHS`):
`/api/tareas`, autenticada con `CRON_SECRET` (mínimo 32 caracteres, comparación en tiempo
constante) y llamada por un planificador externo; y `/api/correo/webhook`, que solo acepta eventos
con firma HMAC válida. Ambas usan la clave de servicio (`createAdminClient`) **solo** para llamar a
las funciones de tareas (`run_scheduled_reminders`, `process_notification_outbox`,
`claim_email_deliveries`, `complete_email_delivery`, `record_email_event`, `record_job_run`,
`settle_vacation_balances`, selfies caducadas). Esas funciones tienen `execute` únicamente para
`service_role`. Nunca devuelven contenido ni datos personales en la respuesta, y el registro solo
guarda recuentos y códigos. Es la segunda excepción a la regla de identidad de Server Actions y
Route Handlers, tras `/terminal` (ADR-036).

## ADR-049 · Avisos con outbox transaccional

**Fecha**: 2026-10-29 · **Estado**: aceptada

**Decisión**: los eventos de dominio (historial de ausencias, pasos e informes de gastos, eventos
de fichaje y de horario) escriben una fila en `notification_outbox` desde un trigger en la misma
transacción. Nada se envía dentro de ella. Un proceso posterior crea avisos y correos con claves
de idempotencia por evento, destinatario y canal. Los parámetros de las plantillas los construye la
base de datos con una lista cerrada (empresa, fecha, periodo, día, recuento, resultado). Las
plantillas viven en el código, versionadas. Preferencias solo de correo y solo para avisos no
obligatorios. Reintentos con espera exponencial y dead-letter; supresión tras rebote; deduplicación
de webhooks por id externo. No hay proveedor de correo real: interfaz `EmailProvider` y proveedor
falso fuera de producción.
**Alternativa descartada**: enviar el correo desde la Server Action (acoplaría la operación al
proveedor y duplicaría en los reintentos).

## ADR-050 · Informes con el predicado de RLS evaluado por persona

**Fecha**: 2026-10-30 · **Estado**: aceptada

**Contexto**: las políticas RLS de jornadas, ausencias, gastos y auditoría llaman a funciones de
permiso por fila (`can_read_employee_time(employee_id)`, `has_permission(company_id, …)`). Con
volumen sintético (`99_rendimiento`), un informe SECURITY INVOKER tardaba ~15 s con 6 200 jornadas
y ~28 s con 40 000 eventos de auditoría, porque el mismo predicado se recalculaba en cada fila.

**Decisión**: los informes de volumen (`report_time_*`, `report_absence_*`, `report_expenses`,
`report_audit`) son SECURITY DEFINER y aplican **exactamente** el predicado de la política de cada
tabla, calculado una vez por persona con `private.report_scope(empresa, dominio)` (con atajo cuando
el permiso es de empresa) o una vez por empresa (`audit.read`). El nombre de la persona solo se
muestra si la política de `employees` lo permite. `96_informes` compara, para 12 perfiles y dos
empresas, cada informe con una consulta directa bajo RLS; cualquier divergencia hace fallar la
verificación. Aprobaciones y cierres (pocas filas) siguen siendo SECURITY INVOKER. No hay vistas.
**Alternativas descartadas**: cambiar las políticas de las tablas a `employee_id in (select …)`
(afecta a toda la aplicación y el conjunto de personas visibles cruza empresas por las
supervisiones); usar la clave de servicio en la aplicación (saltaría RLS).

## ADR-051 · Exportaciones asíncronas con la sesión del solicitante

**Fecha**: 2026-10-30 · **Estado**: aceptada

**Decisión**: la Server Action registra la exportación (`request_report_export`: filtros
validados, `request_id`, idempotencia, máximo 3 en curso) y la genera después de responder con
`after()`, que en Server Functions puede leer cookies: el archivo se construye con la sesión del
solicitante, por páginas de 500 filas, y nunca con la clave de servicio. Se guarda en el bucket
privado `report-exports` en `<empresa>/<usuario>/<exportación>/`, con SHA-256, tamaño y filas, y
caduca a los 7 días. Solo el solicitante descarga (URL firmada de 60 s); cada descarga se registra
en `report_export_downloads` y en `audit_events`. La tarea programada caduca, marca atascadas y
borra archivos caducados o huérfanos con la clave de servicio (ADR-048).
**Alternativa descartada**: generar el archivo en el navegador (cargaría el conjunto completo) o en
la propia petición (bloquea y se corta con informes grandes). Si `after()` resultara insuficiente en
el entorno real, el siguiente paso es una cola en `jobs` procesada por la tarea programada.

## ADR-052 · `request_id` y eventos de estado en `audit_events`

**Fecha**: 2026-10-30 · **Estado**: aceptada

**Decisión**: el cliente de Supabase del servidor envía `x-request-id` (el de la petición entrante
si es válido o uno nuevo por petición) y `audit_events.request_id` lo toma de
`request.headers` de PostgREST. Se añaden eventos mínimos de estado (solo `status`) en solicitudes
de ausencia, informes de gastos, lotes, correcciones y ajustes de fichaje, y las acciones
`status_change`, `request_export` y `download`. La minimización se amplía a textos libres,
proveedor, coordenadas y selfies. `audit_events` no guarda errores, cabeceras, IP, tokens ni
secretos: no sustituye a los registros técnicos.

## ADR-053 · MFA obligatoria por rol, aplicada en la base de datos

**Fecha**: 2026-10-31 · **Estado**: aceptada

**Contexto**: una cuenta de administración, RR. HH., contabilidad o auditoría robada da acceso a
datos de toda la empresa. La interfaz sola no basta: cualquier llamada directa a PostgREST con la
sesión saltaría la comprobación.

**Decisión**: las funciones de permisos (`has_permission`, `has_*_permission`, `my_*_access`,
`has_company_role`, `is_group_admin`, `is_global_admin`) solo cuentan los roles `company_admin`,
`hr`, `accounting` y `auditor`, y la administración de grupo y de plataforma, si la sesión es
**aal2** (`private.strong_auth()`, claim firmado por Supabase Auth). No es un permiso leído del JWT
(regla 3): los permisos siguen en tablas; el claim solo indica la fuerza de la autenticación. Sin
aal2 la persona conserva lo suyo (empleo, supervisión directa). La interfaz pide verificar (step-up)
en Equipo, Informes, Auditoría y Administración, y las acciones de gestión responden con un aviso
claro. TOTP gestionado en el servidor (Server Actions). Degradación documentada con
`private.security_settings.mfa_enforced` (solo propietario de la base de datos).
**Alternativas descartadas**: comprobar solo en la interfaz (eludible); políticas restrictivas en
todas las tablas (bloquearía también el autoservicio de quien tiene un rol privilegiado).

## ADR-054 · Acceso de soporte temporal concedido por la empresa

**Fecha**: 2026-10-31 · **Estado**: aceptada

**Decisión**: la administración de plataforma no lee datos de las empresas. La administración de
una empresa concede a una persona de la plataforma un acceso de **solo lectura** (personas,
cuentas, roles y auditoría) de 1 a 24 horas, con motivo, MFA y auditoría; se revoca o caduca solo.
La plataforma tampoco lee los perfiles de toda la base: solo los de administración y los de empresas
con acceso vigente.
**Alternativa descartada**: acceso permanente de soporte (exposición innecesaria).

## ADR-055 · Cookies de sesión httpOnly y CSP revisada

**Fecha**: 2026-10-31 · **Estado**: aceptada (revisa ADR-009)

**Decisión**: la app no usa Supabase en el navegador (se elimina el cliente de navegador), así que
las cookies de sesión pasan a `httpOnly` (y `SameSite=Lax`, `Secure`). La CSP mantiene
`'unsafe-inline'` en scripts porque los nonces exigen renderizado dinámico de todas las páginas y
son incompatibles con el prerenderizado parcial (guía de Next.js 16); se compensa con
`script-src-attr 'none'`, sin `eval`, sin marcos ni objetos, React sin HTML crudo (prueba estática) y
cookies inaccesibles para scripts. Se añaden COOP, CORP y una `Permissions-Policy` cerrada
(geolocalización solo en el propio origen para la lectura puntual al fichar).

## ADR-056 · Retención ejecutable en simulación y retenciones legales

**Fecha**: 2026-10-31 · **Estado**: aceptada

**Decisión**: `run_retention` aplica solo plazos cortos y técnicos (OCR 90 días, avisos leídos 12
meses, intentos del terminal 90 días, contadores y tareas) y **por defecto simula** (recuentos en
`private.retention_runs`); ejecutar exige `RETENTION_MODE=execute`. Las tablas inmutables solo
permiten borrar dentro de una ejecución (marca de transacción y rol propietario). El registro de
jornada, justificantes, tickets y auditoría nunca se borran automáticamente. Las retenciones legales
(`legal_holds`) bloquean la retención y las supresiones.

## ADR-057 · Derechos de las personas con revisión humana

**Fecha**: 2026-10-31 · **Estado**: aceptada

**Decisión**: la persona presenta solicitudes sobre sí misma; las resuelve RR. HH. de empresa o la
administración (con MFA, nunca la propia persona) con decisión motivada. Para supresión y
limitación la base de datos calcula los bloqueos legales y solo permite aprobación parcial si los
hay; aprobar no borra nada. La copia de acceso o portabilidad se genera para la solicitud aprobada,
se descarga una vez y queda auditada.

## ADR-058 · Evidencias de fichaje y documentos sensibles con lectura auditada

**Fecha**: 2026-10-31 · **Estado**: aceptada

**Decisión**: coordenadas, precisión y ruta de la selfie salen de la lectura general de `punches`
(permiso por columnas); solo `punch_evidence` las devuelve, a la persona, su manager y RR. HH. con
gestión de tiempo (no a auditoría ni a lectura general), y cada consulta deja un evento
`sensitive_read`. La política de Storage de las selfies usa el mismo criterio. Abrir un justificante
de ausencia también se registra (`open_absence_attachment`).

## ADR-059 · Registro técnico con redacción, `request_id` y límites de frecuencia

**Fecha**: 2026-10-31 · **Estado**: aceptada

**Decisión**: todo registro técnico pasa por `src/lib/log.ts` (JSON por línea, niveles, redacción
de datos personales y secretos, `alert: true` en eventos de seguridad); `console.*` está prohibido
fuera de él (prueba estática). El proxy asigna `x-request-id`, que llega a PostgREST y a
`audit_events`. Los límites de frecuencia por persona y acción viven en la base de datos
(`check_rate_limit`) y los aplican las Server Actions y las descargas.

## ADR-060 · Errores de red visibles en formularios y acciones

**Fecha**: 2026-10-22 · **Estado**: aceptada

**Contexto**: una Server Action que falla por red (o con 5xx) rechaza la promesa en el navegador y
React muestra la página de error: se pierde lo escrito y la persona no sabe si la operación llegó.

**Decisión**: todos los `useActionState` envuelven su acción con `networkSafe()` y las llamadas
sueltas (botones) con `safeCall()` (`src/lib/network.ts`). Un fallo se convierte en un estado de
error con un mensaje que no afirma ni niega que se guardara ("No se ha podido confirmar el envío
con el servidor…"); las redirecciones y `notFound()` siguen su curso (`unstable_rethrow`). Nunca se
muestra éxito sin respuesta del servidor. Las operaciones que crean registros (fichaje, solicitud,
gasto, ticket) llevan clave de idempotencia y la conservan en el reintento, así que reintentar no
duplica; la cola local sigue limitada a los fichajes (sin ubicación ni foto).

**Consecuencias**: el formulario conserva los datos y el reintento es seguro. La prueba E2E
`flujos.spec.ts` pierde a propósito la respuesta de la primera llamada (el servidor sí la procesa)
y comprueba que el reintento no crea un segundo registro.

## ADR-061 · Entorno E2E con sesión: PostgREST real y pasarela de pruebas

**Fecha**: 2026-10-22 · **Estado**: aceptada

**Decisión**: las pruebas con sesión arrancan PostgreSQL desechable con todas las migraciones y las
semillas sintéticas, PostgREST 12.2.3 (binario con huella SHA-256 fija) y una pasarela Node
(`scripts/e2e/gateway.mjs`) que simula Auth (JWT HS256 con secreto aleatorio por ejecución, TOTP de
prueba) y Storage, y reenvía `/rest/v1` a PostgREST. Así RLS, permisos y MFA por rol son los
reales; solo la emisión de tokens es simulada. La pasarela solo escucha en `127.0.0.1`, no existe
fuera de las pruebas y su contraseña y código son exclusivos de este entorno.

**Consecuencias**: no se prueban el servicio Auth de Supabase ni su Storage reales (correo de
recuperación, subida firmada); siguen cubiertos por las pruebas sin sesión y por la revisión
manual en el proyecto real.

## ADR-062 · Instalación PWA a petición, sin banners automáticos

**Fecha**: 2026-10-22 · **Estado**: aceptada

**Decisión**: se intercepta `beforeinstallprompt` (Chrome y Edge) para no mostrar el banner
automático y se ofrece "Instalar en este dispositivo" en Mi perfil; en iOS se explican los pasos de
Safari (Compartir › Añadir a pantalla de inicio). El service worker se mantiene como en ADR-008:
página sin conexión e iconos; ninguna respuesta autenticada, ticket, coordenada, token ni informe se
guarda en Cache Storage.

**Consecuencias**: la app instalada sigue necesitando conexión salvo para encolar fichajes
(ADR-060). Cachear más (por ejemplo, catálogos no personales) exigiría un ADR nuevo.

## ADR-063 · CI/CD portable con despliegue por adaptadores

**Fecha**: 2026-10-23 · **Estado**: aceptada

**Contexto**: el repositorio está en GitHub, hay cuatro entornos (local, preview, staging,
producción) y el hosting no está decidido.

**Decisión**:

- CI sin secretos, con acciones fijadas por commit, permisos mínimos, cachés por contenido y un único
  check requerido (`CI correcto`) que agrega todos los trabajos. E2E mínimo en PR y completo en
  `main`, cada noche y a mano.
- Las migraciones fusionadas son inmutables y las nuevas posteriores a la última de `main`
  (`scripts/ci/check-migrations.mjs`). Se aplican con `supabase db push` una sola vez por entorno,
  desde el workflow de despliegue, con grupo de concurrencia por entorno; producción exige commit de
  `main` con CI correcto, aprobación del entorno y copia confirmada si hay pendientes.
- El despliegue delega en `scripts/deploy/proveedores/$DEPLOY_PROVIDER.sh`; sin proveedor no se
  publica nada. Se verifica que la URL sirve el commit y la migración esperados.
- Secretos de ejecución en el gestor del hosting; GitHub solo guarda los del despliegue y las
  migraciones, por entorno. OIDC disponible para los proveedores que lo admiten.

**Consecuencias**: elegir hosting es añadir un adaptador y sus pasos de autenticación (ADR propio).
El token del CLI de Supabase es de larga duración (sin OIDC conocido): se limita al entorno y se
rota. La protección de `main` y de los entornos la configura una persona administradora siguiendo
docs/CI_CD.md, § 3.

## ADR-064 · Salud, versión y métricas operativas sin datos personales

**Fecha**: 2026-10-23 · **Estado**: aceptada

**Decisión**: `/api/salud` (vida, identidad del despliegue), `/api/salud/listo` (estados de base de
datos y Auth) y `/api/salud/metricas` (con `METRICS_TOKEN`) son rutas de máquina fuera del proxy de
sesión. `public.ops_metrics()` devuelve agregados de toda la plataforma (colas, OCR, correo,
exportaciones, tareas y cierre) sin identificadores, solo para `service_role`. La clave de servicio se
usa para estas dos lecturas en `src/lib/ops/checks.ts`, que se añade a la lista de usos justificados
del escáner estático. Los errores no controlados se registran con `onRequestError` (plantilla de
ruta y digest, nunca el mensaje). Alertas portables en `ops/observabilidad/alertas.json`, con dueño y
runbook validados por una prueba.

**Consecuencias**: cualquier herramienta de registros y sondas sirve. La latencia por petición sale
del hosting. Los dueños de alertas son roles hasta asignar personas antes del piloto.

## ADR-065 · Copias: base y Storage por separado, restauración en proyecto nuevo

**Fecha**: 2026-10-23 · **Estado**: aceptada (copia de Storage pendiente de decisión)

**Decisión**: la copia de la base (nativa de Supabase y, recomendada, lógica cifrada fuera de GitHub)
no cubre los archivos de Storage, que necesitan su propia copia para los buckets con justificantes.
Se restaura siempre en un proyecto nuevo y se reaplican retención y supresiones. El procedimiento
lógico se ensaya en local con `npm run ops:prueba-restauracion` (datos sintéticos).

**Consecuencias**: hasta decidir la copia de Storage (PENDIENTES_LEGALES, 16), perder archivos no es
recuperable. La restauración en Supabase queda pendiente de ensayar con el proyecto real.

## ADR-066 · Versión visible `vAA.N` calculada desde git

**Fecha**: 2026-10-23 · **Estado**: aceptada

**Decisión**: la versión que ve la persona (bajo el formulario de acceso, al pie del menú lateral y,
en el móvil, en el menú de usuario) es `vAA.N`: «v», el año en dos cifras (hora de Madrid) del commit
publicado y el número de commits de ese año en su historia, incluido él. Cada commit suma uno y el
1 de enero vuelve a empezar. La calcula `scripts/version.mjs` al construir; sin historia completa
(copia superficial o imagen sin `.git`) se usa `APP_RELEASE_INFO`, que el workflow de despliegue
genera con el mismo script, y si tampoco existe no se muestra ninguna versión (nunca una inventada).
`/api/salud` la expone como `release`. La versión SemVer de `package.json` y las etiquetas `vX.Y.Z`
siguen siendo las de release (docs/RELEASE.md).

**Consecuencias**: los jobs que construyen la app (CI y despliegue) necesitan `fetch-depth: 0`. La
versión depende de la historia de `main`: reescribirla cambiaría los números (la protección de
`main` ya lo impide).

## ADR-067 · Duración máxima de la sesión por empresa

**Fecha**: 2026-10-23 · **Estado**: aceptada

**Decisión**: la sesión se cierra siempre N minutos después de entrar, aunque se esté usando (60
por defecto, de 15 a 720). N se guarda por empresa (`companies.session_max_minutes`), lo cambia
quien gestiona la empresa en Administración › Configuración y a quien tiene varias empresas se le
aplica el más corto (`public.my_session_limit()`). El inicio sale del JWT validado: la marca más
antigua de `amr`, que no cambia al refrescar el token. La capa de acceso a datos trata una sesión
vencida como inexistente y redirige a `/acceder?motivo=caducada`, donde el proxy la cierra en ese
dispositivo (`signOut` local: revoca el refresco y borra las cookies) y explica el motivo. En el
navegador, un aviso 5 minutos antes y el cierre a la hora; se comprueba al volver a la pestaña, de
modo que una pestaña abierta desde ayer se cierra en el acto.

**Alternativas**: el límite de sesión de Supabase Auth (time-box) es por proyecto, no por empresa, y
depende del plan; puede activarse además como segunda barrera con el valor más alto permitido.

**Consecuencias**: antes de los 15 minutos de sesión no se consulta la base; después, una llamada
ligera por petición. El enlace `/acceder?motivo=caducada` cierra la sesión de quien lo abre (solo la
propia). Un cambio del valor cuenta desde la siguiente página que se abra.

## ADR-068 · Novedades en el código y aviso tras actualizar

**Fecha**: 2026-10-23 · **Estado**: aceptada

**Decisión**: las novedades para las personas usuarias viven en `src/content/novedades.ts`, en el
mismo cambio que las introduce, con lenguaje de uso y, si cambia la forma de trabajar, «Antes» y
«Ahora, paso a paso». Su versión no se escribe: es la del commit que añadió la novedad (búsqueda en
git al construir). La cabecera tiene un icono de Novedades (con marca si hay algo sin ver) y, tras
una actualización con novedades, aparece un aviso al entrar. Lo visto se guarda por persona
(`profiles.last_seen_release`), así que no se repite en otros dispositivos.

**Consecuencias**: cada actualización de `profiles` deja su fila en `audit_log` (una por persona y
versión). Una versión sin novedades no genera aviso.

## ADR-069 · Borradores de formularios en el navegador

**Fecha**: 2026-10-23 · **Estado**: aceptada (revisión de privacidad pendiente)

**Decisión**: para no perder lo escrito si la sesión se cierra, el texto de los formularios de la
zona privada se guarda en `localStorage` mientras se escribe, por persona y formulario, y se
recupera al volver a la pantalla con un aviso y la opción «Descartar». Se excluyen contraseñas, PIN,
códigos de un solo uso, campos ocultos, de archivo y casillas, y cualquier campo dentro de
`data-sin-borrador`. Los borradores caducan a las 24 horas, se borran al enviar con éxito y todos al
cerrar la sesión a mano.

**Consecuencias**: es una excepción acotada al requisito del PRD «sin datos personales en caché del
dispositivo»: en un dispositivo compartido, el texto escrito permanece hasta 24 horas si la sesión
vence sin cerrarla a mano. Queda registrada en docs/PENDIENTES_LEGALES.md para su revisión; un campo
especialmente sensible debe marcarse con `data-sin-borrador`.

## ADR-070 · Demostración navegable en GitHub Pages

**Fecha**: 2026-10-23 · **Estado**: aceptada

**Contexto**: la organización publica sus demostraciones en GitHub Pages, que solo sirve archivos
estáticos. Workia necesita servidor (Server Components, Server Actions, proxy, tareas), así que la
aplicación real no puede ejecutarse allí.

**Decisión**: una demostración estática, separada de cualquier entorno real. El workflow `Demo`
(`.github/workflows/demo.yml`, en cada push a `main`) construye la app en modo demo
(`DEMO_BUILD=1`, ruta base `/workia`), arranca el entorno E2E con las semillas SINTÉTICAS (PostgreSQL
desechable, PostgREST y la pasarela de pruebas), recorre con peticiones GET las pantallas visibles
para la cuenta de administración de la empresa ficticia y publica el resultado en
`vangreeneurope.github.io/workia`. En modo demo se muestra una franja de «datos ficticios», no se
instala el service worker ni se cierra la sesión por tiempo, y `scripts/demo/demo.js` intercepta
formularios y acciones con el aviso «los cambios no se guardan». Las descargas no se incluyen.

**Consecuencias**: no es un entorno productivo ni real (CLAUDE.md, regla 13): no usa Supabase real,
ni secretos, ni datos de personas. La demostración es pública aunque el repositorio sea privado (y
GitHub Pages en un repositorio privado requiere un plan de pago de GitHub). Es una instantánea: se ve
como administración de empresa y con los datos del día de la generación.
