# Runbooks de seguridad y operación

Procedimientos para incidentes, brechas, restauración y soporte. Son una base técnica: la
organización debe asignar responsables, contactos y plazos internos, y validarlos con el DPD.
Cada actuación se registra (fecha, persona, decisión) en el sistema de tickets interno.

## 1. Alertas y guardia

Fuentes de alerta: líneas del registro técnico con `"alert": true` (ver SEGURIDAD, § 7), fallos de
`/api/tareas` (respuesta 207 o 401), panel de Supabase (Auth, base de datos, Storage) y avisos de
GitHub (dependencias y secretos).

| Evento                            | Primera acción                                                                |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `cron.unauthorized` repetido      | Revisar origen; rotar `CRON_SECRET` si pudo filtrarse (§ 7)                   |
| `email_webhook.invalid_signature` | Comprobar el secreto con el proveedor; posible intento de suplantación        |
| `mfa.verify_failed` en ráfaga     | Posible ataque a una cuenta: contactar con la persona; bloquear si procede    |
| `rate_limit.exceeded` repetido    | Identificar la cuenta (por `request_id`) y revisar si es abuso o error de uso |
| `support.access_granted`          | Verificar que hay ticket de soporte que lo justifique                         |
| `cron.steps_failed`               | Revisar el paso fallido en `recent_job_runs`; reintentar                      |

Para correlacionar: el `x-request-id` de la respuesta aparece en el registro técnico y en
`audit_events.request_id`.

## 2. Incidente de seguridad

1. **Detectar y registrar**: abrir incidente con hora, alcance sospechado y quién lo comunica.
2. **Contener** (según el caso):
   - Cuenta comprometida: Supabase › Auth › usuario: cerrar sesiones (`signOut` global) y forzar
     cambio de contraseña; revocar sus roles en la plataforma si es privilegiada.
   - Secreto expuesto: rotarlo (§ 7) inmediatamente.
   - Acceso de soporte indebido: `revoke_support_access` y revisar sus eventos en auditoría.
   - Fallo de autorización: desplegar la corrección; si hace falta, desactivar temporalmente la
     sección afectada (retirar la ruta) sin desactivar protecciones de la base de datos.
3. **Investigar**: `audit_events` (filtrar por actor, objeto, `request_id` y periodo en
   `/auditoria`), `audit_log`, registros de Supabase y de la plataforma de despliegue. No copiar
   datos personales fuera de los sistemas autorizados.
4. **Evaluar si es brecha de datos personales** (§ 3).
5. **Recuperar**: restaurar datos si procede (§ 4), verificar con las pruebas (`npm run test:db`,
   E2E) y el escáner de catálogo.
6. **Lecciones**: añadir una prueba que reproduzca el fallo y un ADR si cambia el diseño.

## 3. Brecha de datos personales (arts. 33 y 34 RGPD)

1. Avisar al DPD en cuanto se detecte. La organización decide si notifica.
2. **Notificación a la AEPD** sin dilación indebida y, si es posible, **en 72 horas** desde que se
   tenga constancia, salvo que sea improbable que suponga un riesgo para los derechos de las
   personas. Si no se notifica, documentar el motivo.
3. **Comunicación a las personas afectadas** si es probable un alto riesgo (por ejemplo, ubicaciones,
   justificantes de salud o tipos de ausencia reservados).
4. Datos a reunir: naturaleza, categorías y número aproximado de personas y registros (los
   recuentos salen de consultas, no de copiar los datos), consecuencias probables y medidas.
5. Registrar la brecha en el registro interno de brechas aunque no se notifique.
6. Si interviene un encargado (Supabase, hosting, correo, OCR), pedirle su informe según el contrato.

## 4. Copias y restauración

- **Copias**: Supabase hace copias diarias de la base de datos (PITR según plan). Storage (tickets,
  justificantes, selfies, exportaciones) no entra en esas copias: decisión pendiente (copia de buckets
  cifrada o aceptar el riesgo).
- **Restauración** (con la organización avisada):
  1. Restaurar en un **proyecto nuevo** (no sobrescribir producción) desde el panel de Supabase.
  2. Aplicar las migraciones pendientes posteriores a la copia (`supabase db push`).
  3. Ejecutar en ese proyecto el escáner de catálogo (`97_seguridad_catalogo`) y comprobar datos de
     control (recuentos por empresa).
  4. Cambiar la aplicación al proyecto restaurado (variables de entorno) o copiar los datos
     necesarios.
  5. Tras restaurar, **revisar retención y derechos**: una copia puede reintroducir datos ya
     suprimidos o caducados; volver a ejecutar `run_retention` y reaplicar las supresiones
     registradas en `data_subject_requests`.
- **Prueba periódica** (propuesta: trimestral): restaurar en un proyecto de pruebas y medir el
  tiempo. Registrar el resultado.

## 5. Acceso de soporte

1. La persona usuaria abre un ticket. Soporte (plataforma) **no** ve datos de la empresa.
2. Si soporte necesita ver datos, lo pide a la administración de la empresa indicando el motivo.
3. La administración lo concede en **Administración › Privacidad y soporte** (1 a 24 horas, motivo
   obligatorio, con MFA). Solo lectura de personas, cuentas, roles y auditoría.
4. Soporte trabaja con MFA; no descarga ni copia datos fuera de la plataforma.
5. Al terminar, revocar el acceso (o dejar que caduque). Anotar en el ticket la concesión y la
   revocación (están en `audit_events`).
6. Soporte nunca recibe contraseñas, códigos de segundo factor ni enlaces de invitación.

## 6. Segundo factor (MFA)

- **Pérdida del dispositivo**: la persona contacta con la administración de su empresa. Tras
  verificar su identidad por un canal distinto, la plataforma elimina el factor desde el panel de
  Supabase (Auth › usuario › factores). La persona vuelve a darlo de alta en
  **Mi perfil › Seguridad de la cuenta**. Registrarlo en el ticket.
- **Degradación** (solo si el proyecto de Supabase no tuviera MFA disponible): el propietario de la
  base de datos ejecuta, con ticket y aprobación del responsable de seguridad,
  `update private.security_settings set mfa_enforced = false, updated_at = now() where id = 1;`.
  Mientras dure, los roles privilegiados funcionan sin segundo factor: es un riesgo aceptado
  temporalmente. Revertir con `mfa_enforced = true` en cuanto sea posible.

## 7. Rotación de secretos

| Secreto                | Dónde se cambia                                        | Efecto                                    |
| ---------------------- | ------------------------------------------------------ | ----------------------------------------- |
| `SUPABASE_SECRET_KEY`  | Supabase › API keys (crear nueva, revocar la anterior) | Invitaciones y tareas usan la nueva       |
| `CRON_SECRET`          | Plataforma de despliegue y planificador                | Las llamadas con el antiguo dan 401       |
| `EMAIL_WEBHOOK_SECRET` | Proveedor de correo y despliegue                       | Los eventos con firma antigua se rechazan |
| Claves JWT de Auth     | Supabase › JWT signing keys                            | Cierra todas las sesiones                 |

Tras rotar: comprobar `/api/tareas` (200) y revisar el registro técnico.

## 8. Puesta en marcha del proyecto real (lista de comprobación)

- [ ] Región UE y contrato de encargo con Supabase y hosting.
- [ ] `[auth.mfa.totp]` activado; contraseña mínima 12; registro abierto desactivado.
- [ ] SMTP propio para Auth; límites de Auth revisados; CAPTCHA si hay abuso.
- [ ] Migraciones aplicadas y `97_seguridad_catalogo` ejecutado contra el proyecto.
- [ ] Variables: solo las tres públicas en el cliente; secretos en el gestor de secretos.
- [ ] Alertas de `"alert": true` enviadas a guardia.
- [ ] `RETENTION_MODE` en simulación hasta validar la matriz; revisar las primeras ejecuciones.
- [ ] Prueba de restauración (§ 4) antes del piloto.
- [ ] EIPD firmada si se activa ubicación o selfie.

## 9. Requerimiento de la Inspección de Trabajo u órgano judicial

1. Activar una **retención legal** (categoría y persona o empresa) para que la retención automática no
   toque esos datos.
2. Exportar el **registro horario** (`/informes/registro-horario`, PDF o XLSX) del periodo pedido; la
   exportación queda registrada con su huella.
3. Entregar por el canal indicado por la organización (no por correo sin cifrar).
4. Levantar la retención cuando lo indique la asesoría.
