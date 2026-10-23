# Decisiones pendientes para legal y privacidad

Lista de decisiones que la plataforma **no puede tomar por sí misma**. Mientras no se decidan, la
opción por defecto es la más conservadora (no borrar, no activar, no enviar a terceros). Ninguna
parte de la plataforma acredita por sí sola el cumplimiento legal.

| #   | Decisión                                                                                                  | Por defecto hoy                             | Quién decide           | Dónde se aplica                            |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------- | ------------------------------------------ |
| 1   | Bases jurídicas de cada tratamiento (matriz de PRIVACIDAD, § 1)                                           | Propuestas técnicas sin validar             | DPD                    | Registro de actividades                    |
| 2   | Plazo de conservación del registro de jornada tras los 4 años y su forma de fin (borrado o anonimización) | Se conserva; nunca automático               | Asesoría laboral, DPD  | `run_retention` (categoría `time_records`) |
| 3   | Plazo de justificantes de ausencia y de las ausencias                                                     | Se conservan                                | Asesoría laboral       | Retención manual                           |
| 4   | Plazo de gastos, tickets y lotes contables (referencias de 4 a 6 años)                                    | Se conservan                                | Asesoría fiscal        | Retención manual                           |
| 5   | Plazo de la auditoría (`audit_events`, `audit_log`) y del registro de exportaciones y descargas           | Se conservan                                | DPD, seguridad         | —                                          |
| 6   | Plazo de las selfies (30 días) y de la ubicación puntual                                                  | Selfies 30 días; ubicación como el registro | DPD                    | `selfies`; ubicación pendiente             |
| 7   | Plazo de avisos (12 meses), OCR (90 días), intentos del terminal (90 días)                                | Aplicados en simulación                     | DPD                    | `RETENTION_MODE`                           |
| 8   | Activar la retención real (`RETENTION_MODE=execute`)                                                      | Solo simulación                             | DPD y responsable      | Configuración del despliegue               |
| 9   | EIPD de ubicación puntual, selfie y OCR; proporcionalidad del art. 90 LOPDGDD                             | Ubicación y selfie desactivadas; sin OCR    | DPD                    | `time_tracking_policies`, `OCR_PROVIDER`   |
| 10  | Procedimiento de supresión/anonimización tras aprobar una solicitud                                       | Aprobar no borra; supresión manual          | DPD                    | Derechos (PRIVACIDAD, § 3)                 |
| 11  | Quién atiende los derechos (DPD, RR. HH.) y verificación de identidad                                     | RR. HH. de empresa y administración         | DPD                    | `can_handle_privacy`                       |
| 12  | Plazo de las solicitudes de derechos y de los accesos de soporte                                          | Se conservan                                | DPD                    | —                                          |
| 13  | Encargados del tratamiento (Supabase, hosting, correo, OCR): contratos, región y transferencias           | Sin proveedor de correo ni OCR              | Legal                  | ADR por proveedor                          |
| 14  | Información a la plantilla y consulta a la representación legal (registro de jornada, ubicación)          | Pendiente                                   | RR. HH., legal         | Textos de información                      |
| 15  | Notificación de brechas: responsables, canal y criterios                                                  | Runbook genérico (72 horas)                 | DPD                    | RUNBOOKS, § 3                              |
| 16  | Copia de Storage (tickets, justificantes, selfies) y su conservación                                      | Sin copia propia                            | Seguridad, DPD         | COPIAS_Y_RESTAURACION, § 4                 |
| 17  | Política de desconexión digital por empresa (horarios de avisos)                                          | 9:00-18:00 en días laborables               | RR. HH.                | Recordatorios                              |
| 18  | Plazo de registros técnicos en la plataforma de despliegue                                                | Según plataforma (propuesta 30 días)        | Seguridad              | Configuración del hosting                  |
| 19  | Antivirus para archivos subidos                                                                           | Validación estructural sin antivirus        | Seguridad              | Subidas                                    |
| 20  | Degradación de MFA si el plan de Supabase no lo permitiera                                                | MFA obligatoria                             | Seguridad              | RUNBOOKS, § 6                              |
| 21  | Copias lógicas de la base: dónde se guardan, cifrado, acceso y plazo de conservación                      | Solo copias nativas de Supabase             | Seguridad, DPD         | COPIAS_Y_RESTAURACION, § 2                 |
| 22  | RPO y RTO objetivo del servicio                                                                           | Sin definir                                 | Responsable, seguridad | COPIAS_Y_RESTAURACION, § 2                 |
| 23  | Borradores de formularios en el dispositivo (hasta 24 h; se borran al enviar o cerrar sesión a mano)      | Activado en toda la zona privada            | DPD, seguridad         | ADR-069                                    |
| 24  | Duración máxima de la sesión por empresa                                                                  | 60 minutos (15 a 720)                       | Seguridad, RR. HH.     | ADR-067                                    |
