# Trazabilidad de requisitos (auditoría QA previa al piloto)

**Fecha**: 2026-10-23 · **Commit auditado**: rama `qa/auditoria-piloto` · Informe: [QA_REPORT.md](QA_REPORT.md)

Cada requisito enlaza con la prueba que lo verifica y con la evidencia de la última ejecución
(`docs/qa/evidencias/`). Resultados posibles:

- **Superado**: se ejecutó en esta auditoría y pasó.
- **Superado (parcial)**: se ejecutó, pero no cubre todo el requisito; la parte pendiente se indica.
- **No ejecutado**: no se pudo ejecutar; se indica el motivo.
- **Bloqueado**: depende de una decisión o de un recurso externo.

Las pruebas SQL corren sobre PostgreSQL 16 con una emulación mínima de Supabase
(`supabase/tests/00_shim_supabase.sql`). Las E2E corren contra PostgREST real con una pasarela que
simula Auth y Storage (ADR-061).

Abreviaturas de evidencia: **DB** = `05-test-db.log`, **ISO** = `07-aislamiento.log`,
**UNIT** = `02-check.log`, **E2E** = `10-e2e.log`.

## 1. Aislamiento multiempresa y permisos

| ID   | Requisito                                                                          | Prueba                                                                                         | Resultado                                                                                           | Evidencia     |
| ---- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------- |
| I-01 | Ninguna fila de otra empresa es legible (todas las tablas)                         | `supabase/tests/qa/barrido_aislamiento.sql`: 9 perfiles × 68 tablas con `company_id` + Storage | Superado (612 comprobaciones; solo registros propios del usuario con membresía caducada, ver QA-07) | ISO           |
| I-02 | Ninguna función que salta RLS devuelve o modifica datos de otra empresa            | `qa/fuzz_funciones.sql`: 87 funciones, 3.794 llamadas, huella de datos y control positivo      | Superado                                                                                            | ISO           |
| I-03 | Ninguna escritura directa por la API sobre filas de otra empresa                   | `qa/fuzz_escrituras.sql`: 822 intentos de UPDATE/INSERT, control positivo                      | Superado                                                                                            | ISO           |
| I-04 | Archivos de otra empresa: ni leer, ni crear, ni sobrescribir, ni borrar            | `qa/fuzz_storage.sql` (6 buckets × 5 perfiles) y barrido de `storage.objects`                  | Superado                                                                                            | ISO           |
| I-05 | Pruebas positivas y negativas por tabla (otra empresa, caducada, futura, revocada) | `10_aislamiento_multiempresa` y suites de dominio 40-98                                        | Superado                                                                                            | DB            |
| I-06 | Los arneses detectan una fuga real (no dan falsos negativos)                       | Política permisiva inyectada: el barrido falla (ensayo manual documentado en el informe)       | Superado                                                                                            | QA_REPORT § 4 |
| I-07 | Membresía caducada sin acceso                                                      | Barrido (perfil EXP), suites de dominio con `u(14)`                                            | Superado                                                                                            | ISO, DB       |
| I-08 | Manager fuera de vigencia sin acceso                                               | `10`, `40`, `70`, `96` con `u(17)`                                                             | Superado                                                                                            | DB            |
| I-09 | Rol con vigencia futura o revocado sin permisos                                    | `10`, dominios con `u(19)`/`u(20)`; barrido (RREV)                                             | Superado                                                                                            | DB, ISO       |
| I-10 | Suplencias temporales con motivo y auditoría                                       | `40_administracion`, `90_liquidacion`                                                          | Superado                                                                                            | DB            |
| I-11 | Nadie aprueba lo suyo ni se concede permisos                                       | `10`, `40`, `70`, `90`, `98` (autoaprobación y autoconcesión)                                  | Superado                                                                                            | DB            |
| I-12 | Cambio de empresa: cookie manipulada con empresa ajena se ignora                   | `tests/unit/permissions.test.ts`, `context.test.ts`                                            | Superado                                                                                            | UNIT          |
| I-13 | Exportaciones y descargas solo con permiso, URL firmada de 60 s                    | `navegacion-protegida.spec.ts`, rutas revisadas a mano (QA_REPORT § 5)                         | Superado                                                                                            | E2E           |
| I-14 | MFA por rol (aal2) para administración, RR. HH., contabilidad, auditoría           | `98_privacidad`, `tests/e2e/seguridad.spec.ts`, login E2E con TOTP                             | Superado                                                                                            | DB, E2E       |
| I-15 | Supervisión solo dentro de la propia empresa                                       | —                                                                                              | **Bloqueado** (QA-06: el diseño permite supervisar a otra empresa del grupo, ADR-004)               | —             |
| I-16 | Catálogo: RLS en todo, sin anon, sin DELETE, `search_path` fijo                    | `97_seguridad_catalogo` (24) y `tests/unit/security-static.test.ts`                            | Superado                                                                                            | DB, UNIT      |

## 2. Funcional por dominio

| ID   | Requisito                                                              | Prueba                                                                           | Resultado                                              | Evidencia     |
| ---- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------- |
| F-01 | Organización: empresas, centros, equipos, personas, bajas, importación | `40_administracion` (81), `admin-flows.test.tsx`, auditoría de vistas            | Superado                                               | DB, UNIT, E2E |
| F-02 | Turnos y calendarios: precedencia, festivos, noche, cambio de hora     | `50_horarios` (101), `schedule-resolver.test.ts`, `zoned-time.test.ts`           | Superado                                               | DB, UNIT      |
| F-03 | Fichaje móvil, web y terminal con PIN; inmutable; correcciones         | `60_control_horario` (115), `flujos.spec.ts`, `punch-ui.test.tsx`                | Superado                                               | DB, E2E       |
| F-04 | Ubicación puntual opcional con aviso previo, nunca seguimiento         | `60_control_horario`, `flujos.spec.ts`, revisión de código (sin `watchPosition`) | Superado (parcial: GPS de dispositivo real no probado) | DB, E2E       |
| F-05 | Selfie opcional sin biometría, 30 días                                 | `60`, `98`, revisión de dependencias (sin librerías biométricas)                 | Superado (parcial: cámara real no probada)             | DB            |
| F-06 | Vacaciones y ausencias: saldos, reservas, aprobación, justificantes    | `70_ausencias` (84), `absences.test.tsx`, `flujos.spec.ts`                       | Superado                                               | DB, UNIT, E2E |
| F-07 | Gastos con OCR intercambiable, revisión, duplicados                    | `80_gastos` (81), `expenses.test.tsx`, `flujos.spec.ts` (kilometraje)            | Superado (parcial: sin proveedor de OCR real, QA-12)   | DB, UNIT, E2E |
| F-08 | Aprobación por pasos y liquidación mensual, lotes y correctivos        | `90_liquidacion` (76), `settlement.test.ts`                                      | Superado (parcial: cierre por interfaz sin E2E, QA-13) | DB, UNIT      |
| F-09 | Avisos: outbox, bandeja, correo idempotente, reintentos                | `95_avisos` (53), `notifications.test.ts`                                        | Superado (parcial: sin proveedor de correo real)       | DB, UNIT      |
| F-10 | Informes y exportaciones equivalentes a RLS                            | `96_informes` (75), `reports.test.ts`                                            | Superado                                               | DB, UNIT      |
| F-11 | Auditoría consultable y no modificable                                 | `96`, `20_integridad_y_escalada`, `97`                                           | Superado                                               | DB            |

## 3. Concurrencia e idempotencia

| ID   | Requisito                                     | Prueba (`scripts/test-db-concurrency.sh`)                    | Resultado | Evidencia |
| ---- | --------------------------------------------- | ------------------------------------------------------------ | --------- | --------- |
| C-01 | Doble fichaje (misma clave y doble toque)     | Escenarios 1 y 2; app y terminal a la vez (3)                | Superado  | DB        |
| C-02 | Doble envío de una solicitud                  | Escenario nuevo «misma clave a la vez» (auditoría QA)        | Superado  | DB        |
| C-03 | Dos solicitudes sobre el mismo saldo          | Escenario 4                                                  | Superado  | DB        |
| C-04 | Doble OCR                                     | Escenarios 5 y 6                                             | Superado  | DB        |
| C-05 | Doble decisión                                | Escenario nuevo «aprobar y rechazar a la vez» (auditoría QA) | Superado  | DB        |
| C-06 | Doble cierre                                  | Escenario 7 (misma clave y clave distinta)                   | Superado  | DB        |
| C-07 | Dos trabajadores de avisos                    | Escenario 8                                                  | Superado  | DB        |
| C-08 | Reintento tras respuesta perdida sin duplicar | `flujos.spec.ts` (fichaje y solicitud)                       | Superado  | E2E       |

## 4. Cálculos y conciliación

| ID   | Requisito                                                              | Prueba                                                                     | Resultado | Evidencia     |
| ---- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------- | ------------- |
| K-01 | Jornada y pausas; jornada nocturna; cambio de hora                     | `60_control_horario` (9 h reales en el cambio de octubre), `dates.test.ts` | Superado  | DB, UNIT      |
| K-02 | Saldos de vacaciones (reserva, uso, liberación, prorrateo)             | `70_ausencias`, escenario de concurrencia                                  | Superado  | DB            |
| K-03 | Base + impuestos = total (tolerancia 1 céntimo)                        | Restricción en `confirm_expense` y esquema zod; `80_gastos`                | Superado  | DB, UNIT      |
| K-04 | Totales del lote por moneda = suma por cada dimensión                  | `qa/conciliacion.sql`                                                      | Superado  | ISO           |
| K-05 | Línea del lote = gasto de origen; lote = suma de gastos                | `qa/conciliacion.sql`                                                      | Superado  | ISO           |
| K-06 | Informe de gastos = gastos visibles                                    | `qa/conciliacion.sql`                                                      | Superado  | ISO           |
| K-07 | PDF, CSV y XLSX cuadran con los totales de la base y son deterministas | `settlement.test.ts` (no genera si no cuadra; huellas fijadas)             | Superado  | UNIT          |
| K-08 | Totales nunca mezclan monedas                                          | Revisión de código (`sumByCurrency`, totales por divisa)                   | Superado  | QA_REPORT § 5 |

## 5. Archivos

| ID   | Requisito                                                       | Prueba                                                      | Resultado                                                                   | Evidencia |
| ---- | --------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- | --------- |
| A-01 | MIME falso y extensión que no coincide                          | `expenses.test.tsx`, `security.test.ts`                     | Superado                                                                    | UNIT      |
| A-02 | Tamaño máximo y archivo vacío                                   | `checkReceiptFile` + límites de bucket                      | Superado                                                                    | UNIT      |
| A-03 | PDF con contenido activo (también escapado u oculto en ObjStm)  | `security.test.ts` (regresión QA-01)                        | Superado tras corrección                                                    | UNIT      |
| A-04 | Malware simulado (EICAR)                                        | `security.test.ts`: rechazado si no es un PDF/imagen válido | Superado (parcial: dentro de un PDF válido se acepta; sin antivirus, QA-08) | UNIT      |
| A-05 | Ticket duplicado                                                | `80_gastos`, concurrencia 5, `expenses.test.tsx`            | Superado (parcial: eludible llamando a la API directamente, QA-04)          | DB, UNIT  |
| A-06 | Acceso ajeno a archivos                                         | `qa/fuzz_storage.sql`, barrido                              | Superado                                                                    | ISO       |
| A-07 | Caducidad de URL firmada (60 s) y de exportaciones (7 días)     | Rutas revisadas; `96_informes` (`expire_report_exports`)    | Superado                                                                    | DB        |
| A-08 | Eliminación según retención (simulación reversible)             | `98_privacidad`                                             | Superado                                                                    | DB        |
| A-09 | Metadatos eliminados y datos tras el fin de imagen              | `absences.test.tsx`, `security.test.ts` (regresión QA-02)   | Superado tras corrección                                                    | UNIT      |
| A-10 | Validación de contenido también para subidas directas a Storage | —                                                           | **Abierto** (QA-05)                                                         | —         |

## 6. Fallos y recuperación

| ID   | Requisito                                                    | Prueba                                                  | Resultado                                                  | Evidencia |
| ---- | ------------------------------------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------- | --------- |
| R-01 | Red: error visible, sin falso éxito, reintento sin duplicar  | `ux.test.tsx`, `flujos.spec.ts`                         | Superado                                                   | UNIT, E2E |
| R-02 | OCR caído: el gasto se completa a mano y se puede reintentar | `expenses.test.tsx`, `80_gastos`, runbook               | Superado                                                   | UNIT, DB  |
| R-03 | Correo caído: la bandeja sigue funcionando; reintentos       | `95_avisos`, `notifications.test.ts`                    | Superado                                                   | DB, UNIT  |
| R-04 | Cola: trabajos bloqueados recuperables                       | `80_gastos` (reclamo tras 5 min), métricas `jobs.stuck` | Superado (parcial: sin trabajador en segundo plano, QA-10) | DB        |
| R-05 | Storage caído: errores visibles y reintento                  | Revisión de código y runbook                            | No ejecutado (requiere Storage real)                       | —         |

## 7. Privacidad

| ID   | Requisito                                                    | Prueba                                                             | Resultado                                                      | Evidencia |
| ---- | ------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------- | --------- |
| P-01 | Registros sin datos personales ni secretos                   | `security.test.ts` (redacción), `observabilidad.test.ts`, revisión | Superado                                                       | UNIT      |
| P-02 | Sin datos personales en URLs                                 | `security-static.test.ts`, revisión (sin búsquedas por URL)        | Superado                                                       | UNIT      |
| P-03 | Evidencias de fichaje y justificantes con lectura auditada   | `60`, `70`, `98`                                                   | Superado                                                       | DB        |
| P-04 | Acceso de soporte acotado (≤ 24 h), concedido por la empresa | `98_privacidad`                                                    | Superado                                                       | DB        |
| P-05 | Derechos de las personas con revisión humana                 | `98_privacidad`                                                    | Superado                                                       | DB        |
| P-06 | Plazos de conservación y bases jurídicas validados           | —                                                                  | **Bloqueado** (decisiones legales, docs/PENDIENTES_LEGALES.md) | —         |

## 8. Accesibilidad, UX y rendimiento

| ID   | Requisito                                                   | Prueba                                              | Resultado                                           | Evidencia |
| ---- | ----------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------- | --------- |
| U-01 | Sin desbordamientos ni controles recortados en 360-1440 px  | `auditoria-vistas.spec.ts` (62 rutas × 5 tamaños)   | Superado                                            | E2E       |
| U-02 | Objetivos táctiles de 44 px; un `h1` y un `main` por página | `auditoria-vistas.spec.ts`                          | Superado                                            | E2E       |
| U-03 | axe-core WCAG 2.2 A/AA sin infracciones graves ni críticas  | `auditoria-vistas.spec.ts`                          | Superado                                            | E2E       |
| U-04 | Flujos críticos con teclado en móvil                        | `flujos.spec.ts`                                    | Superado                                            | E2E       |
| U-05 | Lector de pantalla real (VoiceOver, TalkBack)               | —                                                   | No ejecutado (sin dispositivos)                     | —         |
| U-06 | Safari iOS real                                             | —                                                   | No ejecutado (WebKit no disponible; solo emulación) | —         |
| U-07 | Presupuestos de rendimiento por ruta                        | `rendimiento.spec.ts`; `99_rendimiento` (consultas) | Superado                                            | E2E, DB   |

## 9. Operación

| ID   | Requisito                                     | Prueba                                                    | Resultado                                                  | Evidencia                |
| ---- | --------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- | ------------------------ |
| O-01 | Instalación reproducible                      | `npm ci` con lockfile                                     | Superado                                                   | `01-npm-ci.log`          |
| O-02 | Migraciones válidas, inmutables y reversibles | `db:check-migrations`, `test:db` (12 reversiones exactas) | Superado                                                   | `04-migraciones.log`, DB |
| O-03 | Tipos de base de datos al día                 | `db:types:check`                                          | Superado                                                   | `06-db-types.log`        |
| O-04 | Secretos y dependencias                       | `npm run security`                                        | Superado                                                   | `03-security.log`        |
| O-05 | Build de producción                           | `npm run build`                                           | Superado                                                   | `09-build.log`           |
| O-06 | Copia y restauración (ensayo local)           | `ops:prueba-restauracion`                                 | Superado                                                   | `08-restauracion.log`    |
| O-07 | Restauración en Supabase y copia de Storage   | —                                                         | **Bloqueado** (sin proyecto ni decisión de copia)          | —                        |
| O-08 | CI en GitHub con check requerido              | —                                                         | No ejecutado (los workflows no se han ejecutado en GitHub) | —                        |
| O-09 | Salud y versión sin secretos                  | `salud.spec.ts`                                           | Superado                                                   | E2E                      |
| O-10 | Alertas con dueño y runbook                   | `observabilidad.test.ts`                                  | Superado (parcial: dueños sin persona asignada)            | UNIT                     |
