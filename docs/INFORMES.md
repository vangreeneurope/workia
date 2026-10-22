# Informes, exportaciones y auditoría

Paneles, informes, exportaciones y consulta de auditoría (migración `20261030100000_informes`).
Probado en `supabase/tests/96_informes.test.sql` (ámbito por rol, equivalencia con RLS,
conciliación, exportaciones), `supabase/tests/99_rendimiento.test.sql` (volumen sintético e
índices), `tests/unit/reports.test.ts` y la E2E de rutas protegidas.

## 1. Principios

- **La base de datos calcula y filtra.** Cada informe es una función SQL que suma, cuenta y pagina
  en el servidor. El navegador solo recibe una página de resultados (50 filas en pantalla) y nunca
  agrega datos sensibles.
- **Ámbito idéntico al de RLS.** Cada persona ve en un informe exactamente lo que las políticas RLS
  de las tablas base le dejan ver: la propia persona, su manager vigente, RR. HH. en su ámbito,
  contabilidad en gastos y auditoría en lectura. `96_informes` lo comprueba para 12 perfiles y dos
  empresas, comparando cada informe con una consulta directa bajo RLS (ADR-050).
- **Ninguna métrica revela otra empresa.** Con otra empresa o con la membresía caducada, todos los
  informes devuelven cero filas y recuentos a cero (también el total de filas de la paginación).
- **Límites fijos.** Periodo máximo de 92 días en jornada y ausencias y de 366 días en gastos,
  aprobaciones, cierres y auditoría. Máximo 500 filas por llamada y desplazamiento máximo de 100 000.
  Lo comprueba la base de datos aunque la aplicación ya lo haga.
- **Sin datos médicos, documentos ni ubicación.** Ningún informe ni exportación incluye
  justificantes, tickets, selfies, coordenadas, motivos libres, notas ni proveedores. Los tipos de
  ausencia reservados (por ejemplo, de salud) aparecen como «Ausencia (reservada)».

## 2. Diccionario de informes

Horas siempre en **h:mm** a partir de segundos enteros (nunca horas decimales). Fechas y horas en
pantalla en la zona de la jornada (registro horario) o de Madrid. Importes en céntimos enteros, por
moneda y sin convertir.

### Jornada diaria (`report_time_daily`, `/informes/jornada-diaria`)

Una fila por jornada (`time_entries`) del periodo.

| Columna               | Cálculo                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------- |
| Día, Estado           | `work_date` y estado de la jornada (abierta, en pausa, cerrada, incompleta)               |
| Inicio, Fin           | `started_at`, `ended_at` (primer y último fichaje efectivo, ya con correcciones)          |
| Trabajo, Pausas       | `worked_seconds`, `break_seconds` recalculados por la base de datos al fichar o corregir  |
| Plan                  | Estado del turno planificado ese día (`private.planned_shift`): turno, descanso, festivo… |
| Presencia planificada | Del inicio del primer tramo al fin del último del turno publicado (pausas incluidas)      |
| Diferencia            | (Trabajo + Pausas) − Presencia planificada. Positiva = más presencia de la planificada    |
| Ajustes               | Número de correcciones aprobadas (`time_adjustments`) de la jornada                       |
| Incidencias abiertas  | `time_incidents` en estado abierto                                                        |

Los días planificados sin ninguna jornada no aparecen aquí: los detecta control horario como
incidencia («entrada sin fichar»).

### Horas y descansos (`report_time_summary`, `/informes/horas-y-descansos`)

Una fila por persona: jornadas, suma de trabajo, suma de pausas, jornadas incompletas y número de
ajustes del periodo. **Reconciliación**: la suma de la columna Trabajo es la suma de
`worked_seconds` de las jornadas base visibles (probado).

### Registro horario (`report_time_register`, `/informes/registro-horario`)

Registro diario de jornada para consulta e inspección (art. 34.9 ET). Por jornada:

- zona horaria, inicio, fin, trabajo y pausas;
- **fichajes**: hora oficial del servidor, tipo (entrada, inicio o fin de pausa, salida) y origen
  (móvil, web, terminal). No incluye ubicación, selfie ni dispositivo;
- **ajustes** con su trazabilidad: acción (añadir, cambiar, anular), tipo y hora efectiva, cuándo
  se aprobó, quién lo pidió y quién lo decidió (identificadores). El motivo es texto libre y no se
  exporta; está en la corrección original y en `audit_log`.

En PDF, cada celda se muestra entera (sin recortes, A4 horizontal).

### Saldos de vacaciones (`report_absence_balances`, `/informes/saldos`)

Saldo de cada persona y política en el periodo de devengo que contiene el día elegido. Se calcula
desde el libro `balance_movements` con la misma fórmula que ve la persona:

| Columna    | Movimientos                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------- |
| Derecho    | `opening` + `accrual`                                                                              |
| Arrastre   | `carryover` (neto)                                                                                 |
| Disfrutado | −(`usage` + `usage_reversal`)                                                                      |
| Reservado  | −(`reservation` + `reservation_release`)                                                           |
| Ajustes    | `adjustment`                                                                                       |
| Caducado   | −`expiry`                                                                                          |
| Disponible | Suma de todos los movimientos (= Derecho + Arrastre − Disfrutado − Reservado + Ajustes − Caducado) |

### Solicitudes de ausencia (`report_absence_requests`, `/informes/solicitudes`)

Solicitudes que se solapan con el periodo: tipo (enmascarado si es reservado), fechas, cantidad,
estado, fecha de solicitud y de decisión. Sin comentarios ni justificantes.

### Gastos (`report_expenses`, `/informes/gastos`)

Gastos **confirmados** (`status = 'ready'`, los borradores y descartados no cuentan) por fecha del
gasto, agrupados por persona, categoría, proyecto, cliente, centro de coste o mes, y siempre por
moneda. Columnas: número de gastos, base, impuestos y total (suma de céntimos; base e impuestos
solo cuando constan). Filtros adicionales: cliente (contiene) y código de proyecto. Sin proveedor,
NIF, documento ni notas. **Reconciliación**: la suma por moneda coincide con los gastos base
(probado).

### Aprobaciones (`report_approvals`, `/informes/aprobaciones`)

Por tipo (ausencias, informes de gastos, correcciones de fichaje) para lo enviado en el periodo:
pendientes, vencidas (ausencias y correcciones más de 48 h, informes más de 72 h, los mismos plazos
que los recordatorios), decididas y horas medias hasta la decisión (una décima). El panel
`/informes` muestra este informe para el mes en curso.

### Cierres contables (`report_closures`, `/informes/cierres`)

Lotes contables de los meses del periodo: número, tipo (ordinario o corrector), mes, estado, fecha
de cierre y, por moneda, número de líneas y total. Solo administración de empresa y contabilidad.

### Auditoría (`report_audit`, `/auditoria`)

Eventos de `audit_events` de la empresa: fecha, actor (nombre si se puede ver), acción, objeto,
identificador, campos cambiados con su valor anterior y nuevo (minimizados) y `request_id`. Búsqueda
por actor, objeto, acción, identificador y periodo. Solo con el permiso `audit.read`
(administración de empresa y auditoría, y administración del grupo).

### Quién ve qué

| Informe              | employee | manager       | hr (ámbito) | company_admin | accounting | auditor |
| -------------------- | -------- | ------------- | ----------- | ------------- | ---------- | ------- |
| Jornada y registro   | lo suyo  | supervisados  | su ámbito   | empresa       | —          | empresa |
| Saldos y solicitudes | lo suyo  | supervisados  | su ámbito   | empresa       | —          | empresa |
| Gastos               | lo suyo  | supervisados  | —           | empresa       | empresa    | —       |
| Aprobaciones         | lo suyo  | lo que decide | su ámbito   | empresa       | gastos     | lectura |
| Cierres              | —        | —             | —           | empresa       | empresa    | —       |
| Auditoría            | —        | —             | —           | empresa       | —          | empresa |

## 3. Filtros en la URL

Los filtros se guardan en la dirección para poder recargar o compartir la vista: `desde`, `hasta`,
`dia`, `persona`, `equipo`, `centro`, `cliente`, `proyecto`, `agrupar`, `actor`, `objeto`, `accion`,
`id`, `pagina`. Solo admiten fechas, identificadores (uuid) y códigos de negocio; **nunca nombres,
correos ni texto buscado sobre personas**. El servidor los valida uno a uno con zod
(`src/features/reports/filters.ts`): un filtro no válido se ignora y se avisa; un periodo demasiado
largo se acorta. La empresa sale siempre de la empresa activa del servidor, nunca de la URL.

Los selectores de persona, equipo, centro y actor muestran solo lo que RLS deja ver, hasta 500
opciones.

## 4. Exportaciones

```
Exportar (Server Action) ── request_report_export ──► report_exports (pending, filtros validados, request_id)
        │                                             └► audit_events: request_export
        └─ after(): con la sesión del solicitante
             start_report_export ─► páginas de 500 filas ─► CSV / XLSX / PDF ─► SHA-256
             ─► Storage report-exports/<empresa>/<usuario>/<exportación>/<archivo>
             ─► complete_report_export (ready, huella, tamaño, filas, caduca a 7 días)
Descargar ── log_report_download ─► report_export_downloads + audit_events: download
          └─ URL firmada de 60 segundos
/api/tareas «exportaciones» ── expire_report_exports ─► caducadas y huérfanas ─► borrado en Storage
```

- **Con la sesión de quien la pide**: el archivo contiene lo que esa persona ve en pantalla, ni más
  ni menos. Nunca se usa la clave de servicio para generarlo.
- **Registro**: solicitante, informe, formato, filtros validados (sin la página), `request_id`,
  estado, filas, tamaño y SHA-256; y cada descarga con quién y cuándo. Auditoría ve este registro,
  pero no los archivos. En `audit_events` se guardan los nombres de los filtros usados, no sus
  valores.
- **Privado y con caducidad**: bucket privado; solo el solicitante puede leer su archivo, solo
  mientras está `ready` y sin caducar, y siempre con URL firmada de 60 segundos. No hay enlaces
  públicos ni permanentes. A los 7 días pasa a `expired` y la tarea programada borra el archivo.
- **Límites**: como mucho 3 exportaciones en curso por persona; 50 000 filas en CSV y XLSX y 5 000
  en PDF (si se supera, la exportación falla con «Demasiadas filas» y hay que acotar). Una
  generación de más de 30 minutos se marca como fallida.
- **Idempotencia**: el formulario conserva su clave en los reintentos; pedir de nuevo con la misma
  clave devuelve la misma exportación.

### Formato de los archivos

| Formato | Contenido                                                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| CSV     | UTF-8 con BOM, `;`, CRLF. Cabeceras en minúsculas sin acentos (las de la tabla). Fórmulas neutralizadas con `'`                     |
| XLSX    | Hoja `Datos` (mismas columnas que el CSV) y hoja `Informacion` (informe, empresa, filtros, fecha de generación, exportación, filas) |
| PDF     | A4 horizontal: título, empresa, filtros, fecha UTC, filas e identificador; tabla sin recortes y paginada                            |

En CSV y XLSX cada duración va en h:mm y además en segundos (`<campo>_segundos`), cada importe con
punto decimal y además en céntimos (`<campo>_centimos`), y fechas y horas en ISO 8601 (UTC).

## 5. Auditoría (`audit_events`)

Append-only (triggers impiden `UPDATE`, `DELETE` y `TRUNCATE`). Cada evento guarda:

| Campo                    | Contenido                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `actor_id`               | `auth.uid()` de quien hizo el cambio (vacío si fue una tarea de sistema)                                                                  |
| `company_id`, `group_id` | Empresa y grupo                                                                                                                           |
| `action`                 | `create`, `update`, `deactivate`, `reactivate`, `terminate`, `publish`, `status_change`, `export`, `import`, `request_export`, `download` |
| `entity`, `entity_id`    | Tabla e identificador del objeto                                                                                                          |
| `changed_fields`         | Campos cambiados                                                                                                                          |
| `before`, `after`        | Valores mínimos, con datos personales y textos libres sustituidos por `[dato personal]`                                                   |
| `request_id`             | Cabecera `x-request-id` de la petición (la envía el servidor; formato `[A-Za-z0-9-]{8,64}`)                                               |
| `occurred_at`            | Fecha                                                                                                                                     |

Nuevos en esta migración: eventos de estado de solicitudes de ausencia, informes de gastos, lotes
contables, solicitudes de corrección y ajustes de fichaje (solo el estado, sin comentarios), y
solicitud y descarga de exportaciones. La minimización añade notas, comentarios, mensajes, motivos
de decisión, proveedor, NIF, documento, coordenadas y selfies.

`audit_events` **no sustituye a los registros técnicos**: no guarda errores, trazas, cabeceras,
direcciones IP, tokens ni secretos. El `request_id` sirve para correlacionarlo con los registros de
la plataforma de despliegue. La auditoría completa con antes y después íntegros sigue en
`audit_log` (ADR-026).

## 6. Rendimiento, índices y límites

Medido en `99_rendimiento` con PostgreSQL 16 local (contenedor de desarrollo, no Supabase):
200 personas × 60 días (12 000 jornadas y 48 000 fichajes), 6 000 gastos y 60 000 eventos de
auditoría (40 000 de la empresa A). Mejor de tres ejecuciones, con la sesión de RR. HH., de
administración o de auditoría (RLS y comprobaciones de permiso incluidas):

| Consulta                                     | Tiempo medido |
| -------------------------------------------- | ------------- |
| Jornada diaria, 31 días, página de 100       | 70–120 ms     |
| Horas y descansos, 60 días, 200 personas     | 18–36 ms      |
| Registro horario, 31 días, página de 100     | 70–124 ms     |
| Gastos por proyecto, 60 días                 | 7–10 ms       |
| Auditoría, 62 días, página de 50 (con total) | 28–32 ms      |
| Auditoría filtrada por actor                 | 9–13 ms       |

La primera versión, que dejaba a RLS filtrar fila a fila, tardaba unos 15 s en la jornada diaria y
28 s en la auditoría con el mismo volumen; de ahí ADR-050.

| Índice                                                              | Lo usa                                |
| ------------------------------------------------------------------- | ------------------------------------- |
| `time_entries (company_id, work_date)`                              | jornada, resumen y registro (periodo) |
| `punches (time_entry_id, server_at)`                                | fichajes de cada jornada de la página |
| `expenses (company_id, expense_date)` (nuevo)                       | gastos por periodo                    |
| `absence_requests (company_id, start_date)` (nuevo)                 | solicitudes por periodo               |
| `audit_events (company_id, occurred_at desc)`                       | auditoría por periodo                 |
| `audit_events (company_id, actor_id, occurred_at)` (nuevo)          | auditoría por actor                   |
| `audit_events (company_id, entity, occurred_at)` (nuevo)            | auditoría por objeto                  |
| `time_adjustments (company_id, created_at)` (nuevo)                 | resumen de ajustes                    |
| `accounting_batches (company_id, period_month)` (nuevo)             | cierres                               |
| `report_exports (requested_by, created_at)`, `(status, expires_at)` | mis exportaciones y caducidad         |

Sin N+1: cada informe es una sola llamada; los fichajes y ajustes de una página se leen con
subconsultas indexadas por jornada dentro de la misma función. Con periodos que abarcan casi toda
la tabla, el planificador elige una lectura secuencial, que es lo correcto; con años de datos, el
índice por fecha acota la lectura.

Observación: la restricción de zona horaria de `time_entries` (`is_valid_time_zone`) consulta
`pg_timezone_names` en cada inserción (≈20 ms). En uso normal es una jornada por persona y día;
para importaciones masivas habría que revisarla.

## 7. Pendiente

- Informes consolidados de grupo (varias empresas a la vez) para la administración del grupo.
- Paneles con gráficos de evolución (las cifras ya se calculan en el servidor).
- Plazo de conservación del registro de exportaciones y descargas (propuesta: el mismo que
  `audit_events`) con la asesoría.
- Probar la generación y descarga con un proyecto Supabase real (Storage, `after()` y PostgREST).
