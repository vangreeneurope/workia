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
| `metrics.unauthorized` repetido   | Revisar origen; rotar `METRICS_TOKEN` si pudo filtrarse (§ 7)                 |

Las alertas operativas (disponibilidad, colas, integraciones, cierre) están en § 10 y en
`ops/observabilidad/alertas.json`, cada una con su dueño.

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

Procedimiento completo, alcance de cada copia y estado de las pruebas en
**docs/COPIAS_Y_RESTAURACION.md**. Puntos clave:

- La copia de la base de datos de Supabase **no incluye los archivos de Storage** (tickets,
  justificantes, selfies, logotipos, exportaciones): solo sus metadatos (`storage.objects`).
- Restaurar siempre en un **proyecto nuevo**, nunca encima de producción.
- Tras restaurar, revisar retención y derechos (una copia puede reintroducir datos ya suprimidos).
- Ensayo local del procedimiento lógico: `npm run ops:prueba-restauracion`. La restauración en
  Supabase sigue pendiente de ensayar (requiere el proyecto real).

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

| Secreto                 | Dónde se cambia                                            | Efecto                                       |
| ----------------------- | ---------------------------------------------------------- | -------------------------------------------- |
| `SUPABASE_SECRET_KEY`   | Supabase › API keys (crear nueva, revocar la anterior)     | Invitaciones y tareas usan la nueva          |
| `CRON_SECRET`           | Plataforma de despliegue y planificador                    | Las llamadas con el antiguo dan 401          |
| `METRICS_TOKEN`         | Hosting y herramienta de monitorización                    | La lectura de métricas con el antiguo da 401 |
| `SUPABASE_ACCESS_TOKEN` | Supabase › Account › Access tokens y GitHub › Environments | Las migraciones con el antiguo fallan        |
| `SUPABASE_DB_PASSWORD`  | Supabase › Database settings y GitHub › Environments       | Las migraciones con la antigua fallan        |
| `EMAIL_WEBHOOK_SECRET`  | Proveedor de correo y despliegue                           | Los eventos con firma antigua se rechazan    |
| Claves JWT de Auth      | Supabase › JWT signing keys                                | Cierra todas las sesiones                    |

Tras rotar: comprobar `/api/tareas` (200) y revisar el registro técnico.

## 8. Puesta en marcha del proyecto real (lista de comprobación)

La lista completa de release y piloto está en docs/RELEASE.md. Mínimos de seguridad:

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

## 10. Alertas operativas

Cada apartado corresponde a alertas de `ops/observabilidad/alertas.json`. Antes de actuar: anotar
la hora, el entorno y el commit (`/api/salud`) en el ticket. Nunca copiar datos personales al ticket
ni a canales de chat; usar `request_id`, códigos y recuentos.

### Aplicación caída o con errores

Alertas: `app-no-responde`, `errores-aplicacion`, `latencia-alta`. Dueño: guardia.

1. `/api/salud`: ¿responde? ¿qué commit y entorno sirve? Comparar con el último despliegue.
2. Si el problema empezó con un despliegue: desplegar el commit anterior (docs/CI_CD.md, § 8).
   Si ese despliegue incluía migraciones, revisar compatibilidad antes (§ «Despliegue y migraciones»).
3. Si no: agrupar `app.request_error` por `route` y `digest`; buscar el `request_id` en
   `audit_events` si afecta a una acción concreta. El digest aparece también en la pantalla de error
   que ve la persona («Código para soporte»).
4. Latencia: revisar consultas lentas en Supabase (Query performance) y los índices documentados en
   docs/INFORMES.md; comprobar si coincide con exportaciones o cierres grandes.
5. `/api/salud/listo` en 503: seguir «Login y Auth» o «Base de datos» según el `check` en error.

### Login y Auth

Alertas: `login-no-disponible`, `login-errores`, `mfa-rafaga`. Dueños: guardia; seguridad en ráfagas.

1. `checks.login = error`: revisar el estado de Supabase (status del proveedor y panel de Auth).
   Sin Auth nadie puede entrar; el terminal de fichaje con PIN tampoco funciona si la base no
   responde. Comunicar a las empresas piloto el alcance y la hora prevista.
2. Muchos `auth.context_failed`: fallo al leer el contexto de permisos (base de datos o RLS). Ir a
   «Base de datos».
3. Muchos `auth.signin_rate_limited` o `mfa.verify_failed`: posible fuerza bruta. Seguridad identifica
   cuentas por `request_id`, contacta por otro canal y, si procede, cierra sesiones y fuerza cambio
   de contraseña (§ 2). Revisar los límites de Auth del proyecto y activar CAPTCHA si se repite.
4. Correos de acceso que no llegan: revisar SMTP de Auth en Supabase (no es el correo de avisos).

### Base de datos

Alerta: `base-de-datos-no-disponible`. Dueño: guardia.

1. Panel de Supabase: estado del proyecto (en pausa, mantenimiento), conexiones, CPU, disco.
2. Conexiones agotadas: revisar si hay exportaciones o cierres masivos en curso; el pooler de
   Supabase debe estar en uso por PostgREST.
3. Disco lleno: revisar crecimiento de `audit_log` y `notifications` y la retención (docs/PRIVACIDAD.md).
4. **No ejecutar migraciones** ni despliegues con migraciones hasta que se recupere.
5. Si hay corrupción o pérdida de datos: § 4 y docs/COPIAS_Y_RESTAURACION.md, con aviso al DPD (§ 3).

### RLS y aislamiento

Alerta: `rls-denegaciones`. Dueño: seguridad.

1. Picos de 42501 justo tras un despliegue suelen ser un fallo de la app (una política más estricta
   que el código): volver al commit anterior si bloquea a las personas, y corregir.
2. Picos sin despliegue: posible intento de acceso cruzado. Buscar en registros de Postgres el rol y
   la tabla, y en `audit_events` la actividad de la cuenta. Tratarlo como incidente (§ 2).
3. Comprobar el catálogo en el entorno: ejecutar las comprobaciones de
   `supabase/tests/97_seguridad_catalogo.test.sql` contra una copia restaurada (docs/COPIAS_Y_RESTAURACION.md)
   o revisar en el panel que todas las tablas de `public` tienen RLS.
4. Nunca desactivar RLS ni ampliar una política para «desbloquear»: la corrección va por migración
   con pruebas positivas y negativas.

### OCR

Alerta: `ocr-fallos`. Dueño: guardia.

1. Agrupar `ocr.job` por `error_code` y `provider`: `timeout` o `provider_*` apuntan al proveedor;
   `unsupported_file` o `download_failed` a archivos o a Storage.
2. Si el proveedor falla de forma sostenida: dejar `OCR_PROVIDER` vacío en el hosting y desplegar la
   configuración. Los gastos siguen registrándose y se completan a mano; nada se pierde.
3. Al recuperarse, las personas pueden usar «Volver a leer» en cada gasto (límite de reintentos en la
   base de datos).

### Colas y tareas programadas

Alertas: `cola-trabajos-atascada`, `tareas-sin-ejecutar`, `avisos-atascados`. Dueño: guardia.

1. `scheduler.last_run_age_s` alto o −1: el planificador no llama a `/api/tareas`. Comprobar su
   configuración y `CRON_SECRET` (una respuesta 401 aparece como `cron.unauthorized`). Lanzar a mano:
   `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<entorno>/api/tareas`
   (desde un equipo seguro; el secreto nunca en el ticket).
2. Pasos fallidos: `job.step` con `ok = false` indica el paso y su `error_code`; cada paso es
   idempotente y se puede repetir.
3. `jobs.stuck > 0`: un OCR quedó a medias. No hay trabajador en segundo plano (ESTADO_PROYECTO,
   riesgo «Gastos»): el trabajo se recupera al volver a reclamarlo («Volver a leer» en el gasto, que libera
   los bloqueados más de 5 minutos). El gasto se puede completar a mano mientras tanto.
4. Avisos pendientes o fallidos: revisar el paso «avisos»; la consola de soporte
   (`/admin/avisos`) permite reintentar entregas de correo.

### Correo

Alerta: `correo-fallos`. Dueño: guardia.

1. Ver `envios.failed_24h` y los eventos de entrega (rebotes y quejas) en la consola de soporte.
2. Fallo del proveedor: revisar su estado, el dominio verificado y `EMAIL_WEBHOOK_SECRET`. Los avisos
   siguen llegando a la bandeja de la app.
3. Rebotes de una dirección concreta: se suprimen automáticamente; RR. HH. corrige la dirección.
4. Reintentar entregas pendientes desde `/admin/avisos` cuando el proveedor se recupere.

### Storage

Alerta: `storage-errores`. Dueño: guardia.

1. Panel de Supabase › Storage: estado, cuota y tamaño de buckets; registros de errores 5xx.
2. Errores de subida de tickets o justificantes: la persona ve el error y puede reintentar (clave de
   idempotencia); revisar límites de tamaño y tipos del bucket.
3. Exportaciones fallidas (`report_exports.failed_24h`): se vuelven a pedir desde Informes; las
   caducadas se borran solas.
4. Nunca hacer público un bucket ni ampliar sus políticas para resolver un error.

### Cierre mensual

Alertas: `cierre-sin-paquete`, `cierre-pendiente`. Dueño: contabilidad de la empresa, con apoyo de
guardia.

1. Lote sin paquete: Contabilidad pulsa «Volver a generar» en el lote. Los archivos son
   deterministas: regenerar produce los mismos bytes.
2. Si vuelve a fallar: guardia busca `settlement.files_failed` y revisa Storage («Storage»).
3. Informes de meses cerrados sin decidir: Contabilidad recuerda a aprobadores y managers; el cierre
   puede excluir líneas con motivo (queda registrado) y regularizarse en un lote correctivo.
4. Un lote cerrado no se modifica: los errores se corrigen con un lote correctivo
   (docs/LIQUIDACION_GASTOS.md).

### Despliegue y migraciones

Alerta: `despliegue-fallido`. Dueño: guardia.

1. Abrir el resumen del workflow «Despliegue»: entorno, commit, punto de restauración y paso fallido.
2. Falló la migración: no quedó a medias (transaccional) y el código no se desplegó. Corregir con
   una migración nueva por el flujo normal.
3. Falló la verificación (`verificar.sh`): la URL no sirve el commit esperado o no está lista.
   Revisar el hosting; si la versión nueva no arranca, volver a desplegar la anterior.
4. Volver atrás una migración ya aplicada (solo si la corrección hacia delante no es viable):
   1. Confirmar que existe copia o punto de restauración (§ 4).
   2. Leer la cabecera del `.down.sql`: si declara pérdida de datos, decidir con el responsable y
      solo entonces usar `set app.allow_lossy_rollback = 'on'`.
   3. Ejecutar el `.down.sql` en el entorno (editor SQL de Supabase o `psql`), y después
      `supabase migration repair --status reverted <versión> --linked`.
   4. Desplegar el commit anterior y verificar `/api/salud` (la `migration` esperada debe coincidir).
