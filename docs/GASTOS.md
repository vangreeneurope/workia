# Gastos y lectura de tickets (OCR)

Funcionamiento del módulo de gastos (migración `20261027100000_gastos`). Las reglas se aplican en la
base de datos y están probadas en `supabase/tests/80_gastos.test.sql`,
`scripts/test-db-concurrency.sh` (registro y OCR simultáneos) y `tests/unit/expenses.test.tsx`.

> **Importante**: la lectura automática (OCR) solo **propone** datos. Un gasto no queda listo hasta
> que la persona lo confirma, y los campos dudosos hay que marcarlos uno a uno como comprobados.
> Los límites, el precio por kilómetro y la antigüedad admitida los decide cada empresa según su
> convenio, sus acuerdos y el criterio de su asesoría.

## 1. Piezas

| Pieza         | Tabla                | Qué es                                                                        |
| ------------- | -------------------- | ----------------------------------------------------------------------------- |
| Política      | `expense_policies`   | Una por empresa: antigüedad máxima, monedas, ticket obligatorio, €/km         |
| Categoría     | `expense_categories` | Viajes, comidas, kilometraje…: límite a justificar y campos obligatorios      |
| Gasto         | `expenses`           | Datos confirmados por la persona; estado `draft`, `ready` o `discarded`       |
| Ticket        | `expense_receipts`   | Metadatos y huella SHA-256 del archivo; inmutable                             |
| Trabajo       | `jobs`               | Cola de tareas (de momento, OCR de un ticket): intentos, espera, último error |
| Ejecución OCR | `ocr_runs`           | Cada intento: proveedor, estado, campos normalizados con confianza, error     |
| Historial     | `expense_events`     | Creado, lectura, confirmado, reabierto, descartado… (solo códigos)            |

## 2. Flujo

1. **Captura** (`/gastos/nuevo`): "Hacer foto del ticket" abre la cámara trasera del móvil;
   "Subir foto o PDF" abre el selector de archivos. Antes de subirla, la foto se reduce en el
   navegador a un lado mayor de 2400 px en JPEG de calidad alta (legible y ligera) y se corrige su
   orientación; si ya es ligera, se envía tal cual. Se muestra la vista previa para repetirla si no
   se lee bien. Los PDF no se modifican.
2. **Validación en el servidor**: extensión (`pdf`, `jpg`, `jpeg`, `png`), firma real del contenido,
   tipo MIME declarado (los tres deben coincidir), tamaño (hasta 10 MB) y dimensiones (lado mínimo de
   200 px; máximo de 12 000 px y 50 megapíxeles, contra bombas de descompresión). Se rechazan los PDF
   con contenido activo (JavaScript, acciones automáticas, adjuntos incrustados). Se quitan los
   metadatos de las fotos (EXIF puede incluir ubicación) y se descarta el nombre original.
3. **Duplicados**: se calcula la huella SHA-256. Si la persona ya subió ese archivo, se abre su
   gasto; si lo subió otra persona de la empresa, se bloquea sin decir quién.
4. **Guardado**: bucket privado `expense-receipts`, ruta
   `<empresa>/<persona>/<año>/<mes>/<clave>.<ext>`. La clave es la de idempotencia: un reintento
   reutiliza el mismo objeto y el mismo gasto.
5. **Cola de OCR**: se crea un trabajo por ticket (nunca dos) y se ejecuta un intento enseguida.
6. **Revisión** (`/gastos/<id>`): ticket a la izquierda (o arriba en el móvil), datos a la derecha.
7. **Confirmación**: la base de datos aplica las reglas y marca el gasto como listo.

## 3. Estados del OCR y reintentos

| Estado         | Significado                                                                 |
| -------------- | --------------------------------------------------------------------------- |
| `pending`      | En cola (o esperando a reintentar)                                          |
| `processing`   | Leyendo; si tarda más de 5 minutos se considera caído y se puede reclamar   |
| `succeeded`    | Todos los datos con confianza alta (igualmente hay que confirmarlos)        |
| `needs_review` | Algún dato con confianza por debajo de 0,8 o sin total                      |
| `failed`       | Falló; queda el código (`provider_unavailable`, `timeout`…), nunca el texto |

Un fallo devuelve el trabajo a la cola con espera creciente (30 s, 60 s…) hasta **3 intentos**.
Después, la persona puede pedir "Volver a leer" **2 veces** más. En cualquier momento puede
completar los datos a mano: un fallo del OCR nunca bloquea el gasto. Reclamar un trabajo bloquea su
fila: dos sesiones a la vez producen una sola ejecución.

El OCR se ejecuta en el servidor con la sesión de la persona (ADR-043). Aún no hay un trabajador
programado: los reintentos con espera se ejecutan cuando la persona pulsa "Volver a leer".

## 4. Normalización

Común a cualquier proveedor (`src/features/expenses/ocr/normalize.ts`):

| Campo                  | Resultado                                                                |
| ---------------------- | ------------------------------------------------------------------------ |
| Fecha                  | `aaaa-mm-dd`; se aceptan `dd/mm/aaaa`, `dd-mm-aa`, `aaaa-mm-dd`          |
| Base, impuestos, total | Céntimos enteros; `1.234,56`, `1,234.56`, `12,5 €`                       |
| Moneda                 | ISO 4217 (`€` → `EUR`)                                                   |
| NIF del proveedor      | Sin espacios ni guiones; si la letra de control no cuadra, confianza 0,5 |
| Proveedor, nº ticket   | Espacios normalizados y longitud máxima                                  |

Si base + impuestos no da el total, los tres campos bajan a confianza 0,5. Lo que no se puede
interpretar se descarta. Cada campo conserva su confianza.

## 5. Revisión y reglas al confirmar

- Los datos del OCR solo rellenan campos vacíos y se marcan como "Propuesto por la lectura
  automática". Los de **baja confianza** se resaltan en ámbar con su porcentaje y tienen la casilla
  "Lo he comprobado": sin marcarla, la base de datos no confirma ("Confirma que has revisado: fecha").
- Reglas (mensajes de la base de datos): categoría activa; fecha no futura y no más antigua que la
  política; moneda admitida; total, forma de pago y proveedor (con ticket); base + impuestos = total;
  impuestos ≤ total; cliente, proyecto, centro de coste o nota si la categoría los exige; ticket
  obligatorio si la política lo exige (salvo kilometraje).
- **Desviaciones** (se aceptan y quedan registradas en el gasto): superar el importe de la
  categoría exige justificarlo en las notas; un total distinto del leído (más allá de la tolerancia)
  queda marcado; un posible duplicado exige marcar "no es un duplicado".
- **Kilometraje**: kilómetros con un decimal × precio por km de la política; el total lo calcula la
  base de datos y guarda la tarifa aplicada.
- **Corregir**: un gasto listo se reabre a borrador; el ticket original no cambia nunca. Cada cambio
  del gasto queda en `audit_log`. Descartar no borra nada y se puede recuperar.

## 6. Privacidad y acceso

| Quién                                                | Ve gastos y abre tickets | Edita          |
| ---------------------------------------------------- | ------------------------ | -------------- |
| La persona                                           | Los suyos                | Sus borradores |
| Quien la supervisa (o su suplente)                   | Los de su equipo         | No             |
| Contabilidad y administración de empresa             | Los de su ámbito         | No             |
| Administración de grupo                              | No (solo configura)      | No             |
| RR. HH., auditoría, otra empresa, membresía caducada | No                       | No             |

- Tickets solo en el bucket privado; se abren con una URL firmada de **60 segundos** emitida por
  `/gastos/ticket/<id>` si la política de Storage lo permite. No hay URL permanente ni pública.
- El texto completo del ticket no se guarda en ningún sitio: solo los campos normalizados. Los
  mensajes, avisos y el historial no incluyen importes, proveedores ni notas.
- Sin proveedor de OCR aprobado, **ningún archivo sale de la plataforma**.

## 7. Proveedor de OCR

- Interfaz: `OcrProvider` (`src/features/expenses/ocr/types.ts`).
- Desarrollo y pruebas: `OCR_PROVIDER=fake` (solo fuera de producción). Datos sintéticos
  deterministas derivados de la huella del archivo.
- **Proveedor real: ninguno.** Para añadirlo: (1) ADR con el proveedor elegido, contrato de encargo
  de tratamiento, ubicación de los datos y plazo de borrado en el proveedor; (2) credenciales solo en
  el servidor; (3) implementar `ocr/<proveedor>.ts`, registrarlo en `ocr/registry.ts` y añadir sus
  pruebas con respuestas grabadas sintéticas.

## 8. Pendiente

- Elegir proveedor de OCR (ADR) o confirmar que se trabaja sin OCR.
- Trabajador programado para la cola (con la clave de servicio y su ADR).
- Flujo de aprobación por el responsable y validación por Contabilidad (enviar, aprobar, liquidar)
  y exportación contable.
- Plazo de conservación de tickets con la asesoría (referencias habituales de 4 a 6 años) y tarea
  de borrado al vencer.
- Catálogos de clientes, proyectos y centros de coste (ahora son texto libre).
