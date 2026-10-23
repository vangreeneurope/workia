# Informes, aprobación y liquidación de gastos

Ciclo completo del gasto desde que está listo hasta el lote contable (migración
`20261028100000_informes_gastos`). Probado en `supabase/tests/90_liquidacion.test.sql`,
`scripts/test-db-concurrency.sh` (cierres simultáneos) y `tests/unit/settlement.test.ts`.

## 1. Estados y transiciones

El gasto y su informe forman una sola máquina de estados:

| Estado              | Dónde   | Se llega desde                                               | Qué significa                                       |
| ------------------- | ------- | ------------------------------------------------------------ | --------------------------------------------------- |
| `draft`             | gasto   | creación, reabrir                                            | La persona está completando los datos               |
| `ready`             | gasto   | `draft` al confirmar                                         | Listo para enviar en el informe del mes             |
| `submitted`         | informe | envío del informe del mes                                    | Esperando al aprobador                              |
| `in_review`         | informe | `submitted` (primera decisión) o paso aprobado con más pasos | En revisión                                         |
| `returned`          | informe | `submitted` o `in_review`                                    | Devuelto a la persona; la versión queda congelada   |
| `approved`          | informe | `submitted` o `in_review`                                    | Todos los pasos aprobados; listo para el cierre     |
| `included_in_batch` | informe | `approved` al cerrar el periodo                              | Está en un lote contable numerado                   |
| `accounted`         | informe | `included_in_batch`                                          | Contabilidad confirmó que lo registró en su sistema |

Cualquier otra transición la rechaza la base de datos (`guard_report_status`). Un gasto incluido en
un informe que no esté devuelto queda **bloqueado**: no se reabre, no se edita ni se descarta. Una
línea **rechazada** es definitiva: ese gasto no se vuelve a enviar.

## 2. Informe mensual y versiones

- La persona envía el informe de un mes (`/gastos/informes`) con sus gastos `ready` de ese mes que no
  estén en otro informe vigente. Solo puede haber un informe del mes en revisión a la vez. Enviar es
  idempotente (clave por envío).
- Al enviar se guarda una **copia (snapshot)** de cada gasto con su categoría, y la huella SHA-256 de
  esa copia. Lo que revisa el aprobador ya no cambia aunque el gasto se edite después.
- Si el informe se devuelve, la persona corrige las líneas devueltas y vuelve a enviar: se crea la
  **versión siguiente**, enlazada a la anterior, que queda intacta con sus decisiones. Las líneas
  aprobadas cuya copia no ha cambiado (misma huella) **heredan la aprobación**; las corregidas
  vuelven a revisarse; las rechazadas no se incluyen.
- Tras un informe aprobado, los gastos listos del mismo mes que lleguen después se envían como una
  versión nueva (complementaria).

## 3. Aprobación

| Paso               | Quién                                                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 (líneas)         | Manager vigente para "gastos" (o su suplente); sin manager o si sería autoaprobación, la administración de la empresa con permiso `approve`        |
| 2 a 9 (opcionales) | Reglas configuradas: si el total del informe en una moneda (o el de una categoría) alcanza un umbral, aprueba además Administración o Contabilidad |

- En el paso 1 se decide **cada línea**: aprobar, rechazar (con motivo) o devolver para corregir
  (con motivo). Al terminar la revisión, si alguna línea se devolvió, el informe vuelve a la persona;
  si no, pasa al siguiente paso o queda aprobado.
- En los pasos por regla se aprueba o se devuelve el informe entero (devolver exige motivo).
- **Nadie aprueba sus propios gastos ni dos pasos del mismo informe.**
- **Delegación**: si actúa una suplente vigente (suplencias de Administración › Aprobadores, tipo
  gastos o todos), queda registrado a quién sustituye. Si el manager cambia mientras el informe está
  pendiente, decide el aprobador vigente.

## 4. Cierre contable

`/gastos/contabilidad` muestra por periodo la **conciliación** (informes por estado y su importe por
moneda), los **pendientes** (en revisión o devueltos sin reenviar) y los **bloqueos** (categorías
sin cuenta contable).

- Solo **Contabilidad** (permiso `close` a nivel de empresa) cierra. El cierre es transaccional:
  pasa los informes aprobados del periodo a un lote con **número correlativo sin huecos** por
  empresa.
- **Idempotente**: reintentar con la misma clave devuelve el mismo lote. Un segundo cierre ordinario
  del mismo periodo se rechaza. Dos cierres simultáneos producen un solo lote (probado).
- Con informes pendientes no se cierra, salvo que se **excluyan** expresamente con un motivo (queda
  registrado quién lo autorizó y en `audit_log`).
- Un lote cerrado **no se modifica nunca**. Los ajustes van en un **lote corrector** (otro número)
  que puede incluir informes del periodo aprobados después del cierre y ajustes manuales con motivo
  (importes positivos o negativos).
- "Marcar como contabilizado" pasa el lote y sus informes a `accounted`.

## 5. Dinero

Siempre **céntimos enteros** (`bigint`) en base de datos, en TypeScript y al formatear (sin números
con decimales). Cada moneda se totaliza por separado: nunca se suman importes de monedas distintas
ni se convierten. Los totales por empleado, categoría, cuenta, centro de coste y proyecto los calcula
`accounting_batch_totals` a partir de las líneas del lote; la aplicación vuelve a calcularlos y no
genera ningún archivo si no coinciden.

## 6. Paquete contable

Se genera al cerrar y puede regenerarse desde el lote. Los archivos son **deterministas** (misma
fecha interna, la del cierre, y orden estable): regenerar da los mismos bytes y la misma huella
SHA-256; la base de datos rechaza un archivo distinto del registrado.

| Archivo                                                       | Contenido                                                                                    |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `liquidacion-<empresa>-<aaaa-mm>-lote-0001.pdf`               | Liquidación legible: totales por moneda y dimensión y detalle                                |
| `liquidacion-<empresa>-<aaaa-mm>-lote-0001.csv`               | Una fila por línea (esquema abajo)                                                           |
| `liquidacion-<empresa>-<aaaa-mm>-lote-0001.xlsx`              | Hojas `Lineas` (mismas columnas) y `Totales`                                                 |
| `liquidacion-<empresa>-<aaaa-mm>-lote-0001-justificantes.zip` | Tickets: `<empleado>/<fecha>_<línea>_<gasto>.<ext>` e `indice.csv` con la huella de cada uno |

Los lotes correctores añaden `-corrector` al nombre.

### Esquema del CSV

UTF-8 con BOM, separador `;`, fin de línea CRLF, importes con punto decimal y dos decimales. Las
celdas de texto que empiezan por `=`, `+`, `-`, `@` se prefijan con `'` (protección frente a
fórmulas); los importes no.

| Columna                                              | Contenido                                     |
| ---------------------------------------------------- | --------------------------------------------- |
| `lote`                                               | Número del lote                               |
| `tipo_lote`                                          | `ordinario` o `corrector`                     |
| `periodo`                                            | `aaaa-mm`                                     |
| `linea`                                              | Número de línea dentro del lote               |
| `codigo_empleado`, `empleado`                        | Código y "Apellidos, Nombre" al cerrar        |
| `fecha`                                              | Fecha del gasto (`aaaa-mm-dd`)                |
| `categoria_codigo`, `categoria`                      | Categoría del gasto                           |
| `cuenta`, `cuenta_impuestos`, `cuenta_contrapartida` | Del mapeo contable configurado                |
| `centro_coste`, `proyecto`                           | Los indicados en el gasto                     |
| `proveedor`, `nif_proveedor`, `documento`            | Datos del ticket confirmados por la persona   |
| `moneda`                                             | ISO 4217                                      |
| `base`, `impuestos`                                  | Si constan en el gasto                        |
| `total`                                              | Importe (negativo en ajustes que restan)      |
| `total_centimos`                                     | El mismo importe en céntimos enteros          |
| `motivo_ajuste`                                      | Solo en ajustes manuales de un lote corrector |
| `id_gasto`                                           | Identificador del gasto (vacío en ajustes)    |

El formato es genérico a propósito: no imita el de ningún ERP. Para importarlo en uno concreto se
hará un mapeo específico cuando se decida cuál (pendiente).

## 7. Privacidad y acceso

| Quién                                          | Informes                                   | Lotes y totales | Cerrar, generar y descargar el paquete |
| ---------------------------------------------- | ------------------------------------------ | --------------- | -------------------------------------- |
| La persona                                     | Los suyos                                  | No              | No                                     |
| Manager / suplente                             | Los de su equipo; decide si es su paso     | No              | No                                     |
| Administración de empresa                      | Todos; aprueba pasos por rol y de respaldo | Consulta        | No                                     |
| Contabilidad                                   | Todos                                      | Sí              | **Sí** (solo con ámbito de empresa)    |
| Administración de grupo, RR. HH., otra empresa | No                                         | No              | No                                     |

- El paquete se guarda en el bucket privado `accounting-exports`
  (`<empresa>/lotes/<lote>/<archivo>`). Cada archivo se descarga con una URL firmada de 60 segundos
  y la base de datos registra la generación y cada descarga (`accounting_export_events`).
- **Los tickets nunca se envían por correo**: la plataforma no tiene envío de archivos por correo; el
  ZIP solo se descarga desde la consola con permiso de cierre.

## 8. Pendiente

- Mapeo de exportación a un ERP concreto, cuando se decida (el CSV/XLSX genérico es la base).
- Avisos (correo) de informes pendientes y devueltos, sin adjuntos.
- Plazo de conservación de lotes y paquetes con la asesoría.
