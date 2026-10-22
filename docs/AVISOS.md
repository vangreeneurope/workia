# Avisos, correo y tareas programadas

Funcionamiento de las notificaciones (migración `20261029100000_avisos`). Probado en
`supabase/tests/95_avisos.test.sql`, `scripts/test-db-concurrency.sh` (dos trabajadores a la vez),
`tests/unit/notifications.test.ts` y la E2E de rutas protegidas.

## 1. Flujo

```
operación (solicitud, decisión, fichaje, turno, informe…)
   └─ trigger en la MISMA transacción → notification_outbox   (no se envía nada aquí)
tarea programada /api/tareas (cada 5-15 min)
   ├─ run_scheduled_reminders      → recordatorios al outbox
   ├─ process_notification_outbox  → notifications (bandeja) + email_deliveries (cola de correo)
   └─ claim_email_deliveries → EmailProvider → complete_email_delivery
proveedor → /api/correo/webhook (firma verificada) → record_email_event
```

Si la operación principal se confirma, su evento queda en el outbox. Si el correo falla, la
operación no se entera: el fallo se reintenta en la siguiente ejecución.

## 2. Catálogo de avisos

| Evento                    | Destinatario                       | Obligatorio | Enlace                  |
| ------------------------- | ---------------------------------- | :---------: | ----------------------- |
| `absence_submitted`       | Aprobador (o RR. HH. si no hay)    |     Sí      | `/ausencias/bandeja`    |
| `absence_decided`         | La persona                         |     No      | `/ausencias`            |
| `absence_info_requested`  | La persona                         |     Sí      | `/ausencias`            |
| `absence_info_provided`   | Aprobador                          |     No      | `/ausencias/bandeja`    |
| `absence_cancelled`       | Aprobador                          |     No      | `/ausencias/bandeja`    |
| `expense_step_pending`    | Aprobador del paso (persona o rol) |     Sí      | `/gastos/informes/<id>` |
| `expense_report_returned` | La persona                         |     Sí      | `/gastos/informes/<id>` |
| `expense_report_approved` | La persona                         |     No      | `/gastos/informes/<id>` |
| `expense_report_settled`  | La persona (cierre contable)       |     No      | `/gastos/informes/<id>` |
| `time_missing_start`      | La persona                         |     Sí      | `/fichajes`             |
| `time_open_entry`         | La persona                         |     Sí      | `/fichajes`             |
| `time_incident`           | La persona                         |     No      | `/fichajes`             |
| `time_correction_decided` | La persona                         |     No      | `/fichajes/historial`   |
| `shift_changed`           | La persona                         |     Sí      | `/horario`              |
| `approval_overdue`        | Aprobador con pendientes antiguos  |     Sí      | bandeja correspondiente |

- **Obligatorios**: operativos o legales (aprobar, corregir, registro de jornada, cambios de
  horario). Siempre llegan a la bandeja y por correo.
- **Opcionales**: siempre llegan a la bandeja. En `/avisos/preferencias` la persona puede
  desactivar el correo. La base de datos rechaza preferencias sobre avisos obligatorios.
- Solo reciben avisos las personas con membresía vigente en la empresa. Nadie recibe aviso de que
  debe aprobar lo suyo.

## 3. Contenido mínimo y plantillas

- Plantillas en español versionadas en `src/features/notifications/templates.ts`
  (`TEMPLATES[evento][versión]`). Cada aviso guarda su versión. Una versión no se modifica: un
  cambio de texto es una versión nueva.
- **Parámetros permitidos**: empresa, fecha, periodo (aaaa-mm), día de trabajo, recuento y
  resultado (aprobada o rechazada). Los construye la base de datos (`outbox_params`). Las
  plantillas ignoran cualquier otro dato.
- Nunca aparecen tipos o motivos de ausencia, diagnósticos, importes, proveedores, tickets,
  coordenadas ni imágenes, ni en el asunto ni en el cuerpo. No se adjunta nada.
- **Enlaces**: `<NEXT_PUBLIC_SITE_URL>/avisos/<id del aviso>`. El enlace no lleva token ni da
  acceso. Abrirlo exige sesión, y `open_notification` comprueba que el aviso es tuyo y que **hoy**
  sigues teniendo permiso sobre el objeto. Si ya no lo tienes, vuelves a la bandeja con «Ya no
  tienes acceso».
- No se guardan cuerpos de correo. Las entregas solo guardan estado, intentos, códigos de error e
  id externo.

## 4. Idempotencia, reintentos y dead-letter

| Nivel           | Clave                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| Evento → outbox | `source_key` único (p. ej. `absence_event:123`)                                                       |
| Aviso           | `idempotency_key` = `<outbox>:<destinatario>:in_app`                                                  |
| Correo          | `idempotency_key` = `<outbox>:<destinatario>:email`; se envía al proveedor como clave de idempotencia |
| Webhook         | `(proveedor, id del evento externo)` único                                                            |

- Reprocesar, reencolar o ejecutar dos trabajadores a la vez no duplica avisos ni correos. Las
  filas se toman con `FOR UPDATE SKIP LOCKED` (probado).
- **Fallo temporal**: el correo vuelve a la cola con espera de 1, 2, 4, 8… minutos, hasta 5
  intentos. Después queda `failed` (dead-letter).
- **Fallo permanente** (destinatario no válido, rechazo): `failed` sin más reintentos.
- Una entrega bloqueada más de 10 minutos (el trabajador cayó) se puede volver a tomar. Por eso al
  proveedor se le pasa la clave de idempotencia.
- **Rebote o queja**: la entrega queda `bounced` o `complained`. Durante 30 días los correos a esa
  persona se suprimen (`suppressed`), pero los avisos siguen llegando a su bandeja.
- **Límite de frecuencia**: como mucho 3 correos de recordatorio por persona en 24 horas. El resto
  queda `skipped` (`frequency_limit`).
- **Consola de soporte** (`/admin/avisos`, permiso de auditoría): recuentos por estado y últimas
  entregas, sin contenido ni direcciones. La administración de empresa puede reintentar a mano una
  entrega fallida (hasta 3 veces).

## 5. Recordatorios programados

- **Entrada sin fichar y jornada abierta**: `generate_time_reminders`, con la zona horaria del
  centro y el horario planificado de cada persona (solo en sus días y horas de trabajo). Como
  mucho uno por persona y día o jornada.
- **Aprobaciones vencidas**: ausencias pendientes desde hace más de 48 horas e informes de gastos
  desde hace más de 72. Un aviso por aprobador, tipo y día local, solo entre las 9:00 y las 18:00
  de la zona horaria de la empresa y en día laborable (su horario si lo tiene; si no, de lunes a
  viernes). Así se respeta la desconexión digital.

## 6. Tareas programadas (`/api/tareas`)

Un planificador externo llama a `POST` (o `GET`) `/api/tareas` con
`Authorization: Bearer <CRON_SECRET>` cada 5-15 minutos. Pasos independientes, cada uno con su
registro en `private.scheduled_job_runs` (solo recuentos y códigos, visible para la administración
de plataforma con `recent_job_runs`):

1. `recordatorios`: `run_scheduled_reminders`.
2. `avisos`: `process_notification_outbox`.
3. `correo`: envío con el proveedor configurado (o `skipped`/`no_provider` si no hay).
4. `saldos`: `settle_vacation_balances` (pendiente desde el módulo de ausencias).
5. `selfies`: borrado de selfies caducadas (30 días) con la API de Storage (pendiente desde control
   horario).
6. `exportaciones`: `expire_report_exports` (caducadas a los 7 días, atascadas más de 30 minutos y
   archivos huérfanos) y borrado de sus archivos en Storage (docs/INFORMES.md).

Sin `CRON_SECRET` (mínimo 32 caracteres) o sin `SUPABASE_SECRET_KEY`, la ruta no hace nada (401 o
503). Ejemplos de planificador: Vercel Cron, Supabase `pg_cron` + `pg_net` o un workflow
programado de GitHub Actions. Cualquiera sirve si envía la cabecera y se ejecuta con la frecuencia
indicada.

## 7. Guía: activar un proveedor de correo real

Ahora mismo **no hay proveedor real**. Sin él, los avisos llegan solo a la bandeja y las entregas
quedan `skipped` (`no_provider`). Para activar uno:

1. **Decisión**: ADR en `docs/DECISIONES.md` con el proveedor, contrato de encargo de tratamiento
   (art. 28 RGPD), ubicación de los datos y retención de logs del proveedor.
2. **Dominio**: dominio de envío propio verificado (SPF, DKIM, DMARC). Configurar `EMAIL_FROM`
   (por ejemplo, `Portal <avisos@vuestro-dominio>`). No usar dominios de ejemplo.
3. **Credenciales**: clave del proveedor y secreto de firma de webhooks, solo en el gestor de
   secretos del servidor. Nunca `NEXT_PUBLIC_` ni en el repositorio.
4. **Adaptador**: implementar `EmailProvider` en `src/features/notifications/email/<proveedor>.ts`:
   - `send`: enviar con la clave de idempotencia y devolver el id externo; traducir errores a
     `EmailProviderError` (temporales con `retryable: true`).
   - `verifyWebhook`: verificar la firma del proveedor (tiempo constante, ventana de tiempo) y
     traducir sus eventos a `delivered`, `bounced`, `complained` o `deferred`.

   Registrarlo en `email/registry.ts` según `EMAIL_PROVIDER` y añadir pruebas con respuestas
   grabadas sintéticas.

5. **Webhook**: en el panel del proveedor, apuntar a `<sitio>/api/correo/webhook`.
6. **Prueba**: enviar a cuentas internas, revisar `/admin/avisos` y el registro de tareas, y
   provocar un rebote de prueba.

Desarrollo local: `EMAIL_PROVIDER=fake` (solo fuera de producción) y `EMAIL_WEBHOOK_SECRET` para
firmar webhooks de prueba. El formato del falso es la cabecera `x-correo-firma: t=<s>,v1=<hmac>` y
el cuerpo `{"events": [{"id", "message_id", "type", "occurred_at"}]}`.

## 8. Pendiente

- Elegir proveedor de correo (ADR) y configurar el planificador en el entorno real.
- Notificaciones push en la PWA (fase 4).
- Plazo de conservación de avisos y entregas (propuesta: 12 meses) con la asesoría.
