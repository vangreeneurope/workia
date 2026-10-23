# Informe de preparación para el piloto

**Fecha**: 2026-10-23 · **Alcance**: CI/CD, entornos, despliegue, observabilidad, copias y
operación para un piloto controlado con empresas y usuarios sintéticos en staging.

## 1. Conclusión

El repositorio está **preparado** para que cada cambio sea revisable (PR con un check único y
reproducible), desplegable (workflow portable por entornos) y recuperable (migraciones con reversión
probada y procedimiento de restauración ensayado en local). **No está listo para el piloto** hasta
completar la configuración externa del § 3: no hay proyecto de Supabase ni hosting ni protección de
ramas configurados, y la restauración en Supabase no se ha ensayado. Ninguno de esos pasos requiere
cambios de código.

## 2. Estado por área

| Área                          | Estado                                     | Evidencia                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CI reproducible               | Listo en el repositorio                    | `ci.yml` validado con actionlint; los pasos se han ejecutado en local (§ 4). Pendiente de ejecutarse en GitHub                                                                       |
| PR no fusionable con fallos   | Listo; requiere configurar la protección   | Check único `CI correcto`; configuración en docs/CI_CD.md, § 3 (no aplicada: sin autorización)                                                                                       |
| Migraciones                   | Listo                                      | Validador de inmutabilidad y orden probado con casos negativos; 15 migraciones, 12 reversiones exactas; aplicación una vez por entorno con salvaguardas probadas con un CLI simulado |
| Despliegue preview y staging  | Listo en el repositorio; sin proveedor     | Interfaz y adaptador de ejemplo; imagen de contenedor construida y arrancada (healthy) en local                                                                                      |
| Identificación de despliegues | Listo                                      | `/api/salud`: versión, commit, migración y entorno; verificación tras desplegar                                                                                                      |
| Secretos por entorno          | Documentado                                | docs/CI_CD.md, § 6; ningún secreto en YAML, artefactos ni registros                                                                                                                  |
| Observabilidad                | Listo en el repositorio; sin herramienta   | Registros JSON, errores del servidor, `ops_metrics` (8 pruebas SQL), panel y 18 alertas                                                                                              |
| Alertas con dueño y acción    | Listo; faltan personas                     | Cada alerta con rol dueño, acción y runbook validados por prueba; contactos PENDIENTES                                                                                               |
| Runbooks                      | Listo                                      | Login, base de datos, RLS, OCR, correo, Storage, colas, cierre mensual, despliegue                                                                                                   |
| Copias de PostgreSQL          | Procedimiento listo; plan sin anotar       | docs/COPIAS_Y_RESTAURACION.md; datos del plan PENDIENTES                                                                                                                             |
| Copias de Storage             | **Pendiente de decisión**                  | La copia de la base no las incluye; opciones en § 4 del documento                                                                                                                    |
| Prueba de restauración        | **Local: ejecutada · Supabase: pendiente** | Local con datos sintéticos superada; la de Supabase requiere el proyecto real                                                                                                        |
| Release y piloto              | Listas preparadas                          | docs/RELEASE.md                                                                                                                                                                      |

## 3. Pendiente antes del piloto (fuera del código)

1. **Protección de `main` y entornos de GitHub** (docs/CI_CD.md, § 3): la configura una persona
   administradora; este trabajo no ha cambiado ajustes remotos.
2. **Primera ejecución del CI en GitHub** y confirmación de que `CI correcto` aparece como check.
   El repositorio local de esta sesión no tiene remoto configurado: hay que subir la rama.
3. **Proyecto de Supabase de staging** (y de preview), con Auth configurado, y sus secretos y
   variables en GitHub › Environments.
4. **Hosting** (ADR): adaptador de despliegue, secretos de ejecución, planificador de `/api/tareas`.
5. **Observabilidad**: destino de registros, sonda de salud, alertas creadas y **personas y canales**
   de guardia, seguridad y contabilidad de cada empresa.
6. **Copias**: anotar plan, retención y PITR; decidir la copia de Storage; ensayar la restauración en
   staging y cronometrarla.
7. Decisiones de docs/PENDIENTES_LEGALES.md necesarias para el piloto (21 y 22 son nuevas: copias
   lógicas y RPO/RTO).

## 4. Verificación realizada (2026-10-23, en local)

| Verificación                         | Resultado                                                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `npm run check`                      | Tipos, lint, formato y 300 pruebas unitarias en verde                                                       |
| `npm run test:db`                    | Todas las suites en verde, incluida `94_observabilidad` (8) y la reversión sin pérdida de datos             |
| `npm run db:check-migrations`        | 15 migraciones válidas; casos negativos detectados (edición de una fusionada y fecha anterior)              |
| `npm run build` y `npm run test:e2e` | Build correcto; 121 E2E superadas, 0 fallos; auditoría de vistas sin hallazgos                              |
| `npm run ops:prueba-restauracion`    | Esquema idéntico, 81 tablas y 251 filas, escáner de catálogo en verde                                       |
| Imagen de contenedor                 | Construida y arrancada: `HEALTHCHECK` healthy, usuario sin privilegios, `/api/salud` con commit y migración |
| actionlint 1.7.7                     | Sin errores en `ci.yml` y `despliegue.yml`                                                                  |

Limitaciones de esta verificación: los workflows no se han ejecutado en GitHub; el despliegue y las
migraciones no se han ejecutado contra ningún proyecto (no existe), solo sus salvaguardas con un CLI
simulado; la imagen se construyó inyectando el proxy de red de este entorno en el paso `npm ci` (el
`Dockerfile` del repositorio no cambia).

## 5. Riesgos principales

| Riesgo                                            | Mitigación                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| Pérdida de archivos de Storage sin copia          | Decidir la copia (§ 4 de COPIAS) antes de cargar datos reales                |
| Alertas sin persona que las atienda               | Asignar dueños como condición de inicio del piloto (docs/RELEASE.md)         |
| Migración incompatible con el código en ejecución | Patrón expandir y contraer, revisión en la PR y despliegue de staging previo |
| Token de larga duración del CLI de Supabase       | Limitado al entorno, tras aprobación, con rotación documentada               |
| Umbrales de alertas sin calibrar                  | Revisión con los datos del piloto                                            |
| OCR sin trabajador en segundo plano               | Trabajos bloqueados recuperables con «Volver a leer»; gasto manual posible   |

## 6. Siguiente paso

Con los puntos 1 a 3 del § 3 resueltos, el repositorio queda listo para ejecutar el plan de QA
sobre staging con los recorridos de docs/RELEASE.md, § 3.
