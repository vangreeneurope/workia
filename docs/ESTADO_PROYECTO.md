# Estado del proyecto

**Última actualización**: 2026-10-27 · **Fase actual**: 1 y 2 implementadas en local
(administración, horarios, control horario, vacaciones y ausencias) y fase 3 iniciada (captura de
gastos con OCR intercambiable). Nada se ha validado aún contra
un proyecto Supabase real ni en GitHub Actions (sin remoto): los tres trabajos del CI se han
ejecutado en local. Los módulos se han construido por petición expresa sin validar antes los
anteriores con sesión real (excepción a la regla de CLAUDE.md, registrada aquí).

## 1. Qué está hecho

### Fase 0 · Base técnica (2026-10-21)

- Next.js 16.4.2 (App Router, Cache Components), React 19.3, TypeScript estricto, Tailwind CSS 4,
  shadcn/ui (Radix), ESLint sin avisos, Prettier, Vitest, Playwright 1.56.1.
- Autenticación con Supabase (acceso, recuperación, invitación, cambio de contraseña), proxy de
  sesión, capa de acceso a datos, layout mobile-first con navegación protegida, selector de empresa
  con identidad visual, PWA, cabeceras de seguridad.

### Modelo de autorización multiempresa (2026-10-22)

- Migraciones `20261022100000_modelo_multiempresa` y `20261022100100_empleados`: `groups`,
  `group_admins`, `work_centers`, `teams`, `role_assignments`, `employees`, `employment_terms`;
  cambios en `companies` (grupo, estado), `company_memberships` (estado y vigencia) y
  `manager_assignments` (sobre empleados, con estado y vigencia).
- Roles: administración de plataforma, administrador de grupo, `company_admin`, `hr`, `manager`,
  `accounting`, `employee`, `auditor`, con ámbito (empresa, centro, equipo) y vigencia.
- Funciones seguras `current_membership_id()` y `has_permission(empresa, permiso, centro, equipo)`
  sin recursión de RLS; techo de concesión de roles; prohibición de autoconcesiones; permisos solo
  en tablas del servidor (nunca en metadatos de Auth).
- Aislamiento también frente a inferencia: claves foráneas compuestas, índices únicos por empresa,
  claves inmutables, ids generados por el servidor (ADR-018).
- Auditoría de cambios privilegiados con actor, empresa y grupo.
- Reversión documentada y verificada de cada migración nueva (`supabase/rollbacks/`).
- Semillas sintéticas solo locales (`supabase/seeds/`).
- Tipos TypeScript generados desde las migraciones (`npm run db:types`) con control de divergencia.
- La aplicación lee roles de `role_assignments` aplicando vigencias (`assembleUserContext`) y
  reconoce la administración de grupo.
- CI en GitHub Actions (`.github/workflows/ci.yml`).
- Documentación: BASE_DATOS (diagrama de relaciones, reversibilidad), PERMISOS (matrices por tabla
  y rol), ADR-017 a ADR-022, README y CLAUDE.md.

### Módulo de administración (2026-10-23)

- Pantallas responsive en `/admin` (listas, formularios y fichas): empresas del grupo, centros,
  equipos, personas, condiciones de empleo, cuentas y roles, aprobadores y suplencias, importación
  CSV. Cada usuario ve solo las áreas de su ámbito según sus permisos reales.
- Validación compartida cliente/servidor (zod), Server Actions autorizadas con `adminAction`
  (empresa siempre del servidor), interfaz optimista solo en activar/desactivar (reversible).
- Altas, cambios con fecha de efecto (condiciones), desactivación y reactivación (empresas,
  centros, equipos), bajas atómicas con fecha efectiva y reactivación. Ningún borrado.
- Aprobadores por persona o equipo y tipo de solicitud, sin ambigüedad por construcción, con
  errores accionables; suplencias temporales con motivo y auditoría.
- Importación CSV con previsualización, mapeo de columnas, validación por fila y confirmación de
  todo o nada.
- Búsqueda (sin datos personales en la URL), filtros, paginación en servidor y exportación CSV
  auditada y protegida contra inyección de fórmulas.
- `audit_events` con antes/después minimizados; separación entre administración de plataforma y de
  empresa.
- Migración `20261023100000_administracion` con reversión verificada; reglas documentadas en
  `docs/VIGENCIA_Y_BAJAS.md`; ADR-023 a ADR-029.

### Calendarios, plantillas de turno y asignaciones (2026-10-24)

- Migración `20261024100000_calendarios_turnos` con reversión verificada: calendarios laborales con
  fuente obligatoria, festivos, aplicación a centros con vigencia, plantillas con versiones
  inmutables, tramos en minutos enteros (continua, partida, nocturna con cruce de medianoche y
  flexible, pausas retribuidas o no, tolerancias, horas objetivo), asignaciones por excepción,
  persona, equipo o contrato con ciclos de 1 a 56 días, ausencias aprobadas como punto de
  integración y eventos de aviso por persona.
- Nada con efecto en el pasado: versiones, asignaciones, festivos y calendarios solo cambian desde
  hoy (zona de la empresa) y lo publicado es inmutable.
- Conflictos explicados antes de publicar (solapes y plantillas sin versión bloquean; ausencias,
  bajas y falta de contrato exigen confirmación); se registra quién publica y se crea un evento por
  persona afectada.
- Resolvedor determinista `resolvePlannedShift(employeeId, localDate, foto)` con precedencia
  excepción › festivo › persona › equipo › contrato y conversión de zona horaria con reglas
  explícitas para el cambio de hora (`getPlannedShift` lo usa con los datos visibles por RLS).
- Pantallas: "Horario" (semana y mes, móvil y escritorio, selector de persona para managers y
  RR. HH., cambios recientes) y en Administración: plantillas (editor con validación en vivo y
  publicación con fecha de efecto), asignaciones (borrador, conflictos, publicación, cierre) y
  calendarios (festivos, importación de todo o nada, centros).
- Zonas horarias de empresas y centros validadas en la base de datos.
- Documentación: docs/HORARIOS.md, ADR-030 a ADR-034, BASE_DATOS, PERMISOS, plan y README.

### Control horario (2026-10-25)

- Migración `20261025100000_control_horario` con reversión verificada: fichajes inmutables con
  hora del servidor, hora declarada, origen, zona, dispositivo seudónimo y clave idempotente;
  jornadas recalculadas en la misma transacción; solicitudes de corrección y ajustes con antes,
  después, motivo y autores; incidencias automáticas (tolerancia, fuera de horario, olvido, jornada
  abierta, solape, ubicación no disponible, hora del dispositivo distinta); políticas de ubicación y
  selfie; terminales con token; PIN con bcrypt y límites de intentos; eventos de trabajo.
- Máquina de estados en base de datos y en la interfaz; bloqueo por persona para fichajes
  simultáneos; jornada olvidada cerrada como incompleta sin inventar la salida.
- Pantallas: fichaje móvil y escritorio con aviso previo a la ubicación, selfie opcional y cola sin
  conexión; terminal `/terminal` con código y PIN que se limpia sola; historial con solicitud de
  correcciones; revisión de correcciones e incidencias; administración de políticas, terminales y
  PIN; PIN propio en el perfil.
- Decisiones de la responsable del proyecto: terminal por token de dispositivo y selfies 30 días.
- Documentación: docs/CONTROL_HORARIO.md, ADR-035 a ADR-038, BASE_DATOS, PERMISOS, NORMATIVA,
  ARQUITECTURA, PRD, plan y README.

### Vacaciones y ausencias (2026-10-26)

- Migración `20261026100000_ausencias` con reversión verificada: tipos configurables (sin catálogo
  legal en el código), políticas versionadas (derecho, devengo, prorrateo, redondeo, arrastre,
  caducidad, unidad, negativo autorizado), asignaciones persona › equipo › centro › empresa, saldo
  como libro de movimientos inmutable, solicitudes por días, medios días u horas con validación de
  contrato, política, saldo, solapes, festivos y turno, y reserva bajo bloqueo.
- Aprobación con el manager vigente o su suplente, escalado a RR. HH. sin aprobador o con
  autoaprobación, reglas expresas de aprobación automática; aprobar, rechazar con motivo, pedir
  información, cancelar y retirar.
- Justificantes en bucket separado con acceso de RR. HH. por permiso específico; calendario con
  privacidad (compañeros: "Ausente"); integración con horarios (`leave_periods`).
- Pantallas: saldo, solicitud con cálculo previo, mis solicitudes, calendario, bandeja de
  aprobación y administración de tipos, políticas, versiones, asignaciones y ajustes.
- Documentación: docs/AUSENCIAS.md, ADR-039 a ADR-041, BASE_DATOS, PERMISOS, NORMATIVA, PRD, plan
  y README.

### Tema visual verde salvia (2026-10-26)

- Tokens de `globals.css` con neutros de tinte verde, radios amplios, sombra suave y degradado de
  fondo; tarjetas con degradado leve, insignias en píldora y barra lateral oscura en degradado.
- Color corporativo por defecto `#4a7a5f` en código y en el formulario de empresa. Las empresas ya
  creadas conservan el que tengan en la base de datos (por defecto de la columna: `#1f2937`); se
  cambia desde Administración, sin migración.
- Ausencias: anillo de progreso por saldo y barras de uso mensual (`src/components/charts`), sin
  librerías, con el dato también en texto y tabla para lectores de pantalla.

### Gastos: captura y OCR (2026-10-27)

- Migración `20261027100000_gastos` con reversión verificada: `expense_policies`,
  `expense_categories`, `expenses`, `expense_receipts`, `jobs`, `ocr_runs`, `expense_events`;
  bucket privado `expense-receipts` con políticas de Storage; permisos de gastos (ADR-042).
- Captura móvil con cámara o archivo, vista previa y reducción legible en el navegador; validación
  en servidor (extensión, firma, MIME, tamaño, dimensiones, PDF sin contenido activo), metadatos
  eliminados, SHA-256 y duplicados exactos (ADR-044).
- `OcrProvider` con proveedor falso determinista (solo fuera de producción) y normalización común;
  **sin proveedor real** (ADR-043). Cola idempotente, estados `pending`, `processing`,
  `succeeded`, `needs_review`, `failed`, 3 intentos con espera y 2 reintentos manuales.
- Revisión con campos de baja confianza resaltados y comprobación obligatoria; reglas de la
  política (fechas, importes, moneda, obligatorios, desviaciones), similitud que pide confirmación,
  kilometraje, corrección sin tocar el ticket original. Administración de política y categorías.
- Límite de Server Actions subido a 11 MB (antes, 1 MB por defecto: afectaba también a
  justificantes y selfies de más de 1 MB).

## 2. Resultados de verificación (2026-10-27)

| Verificación               | Comando                                           | Resultado                                                                                                  |
| -------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Tipos                      | `npm run typecheck`                               | Sin errores                                                                                                |
| Lint                       | `npm run lint`                                    | 0 errores, 0 avisos                                                                                        |
| Formato                    | `npm run format:check`                            | Correcto                                                                                                   |
| Unitarias                  | `npm test`                                        | 19 archivos, 214 pruebas superadas (33 de gastos: archivos maliciosos, OCR caído, reintento, móvil)        |
| Aislamiento multiempresa   | `npm run test:db` → `10_aislamiento_multiempresa` | 134 aserciones superadas                                                                                   |
| Integridad y escalada      | `npm run test:db` → `20_integridad_y_escalada`    | 26 aserciones superadas                                                                                    |
| Semillas sintéticas        | `npm run test:db` → `30_seed_sintetico`           | 23 aserciones superadas                                                                                    |
| Administración             | `npm run test:db` → `40_administracion`           | 81 aserciones superadas                                                                                    |
| Horarios                   | `npm run test:db` → `50_horarios`                 | 101 aserciones superadas                                                                                   |
| Control horario            | `npm run test:db` → `60_control_horario`          | 115 aserciones superadas                                                                                   |
| Ausencias                  | `npm run test:db` → `70_ausencias`                | 81 aserciones superadas                                                                                    |
| Gastos                     | `npm run test:db` → `80_gastos`                   | 81 aserciones superadas                                                                                    |
| Concurrencia               | `npm run test:db` → `test-db-concurrency.sh`      | 6 escenarios con dos sesiones simultáneas (mismo saldo, mismo ticket, mismo trabajo de OCR)                |
| Reversibilidad             | `npm run test:db`                                 | 7 reversiones restauran el esquema exacto, reaplicar lo reproduce, 7 exigen autorización para perder datos |
| Tipos frente a esquema     | `npm run db:types:check`                          | Al día (incluye las funciones RPC)                                                                         |
| Build de producción        | `npm run build`                                   | Correcto (incluye /gastos, /gastos/nuevo, /gastos/[id], /gastos/ticket/[id] y /admin/gastos)               |
| E2E                        | `npm run test:e2e`                                | 34 pruebas superadas (móvil y escritorio)                                                                  |
| Dependencias de producción | `npm audit --omit=dev`                            | 0 vulnerabilidades                                                                                         |

**CI**: los pasos de los tres trabajos de `.github/workflows/ci.yml` se han ejecutado en local
(calidad; base de datos con PostgreSQL desechable; build y E2E con las variables de marcador del CI).
`npm audit` completo avisa de 5 vulnerabilidades altas en `braces`, dentro de las herramientas de
lint (no en producción); la corrección automática rebajaría `eslint-config-next` a la versión 14 y
no se ha aplicado. No se ha podido ejecutar en GitHub Actions porque el repositorio no tiene remoto.

Comprobaciones adicionales: revisión visual a 360 px y en escritorio del panel de fichaje y del
terminal, y antes del calendario y el editor de plantillas, con páginas temporales ya eliminadas
(sin desbordamiento horizontal). Esa revisión detectó y corrigió una clave del terminal generada
durante el renderizado. En ausencias, revisión visual a 360 px del formulario de solicitud y la
bandeja; las pruebas detectaron que React restablecía la clave de idempotencia de un campo oculto
en los reintentos (corregido guardándola en memoria).

**Lo que no se ha podido verificar**: las pantallas de administración, horarios, fichaje,
ausencias y gastos con una sesión y datos reales, la subida real de tickets a Storage y la cámara
del móvil al fotografiar tickets, la subida real de selfies a Storage, la geolocalización y la cámara en
dispositivos físicos
(requiere un proyecto Supabase), la invitación por correo (requiere `SUPABASE_SECRET_KEY` y Auth
real) y la ejecución del workflow de CI en GitHub (el repositorio no tiene remoto). La lógica de
cada operación está cubierta por las pruebas SQL contra PostgreSQL 16 con la emulación de Supabase.

## 3. Bloqueantes y riesgos

1. **Sin repositorio remoto en GitHub**: CI no se puede ejecutar y el trabajo solo está en git local
   dentro de un contenedor temporal.
2. **Sin proyecto Supabase**: falta aplicar las migraciones y probar las pantallas con sesión real.
3. **Invitaciones**: necesitan `SUPABASE_SECRET_KEY` en el servidor y SMTP configurado.
4. **Cambio de centro o equipo con fecha futura**: no se programa todavía (ADR-029).
5. **Dos auditorías** (`audit_log` completa y `audit_events` minimizada): fijar con la asesoría el
   plazo de conservación de `audit_log` (ADR-026).
6. **Horarios**: el equipo de una asignación por equipo es el actual de la persona; cambiar un
   festivo no genera avisos todavía; `leave_periods` no tiene aún quien la rellene (módulo de
   ausencias); el manager solo consulta horarios (ADR-030). Los festivos reales deben registrarse
   desde una fuente aprobada por la empresa.
7. **Control horario**: falta programar `generate_time_reminders` (cada 15 min) y el borrado de
   selfies caducadas con la API de Storage; no hay adaptador de correo para los eventos de
   trabajo; falta la exportación para la Inspección; validar con la asesoría el plazo de selfies y,
   con el DPD, la activación de la ubicación en cada empresa.
8. **Ausencias**: programar `settle_vacation_balances` (diaria); definir con la asesoría el plazo
   de conservación de justificantes y los valores reales de tipos y políticas de cada empresa; un
   cambio de contrato a mitad de periodo no reprorratea el saldo abierto (se regulariza con un
   ajuste).
9. **Gastos**: no hay proveedor de OCR (decisión pendiente, ADR-043); sin trabajador programado
   para la cola; falta el flujo de aprobación, validación por Contabilidad, liquidación y
   exportación; plazo de conservación de tickets con la asesoría; clientes, proyectos y centros de
   coste son texto libre.
10. Riesgos heredados: CSP con `'unsafe-inline'`, componentes shadcn escritos a mano,
    vulnerabilidades en herramientas de lint, revisión normativa pendiente.

## 4. Próximos pasos

1. Subir el repositorio a GitHub y comprobar CI.
2. Proyecto Supabase de pruebas: `supabase db push`, configurar `SUPABASE_SECRET_KEY` y SMTP, probar
   el módulo con las cuentas sintéticas y añadir E2E con sesión.
3. Probar el horario con las semillas sintéticas (`supabase db reset`) y sesión real.
4. Tareas programadas del control horario, exportación para la Inspección y visor de auditoría
   (resto de la fase 1); reglas de clasificación de excesos de jornada aprobadas por la asesoría.
5. Gastos: decidir el proveedor de OCR (o trabajar sin OCR) y, después, notas de gasto, aprobación,
   validación por Contabilidad y exportación contable (resto de la fase 3).
