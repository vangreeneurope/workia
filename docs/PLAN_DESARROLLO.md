# Plan de desarrollo

Regla: no se empieza una fase hasta cumplir los criterios de salida de la anterior. Los plazos no se
estiman aquí; se planificarán con el equipo cuando se confirmen las preguntas abiertas del PRD.

## Fase 0 · Base técnica (completada, ver ESTADO_PROYECTO)

Estructura del repositorio, configuración (TypeScript estricto, ESLint, Prettier, Vitest,
Playwright), variables de entorno de ejemplo, Supabase (clientes, proxy, DAL), esquema base
multiempresa con RLS y auditoría, autenticación, layout responsive con navegación protegida por
rol, selector de empresa con identidad visual, PWA, documentación.

Criterios de salida: build, tipos, lint, pruebas unitarias, E2E y RLS en verde.
Pendiente externo: validar migraciones y flujo de acceso en un proyecto Supabase real.

## Fase 1 · Administración y control horario

Estado (2026-10-23): **administración implementada** (empresas, centros, equipos, personas,
condiciones con fecha de efecto, bajas, cuentas y roles, aprobadores, suplencias, importación CSV,
auditoría minimizada). Calendarios laborales, plantillas de turno versionadas y asignaciones
implementados (2026-10-24, docs/HORARIOS.md). Control horario con fichaje móvil, web y terminal,
correcciones e incidencias implementado (2026-10-25, docs/CONTROL_HORARIO.md). Pendiente:
exportación para la Inspección, visor de auditoría, tareas programadas (recordatorios y borrado de
selfies) y validación de todos los módulos en un proyecto Supabase real.

1. Proyecto Supabase de pruebas y de producción (región UE); migraciones aplicadas; tipos
   regenerados.
2. Gestión de empresas (admin. global): alta, edición, logotipo y color.
3. Gestión de personas (RR. HH.): invitación por correo desde servidor (requiere ADR sobre el uso
   de la clave secreta o de una Edge Function), roles, baja, asignación de responsables.
4. Control horario: hecho (`punches` inmutables, `time_entries` recalculadas, ajustes, incidencias,
   terminal con PIN, historial y revisión). Falta la exportación para la Inspección.
5. Visor de auditoría.

Criterios de salida: pruebas RLS de las nuevas tablas (incluida la inmutabilidad), E2E con sesión
real en un proyecto de pruebas, revisión de NORMATIVA con la asesoría.

## Fase 2 · Vacaciones y ausencias

Estado (2026-10-26): **implementado y probado en local** (docs/AUSENCIAS.md). Pendiente: valores
reales de cada empresa, tareas programadas y validación en un proyecto Supabase real.

Tipos de ausencia (los calendarios laborales ya existen y las aprobadas alimentarán `leave_periods`) y políticas por empresa, saldos, solicitudes y
aprobaciones (incluido el responsable de otra empresa), justificantes privados, calendario de
equipo.

## Fase 3 · Gastos con OCR

Decisión de proveedor OCR (ADR), captura con cámara, extracción y revisión, políticas de gasto,
flujo de aprobación y validación por Contabilidad, exportación contable, tickets privados.

Hecho (2026-10-27, docs/GASTOS.md): captura con cámara o archivo, validación y duplicados, bucket
privado, adaptador de OCR con proveedor falso para pruebas (sin proveedor real: pendiente de ADR),
cola con reintentos, revisión con confianza por campo, política y categorías, kilometraje.
Hecho (2026-10-28, docs/LIQUIDACION_GASTOS.md): informes mensuales con snapshot y versiones,
aprobación por líneas y pasos con reglas y delegación, consola contable, cierre idempotente en lotes,
lote corrector y paquete PDF, CSV, XLSX y ZIP. Pendiente: proveedor de OCR y mapeo a un ERP concreto.

## Fase 4 · Informes y notificaciones

Informes por empresa y grupo, exportaciones, notificaciones por correo y push en la PWA respetando
la desconexión digital.

## Fase 5 · Endurecimiento y salida a producción

CSP con nonce (ADR-009), revisión de seguridad completa, pruebas de carga básicas, copias de
seguridad y restauración probadas, monitorización de errores, documentación de usuario, formación.

## Prácticas transversales

- Cada cambio: `npm run check`, y `npm run test:db` si toca migraciones.
- Ramas por funcionalidad y Pull Requests revisadas; nada directo a la rama principal.
- Cada decisión relevante, en `docs/DECISIONES.md`; cada avance, en `docs/ESTADO_PROYECTO.md`.
