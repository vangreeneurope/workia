# Observabilidad

Qué señales emite la plataforma, cómo se consumen sin atarse a un proveedor y qué alertas tienen
dueño y acción. Ninguna señal contiene datos personales ni secretos: solo códigos, recuentos,
duraciones e identificadores técnicos (ADR-064).

## 1. Señales

| Señal                  | Dónde                                                         | Contenido                                                               |
| ---------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Registro técnico       | Salida estándar del servidor (`src/lib/log.ts`)               | Una línea JSON por evento, redactada, con `request_id` cuando se conoce |
| Errores no controlados | `src/instrumentation.ts` → evento `app.request_error`         | Plantilla de ruta, tipo (página, acción, ruta, proxy), método, digest   |
| Arranque               | Evento `app.start`                                            | Versión, commit, migración esperada, entorno                            |
| Tareas programadas     | Evento `job.step` por paso de `/api/tareas`                   | Paso, resultado, duración, recuentos, código de error                   |
| Instantánea de colas   | Evento `ops.metrics` al final de cada ejecución de tareas     | Salida de `public.ops_metrics()` (§ 3)                                  |
| OCR                    | Evento `ocr.job`                                              | Proveedor, resultado, código de error, duración                         |
| Cierre mensual         | Eventos `settlement.period_closed`, `settlement.files_failed` | Resultado de la generación del paquete, duración                        |
| Seguridad              | Eventos con `alert: true` (RUNBOOKS, § 1)                     | Código del evento                                                       |
| Salud                  | `GET /api/salud`, `GET /api/salud/listo`                      | Estado, versión y estados de base de datos y Auth                       |
| Métricas bajo demanda  | `GET /api/salud/metricas` con `METRICS_TOKEN`                 | `ops_metrics()` y la identidad del despliegue                           |
| Hosting                | Panel del proveedor                                           | Peticiones, códigos 5xx, latencia                                       |
| Supabase               | Panel y registros de Supabase                                 | Postgres (errores, conexiones, consultas lentas), Auth, Storage         |
| Auditoría funcional    | `audit_events` (`/auditoria`)                                 | Quién hizo qué (no es registro técnico)                                 |

Formato de una línea del registro:

```json
{
  "ts": "2026-10-23T05:14:38.110Z",
  "level": "info",
  "event": "job.step",
  "request_id": "…",
  "job": "correo",
  "ok": true,
  "duration_ms": 412,
  "counts": { "enviados": 3 }
}
```

## 2. Salud y versión

| Ruta                  | Acceso                 | Respuesta                                                                                            |
| --------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `/api/salud`          | Pública                | `{status, version, commit, migration, environment}`. No consulta dependencias                        |
| `/api/salud/listo`    | Pública                | 200 o 503 con `{status, checks: {database, login}, commit}`; estados `ok`, `error`, `no_configurado` |
| `/api/salud/metricas` | `Bearer METRICS_TOKEN` | `{release, metrics}`; 401 sin token, 503 si no hay clave de servicio                                 |

No pasan por el proxy de sesión, no tienen caché y nunca devuelven mensajes de error de las
dependencias. `database = no_configurado` significa que el servidor no tiene `SUPABASE_SECRET_KEY`
(la app sirve igualmente; las tareas y las invitaciones no funcionan).

## 3. Métricas de colas y procesos (`public.ops_metrics`)

Agregados de toda la plataforma, sin identificadores de empresa ni de persona. Solo `service_role`
puede ejecutarla (pruebas en `supabase/tests/94_observabilidad.test.sql`).

| Sección          | Claves                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `jobs`           | `pending`, `processing`, `stuck` (bloqueados > 15 min), `failed_24h`, `oldest_pending_s` |
| `ocr`            | `runs_24h`, `failed_24h`, `needs_review_24h`, `p95_duration_s`                           |
| `outbox`         | `pending`, `failed`, `oldest_pending_s`                                                  |
| `envios`         | `due`, `sent_24h`, `failed_24h`, `oldest_due_s` (correo)                                 |
| `report_exports` | `pending`, `failed_24h`, `oldest_pending_s`                                              |
| `scheduler`      | `last_run_age_s` (−1 si nunca), `runs_24h`, `failed_24h`                                 |
| `settlement`     | `batches_without_exports`, `reports_pending_past_months`                                 |

**Latencia y tasa de error** de las peticiones se toman del hosting (todos los proveedores las dan);
la app añade el recuento de errores no controlados (`app.request_error`) agrupable por ruta.

## 4. Configuración portable

- `ops/observabilidad/alertas.json`: cada alerta con severidad, señal y condición, dueño, acción y
  runbook. `tests/unit/observabilidad.test.ts` comprueba que cada dueño existe, cada runbook enlaza a
  un apartado real y cada métrica citada existe en `ops_metrics`.
- `ops/observabilidad/panel.json`: paneles recomendados (disponibilidad, errores, colas,
  integraciones y cierre mensual) y su fuente.

Para llevarlo a una herramienta concreta:

1. Enviar la salida estándar del servidor a la herramienta de registros del hosting o a una externa.
   Las líneas son JSON: se crean métricas por `event` y por campos numéricos.
2. Crear una sonda que llame cada minuto a `/api/salud` y `/api/salud/listo` desde fuera.
3. Programar la lectura de `/api/salud/metricas` (o usar el evento `ops.metrics`) y traducir las
   condiciones de `alertas.json`.
4. Asignar el contacto real de cada dueño (`propietarios` en `alertas.json`) y el canal de aviso.

## 5. Alertas

Resumen (el detalle y la acción están en `alertas.json` y en docs/RUNBOOKS.md, § 10):

| Área                | Alertas                                                                           | Dueño              |
| ------------------- | --------------------------------------------------------------------------------- | ------------------ |
| Aplicación          | `app-no-responde`, `errores-aplicacion`, `latencia-alta`                          | Guardia            |
| Login               | `login-no-disponible`, `login-errores`, `mfa-rafaga`                              | Guardia, seguridad |
| Base de datos y RLS | `base-de-datos-no-disponible`, `rls-denegaciones`                                 | Guardia, seguridad |
| OCR y colas         | `ocr-fallos`, `cola-trabajos-atascada`, `tareas-sin-ejecutar`, `avisos-atascados` | Guardia            |
| Correo              | `correo-fallos`                                                                   | Guardia            |
| Storage             | `storage-errores`                                                                 | Guardia            |
| Cierre mensual      | `cierre-sin-paquete`, `cierre-pendiente`                                          | Contabilidad       |
| Accesos de máquina  | `acceso-maquina-no-autorizado`                                                    | Seguridad          |
| Despliegue          | `despliegue-fallido`                                                              | Guardia            |

Los umbrales son iniciales y se ajustarán con los datos del piloto. Los dueños son roles: la
persona y el canal de cada uno se asignan en la lista de comprobación del piloto (docs/RELEASE.md).

## 6. Limitaciones

- No hay trazas distribuidas ni APM: cuando se elija proveedor, `instrumentation.ts` es el punto
  para añadir OpenTelemetry.
- Los errores del navegador no se recogen (solo los del servidor).
- La latencia por petición depende del hosting elegido.
- Sin datos reales todavía: los umbrales no están calibrados.
