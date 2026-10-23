# Informe QA previo al piloto

**Fecha**: 2026-10-23 · **Rama auditada**: `qa/auditoria-piloto` (incluye todos los módulos) ·
**Trazabilidad**: [REQUIREMENTS_TRACEABILITY.md](REQUIREMENTS_TRACEABILITY.md) ·
**Evidencias**: [evidencias/](evidencias/)

## 1. Recomendación

**GO condicionado para un piloto con empresas y usuarios sintéticos en staging**, una vez resueltos
los bloqueos externos B-01 a B-04 (§ 7).

**NO-GO para datos reales** hasta cerrar B-01 a B-09 y los P2 abiertos QA-04, QA-05 y QA-08, o
aceptarlos por escrito con su dueño.

Base de la recomendación:

- No hay ningún P0 ni P1 abierto: no se encontraron.
- El aislamiento multiempresa se ha comprobado con pruebas positivas y negativas: 612 lecturas,
  3.794 llamadas a funciones, 822 escrituras directas y 60 operaciones de Storage, todas
  bloqueadas, más un control positivo que demuestra que los arneses detectan una fuga real.
- Los totales contables se reconcilian en la base, en el informe de gastos y en los archivos de
  cierre (PDF, CSV y XLSX), siempre por moneda.
- Los flujos críticos funcionan en móvil y escritorio con teclado, sin infracciones graves de
  accesibilidad (axe-core).

Lo que impide los datos reales:

- Una decisión de producto contraria al requisito central (QA-06).
- Decisiones legales pendientes.
- Copias de Storage sin resolver.
- Ninguna prueba contra Supabase, Auth, Storage, Safari ni dispositivos reales.

Nada de este informe acredita cumplimiento legal: identifica qué debe validar la organización.

## 2. Alcance

Revisado sobre el código, no sobre la documentación:

- Las 15 migraciones (esquema, RLS, funciones y Storage).
- Las 89 funciones `SECURITY DEFINER` ejecutables por personas con sesión (87 atacadas; las 2 del
  terminal son para el rol anónimo y tienen sus propias pruebas).
- Las 137 políticas RLS.
- Los 13 Route Handlers.
- Las Server Actions principales.
- Los dos workflows de CI/CD y las pruebas existentes.

No hay Edge Functions de Supabase (`supabase/functions` no existe).

Fuera de alcance por falta de recursos:

- Un proyecto real de Supabase (Auth, Storage y copias).
- Safari/WebKit, lectores de pantalla y dispositivos físicos.
- Proveedores reales de OCR y correo.
- Ejecución en GitHub Actions.

## 3. Entorno

| Elemento      | Valor                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Sistema       | Contenedor Linux efímero; Node 22.22.0; PostgreSQL 16 local                                                                             |
| Base de datos | Migraciones aplicadas a PostgreSQL 16 con emulación mínima de Supabase (`00_shim`)                                                      |
| API           | PostgREST 12.2.3 real (huella fijada) + pasarela de pruebas para Auth y Storage (ADR-061)                                               |
| Navegador     | Chromium de Playwright 1.56.1; perfiles Pixel 7, iPhone 13 (emulado sobre Chromium) y escritorio                                        |
| Datos         | Exclusivamente sintéticos: escenario de pruebas (empresas A, B y C en dos grupos, 20 personas) y semillas de demostración (Alfa y Beta) |

## 4. Ejecución y resultados

Comandos ejecutados el 2026-10-23 entre las 06:51 y las 07:01 UTC (salida completa en `evidencias/`):

| #   | Comando                           | Resultado                                                                                    |
| --- | --------------------------------- | -------------------------------------------------------------------------------------------- |
| 01  | `npm ci`                          | Correcto (lockfile)                                                                          |
| 02  | `npm run check`                   | Tipos, lint sin avisos, formato y 303 pruebas unitarias (27 archivos) en verde               |
| 03  | `npm run security`                | Sin secretos en 457 archivos versionados; 0 vulnerabilidades de producción                   |
| 04  | `npm run db:check-migrations`     | 15 migraciones válidas                                                                       |
| 05  | `npm run test:db`                 | 1.024 comprobaciones: 15 suites, 11 escenarios de concurrencia, 12 reversiones exactas       |
| 06  | `npm run db:types:check`          | Tipos al día                                                                                 |
| 07  | `npm run test:aislamiento`        | 73 de 73 tablas con datos; lectura, funciones, escrituras, Storage y conciliación sin fallos |
| 08  | `npm run ops:prueba-restauracion` | Esquema idéntico, 81 tablas y 251 filas, escáner en verde; restauración 2,0 s                |
| 09  | `npm run build`                   | Correcto, sin avisos                                                                         |
| 10  | `npx playwright test`             | 121 superadas, 0 fallos, 86 omitidas a propósito (las pruebas con datos usan un perfil)      |

Las 86 omitidas no son fallos: cada prueba que modifica datos o crea sus propios contextos se
ejecuta en un único perfil. Ninguna prueba se ha marcado como superada sin ejecutarla.

**Pruebas adversarias nuevas** (`npm run test:aislamiento`, ahora en el CI). Se ejecutan sobre una
base en la que todos los escenarios de dominio han dejado datos (73 de 73 tablas pobladas):

| Arnés                 | Qué hace                                                                                                                   | Resultado                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `barrido_aislamiento` | 9 perfiles (otra empresa, otro grupo, sin membresía, caducada, rol revocado) leen las 68 tablas con `company_id` y Storage | 0 filas ajenas (solo registros propios de la persona caducada)                       |
| `fuzz_funciones`      | 7 atacantes llaman a las 87 funciones con ids reales de A; huella de todos los datos de A antes y después                  | 0 datos devueltos, huella intacta; el control positivo obtiene datos en 20 funciones |
| `fuzz_escrituras`     | UPDATE en cada columna permitida e INSERT copiando filas reales de A                                                       | 822 intentos bloqueados; el control positivo actualiza 88                            |
| `fuzz_storage`        | Crear, sobrescribir y borrar objetos de A en los 6 buckets                                                                 | 60 bloqueados                                                                        |
| `conciliacion`        | Dimensiones del lote = total por moneda; línea = gasto; lote = gastos incluidos; informe = gastos                          | Todo cuadra                                                                          |

**Validez de los arneses**: se inyectó una política RLS permisiva en `punches` y el barrido falló
nombrando a cada atacante. La primera versión del ataque a funciones confundía columnas de salida
con parámetros y dejaba 30 funciones sin ejercitar; se detectó al revisar los motivos de rechazo,
se corrigió y ahora las 87 se ejercitan. La conciliación dio un falso descuadre por mezclar monedas
en la propia prueba; se corrigió la prueba, no el producto (los datos cuadraban por moneda).

**Concurrencia**: a los 9 escenarios existentes se añadieron doble decisión simultánea (aprobar y
rechazar a la vez) y doble envío con la misma clave. Los 11 pasan.

## 5. Revisión manual

- **Descargas y exportaciones** (7 rutas): todas exigen sesión, comprueban origen y frecuencia
  (`guardDownload`), leen con la sesión de la persona (RLS) y firman URLs de 60 segundos. Las
  exportaciones se auditan y no hay datos personales en la URL ni en el nombre del archivo.
- **Rutas de archivo en la base**: `register_expense_receipt`, `add_absence_attachment`,
  `complete_report_export` y `register_accounting_export` comprueban la empresa, la persona, el
  patrón exacto de ruta y que el objeto exista.
- **Cálculos**: base + impuestos = total (1 céntimo de tolerancia) en base de datos y formulario. Las
  jornadas nocturnas y los cambios de hora tienen pruebas con horas reales. Los totales siempre van
  por moneda (`sumByCurrency`, totales contables por divisa).
- **Privacidad**:
  - Ubicación de una sola lectura (`getCurrentPosition`; `watchPosition` no se usa).
  - Ninguna dependencia biométrica.
  - Ningún `console.*` fuera del registro.
  - Ninguna búsqueda por URL.
  - Registros redactados (con pruebas).
- **Cambio de empresa**: una cookie con una empresa ajena se ignora (pruebas unitarias) y RLS lo
  impide de todos modos.

## 6. Defectos

| ID    | Prio. | Estado                  | Descripción                                                                                                                                                                                                                               | Propietario recomendado     | Condición de cierre                                                                                                                                   |
| ----- | ----- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| QA-01 | P2    | **Corregido**           | El filtro de PDF con contenido activo se eludía con nombres escapados (`/J#61vaScript`) o con diccionarios dentro de flujos de objetos comprimidos                                                                                        | Desarrollo                  | Hecho: `checkPdf` decodifica nombres y revisa ObjStm con límite de descompresión; regresión en `security.test.ts`                                     |
| QA-02 | P3    | **Corregido**           | Los JPEG conservaban datos tras el fin de imagen (archivo políglota)                                                                                                                                                                      | Desarrollo                  | Hecho: se descartan; regresión en `security.test.ts`                                                                                                  |
| QA-03 | P3    | **Corregido**           | El registro técnico usaba `process.stdout`, inexistente en el runtime Edge (error al registrar desde el proxy)                                                                                                                            | Desarrollo                  | Hecho: `console.log` en `log.ts`; build sin avisos                                                                                                    |
| QA-04 | P2    | Abierto                 | La huella SHA-256 que detecta tickets duplicados la envía el llamante: alguien que llame directamente a la API con su sesión puede registrar un duplicado con otra huella                                                                 | Arquitectura                | Registro del ticket solo desde el servidor (revocar `execute` a `authenticated` y llamar tras validar) u otra medida aprobada en ADR; prueba negativa |
| QA-05 | P2    | Abierto                 | Las políticas de Storage permiten subir directamente a la carpeta propia (tickets, justificantes, selfies) sin pasar por la validación de contenido del servidor (firma, PDF activo, metadatos). Lo subido lo abren aprobadores o RR. HH. | Arquitectura y seguridad    | Subida mediante URL firmada emitida tras validar, o revalidación del objeto en el servidor antes de registrarlo; prueba negativa                      |
| QA-06 | —     | **Bloqueo de producto** | El diseño permite que un manager supervise a personas de otra empresa del mismo grupo (ADR-004), contrario al requisito «ningún dato puede cruzar empresas»                                                                               | Dirección de producto y DPD | Decisión escrita: mantener (y reformular el requisito) o restringir a la propia empresa (cambio de modelo con ADR y pruebas)                          |
| QA-07 | P3    | Abierto                 | Una persona con membresía caducada sigue viendo sus propios registros históricos de membresía, rol y asignación (solo identificadores)                                                                                                    | Seguridad                   | Aceptar por escrito o restringir con prueba                                                                                                           |
| QA-08 | P2    | Bloqueado               | Sin antivirus: un archivo EICAR dentro de un PDF válido se acepta (PENDIENTES_LEGALES 19)                                                                                                                                                 | Seguridad                   | Decidir antivirus o aceptar el riesgo con medidas compensatorias                                                                                      |
| QA-09 | P3    | Abierto                 | Los PDF contables y de informes llevan «Portal del empleado» como creador. No se cambió para no alterar los archivos deterministas de cierre                                                                                              | Producto                    | Cambiar antes del primer cierre real, actualizando las huellas fijadas en las pruebas                                                                 |
| QA-10 | P2    | Abierto (conocido)      | OCR sin trabajador en segundo plano: un trabajo bloqueado se recupera solo al reintentarlo desde el gasto                                                                                                                                 | Desarrollo                  | Trabajador programado o paso en `/api/tareas`, con prueba                                                                                             |
| QA-11 | P2    | No verificable aquí     | Safari iOS real, VoiceOver/TalkBack, cámara y GPS de dispositivos sin probar                                                                                                                                                              | QA                          | Sesión manual en dispositivos antes del piloto                                                                                                        |
| QA-12 | P2    | Bloqueado               | Proveedores de OCR y correo sin decidir (ADR pendientes); flujos probados solo con proveedores simulados                                                                                                                                  | Producto y legal            | ADR y contrato de encargo por proveedor                                                                                                               |
| QA-13 | P3    | Abierto                 | Sin E2E por interfaz de la aprobación por pasos y del cierre contable (cubiertos por SQL y unitarias)                                                                                                                                     | QA                          | Añadir E2E de aprobación de informe y cierre                                                                                                          |
| QA-14 | P3    | Abierto                 | El logotipo es una recreación vectorial                                                                                                                                                                                                   | Marca                       | Sustituir por el archivo original                                                                                                                     |

No hay P0 ni P1.

## 7. Bloqueos para el piloto

| ID   | Bloqueo                                                                                               | Dueño                          | Necesario para   |
| ---- | ----------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------- |
| B-01 | Proyecto de Supabase de staging (Auth con MFA, SMTP, Storage) y migraciones aplicadas por el workflow | Plataforma                     | Piloto sintético |
| B-02 | Hosting elegido (ADR) y adaptador de despliegue                                                       | Dirección técnica              | Piloto sintético |
| B-03 | Subida a GitHub, CI ejecutado y protección de `main` configurada (docs/CI_CD.md, § 3)                 | Administración del repositorio | Piloto sintético |
| B-04 | Dueños de alertas asignados (persona y canal)                                                         | Dirección técnica              | Piloto sintético |
| B-05 | Decisión QA-06 (supervisión entre empresas)                                                           | Producto y DPD                 | Datos reales     |
| B-06 | Decisiones de docs/PENDIENTES_LEGALES.md (plazos, bases jurídicas, EIPD, encargados)                  | DPD y asesorías                | Datos reales     |
| B-07 | Copia de Storage decidida y restauración ensayada en Supabase                                         | Seguridad                      | Datos reales     |
| B-08 | Pruebas en dispositivos reales y lector de pantalla (QA-11)                                           | QA                             | Datos reales     |
| B-09 | Proveedores de OCR y correo, o decisión de operar sin ellos (QA-12)                                   | Producto                       | Datos reales     |

## 8. Riesgos residuales

- La pasarela E2E simula Auth y Storage. El comportamiento real de Supabase (firma de URLs, límites,
  sesiones) se valida en staging.
- La emulación de Supabase en PostgreSQL no reproduce todo el producto. RLS y las funciones son las
  mismas, pero conviene ejecutar `97_seguridad_catalogo` contra el proyecto real.
- Los umbrales de alertas no están calibrados sin tráfico real.
- La aprobación humana mitiga QA-04 y QA-05, pero no sustituye la corrección técnica.

## 9. No ejecutado y motivo

| Prueba                                                  | Motivo                                            |
| ------------------------------------------------------- | ------------------------------------------------- |
| Auth, Storage y copias de Supabase reales               | No existe el proyecto                             |
| Workflows en GitHub Actions                             | El repositorio no se ha subido desde este entorno |
| Safari/WebKit, VoiceOver, TalkBack, cámara y GPS reales | Sin WebKit ni dispositivos en el entorno          |
| OCR y correo reales                                     | Sin proveedor decidido                            |
| Carga y volumen más allá de `99_rendimiento`            | Sin entorno representativo                        |
| Antivirus                                               | Sin decisión (QA-08)                              |

## 10. Cómo reproducir

```bash
npm ci
npm run check && npm run security && npm run db:check-migrations
npm run test:db && npm run db:types:check && npm run test:aislamiento
npm run ops:prueba-restauracion
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_placeholder_solo_para_build \
NEXT_PUBLIC_SITE_URL=http://localhost:3000 npm run build
npx playwright test
```
