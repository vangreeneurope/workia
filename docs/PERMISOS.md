# Permisos

## 1. Principios

1. **Mínimo privilegio** y **por empresa**: ser RR. HH. en la empresa A no da nada en B, aunque
   ambas sean del mismo grupo.
2. **Los permisos viven en tablas controladas por el servidor** (`platform_admins`, `group_admins`,
   `role_assignments`, `manager_assignments`). Nunca en `user_metadata` ni `app_metadata` de Auth
   ni en claims añadidos al JWT: las políticas solo usan `auth.uid()`. Probado en
   `20_integridad_y_escalada.test.sql`.
3. **Vigencia**: membresías, roles y asignaciones solo cuentan si están activos y dentro de su
   vigencia. Una membresía caducada anula todos los roles de esa empresa.
4. **Ámbito**: un rol puede limitarse a un centro o a un equipo. Un rol de ámbito empresa cubre todo.
5. **Sin autoconcesiones**: nadie crea su propia membresía, se concede o amplía roles, se nombra
   manager ni edita su propia ficha o condiciones desde la API.
6. **El backend decide**: la interfaz oculta lo que no procede, pero la autorización real está en
   RLS (barrera definitiva) y en la capa de servidor (`src/lib/auth/dal.ts`).
7. **Sin pistas**: los errores no revelan datos de otras empresas (índices únicos por empresa, ids
   generados por el servidor, claves foráneas compuestas).

8. **Plataforma y empresa no se mezclan** (ADR-024): la administración de plataforma gestiona grupos
   y administradores de grupo, pero no tiene permisos sobre datos de las empresas. Para administrar
   una empresa hace falta ser administrador de su grupo o tener un rol en ella.

## 2. Roles

| Rol                          | Clave           | Dónde se guarda                            | Ámbito                                                                  |
| ---------------------------- | --------------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| Administración de plataforma | —               | `platform_admins`                          | Grupos y administradores de grupo; **ningún** dato de empresa           |
| Administrador de grupo       | —               | `group_admins`                             | Todas las empresas de su grupo                                          |
| Administrador de empresa     | `company_admin` | `role_assignments`                         | Empresa                                                                 |
| RR. HH.                      | `hr`            | `role_assignments`                         | Empresa, centro o equipo                                                |
| Manager / responsable        | `manager`       | `role_assignments` + `manager_assignments` | Empleados con asignación vigente (pueden ser de otra empresa del grupo) |
| Contabilidad                 | `accounting`    | `role_assignments`                         | Empresa                                                                 |
| Empleado                     | `employee`      | `role_assignments`                         | Sus propios datos                                                       |
| Auditor                      | `auditor`       | `role_assignments`                         | Empresa (solo lectura)                                                  |

## 3. Matriz rol → permiso

Implementada en `private.role_has_permission()`. Plataforma y administración de grupo tienen todos
los permisos en sus empresas.

| Permiso                                            | company_admin | hr  | auditor | accounting | manager | employee |
| -------------------------------------------------- | :-----------: | :-: | :-----: | :--------: | :-----: | :------: |
| `company.manage` (datos e identidad de la empresa) |       ✓       |     |         |            |         |          |
| `org.manage` (centros y equipos)                   |       ✓       |     |         |            |         |          |
| `members.read` (cuentas y roles de la plantilla)   |       ✓       |  ✓  |    ✓    |            |         |          |
| `members.manage` (altas y bajas de cuentas)        |       ✓       |  ✓  |         |            |         |          |
| `roles.manage` (con el techo de la sección 5)      |       ✓       |  ✓  |         |            |         |          |
| `employees.read`                                   |       ✓       |  ✓  |    ✓    |     ✓      |         |          |
| `employees.manage`                                 |       ✓       |  ✓  |         |            |         |          |
| `terms.read` (condiciones laborales)               |       ✓       |  ✓  |    ✓    |            |         |          |
| `terms.manage`                                     |       ✓       |  ✓  |         |            |         |          |
| `assignments.manage` (asignar managers)            |       ✓       |  ✓  |         |            |         |          |
| `audit.read`                                       |       ✓       |     |    ✓    |            |         |          |

El manager no obtiene permisos de empresa: ve exactamente a los empleados cubiertos por una
`manager_assignments` vigente. Todo usuario con membresía vigente ve los datos básicos de su
empresa (nombre, centros, equipos) y su propio registro.

## 4. Matriz de políticas por tabla

L = leer, C = crear, M = modificar (solo columnas permitidas). Ninguna tabla permite borrar desde la
API. "Permiso X" = `has_permission` vigente en la empresa de la fila (y en su centro/equipo cuando
aplica).

| Tabla                              | Leer                                                                                        | Crear                                                                                                       | Modificar                                                | Columnas modificables                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| `groups`                           | plataforma, admin del grupo, miembros vigentes de sus empresas                              | plataforma                                                                                                  | plataforma                                               | `name`, `slug`, `status`                                 |
| `group_admins`                     | la propia fila, plataforma, admin del grupo                                                 | plataforma (no a sí misma)                                                                                  | plataforma (no a sí misma)                               | `status`, `valid_to`                                     |
| `companies`                        | plataforma, admin del grupo, miembros vigentes, managers con supervisados en ella           | plataforma, admin del grupo (en su grupo)                                                                   | `company.manage`; cambiar `status` solo grupo/plataforma | datos e identidad visual, `status`                       |
| `work_centers`, `teams`            | miembros vigentes, `org.manage`, managers con supervisados en la empresa                    | `org.manage`                                                                                                | `org.manage`                                             | nombre, código, dirección, estado…                       |
| `profiles`                         | la propia, plataforma, quien tenga `members.read` en una empresa de esa persona, su manager | — (trigger de Auth)                                                                                         | la propia                                                | `full_name`, `phone`                                     |
| `platform_admins`                  | la propia, plataforma                                                                       | — (solo SQL)                                                                                                | —                                                        | —                                                        |
| `company_memberships`              | la propia, `members.read`, manager de esa persona                                           | `members.manage`, nunca la propia                                                                           | `members.manage`, nunca la propia                        | `status`, `valid_from`, `valid_to`                       |
| `role_assignments`                 | las de su membresía, `members.read`                                                         | `can_grant_role`, nunca a la propia membresía                                                               | `can_grant_role`, nunca a la propia                      | `status`, `valid_to`                                     |
| `employees`                        | la propia ficha (con membresía vigente), `employees.read` en su ámbito, su manager vigente  | `employees.manage` en el ámbito de la ficha, no ligada a la propia cuenta                                   | ídem (en el ámbito antiguo **y** en el nuevo)            | datos personales básicos, centro, equipo, estado, cuenta |
| `employment_terms`                 | las propias, `terms.read` en el ámbito del empleado, su manager vigente                     | `terms.manage` en el ámbito, no las propias                                                                 | ídem                                                     | `status`, `valid_to`                                     |
| `manager_assignments`              | el manager, el propio empleado, `employees.read` en el ámbito                               | `assignments.manage` en el ámbito; manager elegible del mismo grupo; no a sí mismo ni sobre su propia ficha | ídem                                                     | `status`, `valid_to`                                     |
| `manager_assignments` (por equipo) | el manager, `employees.read` en el ámbito del equipo                                        | `assignments.manage` en el ámbito del equipo; manager elegible del grupo                                    | ídem                                                     | `status`, `valid_to`                                     |
| `approver_substitutions`           | ausente, suplente, `members.read`                                                           | `assignments.manage`; suplente elegible del grupo; ni ausente ni suplente puede ser quien la registra       | ídem                                                     | `status`, `valid_to`                                     |
| `audit_log`                        | admin del grupo (su grupo), `audit.read` (su empresa); plataforma solo filas sin empresa    | — (triggers)                                                                                                | — (inmutable)                                            | —                                                        |
| `audit_events`                     | `audit.read` (su empresa), admin del grupo                                                  | — (triggers y `log_admin_event`)                                                                            | — (inmutable)                                            | —                                                        |
| Calendarios, festivos, plantillas  | miembros vigentes, managers con supervisados, lectura de horarios                           | gestión de horarios (ámbito empresa)                                                                        | ídem; festivos pasados y versiones publicadas inmutables | nombre, fuente, estado…                                  |
| `shift_template_versions`/tramos   | publicadas: como las plantillas; borradores: gestión                                        | — (RPC `save_shift_template_draft`)                                                                         | — (RPC `publish_shift_template_version`)                 | —                                                        |
| `shift_assignments` (+ días)       | publicadas: la persona, su manager, lectura en su ámbito; borradores: gestión en su ámbito  | — (RPC `save_shift_assignment`)                                                                             | — (RPC de publicación y cierre)                          | —                                                        |
| `leave_periods`, `schedule_events` | la persona; manager y lectura en su ámbito (eventos: solo la persona y lectura)             | — (integración / funciones)                                                                                 | —                                                        | —                                                        |
| `storage: company-logos`           | plataforma, admin del grupo, miembros vigentes, managers con supervisados                   | `company.manage`                                                                                            | `company.manage`                                         | —                                                        |

`anon` no tiene ningún privilegio sobre estas tablas.

## 5. Techo de concesión de roles (`can_grant_role`)

| Quien concede                      | Puede conceder o revocar      |
| ---------------------------------- | ----------------------------- |
| Plataforma, administrador de grupo | Cualquier rol en sus empresas |
| `company_admin` (ámbito empresa)   | Cualquier rol de su empresa   |
| `hr` (ámbito empresa)              | Solo `employee` y `manager`   |
| Resto                              | Nada                          |

Nadie puede concederse, ampliar ni revocar sus propios roles. Un rol concedido no se transforma en
otro (el rol y el ámbito son inmutables): se revoca y se concede uno nuevo, y ambos quedan auditados.

## 6. Matriz de secciones de la interfaz (según la empresa activa)

Implementada en `canAccessSection()` (`src/lib/auth/permissions.ts`). "Admin" = administración de
plataforma o del grupo de la empresa activa.

| Sección             | employee | manager | hr  | company_admin | accounting | auditor |        Admin        |
| ------------------- | :------: | :-----: | :-: | :-----------: | :--------: | :-----: | :-----------------: |
| Inicio, Mi perfil   |    ✓     |    ✓    |  ✓  |       ✓       |     ✓      |    ✓    |          ✓          |
| Horario             |    ✓     |    ✓    |  ✓  |       ✓       |    (*)     |    ✓    |          ✓          |
| Fichajes, Ausencias |    ✓     |    ✓    |  ✓  |       ✓       |            |         | si además tiene rol |
| Gastos              |    ✓     |    ✓    |  ✓  |       ✓       |     ✓      |         | si además tiene rol |
| Equipo              |   (*)    |    ✓    |  ✓  |       ✓       |            |         |          ✓          |
| Auditoría           |          |         |     |       ✓       |            |    ✓    |          ✓          |
| Administración      |          |         |  ✓  |       ✓       |            |         |          ✓          |

(*) Quien supervisa al menos a una persona con asignación vigente ve "Equipo" y "Horario".

### Áreas de administración (`src/lib/admin/access.ts`)

Se calculan con los permisos reales de la base de datos (`my_company_permissions`):

| Área                                       | Requiere                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| Empresas del grupo                         | Administración del grupo                                                 |
| Centros y equipos                          | `org.manage` (ámbito empresa)                                            |
| Personas                                   | `employees.read` (cualquier ámbito; RR. HH. de centro ve solo su centro) |
| Cuentas y roles                            | `members.read` (ámbito empresa); invitar exige `members.manage`          |
| Aprobadores                                | `assignments.manage`                                                     |
| Importar CSV                               | `employees.manage` (RLS valida el ámbito de cada fila)                   |
| Plantillas de turno, Calendarios laborales | `schedule.manage` (ámbito empresa)                                       |
| Asignación de horarios                     | `schedule.manage` (cualquier ámbito; RLS limita a su centro o equipo)    |

Permisos de horarios (`my_schedule_access`, ADR-030): administración de empresa y RR. HH.
gestionan (`schedule.manage`) y leen; auditoría solo lee; el manager ve los horarios publicados de
quien supervisa sin permiso de gestión. Detalle en [HORARIOS.md](HORARIOS.md).

## 7. Cómo se aplica

1. **Proxy**: sin sesión, cualquier ruta privada redirige a `/acceder`.
2. **Página**: cada página privada empieza con `await requireSection("<seccion>")`; sin permiso, 404.
3. **Server Action**: obtiene el contexto con `getUserContext()` y valida cada id recibido. El
   contexto se construye solo con tablas de permisos y aplica vigencias (`assembleUserContext`).
4. **RLS**: políticas basadas en las funciones de `private` (docs/BASE_DATOS.md, sección 4).
5. **Pruebas**: `supabase/tests/` (positivas y negativas por actor; se ejecutan en CI).

## 8. Al añadir una tabla o una acción

- Decide en la matriz de la sección 4 quién lee, crea y modifica, y qué permiso de la sección 3 lo
  rige (o añade uno nuevo al enum `private.app_permission` con su ADR).
- `company_id` obligatorio, claves foráneas compuestas, índices únicos con `company_id`, claves
  inmutables, `grant` por columna y sin `delete`.
- Pruebas positivas y negativas en `supabase/tests/`, incluida "otra empresa" y "membresía caducada".
- Script de reversión en `supabase/rollbacks/` y `npm run db:types`.
