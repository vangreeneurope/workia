# Release y piloto

Listas de comprobación para publicar una versión y para el piloto controlado con empresas y
usuarios sintéticos en staging. Cada casilla la marca una persona con nombre y fecha en el ticket de
la release; si algo no aplica, se anota el motivo.

## 1. Publicar una versión

### Antes

- [ ] Todas las PR de la versión están fusionadas en `main` con `CI correcto` y aprobación.
- [ ] El CI nocturno (E2E completo: auditoría de vistas y rendimiento) está en verde para el commit.
- [ ] `CHANGELOG.md`: mover «Sin publicar» a la nueva versión con fecha; subir `version` en
      `package.json` (SemVer: mayor si rompe datos o integraciones, menor si añade, parche si corrige).
- [ ] Migraciones de la versión revisadas: compatibles con el código anterior durante el despliegue,
      pérdida de datos de cada reversión declarada, sin cambios destructivos en un solo paso.
- [ ] `docs/ESTADO_PROYECTO.md` actualizado y ADR para cada decisión de arquitectura.
- [ ] Nada pendiente en `docs/PENDIENTES_LEGALES.md` que bloquee esta versión.

### Staging

- [ ] El despliegue automático a staging terminó bien: el resumen muestra entorno, commit, migración
      y URL, y la verificación pasó.
- [ ] `/api/salud` en staging sirve el commit y la migración esperados.
- [ ] Prueba de humo manual en móvil y escritorio: acceso con MFA, fichaje, solicitud, gasto,
      aprobación, informe y exportación.
- [ ] Sin alertas abiertas (docs/OBSERVABILIDAD.md) tras una ejecución de `/api/tareas`.

### Producción

- [ ] Etiqueta `vX.Y.Z` en el commit verificado en staging.
- [ ] Si hay migraciones pendientes: copia o punto de restauración verificado (docs/COPIAS_Y_RESTAURACION.md,
      § 3) y anotado en el ticket.
- [ ] Workflow «Despliegue» lanzado a mano con `entorno = production`, `ref = vX.Y.Z` y, si procede,
      «copia confirmada»; aprobado por un revisor del entorno distinto de quien lo lanza.
- [ ] Verificación del workflow en verde y `/api/salud` con la versión nueva.
- [ ] Vigilancia de alertas durante la primera hora; plan de vuelta atrás a mano (docs/CI_CD.md, § 8).
- [ ] Comunicación a las empresas (novedades y posibles cortes).

## 2. Entorno (una vez por entorno)

- [ ] Proyecto de Supabase propio en región UE; plan y copias anotados en
      docs/COPIAS_Y_RESTAURACION.md, § 2 (producción).
- [ ] Auth: MFA TOTP activado, contraseña mínima de 12, registro abierto desactivado, URLs de
      redirección del entorno, SMTP propio con dominio verificado.
- [ ] Migraciones aplicadas por el workflow (nunca a mano) y comprobación del catálogo de seguridad.
- [ ] GitHub › Environments con sus secretos y variables (docs/CI_CD.md, § 6); `production` con
      revisores obligatorios.
- [ ] Protección de `main` configurada según docs/CI_CD.md, § 3.
- [ ] Hosting elegido (ADR), adaptador de despliegue, `APP_ENV` y secretos de ejecución en su gestor.
- [ ] Planificador de `/api/tareas` cada 5-15 minutos con `CRON_SECRET`.
- [ ] Sonda externa de `/api/salud` y `/api/salud/listo` cada minuto.
- [ ] Registros del servidor enviados a la herramienta de observabilidad; alertas de
      `ops/observabilidad/alertas.json` creadas.
- [ ] **Dueños de alertas asignados** (persona y canal) para guardia, seguridad y contabilidad de cada
      empresa; `propietarios` de `alertas.json` actualizado.
- [ ] `RETENTION_MODE` en simulación; `OCR_PROVIDER` y `EMAIL_PROVIDER` vacíos o con proveedor
      aprobado por ADR (nunca `fake` en producción).

## 3. Piloto controlado con empresas y usuarios sintéticos (staging)

Objetivo: ejercitar todos los flujos con datos inventados antes de cargar datos reales. Nada de lo
que se cree aquí representa a personas reales. Las semillas de `supabase/seeds` siguen siendo solo
locales: en staging los datos se crean **a través de la propia aplicación**, lo que también prueba
los flujos de alta.

### Preparación

- [ ] Staging desplegado con la versión candidata y sin alertas abiertas.
- [ ] Buzones de prueba bajo un dominio de la organización (p. ej. direcciones con sufijo `+rol` de un
      buzón compartido) para recibir invitaciones y avisos. Ningún correo de una persona real.
- [ ] Grupo sintético con dos empresas («Piloto Norte» y «Piloto Sur»), cada una con un centro,
      dos equipos, calendario laboral, una plantilla de turno y política de vacaciones de ejemplo.
- [ ] Usuarios sintéticos invitados desde la app, con MFA donde el rol lo exige:

| Rol                       | Norte     | Sur |
| ------------------------- | --------- | --- |
| Administración de grupo   | 1 (común) | —   |
| Administración de empresa | 1         | 1   |
| RR. HH.                   | 1         | 1   |
| Manager                   | 1         | 1   |
| Personas empleadas        | 3         | 2   |
| Contabilidad              | 1         | 1   |
| Auditoría                 | 1         | —   |

### Recorridos (cada uno con su resultado anotado)

- [ ] Fichaje móvil con y sin ubicación, pausa y salida; terminal compartido con PIN; corrección
      solicitada y aprobada; incidencia revisada.
- [ ] Fichaje sin conexión (modo avión) que se envía al recuperar la red sin duplicarse.
- [ ] Solicitud de vacaciones, aprobación por el manager y saldo actualizado; ausencia con
      justificante abierta solo por RR. HH.
- [ ] Gasto con foto de ticket (sin OCR o con proveedor aprobado), kilometraje y gasto sin ticket;
      informe mensual, aprobación por pasos y cierre contable con paquete descargado.
- [ ] Avisos en la bandeja y por correo; preferencias; recordatorio programado.
- [ ] Informes y exportación del registro horario; consulta de auditoría.
- [ ] Aislamiento: una persona de Norte no ve nada de Sur (listas, URLs directas, exportaciones).
- [ ] Membresía caducada: tras la baja, la persona deja de acceder.
- [ ] Derechos: solicitud de acceso y de supresión sintética con revisión.
- [ ] Alertas: forzar una alerta de prueba por área (p. ej. parar el planificador para
      `tareas-sin-ejecutar`) y comprobar que llega a su dueño y que el runbook se puede seguir.
- [ ] Despliegue de una versión nueva durante el piloto y vuelta atrás ensayada.
- [ ] Prueba de restauración de staging (docs/COPIAS_Y_RESTAURACION.md, § 7) cronometrada.

### Criterios de salida del piloto

- Todos los recorridos completados o con incidencias aceptadas por escrito.
- Sin hallazgos críticos abiertos de seguridad, aislamiento o pérdida de datos.
- Alertas probadas con dueño que respondió; umbrales revisados con los datos del piloto.
- Restauración ensayada con tiempos anotados y decisión tomada sobre la copia de Storage.
- Decisiones legales necesarias cerradas (docs/PENDIENTES_LEGALES.md).
- Aprobación de la organización para pasar a datos reales.

Al terminar, los datos sintéticos de staging se pueden conservar para pruebas; nunca se copian a
producción.
