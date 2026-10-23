# Privacidad: matriz de datos, retención, derechos y soporte

Complementa [NORMATIVA.md](NORMATIVA.md) (marco legal) y [SEGURIDAD.md](SEGURIDAD.md) (controles).
Las bases jurídicas y los plazos marcados **«a validar»** son propuestas técnicas: la decisión final
corresponde a la organización (DPD y asesoría laboral y fiscal). Ver
[PENDIENTES_LEGALES.md](PENDIENTES_LEGALES.md). Probado en `supabase/tests/98_privacidad.test.sql`.

## 1. Matriz de datos

Leyenda de acceso: P = la propia persona; M = su manager vigente; RH = RR. HH. en su ámbito;
AE = administración de empresa; C = contabilidad; AU = auditoría (solo lectura); S = soporte con
acceso temporal concedido. Todos los accesos de AE, RH, C y AU exigen MFA.

| Dato                                    | Finalidad                                    | Base jurídica (a validar)                                         | Acceso                                                         | Conservación (a validar)                     | Borrado / fin                                             |
| --------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------- |
| Borradores de formularios (dispositivo) | No perder lo escrito si la sesión se cierra  | Interés legítimo (a validar)                                      | P, solo en su navegador                                        | 24 horas                                     | Al enviar, al cerrar sesión a mano o a las 24 h (ADR-069) |
| Identidad de la cuenta (nombre, correo) | Acceso a la plataforma                       | Ejecución del contrato (art. 6.1.b RGPD)                          | P, RH, AE, M (nombre), S                                       | Mientras haya relación + obligaciones        | Cuenta desactivada; sin borrado mientras haya obligación  |
| Ficha laboral (código, centro, equipo)  | Gestión de personal                          | Contrato y obligación legal (6.1.b y c)                           | P, M, RH, AE, C (lectura), AU, S                               | Relación laboral + prescripción              | Revisión manual                                           |
| Condiciones (contrato, jornada, puesto) | Cálculo de jornada y saldos                  | Contrato (6.1.b)                                                  | P, RH, AE, AU                                                  | Relación laboral + prescripción              | Revisión manual                                           |
| Registro de jornada (fichajes, totales) | Registro diario obligatorio                  | Obligación legal, art. 34.9 ET (6.1.c)                            | P, M, RH, AE, AU                                               | **Mínimo 4 años**                            | Nunca automático (revisión manual tras 4 años)            |
| Correcciones de fichaje y motivo        | Trazabilidad del registro                    | Obligación legal (6.1.c)                                          | P, M, RH, AE, AU (sin motivo en informes)                      | Igual que el registro                        | Igual que el registro                                     |
| Ubicación puntual al fichar             | Verificar el lugar (si la empresa lo activa) | Interés legítimo o contrato, art. 90 LOPDGDD (a validar con EIPD) | P, M, RH con gestión (lectura auditada)                        | Igual que el registro (a revisar)            | Propuesta: minimizar tras la revisión del día (pendiente) |
| Selfie al fichar                        | Disuadir suplantación (sin biometría)        | Interés legítimo (a validar con EIPD)                             | P, M, RH con gestión (lectura auditada)                        | **30 días**                                  | Automático (tarea `selfies`)                              |
| Intentos del terminal                   | Seguridad del PIN                            | Interés legítimo (6.1.f)                                          | Nadie desde la API                                             | **90 días**                                  | Automático                                                |
| Ausencias y saldos                      | Vacaciones y permisos                        | Contrato y obligación legal                                       | P, M, RH, AE, AU                                               | Pendiente                                    | Revisión manual                                           |
| Tipo de ausencia reservado (salud)      | Justificar la ausencia                       | Art. 9.2.b RGPD (obligaciones laborales)                          | P, RH con permiso; resto ve «Ausencia (reservada)»             | Pendiente                                    | Revisión manual                                           |
| Justificantes                           | Acreditar la ausencia                        | Art. 9.2.b RGPD                                                   | P, RH con permiso; M solo si no es sensible; apertura auditada | Pendiente                                    | Revisión manual                                           |
| Gastos y tickets                        | Reembolso y contabilidad                     | Contrato y obligación legal contable/fiscal                       | P, M, AE, C                                                    | Pendiente (referencias 4-6 años)             | Revisión manual                                           |
| Lectura OCR del ticket                  | Prellenar el gasto                           | Contrato                                                          | P, M, AE, C                                                    | **90 días** desde que se confirma o descarta | Automático: se quedan solo las confianzas                 |
| Informes y lotes contables              | Contabilidad                                 | Obligación legal                                                  | AE, C                                                          | Pendiente (4-6 años)                         | Revisión manual                                           |
| Exportaciones de informes (archivo)     | Consulta puntual                             | El del dato exportado                                             | Solo quien la pidió                                            | **7 días**                                   | Automático (tarea `exportaciones`)                        |
| Registro de exportaciones y descargas   | Trazabilidad                                 | Interés legítimo / obligación de seguridad                        | P (las suyas), AU                                              | Pendiente                                    | Revisión manual                                           |
| Avisos (bandeja) y entregas de correo   | Comunicación de tareas                       | Contrato                                                          | P                                                              | **12 meses** (avisos leídos)                 | Automático                                                |
| Auditoría (`audit_events`, `audit_log`) | Seguridad y trazabilidad                     | Interés legítimo / art. 32 RGPD                                   | AU, AE (`audit_log` completo: según ADR-026)                   | Pendiente                                    | Nunca automático                                          |
| Solicitudes de derechos                 | Atender derechos                             | Obligación legal (arts. 12-22 RGPD)                               | P (las suyas), RH de empresa, AE                               | Pendiente (propuesta: 3 años)                | Revisión manual                                           |
| Retenciones legales                     | Litigio, inspección                          | Obligación legal / defensa (art. 17.3.e)                          | RH de empresa, AE, AU                                          | Mientras dure + plazo                        | Se levantan, no se borran                                 |
| Accesos de soporte                      | Soporte técnico                              | Interés legítimo / encargo                                        | AE, AU, la persona de soporte                                  | Pendiente                                    | No se borran                                              |
| Registro técnico (logs)                 | Operación y seguridad                        | Interés legítimo                                                  | Operación                                                      | Según plataforma (propuesta: 30 días)        | Plataforma de despliegue                                  |
| Contadores de frecuencia, tareas        | Seguridad y operación                        | Interés legítimo                                                  | Nadie desde la API                                             | 2 y 90 días                                  | Automático                                                |

## 2. Retención ejecutable

- `public.retention_catalog()` publica lo que se aplica automáticamente; la consola
  `/admin/privacidad` lo muestra.
- `public.run_retention(modo)` (solo `service_role`, paso `retencion` de `/api/tareas`):
  - **`simulate`** (por defecto): calcula qué afectaría, por categoría, sin cambiar nada, y lo deja en
    `private.retention_runs`. Es **comprobable** (recuentos) y **reversible** por definición.
  - **`execute`**: aplica lo automático. Solo se activa con `RETENTION_MODE=execute` tras validar la
    matriz. Se ejecuta en una transacción: probado que, si se deshace, todo vuelve.
- Tablas inmutables: solo admiten borrar filas caducadas dentro de una ejecución de retención (marca
  de transacción y rol propietario). Auditoría, registro de jornada, justificantes, tickets y
  solicitudes nunca se borran automáticamente.
- **Retenciones legales** (`legal_holds`): RR. HH. de empresa o la administración las activan por
  persona o para toda la empresa y por categoría; la retención automática las respeta y las
  supresiones las muestran como bloqueo. Se levantan, no se borran, y quedan auditadas.

## 3. Derechos de las personas (con revisión humana)

1. La persona presenta la solicitud en **Mi perfil › Mis datos y privacidad** (solo sobre sí
   misma; 5 al día). Plazo: un mes.
2. RR. HH. de empresa o la administración (con MFA, nunca sobre su propia solicitud) la revisan en
   **Administración › Privacidad y soporte** y deciden de forma motivada: aprobar, aprobar en parte
   o rechazar.
3. **Supresión y limitación**: la base de datos calcula las obligaciones que lo impiden (registro de
   jornada 4 años, gastos, retención legal, relación laboral vigente). Con alguna, solo cabe
   aprobación parcial. **Aprobar no borra nada**: la supresión se ejecuta a mano tras la revisión
   (pendiente definir el procedimiento de anonimización con la organización).
4. **Acceso y portabilidad**: aprobada la solicitud, quien la revisa descarga la copia en JSON
   (datos de la persona: cuenta, ficha, condiciones, jornada con fichajes, ausencias, gastos y
   solicitudes; sin archivos ni datos de terceros). La descarga queda auditada y no se guarda.
5. Rectificación, oposición: se atienden en las pantallas habituales (correcciones auditadas).
6. Cada cambio de estado queda en `audit_events` (sin el texto de la persona).

## 4. Documentos sensibles y soporte

- **Separación**: justificantes en bucket propio; tipo reservado oculto en informes, calendarios y
  avisos; el manager solo abre justificantes no sensibles; cada apertura se audita.
- **Evidencias de fichaje**: coordenadas y selfie fuera de la API general; solo la persona, su
  manager y RR. HH. con gestión, con cada consulta auditada.
- **Soporte**: la plataforma no ve datos de las empresas. La administración de la empresa concede un
  acceso de solo lectura (personas, cuentas, roles y auditoría), como mucho 24 horas, con motivo y
  MFA; puede revocarlo; caduca solo; todo queda auditado. Procedimiento en RUNBOOKS, § 5.

## 5. Evaluación de impacto (EIPD), geolocalización y biometría

- **Geolocalización**: la lectura puntual al fichar (desactivada por defecto) y cualquier ampliación
  requieren **EIPD previa** y la evaluación de proporcionalidad del art. 90 LOPDGDD, con información
  previa a la plantilla. No hay seguimiento continuo (`watchPosition` prohibido por prueba).
- **Selfie**: aunque no se usa para identificar, conviene incluirla en la EIPD (imagen de la
  persona). Desactivada por defecto.
- **Biometría y reconocimiento facial**: **no existen** en la plataforma. Ninguna dependencia ni
  código los implementa (comprobado en `tests/unit/security-static.test.ts`), la selfie no se analiza
  y no se extrae ningún rasgo. Introducir cualquier biometría exigiría EIPD, base del art. 9 RGPD y
  una decisión expresa; la guía de la AEPD de 2023 la considera, con carácter general, no justificada
  para el control horario.
- **OCR de tickets**: si se contrata un proveedor, EIPD (o su actualización) y contrato de encargo.
