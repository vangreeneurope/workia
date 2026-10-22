# Estado del proyecto

**Última actualización**: 2026-10-31 · **Fase actual**: 1 y 2 implementadas en local
(administración, horarios, control horario, vacaciones y ausencias) y fase 3 casi completa (gastos
con OCR intercambiable, informes, aprobación y liquidación contable; falta el proveedor de OCR) y
fase 4 casi completa (avisos, correo y tareas programadas; informes, exportaciones y auditoría
consultable; faltan el proveedor de correo, push e informes de grupo), más el endurecimiento de
seguridad y privacidad previo al piloto (fase 5, parcial). Nada se ha validado aún contra
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

### Informes, aprobación y liquidación (2026-10-28)

- Migración `20261028100000_informes_gastos` con reversión verificada: reglas de aprobación, mapeo
  contable, informes con snapshot y versiones, instancias y pasos de aprobación, lotes contables,
  líneas, exclusiones, exportaciones y su registro; bucket privado `accounting-exports`.
- Estados explícitos (`draft` → `ready` → `submitted` → `in_review` → `returned`/`approved` →
  `included_in_batch` → `accounted`) con transiciones en trigger; gastos bloqueados mientras están en
  un informe vigente.
- Aprobación por líneas (aprobar, rechazar, devolver con comentario) y pasos por reglas;
  delegación registrada; sin autoaprobación ni dos pasos por la misma persona (ADR-045, ADR-046).
- Consola contable con conciliación, pendientes y bloqueos; cierre idempotente con secuencia sin
  huecos y exclusión motivada; lote corrector; totales por empleado, categoría, cuenta, centro y
  proyecto; PDF, CSV, XLSX y ZIP deterministas con SHA-256, descargas registradas (ADR-047).
  Dependencias nuevas: `pdf-lib` 1.17.1 y `fflate` 0.8.3 (sin vulnerabilidades conocidas).

### Avisos, correo y tareas programadas (2026-10-29)

- Migración `20261029100000_avisos` con reversión verificada: outbox transaccional alimentado por
  triggers (ausencias, aprobación de gastos, fichajes, horarios), avisos, preferencias, cola de
  correo con reintentos, eventos de webhook y registro de tareas (ADR-049).
- Plantillas versionadas en español con contenido mínimo (empresa, acción, fecha, enlace) y enlace
  que exige sesión y vuelve a comprobar el permiso; bandeja con contador; preferencias solo para
  avisos no obligatorios; consola de soporte sin contenido.
- `EmailProvider` con proveedor falso (sin proveedor real); webhook con firma HMAC y
  deduplicación; rebotes con supresión; límite de 3 recordatorios por correo al día.
- Tareas programadas en `/api/tareas` con `CRON_SECRET` y clave de servicio (ADR-048):
  recordatorios por zona horaria y día laborable, avisos, correo, saldos de vacaciones y borrado de
  selfies caducadas (pendientes desde fases anteriores).

### Informes, exportaciones y auditoría (2026-10-30)

- Migración `20261030100000_informes` con reversión verificada: nueve funciones de informe
  paginadas y con periodo máximo (jornada diaria con diferencia frente al turno, horas y descansos,
  registro horario, saldos, solicitudes, gastos agrupados, aprobaciones, cierres y auditoría).
- Ámbito idéntico al de RLS evaluado una vez por persona (ADR-050), con prueba de equivalencia
  para 12 perfiles y dos empresas, y conciliación de totales con los registros base.
- Panel `/informes`, vistas por informe con filtros en la URL validados en el servidor, tablas
  adaptables a móvil y `/auditoria` con búsqueda por actor, objeto, acción, identificador y periodo.
- Exportaciones CSV, XLSX y PDF generadas con `after()` y la sesión del solicitante, en bucket
  privado con SHA-256, caducidad de 7 días, descargas registradas y URL firmada de 60 s (ADR-051);
  la tarea programada borra caducadas y huérfanas.
- `audit_events` con `request_id`, eventos de estado mínimos y minimización ampliada (ADR-052).
- Escritores XLSX y PDF extraídos a `src/lib/files/` (liquidación produce los mismos bytes: huellas
  fijadas en sus pruebas). Diccionario de informes, índices y tiempos medidos en `docs/INFORMES.md`.

### Endurecimiento de seguridad y privacidad (2026-10-31)

- Modelo de amenazas, auditoría de seguridad y riesgos residuales (docs/SEGURIDAD.md); matriz de
  datos, retención, derechos, soporte y EIPD (docs/PRIVACIDAD.md); runbooks (docs/RUNBOOKS.md);
  decisiones pendientes para legal y privacidad (docs/PENDIENTES_LEGALES.md); ADR-053 a ADR-059.
- Migración `20261031100000_seguridad` con reversión verificada:
  - MFA obligatoria para administración, RR. HH., contabilidad, auditoría y administración de grupo
    y plataforma, aplicada en las funciones de permisos (aal2), con degradación documentada.
  - Acceso de soporte de solo lectura, temporal (≤ 24 h), concedido por la empresa y auditado; la
    plataforma deja de leer perfiles de toda la base.
  - Coordenadas y selfie fuera de la API general; lectura solo por la persona, su manager y RR. HH.
    con gestión, auditada; apertura de justificantes auditada.
  - Límites de frecuencia por persona y acción; retención ejecutable en simulación y reversible;
    retenciones legales; derechos de las personas con revisión humana y bloqueos legales.
  - Secuencias y privilegios por defecto sin `anon` ni `authenticated`.
- Aplicación: cookies de sesión `httpOnly` (sin Supabase en el navegador), CSP y cabeceras
  reforzadas (COOP, CORP, `Permissions-Policy` cerrada; corregida la geolocalización bloqueada),
  `x-request-id` de extremo a extremo, registro técnico con redacción y alertas, descargas con
  comprobación de origen y frecuencia, PDF activos y metadatos PNG rechazados en justificantes,
  segundo factor (TOTP) en Mi perfil › Seguridad, Mis datos y privacidad, y la consola
  Administración › Privacidad y soporte. Paso `retencion` en `/api/tareas` (simulación por defecto).
- Escáneres: catálogo de base de datos (`97_seguridad_catalogo`), código
  (`tests/unit/security-static.test.ts`), secretos (`npm run security:secrets`) y dependencias, con
  nuevo trabajo `seguridad` en CI. Hallazgos corregidos: dos Server Actions sin identidad, lectura
  global de secuencias, coordenadas visibles para auditoría y perfiles visibles para la plataforma.

## 2. Resultados de verificación (2026-10-31)

| Verificación               | Comando                                           | Resultado                                                                                                    |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Tipos                      | `npm run typecheck`                               | Sin errores                                                                                                  |
| Lint                       | `npm run lint`                                    | 0 errores, 0 avisos                                                                                          |
| Formato                    | `npm run format:check`                            | Correcto                                                                                                     |
| Unitarias                  | `npm test`                                        | 24 archivos, 278 pruebas superadas (incluidos escáner estático, redacción de registros, subidas y MFA)       |
| Aislamiento multiempresa   | `npm run test:db` → `10_aislamiento_multiempresa` | 134 aserciones superadas                                                                                     |
| Integridad y escalada      | `npm run test:db` → `20_integridad_y_escalada`    | 26 aserciones superadas                                                                                      |
| Semillas sintéticas        | `npm run test:db` → `30_seed_sintetico`           | 24 aserciones superadas                                                                                      |
| Administración             | `npm run test:db` → `40_administracion`           | 81 aserciones superadas                                                                                      |
| Horarios                   | `npm run test:db` → `50_horarios`                 | 101 aserciones superadas                                                                                     |
| Control horario            | `npm run test:db` → `60_control_horario`          | 115 aserciones superadas                                                                                     |
| Ausencias                  | `npm run test:db` → `70_ausencias`                | 84 aserciones superadas                                                                                      |
| Gastos                     | `npm run test:db` → `80_gastos`                   | 81 aserciones superadas                                                                                      |
| Liquidación                | `npm run test:db` → `90_liquidacion`              | 76 aserciones superadas                                                                                      |
| Avisos                     | `npm run test:db` → `95_avisos`                   | 53 aserciones superadas                                                                                      |
| Informes                   | `npm run test:db` → `96_informes`                 | 75 aserciones superadas (ámbito por rol, equivalencia con RLS, conciliación, exportaciones)                  |
| Escáner de catálogo        | `npm run test:db` → `97_seguridad_catalogo`       | 24 comprobaciones sin hallazgos (RLS, privilegios, funciones, vistas, buckets, políticas)                    |
| Seguridad y privacidad     | `npm run test:db` → `98_privacidad`               | 92 aserciones (MFA, soporte, evidencias, frecuencia, retención simulada y reversible, derechos)              |
| Rendimiento                | `npm run test:db` → `99_rendimiento`              | 14 aserciones: índices usados y páginas de 7 a 120 ms con 12 000 jornadas y 60 000 eventos                   |
| Concurrencia               | `npm run test:db` → `test-db-concurrency.sh`      | 9 escenarios con dos sesiones simultáneas (saldo, ticket, OCR, cierre contable y trabajadores de avisos)     |
| Reversibilidad             | `npm run test:db`                                 | 11 reversiones restauran el esquema exacto, reaplicar lo reproduce, 11 exigen autorización para perder datos |
| Tipos frente a esquema     | `npm run db:types:check`                          | Al día (incluye las funciones RPC)                                                                           |
| Build de producción        | `npm run build`                                   | Correcto (incluye seguridad de la cuenta, privacidad y consola de privacidad)                                |
| E2E                        | `npm run test:e2e`                                | 48 pruebas superadas (móvil y escritorio; incluye cabeceras de seguridad y `x-request-id`)                   |
| Secretos                   | `npm run security:secrets`                        | Sin secretos en archivos versionados ni en el historial                                                      |
| Dependencias de producción | `npm audit --omit=dev`                            | 0 vulnerabilidades                                                                                           |

**CI**: los pasos de los cuatro trabajos de `.github/workflows/ci.yml` se han ejecutado en local
(calidad; seguridad; base de datos con PostgreSQL desechable; build y E2E con las variables de
marcador del CI). `npm audit` completo avisa de 5 vulnerabilidades altas en `braces`, dentro de las
herramientas de lint (no en producción): el aviso afecta a todas sus versiones y no hay corrección;
riesgo aceptado y documentado en docs/SEGURIDAD.md, § 9. No hay hallazgos críticos abiertos. No se ha podido ejecutar en GitHub Actions porque el repositorio no tiene remoto.

Comprobaciones adicionales: revisión visual a 360 px y en escritorio del panel de fichaje y del
terminal, y antes del calendario y el editor de plantillas, con páginas temporales ya eliminadas
(sin desbordamiento horizontal). Esa revisión detectó y corrigió una clave del terminal generada
durante el renderizado. En ausencias, revisión visual a 360 px del formulario de solicitud y la
bandeja; las pruebas detectaron que React restablecía la clave de idempotencia de un campo oculto
en los reintentos (corregido guardándola en memoria).

**Lo que no se ha podido verificar**: las pantallas de administración, horarios, fichaje,
ausencias, gastos, liquidación, informes y auditoría con una sesión y datos reales (incluida la
generación de exportaciones con `after()`, su subida a Storage y el paso de `x-request-id` por
PostgREST) (incluida la generación del paquete
contable con datos leídos por PostgREST y su subida a Storage), la subida real de tickets a Storage y la cámara
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
7. **Control horario**: la tarea programada ya ejecuta recordatorios y borrado de selfies, pero
   falta configurar el planificador en el entorno real; falta la exportación para la Inspección; validar con la asesoría el plazo de selfies y,
   con el DPD, la activación de la ubicación en cada empresa.
8. **Ausencias**: `settle_vacation_balances` va en la tarea programada (falta el planificador real); definir con la asesoría el plazo
   de conservación de justificantes y los valores reales de tipos y políticas de cada empresa; un
   cambio de contrato a mitad de periodo no reprorratea el saldo abierto (se regulariza con un
   ajuste).
9. **Gastos**: no hay proveedor de OCR (decisión pendiente, ADR-043); sin trabajador programado
   para la cola; plazo de conservación de tickets, lotes y paquetes con la asesoría; clientes,
   proyectos y centros de coste son texto libre; la exportación es genérica (sin mapeo a un ERP
   concreto); sin avisos por correo de informes pendientes o devueltos.
10. **Avisos**: sin proveedor de correo real (ADR pendiente) ni planificador configurado en un
    entorno real; sin push en la PWA; plazo de conservación de avisos por validar.
11. **Informes**: los informes de volumen son SECURITY DEFINER con el mismo predicado que RLS
    (ADR-050): cualquier cambio futuro en una política de jornadas, ausencias, gastos o auditoría
    debe reflejarse en `private.report_scope` (la prueba de equivalencia lo detecta). Sin informes
    consolidados de grupo; `after()` sin probar en el entorno real (alternativa: cola en `jobs`);
    plazo de conservación del registro de exportaciones por validar; la restricción de zona horaria
    de `time_entries` es lenta en importaciones masivas (≈20 ms por fila).
12. **Seguridad y privacidad**: MFA (TOTP) desactivado en `supabase/config.toml` local: activarlo
    en el proyecto real (si no estuviera disponible, degradación en RUNBOOKS, § 6); la retención
    está en simulación hasta validar la matriz; 20 decisiones abiertas en
    docs/PENDIENTES_LEGALES.md (plazos, EIPD, encargados, supresión); sin antivirus en subidas; CSP
    con `'unsafe-inline'` por compatibilidad con el prerenderizado parcial (ADR-055).
13. Riesgos heredados: componentes shadcn escritos a mano, vulnerabilidades en herramientas de
    lint (aceptadas), revisión normativa pendiente.

## 4. Próximos pasos

1. Subir el repositorio a GitHub y comprobar CI.
2. Proyecto Supabase de pruebas: `supabase db push`, configurar `SUPABASE_SECRET_KEY` y SMTP, probar
   el módulo con las cuentas sintéticas y añadir E2E con sesión.
3. Probar el horario con las semillas sintéticas (`supabase db reset`) y sesión real.
4. Revisar con la asesoría el registro horario exportable (`/informes/registro-horario`) como
   formato para la Inspección; reglas de clasificación de excesos de jornada aprobadas por la
   asesoría.
5. Elegir proveedor de correo (guía en docs/AVISOS.md) y configurar el planificador de `/api/tareas`.
6. Gastos: decidir el proveedor de OCR (o trabajar sin OCR) y, si se elige un ERP, su mapeo de
   importación a partir del CSV/XLSX genérico.
7. Revisar con el DPD docs/PENDIENTES_LEGALES.md y la matriz de PRIVACIDAD; después, activar la
   retención real y completar la lista de puesta en marcha (RUNBOOKS, § 8).
