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

### Administración (migración `20261023100000_administracion`)

| Tabla / cambio                   | Propósito                                                                                                                       | Claves y restricciones relevantes                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `manager_assignments` (ampliada) | Aprobador por **persona o equipo** y **tipo de solicitud** (`approval_type`: `all`, `absences`, `expenses`, `time_corrections`) | `scope_type` coherente con `employee_id`/`team_id`; exclusión: un único aprobador vigente por (empresa, persona o equipo, tipo) |
| `approver_substitutions`         | Suplencias temporales con motivo                                                                                                | fin obligatorio, máximo un año, sin solapes por (ausente, tipo), suplente distinto del ausente                                  |
| `employees.end_date`             | Baja con fecha efectiva (último día incluido)                                                                                   | solo se modifica con `terminate_employee` / `reactivate_employee`                                                               |
| `audit_events`                   | Auditoría minimizada de cambios sensibles                                                                                       | solo campos cambiados, datos personales enmascarados, inmutable                                                                 |

Las reglas completas de vigencia, bajas y aprobadores están en
[VIGENCIA_Y_BAJAS.md](VIGENCIA_Y_BAJAS.md).

Funciones expuestas por la API (RPC), todas con comprobación explícita de permisos o con RLS del
propio usuario:

| Función                                                                         | Tipo          | Uso                                                          |
| ------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------ |
| `my_company_permissions(empresa)`                                               | definer       | Permisos del propio usuario (adaptar la interfaz)            |
| `resolve_approver(empleado, tipo, instante)`                                    | definer       | Aprobador efectivo o error `APROBADOR_*`                     |
| `terminate_employee(empleado, último_día)` · `reactivate_employee(empleado)`    | definer       | Baja y reactivación atómicas                                 |
| `change_employment_terms(...)`                                                  | invoker (RLS) | Cambio de condiciones con fecha de efecto                    |
| `import_employees(empresa, filas)`                                              | invoker (RLS) | Importación de todo o nada                                   |
| `log_admin_event(...)`                                                          | definer       | Registrar exportaciones e importaciones sin datos personales |
| `find_group_user_by_email(empresa, correo)` · `group_user_labels(empresa, ids)` | definer       | Elegir y mostrar managers y suplentes del mismo grupo        |

### Calendarios y horarios (migración `20261024100000_calendarios_turnos`)

Modelo, precedencia y zonas horarias en [HORARIOS.md](HORARIOS.md).

| Tabla / cambio                      | Propósito                                                   | Claves y restricciones relevantes                                                                                   |
| ----------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `holiday_calendars`                 | Calendario laboral con fuente obligatoria                   | nombre único por empresa; región ISO `ES-XX`                                                                        |
| `work_center_holiday_calendars`     | Calendario aplicado a un centro con vigencia                | claves compuestas; exclusión de solapes; inicio no pasado                                                           |
| `holidays`                          | Festivos                                                    | único (empresa, calendario, fecha); pasados inmutables                                                              |
| `shift_templates`                   | Plantilla de turno                                          | código único por empresa                                                                                            |
| `shift_template_versions`           | Versión con tipo, horas objetivo, tolerancias, vigencia     | publicada inmutable; una publicada por día y plantilla (exclusión)                                                  |
| `shift_template_segments`           | Tramos en minutos enteros (0–2880)                          | fin > inicio; inmutables si la versión está publicada                                                               |
| `shift_assignments` + `_days`       | Asignación por excepción, persona, equipo o contrato; ciclo | coherencia de ámbito; excepción ≤ 31 días; una publicada por nivel y sujeto (exclusión); FK compuesta a condiciones |
| `leave_periods`                     | Ausencias aprobadas (integración)                           | solo lectura desde la API                                                                                           |
| `schedule_events`                   | Avisos por persona                                          | inmutables salvo para `service_role`                                                                                |
| `companies`/`work_centers.timezone` | Zona horaria                                                | solo nombres IANA conocidos (`private.is_valid_time_zone`)                                                          |

RPC nuevas (definer, con comprobación explícita de permisos y empresa derivada de los datos):
`save_shift_template_draft`, `publish_shift_template_version`, `save_shift_assignment`,
`shift_assignment_conflicts`, `publish_shift_assignment`, `close_shift_assignment` y
`my_schedule_access`. `audit_events` admite la acción `publish`.

### Control horario (migración `20261025100000_control_horario`)

Funcionamiento y operación en [CONTROL_HORARIO.md](CONTROL_HORARIO.md).

| Tabla                          | Propósito                                         | Claves y restricciones relevantes                                                                                                                    |
| ------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `punches`                      | Fichaje original                                  | inmutable (trigger, también para servicio salvo retirar la foto); clave idempotente única por (empresa, persona); ubicación coherente con el permiso |
| `time_entries`                 | Jornada recalculada                               | una abierta por persona (índice parcial); fecha = día local de la entrada; sin borrado                                                               |
| `time_correction_requests`     | Solicitud de corrección                           | forma según la acción (añadir, cambiar, anular); solo cambia la decisión                                                                             |
| `time_adjustments`             | Ajuste aprobado (antes, después, motivo, autores) | inmutable; uno por solicitud                                                                                                                         |
| `time_incidents`               | Incidencias detectadas                            | sin duplicados por (jornada, clave); solo cambia su estado                                                                                           |
| `time_tracking_policies`       | Ubicación y selfie por empresa o centro           | una por empresa y una por centro; aviso obligatorio si se usa la ubicación                                                                           |
| `kiosk_devices`                | Terminales                                        | solo el hash del token; columna no legible desde la API                                                                                              |
| `kiosk_pins`, `kiosk_attempts` | PIN (bcrypt) e intentos                           | sin acceso desde la API                                                                                                                              |
| `work_events`                  | Recordatorios y avisos pendientes                 | únicos por (persona, clave); inmutables salvo para servicio                                                                                          |

RPC: `record_punch`, `my_time_status`, `my_time_access`, `set_my_kiosk_pin`, `reset_kiosk_pin`,
`register_kiosk_device`, `request_time_correction`, `cancel_time_correction`,
`decide_time_correction`, `resolve_time_incident` (authenticated); `kiosk_device_info` y
`kiosk_punch` (también anon, ADR-036); `generate_time_reminders`, `expired_punch_selfies` y
`mark_punch_selfie_purged` (solo service_role). Bucket privado `punch-selfies` (JPEG, 2 MB).
El horario planificado se recalcula en SQL con `private.planned_shift` (mismas reglas que el
resolvedor TypeScript; las horas repetidas del cambio de hora se corrigen en
`private.local_to_utc`).

### Vacaciones y ausencias (migración `20261026100000_ausencias`)

Reglas y privacidad en [AUSENCIAS.md](AUSENCIAS.md).

| Tabla                      | Propósito                                      | Claves y restricciones relevantes                                                        |
| -------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `absence_types`            | Tipos configurables por empresa                | código único por empresa; sin aprobación solo con referencia de la regla                 |
| `vacation_policies`        | Política de saldo de un tipo                   | mes de inicio del periodo inmutable                                                      |
| `vacation_policy_versions` | Reglas versionadas por vigencia                | publicadas inmutables; una por día (exclusión); negativo solo con límite y justificación |
| `policy_assignments`       | Política por persona, equipo, centro o empresa | una por tipo, nivel y sujeto en cada fecha (exclusión); solo desde hoy                   |
| `vacation_balances`        | Saldo por persona, política y periodo          | sin importes; versión fijada al abrir                                                    |
| `balance_movements`        | Libro de movimientos                           | inmutable; signo por tipo; deduplicación por saldo                                       |
| `absence_requests`         | Solicitudes                                    | sin solapes activos (exclusión sobre `tstzrange`); idempotentes; solo cambia el estado   |
| `absence_approvals`        | Instancia de aprobación                        | una por solicitud                                                                        |
| `absence_request_events`   | Historial                                      | inmutable                                                                                |
| `absence_attachments`      | Justificantes (metadatos)                      | inmutables; sensibilidad copiada del tipo                                                |
| `leave_periods`            | (columna nueva) `absence_request_id`           | enlaza las ausencias aprobadas de día completo                                           |

RPC: `quote_absence_request`, `submit_absence_request`, `decide_absence_request`,
`respond_absence_info`, `cancel_absence_request`, `add_absence_attachment`,
`adjust_vacation_balance`, `my_vacation_balances`, `absence_calendar`, `my_absence_access`,
`publish_vacation_policy_version` (authenticated); `settle_vacation_balances` (solo service_role).
Bucket privado `absence-attachments` (PDF, JPEG, PNG; 5 MB).

### Gastos (migración `20261027100000_gastos`)

Flujo, reglas y privacidad en [GASTOS.md](GASTOS.md).

| Tabla                | Propósito                            | Claves y restricciones relevantes                                                       |
| -------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- |
| `expense_policies`   | Política de gastos (una por empresa) | moneda por defecto entre las admitidas; €/km en milésimas                               |
| `expense_categories` | Categorías                           | código único por empresa; `is_mileage` inmutable                                        |
| `expenses`           | Gastos                               | idempotentes por persona; importes en céntimos; `ready` exige los datos completos       |
| `expense_receipts`   | Tickets (metadatos)                  | inmutables; huella SHA-256 única por empresa; uno por gasto                             |
| `jobs`               | Cola de trabajos                     | un trabajo por (empresa, tipo, `dedupe_key`); intentos ≤ máximo; solo ids en el payload |
| `ocr_runs`           | Intentos de OCR                      | resultado limitado a campos conocidos (≤ 8 KB); terminado = inmutable                   |
| `expense_events`     | Historial                            | inmutable; solo códigos                                                                 |

RPC: `find_receipt_duplicate`, `register_expense_receipt`, `create_expense`, `claim_ocr_job`,
`finish_ocr_run`, `requeue_receipt_ocr`, `confirm_expense`, `reopen_expense`,
`set_expense_discarded`, `my_expense_access` (authenticated). Bucket privado `expense-receipts`
(PDF, JPEG, PNG; 10 MB), ruta `<empresa>/<persona>/<año>/<mes>/<uuid>.<ext>`.

### Informes y liquidación (migración `20261028100000_informes_gastos`)

Ciclo, aprobación, cierre y exportación en [LIQUIDACION_GASTOS.md](LIQUIDACION_GASTOS.md).

| Tabla                                            | Propósito                             | Claves y restricciones relevantes                                                                          |
| ------------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `expense_approval_rules`                         | Pasos adicionales por umbral          | un aprobador (rol o persona); orden 2 a 9                                                                  |
| `expense_account_mappings`                       | Cuentas contables por categoría       | una por categoría y una por defecto (índice único con `coalesce`)                                          |
| `expense_reports`                                | Informe mensual por persona y versión | uno en revisión por persona y mes; versiones enlazadas; transiciones por trigger                           |
| `expense_report_items`                           | Líneas con snapshot del gasto         | copia y huella inmutables; un gasto por informe                                                            |
| `approval_instances`, `approval_steps`           | Aprobación por pasos                  | paso actual; delegación registrada; sin borrado                                                            |
| `accounting_batches`                             | Lotes contables                       | secuencia única por empresa; clave idempotente; un cierre ordinario por periodo; solo pasa a contabilizado |
| `accounting_batch_lines`                         | Líneas del lote                       | inmutables; importes en céntimos; ajustes con motivo                                                       |
| `accounting_batch_exclusions`                    | Informes excluidos de un cierre       | motivo obligatorio; inmutables; auditados                                                                  |
| `accounting_exports`, `accounting_export_events` | Paquete y registro                    | un archivo por formato y lote con su SHA-256; generación y descargas inmutables                            |

RPC: `submit_expense_report`, `decide_report_line`, `complete_report_step`,
`my_pending_expense_approvals`, `accounting_close_blockers`, `close_accounting_period`,
`create_corrective_batch`, `mark_batch_accounted`, `accounting_batch_totals`,
`register_accounting_export`, `log_export_download`. Bucket privado `accounting-exports`.

### Avisos (migración `20261029100000_avisos`)

Flujo, catálogo y reintentos en [AVISOS.md](AVISOS.md).

| Tabla                        | Propósito                                 | Claves y restricciones relevantes                                                                  |
| ---------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `notification_outbox`        | Eventos de dominio pendientes de procesar | `source_key` único; payload con ids, fechas o recuentos (≤ 1 KB); no visible a usuarios            |
| `notifications`              | Bandeja de cada persona                   | clave idempotente por evento, destinatario y canal; solo cambia `read_at`; enlace interno          |
| `notification_preferences`   | Correo de avisos opcionales               | una por persona, empresa, evento y canal; prohibido en avisos obligatorios                         |
| `email_deliveries`           | Cola de correo                            | clave idempotente; reintentos con espera; `(proveedor, id externo)` único; sin cuerpo ni dirección |
| `email_delivery_events`      | Eventos de webhook                        | `(proveedor, id del evento)` único; inmutables                                                     |
| `private.scheduled_job_runs` | Registro de tareas programadas            | fuera del API; solo recuentos y códigos                                                            |

Triggers nuevos en `absence_request_events`, `approval_steps`, `expense_reports`, `work_events` y
`schedule_events` (solo escriben en el outbox). RPC de usuario: `open_notification`,
`mark_notifications_read`, `retry_email_delivery`, `notification_support_summary`,
`recent_job_runs`; de tareas (solo service_role): `process_notification_outbox`,
`claim_email_deliveries`, `complete_email_delivery`, `record_email_event`,
`run_scheduled_reminders`, `record_job_run`.

### Informes y exportaciones (migración `20261030100000_informes`)

Diccionario, límites e índices en [INFORMES.md](INFORMES.md).

| Tabla                     | Propósito                 | Claves y restricciones relevantes                                                                                    |
| ------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `report_exports`          | Registro de exportaciones | `(company_id, requested_by, idempotency_key)` único; filtros ≤ 1 KB; solo cambia el estado; sin `delete`; ruta única |
| `report_export_downloads` | Cada descarga             | inmutable; FK compuesta `(export_id, company_id)`                                                                    |

Funciones de informe (paginadas, con periodo máximo): `report_time_daily`, `report_time_summary`,
`report_time_register`, `report_absence_balances`, `report_absence_requests`, `report_expenses`,
`report_approvals`, `report_closures`, `report_audit`. Exportaciones: `request_report_export`,
`start_report_export`, `complete_report_export`, `fail_report_export`, `log_report_download` y,
solo service_role, `expire_report_exports`. Bucket privado `report-exports`
(`<empresa>/<usuario>/<exportación>/<archivo>`).

### Seguridad y privacidad (migración `20261031100000_seguridad`)

Detalle en [SEGURIDAD.md](SEGURIDAD.md) y [PRIVACIDAD.md](PRIVACIDAD.md).

| Tabla                       | Propósito                                 | Claves y restricciones relevantes                                               |
| --------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------- |
| `support_access_grants`     | Accesos de soporte temporales             | ≤ 24 h, motivo, no a uno mismo; solo se revoca; sin borrado; auditado           |
| `legal_holds`               | Retenciones legales por empresa o persona | Categoría y motivo; solo se levanta; sin borrado; auditado                      |
| `data_subject_requests`     | Derechos de las personas                  | Idempotente; plazo de un mes; bloqueos calculados; sin borrado; estado auditado |
| `private.security_settings` | MFA obligatoria (una fila)                | Fuera de la API                                                                 |
| `private.rate_limit_hits`   | Contadores de frecuencia                  | Por persona, acción y ventana; fuera de la API                                  |
| `private.retention_runs`    | Ejecuciones de retención (recuentos)      | Fuera de la API; solo plataforma vía `recent_retention_runs`                    |

Además: los permisos de roles privilegiados exigen aal2 (`private.strong_auth`); `punches` deja de
exponer coordenadas y selfie (RPC `punch_evidence`); `open_absence_attachment` audita la apertura de
justificantes; `check_rate_limit`, `run_retention` (solo service_role), `retention_catalog`,
`place_legal_hold`, `release_legal_hold`, `submit_data_request`, `review_data_request`,
`complete_data_request`, `subject_access_package`, `grant_support_access`, `revoke_support_access`
y `support_staff`. Secuencias y privilegios por defecto sin `anon` ni `authenticated`.

### Auditoría y almacenamiento

- `audit_log`: append-only. Columnas `actor_id` (`auth.uid()`), `company_id`, `group_id`,
  `table_name`, `record_id`, `action`, `old_data`, `new_data`. Triggers impiden `UPDATE`, `DELETE`
  y `TRUNCATE`. Auditadas: `groups`, `group_admins`, `platform_admins`, `companies`,
  `work_centers`, `teams`, `company_memberships`, `role_assignments`, `employees`,
  `employment_terms`, `manager_assignments` y cambios de `profiles`. Los cambios privilegiados
  (roles, administradores, membresías, asignaciones) quedan con quién, cuándo, antes y después.
- `audit_events`: auditoría **minimizada** para consultar en la interfaz (`/auditoria`): acción
  (`create`, `update`, `deactivate`, `reactivate`, `terminate`, `publish`, `status_change`,
  `export`, `import`, `request_export`, `download`, `sensitive_read`), campos cambiados y sus valores antes y
  después, `request_id` de la petición, con nombre, apellidos, correos, teléfono, CIF, dirección,
  motivos, notas, comentarios, proveedor, coordenadas y selfies sustituidos por `[dato personal]`. Las exportaciones guardan solo número de filas y
  filtros (nunca el texto buscado).
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

| Migración                               | Reversión                                              | Datos que se pierden al revertir                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `20261021090000/090100/090200` (fase 0) | No tienen (anteriores a esta norma)                    | —                                                                                                                                                      |
| `20261022100000_modelo_multiempresa`    | Sí                                                     | grupos, administradores de grupo, centros, equipos, roles `hr`/`auditor` y roles de ámbito centro/equipo; estados `invited`/`suspended`                |
| `20261022100100_empleados`              | Sí                                                     | fichas de empleado y condiciones; asignaciones de manager de empleados sin cuenta                                                                      |
| `20261023100000_administracion`         | Sí (generada desde el texto literal de las anteriores) | suplencias, `audit_events`, fechas de baja, asignaciones por equipo o por tipo                                                                         |
| `20261024100000_calendarios_turnos`     | Sí                                                     | calendarios, festivos, plantillas, asignaciones, ausencias integradas y eventos (la auditoría se conserva siempre)                                     |
| `20261025100000_control_horario`        | Sí                                                     | todo el registro de jornada (exportar antes: obligación de 4 años); exige vaciar antes el bucket de selfies                                            |
| `20261026100000_ausencias`              | Sí                                                     | tipos, políticas, saldos, solicitudes y justificantes; exige vaciar antes el bucket de justificantes                                                   |
| `20261031100000_seguridad`              | Sí                                                     | accesos de soporte, retenciones legales, solicitudes de derechos, contadores y ejecuciones de retención; quita protecciones (MFA, soporte, evidencias) |
| `20261030100000_informes`               | Sí                                                     | registro de exportaciones y descargas, `audit_events.request_id`; exige vaciar el bucket `report-exports`; la auditoría se conserva                    |

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
   (inmutabilidad, restricciones, falsificaciones, metadatos y claims), `30_seed_sintetico` y
   `40_administracion` (aprobadores, solapes, suplencias, bajas, auditoría, importación y separación
   plataforma / empresa) y `50_horarios` (permisos por ámbito, versionado sin efecto retroactivo,
   validación de plantillas, conflictos, publicación y eventos) y `60_control_horario`
   (idempotencia, estados, medianoche, zona, ubicación, selfie, terminal, correcciones, incidencias,
   permisos) y `70_ausencias` (libro de saldos, arrastre, caducidad, cambio de política, solapes,
   decisiones, privacidad de justificantes y calendario). Después,
   `scripts/test-db-concurrency.sh` lanza dos sesiones simultáneas (misma clave, doble toque,
   aplicación y terminal a la vez, dos solicitudes sobre el mismo saldo).
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

- **Control horario**: exportación para la Inspección (sin tablas nuevas).
- **Ausencias**: plazo de conservación y borrado de justificantes. (justificantes en bucket privado `leave-attachments`).
- **Gastos**: notas de gasto (`expense_reports`), aprobación, validación por Contabilidad,
  liquidación y exportación; borrado de tickets al vencer su plazo de conservación.

Cada tabla nueva seguirá las convenciones de la sección 1, con pruebas de aislamiento y reversión.
