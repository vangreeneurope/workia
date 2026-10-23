# Registro de cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versiones
[SemVer](https://semver.org/lang/es/). Cada PR añade su entrada en «Sin publicar»; al publicar una
versión se mueve a su sección con la fecha y se crea la etiqueta `vX.Y.Z` (docs/RELEASE.md).
`/api/salud` muestra la versión y el commit desplegados en cada entorno.

## Sin publicar

### Añadido

- CI/CD portable: acciones fijadas por commit, concurrencia, cachés seguras, E2E mínimo en PR y
  completo en main y cada noche, check único «CI correcto», validación de migraciones inmutables,
  Dependabot y plantilla de PR (docs/CI_CD.md).
- Despliegue por entornos (preview, staging, producción) con interfaz de proveedor, migraciones una
  vez por entorno con copia confirmada en producción, verificación de commit y migración, y
  `Dockerfile` de ejemplo.
- Salud y versión: `/api/salud`, `/api/salud/listo` y `/api/salud/metricas` (con `METRICS_TOKEN`).
- Observabilidad: errores del servidor (`app.request_error`), métricas de tareas, OCR, correo, colas
  y cierre mensual (`public.ops_metrics`), alertas portables con dueño y runbook
  (docs/OBSERVABILIDAD.md).
- Copias y restauración documentadas y prueba de restauración local
  (docs/COPIAS_Y_RESTAURACION.md).
- Lista de release y piloto (docs/RELEASE.md) e informe de preparación (docs/PREPARACION_PILOTO.md).
- Versión visible `vAA.N` calculada al publicar (acceso, menú lateral y menú de usuario en móvil) y
  expuesta en `/api/salud` como `release` (ADR-066).
- Cierre automático de la sesión a los 60 minutos de entrar, con aviso 5 minutos antes, cierre
  inmediato al volver a una pestaña antigua y duración configurable por empresa en Administración ›
  Configuración (migración `20261102100000_sesion_y_novedades`, ADR-067).
- Novedades: icono en la cabecera, historial por versión con «Antes» y «Ahora, paso a paso» y aviso
  al entrar tras una actualización (ADR-068).
- Autoguardado del texto de los formularios en el dispositivo, recuperable al volver a entrar
  (ADR-069).
- Ayuda: landing y manual de uso por apartados en `/ayuda`.
- Demostración navegable con datos ficticios en GitHub Pages (`vangreeneurope.github.io/workia`),
  generada por el workflow `Demo` en cada cambio de `main` (ADR-070).

### Cambiado

- El cierre contable registra el fallo de generación del paquete en lugar de ignorarlo.
- Nombre de la aplicación: Workia, con logotipo e iconos.

### Corregido (auditoría QA)

- La detección de PDF con contenido activo se podía eludir con nombres escapados (`/J#61vaScript`)
  o con diccionarios dentro de flujos de objetos comprimidos; ahora se revisan ambos.
- Los JPEG subidos conservaban datos añadidos tras el final de la imagen (archivos políglotas).
- El registro técnico usaba `process.stdout`, inexistente en el runtime Edge.
- El plan de despliegue fallaba en repositorios privados (`git fetch` sin credenciales) y las
  migraciones fallaban en rojo en entornos sin Supabase configurado; ahora se saltan con aviso y
  nunca se publica en staging o producción sin migrar su base.

### Pruebas

- `npm run test:aislamiento`: pruebas adversarias sobre una base poblada (lectura, funciones,
  escrituras, Storage y conciliación contable) con control positivo; en el CI.
- Concurrencia: doble decisión simultánea y doble envío con la misma clave.

## 0.1.0 - 2026-10-22

Primera versión completa en local, sin desplegar.

### Añadido

- Base técnica multiempresa (Next.js, Supabase, autorización en tres capas) y modelo de aislamiento
  por empresa con RLS.
- Administración de organización y personas; calendarios laborales, plantillas de turno y
  asignaciones.
- Control horario con fichaje móvil, web y terminal con PIN; correcciones e incidencias.
- Vacaciones y ausencias con políticas versionadas, saldos y aprobación.
- Gastos con captura de tickets y OCR intercambiable; liquidación con informes mensuales,
  aprobación por pasos y lotes contables.
- Avisos en bandeja, correo idempotente y tareas programadas.
- Informes, exportaciones y auditoría consultable.
- Endurecimiento de seguridad y privacidad (MFA por rol, soporte acotado, retención simulable,
  derechos de las personas).
- Experiencia móvil, escritorio, PWA y accesibilidad.
