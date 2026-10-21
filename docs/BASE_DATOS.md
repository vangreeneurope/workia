# Base de datos

Fuente de verdad: `supabase/migrations/`. Si este documento discrepa de las migraciones, mandan
las migraciones y hay que corregir este documento. Los tipos TypeScript se generan desde ellas
(`npm run db:types`) y CI comprueba que no divergen.

## 1. Convenciones

- Identificadores en inglés y `snake_case`. Claves primarias `uuid` (`gen_random_uuid()`), salvo
  `audit_log` (`bigint identity`).
- **Tiempo en UTC**: todos los instantes son `timestamptz` (se almacenan en UTC; Supabase usa UTC
  como zona de la base). Las fechas de calendario laboral (`employment_terms.valid_from/valid_to`)
  son `date`.
- **Estados explícitos** con enums (`entity_status`, `membership_status`, `grant_status`,
  `terms_status`), nunca booleanos ambiguos.
- **Vigencia temporal** `[valid_from, valid_to)`: el inicio se incluye, el fin no; `valid_to` nulo
  significa sin fin. Un registro solo produce efectos si su estado es `active` y `now()` está dentro
  de la vigencia (`private.is_active_window`).
- **Toda tabla operativa lleva `company_id`** (las de grupo llevan `group_id`). Las referencias entre
  tablas de empresa usan **claves foráneas compuestas** `(x_id, company_id)`, de modo que es
  imposible mezclar filas de empresas distintas aunque el cliente envíe ids de otra empresa.
- **Claves inmutables**: un trigger `private.prevent_key_change()` impide cambiar `company_id`,
  `user_id`, `group_id` y similares incluso a `service_role`. Una fila no se "mueve" de empresa.
- **Unicidad por empresa**: los índices únicos incluyen `company_id` (o `group_id`). La unicidad se
  comprueba antes que las claves foráneas; con índices globales, un error de "duplicado" revelaría
  datos de otra empresa (ver ADR-018).
- El cliente no elige `id` ni campos controlados por el servidor (`granted_by`, `status` inicial de
  asignaciones): los `grant insert` son por columna.
- No se borra información laboral: bajas con estado `ended`/`inactive` o `revoked` y fecha de fin.
  Ninguna tabla operativa concede `delete` a `authenticated`.
- RLS activada en todas las tablas de `public`, `revoke all from anon, authenticated` y `grant`
  mínimos por columna. Funciones de autorización en el esquema `private` (no expuesto por la API),
  `security definer`, `set search_path = ''` (ver sección 4).
- Migraciones `AAAAMMDDHHMMSS_descripcion.sql`, nunca se editan una vez aplicadas en un entorno
  compartido. Cada migración nueva lleva su reversión en `supabase/rollbacks/` (sección 6).

## 2. Diagrama de relaciones

```
auth.users 1──1 profiles ──────────────┐ (user_id)
                  │                    │
                  │ 0..1               │
           platform_admins             │
                                       │
groups 1──* group_admins *─────────────┤
  │                                    │
  1                                    │
  *                                    │
companies 1──* work_centers 1──* teams │
  │  (logotipo: storage company-logos/<company_id>/…)
  │                                    │
  1──* company_memberships *───────────┘  (company_id, user_id) único
  │        │ 1
  │        ├──* role_assignments  (rol + ámbito: empresa | centro | equipo, con vigencia)
  │        │        └─ ámbito → work_centers / teams de la MISMA empresa
  │        │ 0..1
  1──* employees  (ficha laboral; centro y equipo actuales; cuenta opcional)
  │        │ 1
  │        ├──* employment_terms  (condiciones con vigencia, sin solapes activos)
  │        │ 1
  │        └──* manager_assignments *── profiles (manager_user_id; puede ser de otra
  │                                    empresa del MISMO grupo)
  │
  └──  audit_log  (company_id, group_id; append-only, escrito por triggers)

Todas las flechas entre tablas de empresa son claves compuestas (id, company_id).
```

## 3. Tablas

### Organización

| Tabla          | Propósito                            | Claves y restricciones relevantes                                                                                          |
| -------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `groups`       | Grupo empresarial                    | `slug` único; `status`                                                                                                     |
| `group_admins` | Administración de grupo con vigencia | único activo por (grupo, usuario); solo la concede la plataforma                                                           |
| `companies`    | Empresa del grupo e identidad visual | `group_id` inmutable; `slug` único por grupo; color `#RRGGBB` validado; `status` solo lo cambia la administración de grupo |
| `work_centers` | Centros de trabajo                   | único (empresa, `code`); zona horaria                                                                                      |
| `teams`        | Equipos                              | único (empresa, nombre); centro de la misma empresa                                                                        |

### Personas y acceso

| Tabla                 | Propósito                                                   | Claves y restricciones relevantes                                                                                                                                              |
| --------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `profiles`            | 1:1 con `auth.users` (nombre, email sincronizado, teléfono) | creado por trigger al dar de alta en Auth; la persona solo edita nombre y teléfono                                                                                             |
| `platform_admins`     | Administración de plataforma (soporte, crea grupos)         | sin escritura desde la API                                                                                                                                                     |
| `company_memberships` | Cuenta de una persona en una empresa                        | `status` (`invited`, `active`, `suspended`, `ended`) + vigencia; único (empresa, usuario); `company_id`/`user_id` inmutables                                                   |
| `role_assignments`    | Roles de una membresía                                      | rol (`company_admin`, `hr`, `manager`, `accounting`, `employee`, `auditor`), ámbito (`company`, `work_center`, `team`), `status`, vigencia, `granted_by` (lo fija el servidor) |

### Empleo

| Tabla                 | Propósito                            | Claves y restricciones relevantes                                                                                                                                                                |
| --------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `employees`           | Ficha laboral gestionada por RR. HH. | código único por empresa; cuenta opcional (`membership_id`, única por empresa); centro y equipo de la misma empresa                                                                              |
| `employment_terms`    | Condiciones contractuales            | tipo de contrato, jornada (≤ 40 h semanales), puesto, vigencia en fechas; **sin dos condiciones activas solapadas** (restricción de exclusión con `btree_gist`); se cambian creando filas nuevas |
| `manager_assignments` | Manager → empleado                   | `status` + vigencia; el manager debe tener membresía vigente en una empresa del mismo grupo; nadie se supervisa a sí mismo                                                                       |

### Auditoría y almacenamiento

- `audit_log`: append-only. Columnas `actor_id` (`auth.uid()`), `company_id`, `group_id`,
  `table_name`, `record_id`, `action`, `old_data`, `new_data`. Triggers impiden `UPDATE`, `DELETE`
  y `TRUNCATE`. Auditadas: `groups`, `group_admins`, `platform_admins`, `companies`,
  `work_centers`, `teams`, `company_memberships`, `role_assignments`, `employees`,
  `employment_terms`, `manager_assignments` y cambios de `profiles`. Los cambios privilegiados
  (roles, administradores, membresías, asignaciones) quedan con quién, cuándo, antes y después.
- Bucket privado `company-logos` (ruta `<company_id>/…`, URL firmada de 1 hora).

## 4. Funciones de autorización (`private`)

Todas son `security definer` con propietario `postgres`: leen sin aplicar RLS (así no hay
recursión entre políticas), fijan `search_path = ''` y cualifican cada objeto con su esquema. Solo
devuelven booleanos o el id de la membresía **del propio usuario**, nunca datos de otras personas.
Se revoca `execute` a `public` y se concede solo a `authenticated` y `service_role` las que usan
las políticas; las funciones de trigger no se conceden.

| Función                                                                                       | Devuelve                                                                                      |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `current_membership_id(company)`                                                              | Membresía vigente del usuario en una empresa activa de un grupo activo                        |
| `is_company_member(company)`                                                                  | Si tiene membresía vigente                                                                    |
| `is_global_admin()` · `is_group_admin(group)` · `is_group_admin_of_company(company)`          | Administración de plataforma o de grupo vigente                                               |
| `role_has_permission(role, permission)`                                                       | Matriz rol → permiso (inmutable, ver PERMISOS)                                                |
| `has_permission(company, permission, work_center?, team?)`                                    | Si algún rol vigente concede el permiso en la empresa y, si se indica, en ese centro o equipo |
| `has_company_role(company, roles[])` · `can_grant_role(company, role)`                        | Roles de ámbito empresa y techo de concesión de roles                                         |
| `is_own_membership(m)` · `is_self_employee(e)` · `employee_belongs_to_user(u, e)`             | Para impedir autoconcesiones                                                                  |
| `employee_permission(e, permission)`                                                          | `has_permission` con el centro y equipo del empleado                                          |
| `manages_employee(e)` · `manages_membership(m)` · `manages_user(u)` · `manages_in_company(c)` | Supervisión con asignación vigente                                                            |
| `is_eligible_manager(u, company)` · `user_has_current_membership_in_group(u, g)`              | Elegibilidad de un manager dentro del grupo                                                   |

No hay vistas. Si se necesitara una, se creará con `security_invoker = true` o se revocará su
acceso directo.

## 5. Datos semilla (solo local)

`supabase/seeds/01_demo_sintetico.sql`: dos empresas ficticias de un grupo ficticio, centros,
equipos, nueve cuentas con roles distintos, seis fichas de empleado, condiciones laborales y un
manager que supervisa a una persona de cada empresa. Correos con el dominio reservado `.example`,
sin NIF y **sin contraseñas** (en local se entra con "¿Has olvidado tu contraseña?" y el buzón de
pruebas de Supabase). Se cargan con `npx supabase db reset`; nunca con `--include-seed` contra un
proyecto real. `supabase/tests/30_seed_sintetico.test.sql` comprueba que cargan y respetan el
aislamiento.

## 6. Reversibilidad

Supabase no ejecuta migraciones "down", así que cada migración nueva tiene su script en
`supabase/rollbacks/<migración>.down.sql`. Para revertir en un entorno: aplicar los scripts en
orden inverso con `psql` y borrar la fila correspondiente de
`supabase_migrations.schema_migrations` (o `npx supabase migration repair --status reverted <versión>`).

| Migración                               | Reversión                           | Datos que se pierden al revertir                                                                                                        |
| --------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `20261021090000/090100/090200` (fase 0) | No tienen (anteriores a esta norma) | —                                                                                                                                       |
| `20261022100000_modelo_multiempresa`    | Sí                                  | grupos, administradores de grupo, centros, equipos, roles `hr`/`auditor` y roles de ámbito centro/equipo; estados `invited`/`suspended` |
| `20261022100100_empleados`              | Sí                                  | fichas de empleado y condiciones; asignaciones de manager de empleados sin cuenta                                                       |

Protecciones:

- Las migraciones destructivas abortan si encuentran datos que no saben trasladar (por ejemplo,
  `job_title` en membresías o asignaciones de manager previas) en lugar de perderlos.
- Las reversiones abortan si van a perder datos, salvo `set app.allow_lossy_rollback = 'on';`.
- `npm run test:db` verifica automáticamente que cada reversión deja el esquema **idéntico** al
  anterior (tablas, columnas, restricciones, índices, políticas, funciones, triggers, tipos y
  permisos) y que reaplicar las migraciones reproduce el esquema completo.

## 7. Pruebas de base de datos

`npm run test:db` (en local levanta un PostgreSQL temporal; en CI usa un servicio `postgres:16`):

1. Carga `supabase/tests/00_shim_supabase.sql` (emulación mínima de Supabase: roles, `auth.users`,
   `auth.identities`, `auth.uid()`, `storage`) y todas las migraciones en una base plantilla.
2. Ejecuta cada `supabase/tests/NN_*.test.sql` en una base nueva clonada de la plantilla:
   `10_aislamiento_multiempresa` (qué ve y hace cada actor), `20_integridad_y_escalada`
   (inmutabilidad, restricciones, falsificaciones, metadatos y claims) y `30_seed_sintetico`.
3. Comprueba reversibilidad y protección de datos de las reversiones.

Cada prueba actúa como un usuario concreto (`set role authenticated` + claims del JWT). Limitación:
la emulación no es Supabase completo; antes de producción hay que aplicar las migraciones y repetir
las pruebas en un proyecto Supabase de pruebas.

## 8. Tipos TypeScript

`npm run db:types` levanta un PostgreSQL desechable, aplica las migraciones, lee el catálogo y
escribe `src/types/database.ts` con el formato de `supabase gen types`. `npm run db:types:check`
(en CI) falla si el archivo no coincide con las migraciones. Con Docker o un proyecto enlazado, el
equivalente oficial es:

```bash
npx supabase gen types typescript --local --schema public > src/types/database.ts
```

## 9. Previsto para fases siguientes (no implementado)

- **Control horario (fase 1)**: `time_entries` (fichaje original, hora del servidor, sin `update`
  ni `delete`, trigger `prevent_mutation()`) y `time_entry_corrections` (solicitud enlazada con
  motivo y aprobación). Ambas con `company_id`, `employee_id` y claves compuestas.
- **Ausencias (fase 2)**: `work_calendars`, `calendar_holidays`, `leave_types`, `leave_balances`,
  `leave_requests` (justificantes en bucket privado `leave-attachments`).
- **Gastos (fase 3)**: `expense_policies`, `expense_reports`, `expenses`, `expense_receipts`
  (bucket privado `expense-receipts`, resultado OCR y campos confirmados por la persona).

Cada tabla nueva seguirá las convenciones de la sección 1, con pruebas de aislamiento y reversión.
