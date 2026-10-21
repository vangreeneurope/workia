# Base de datos

Fuente de verdad: `supabase/migrations/`. Este documento explica el modelo; si discrepa de las
migraciones, mandan las migraciones y hay que corregir este documento.

## 1. Convenciones

- Identificadores en inglés y `snake_case`. Claves primarias `uuid` (`gen_random_uuid()`), salvo
  `audit_log` (`bigint identity`).
- `created_at` / `updated_at` en `timestamptz`; `updated_at` mediante trigger.
- Toda tabla de `public`: RLS activada, `revoke all from anon, authenticated` y `grant` mínimos,
  con permisos por columna cuando proceda.
- Funciones de autorización en el esquema `private` (no expuesto por la API REST),
  `security definer` y `set search_path = ''`.
- No se borra información laboral: las bajas son `active = false` con `end_date`. Las claves
  foráneas hacia personas usan `on delete restrict` donde hay obligación de conservar.
- Validaciones en base de datos con `check` (color hexadecimal, slug, CIF, longitudes).
- Nombre de migración: `AAAAMMDDHHMMSS_descripcion.sql`. Nunca se edita una migración ya aplicada en
  un entorno compartido: se crea otra.

## 2. Esquema actual (fase 0)

### `companies`

Empresas del grupo. `name`, `legal_name`, `tax_id` (CIF), `slug` único, `primary_color` (`#RRGGBB`),
`logo_path` (ruta en el bucket `company-logos`), `timezone` (por defecto `Europe/Madrid`), `active`.

### `profiles`

1:1 con `auth.users`. `email` (sincronizado desde Auth por trigger), `full_name`, `phone`. Se crea
automáticamente al dar de alta un usuario en Auth (`private.handle_new_user`). La persona solo puede
editar `full_name` y `phone` (permiso por columna).

### `platform_admins`

Administradores globales. Sin escritura desde la API: se gestionan con SQL o `service_role`.

### `company_memberships`

Pertenencia de una persona a una empresa: `roles company_role[]` (uno o varios de `company_admin`,
`manager`, `employee`, `accounting`), `job_title`, `active`, `start_date`, `end_date`. Única por
`(company_id, user_id)`. `company_id` y `user_id` no se pueden modificar (una membresía no se
"mueve" de empresa ni de persona).

### `manager_assignments`

Relación responsable → membresía supervisada. `company_id` replica la empresa de la membresía y se
garantiza con una clave foránea compuesta `(employee_membership_id, company_id)`. Un trigger impide
que alguien sea su propio responsable. Permite supervisar a personas de otras empresas del grupo.

### `audit_log`

Auditoría append-only: `occurred_at`, `actor_id` (`auth.uid()`), `company_id`, `table_name`,
`record_id`, `action`, `old_data`, `new_data`. Escrita solo por `private.audit_row_change()`.
Triggers bloquean `UPDATE`, `DELETE` y `TRUNCATE` incluso para el propietario. Auditadas:
`companies`, `company_memberships`, `manager_assignments`, `platform_admins` y cambios de
`profiles`.

### Storage: bucket `company-logos`

Privado, 512 KB, PNG/JPEG/WebP. Ruta `<company_id>/<archivo>`. Lectura para miembros de la empresa,
responsables con personas en ella y administración global; escritura solo administración global.

### Funciones de autorización (`private`)

`is_global_admin()`, `has_company_role(company, roles[])`, `is_company_member(company)`,
`manages_in_company(company)`, `manages_membership(membership)`, `manages_user(user)`,
`is_hr_of_user(user)`, `object_company_id(path)`.

## 3. Esquema previsto (no implementado)

Se detallará y probará en la fase correspondiente. Diseño orientativo:

**Control horario (fase 1)**

- `time_entries`: fichaje original. `membership_id`, `kind` (`start`, `pause`, `resume`, `end`),
  `recorded_at` (hora del servidor, `default now()`), `source` (web, pwa), `created_by`.
  **Sin `update` ni `delete`** para ningún rol de la API; trigger `prevent_mutation()`.
- `time_entry_corrections`: solicitud de corrección enlazada al fichaje original, con motivo,
  valor propuesto, estado (`pending`, `approved`, `rejected`), quién y cuándo resuelve. La jornada
  "efectiva" se calcula combinando originales y correcciones aprobadas; el original nunca cambia.
- Vista o función de cálculo de jornada diaria y exportación para la Inspección.

**Ausencias (fase 2)**

- `work_calendars`, `calendar_holidays` (por empresa y centro).
- `leave_types` (por empresa: retribuido, requiere justificante, cómputo).
- `leave_policies` / `leave_balances` (saldo anual por membresía).
- `leave_requests` (estado, aprobador, fechas, justificante en bucket privado `leave-attachments`).

**Gastos (fase 3)**

- `expense_policies` (límites, kilometraje, dietas por empresa).
- `expense_reports` (agrupación y flujo: borrador, enviado, aprobado, validado, liquidado).
- `expenses` (línea de gasto con importe, impuestos, proveedor, categoría).
- `expense_receipts` (archivo en bucket privado `expense-receipts`, resultado OCR en bruto y campos
  confirmados por la persona, con su procedencia).

## 4. Pruebas de base de datos

`npm run test:db` levanta un PostgreSQL desechable, carga `supabase/tests/00_shim_supabase.sql`
(emula lo mínimo de Supabase: roles, `auth.users`, `auth.uid()`, `storage`), aplica todas las
migraciones y ejecuta `supabase/tests/*.test.sql`. Cada prueba actúa como un usuario concreto
(`set role authenticated` + claims del JWT) y comprueba qué puede ver y hacer.

Limitación: la emulación no es Supabase completo. Antes de producción las migraciones deben
aplicarse y probarse también en un proyecto Supabase real de pruebas (ver ESTADO_PROYECTO).

## 5. Tipos TypeScript

`src/types/database.ts` está escrito a mano en el formato de `supabase gen types`. Con el proyecto
creado, regenerarlo:

```bash
npx supabase gen types typescript --project-id <id> --schema public > src/types/database.ts
```
