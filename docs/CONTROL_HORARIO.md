# Control horario: funcionamiento y operación

Guía funcional y operativa del registro de jornada (migración `20261025100000_control_horario`).
Las reglas se aplican en la base de datos y están probadas en
`supabase/tests/60_control_horario.test.sql`, `scripts/test-db-concurrency.sh` (dos sesiones
simultáneas), `tests/unit/time-tracking.test.ts` y `tests/unit/punch-ui.test.tsx`.

## 1. Conceptos

| Concepto                | Tabla                      | Qué es                                                                                               |
| ----------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------- |
| Fichaje                 | `punches`                  | Evento original: entrada, pausa, reanudación o salida. **Nunca se modifica ni se borra.**            |
| Jornada                 | `time_entries`             | Agrupa los fichajes desde una entrada hasta su salida. Se **recalcula** siempre desde los fichajes.  |
| Solicitud de corrección | `time_correction_requests` | Petición de añadir, cambiar o anular un fichaje, con motivo.                                         |
| Ajuste                  | `time_adjustments`         | Lo que crea una corrección aprobada: antes, después, motivo, quién pidió y quién decidió. Inmutable. |
| Incidencia              | `time_incidents`           | Aviso para revisión (olvido, fuera de tolerancia, solape…). Se cierra con nota o sola al corregir.   |
| Política                | `time_tracking_policies`   | Por empresa o centro: uso de la ubicación y selfie opcional.                                         |
| Terminal                | `kiosk_devices`            | Dispositivo compartido de un centro, identificado por un token secreto.                              |
| Evento de trabajo       | `work_events`              | Recordatorios y avisos pendientes de enviar (aún no hay proveedor de correo).                        |

## 2. Cómo se registra un fichaje

1. La persona pulsa una acción. La pantalla solo muestra las posibles según el estado:

   | Estado actual       | Acciones posibles | Estado siguiente   |
   | ------------------- | ----------------- | ------------------ |
   | Sin jornada abierta | Entrada           | Trabajando         |
   | Trabajando          | Pausa / Salida    | En pausa / Cerrada |
   | En pausa            | Reanudar          | Trabajando         |

   Cualquier otra combinación (dos entradas, salir estando en pausa, reanudar sin pausa) la rechaza
   la base de datos con un mensaje claro y sin tocar la jornada.

2. La aplicación genera una **clave de idempotencia** (un identificador aleatorio) por cada
   pulsación. Si la misma petición llega dos veces (reintento, red lenta), el servidor devuelve el
   fichaje ya registrado: **misma clave, un solo fichaje**.
3. El servidor guarda su propia hora (**hora oficial**), la hora que declara el dispositivo, el
   origen (móvil, web o terminal), la zona horaria del centro, un identificador seudónimo del
   dispositivo (aleatorio, guardado en el propio dispositivo) y la clave.
4. En la misma transacción se recalcula la jornada (tiempo trabajado y de pausa en segundos
   enteros) y sus incidencias. Las operaciones de una misma persona se ejecutan de una en una
   (bloqueo por persona): dos toques simultáneos o la aplicación y el terminal a la vez no pueden
   abrir dos jornadas.

**Medianoche y zona horaria**: la jornada pertenece al día local en que empieza, en la zona del
centro (por ejemplo, una noche de 22:00 a 06:00 es del día de las 22:00). Las horas trabajadas son
reales: la noche del cambio de hora de octubre suma 9 h y la de marzo 7 h.

**Olvido de salida**: si alguien ficha entrada con una jornada abierta desde hace más de 16 horas,
la anterior se cierra como **incompleta** (sin inventar la hora de salida) y se crea la incidencia
"Salida no registrada". Con menos de 16 horas, la nueva entrada se rechaza.

## 3. Sin conexión

Si el envío falla por red, el fichaje se guarda en el dispositivo con su clave y su hora declarada,
y se reenvía al recuperar la conexión **con la misma clave**. La hora oficial será la de llegada al
servidor; si difiere más de 5 minutos de la declarada, se crea la incidencia "Hora del dispositivo
distinta" para que el responsable la revise y, si procede, se corrija. En la cola local no se
guardan ni ubicación ni foto.

## 4. Ubicación (puntual y configurable)

| Política                     | Qué pasa al fichar                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| No se registra (por defecto) | No se pide. Si llegaran coordenadas, la base de datos las descarta.                                                       |
| Opcional                     | Se muestra el aviso de la empresa; la persona elige compartirla o fichar sin ella.                                        |
| Exigida                      | Igual, pero si no se obtiene (denegada, no disponible, tiempo agotado) el fichaje **se registra** y queda una incidencia. |

- Siempre se explica el uso **antes** de pedir el permiso (texto obligatorio de la política,
  art. 90 LOPDGDD).
- Una sola lectura (`getCurrentPosition`), nunca seguimiento; se guardan latitud, longitud,
  precisión y el resultado del permiso.
- En el terminal no se pide ubicación (el dispositivo está fijo en su centro).
- Las coordenadas solo las ven la persona, su manager y RR. HH. con permiso; no van a `audit_log`
  ni a ningún registro. Uso exclusivo: verificar el fichaje.

## 5. Selfie opcional

- Solo si la política la activa (interruptor por empresa o centro). Siempre opcional: si la cámara
  se deniega, se ficha sin foto.
- Solo JPEG de hasta 2 MB. El servidor **elimina los metadatos** (EXIF, que puede incluir GPS) antes
  de guardarla en el bucket privado `punch-selfies`, ruta `<empresa>/<persona>/<clave>.jpg`.
- No se analiza la imagen ni se extrae ninguna plantilla biométrica. No hay reconocimiento facial.
- Se conserva **30 días** (ADR-037). La tarea programada lista las caducadas con
  `expired_punch_selfies()`, las borra con la API de Storage y llama a
  `mark_punch_selfie_purged()`; el fichaje conserva la constancia de que hubo foto.

## 6. Terminal compartido

1. RR. HH. da de alta el terminal en **Administración › Control horario** y copia el código (se
   muestra una sola vez; en la base de datos solo queda su huella SHA-256).
2. En el dispositivo se abre `/terminal`, se pega el código y queda guardado en una cookie
   protegida (no accesible desde JavaScript).
3. Cada persona crea su **PIN de 6 cifras** en **Mi perfil** (cifrado con bcrypt; nadie lo ve). Se
   rechazan PIN con cifras repetidas o consecutivas.
4. Para fichar: acción, código de empleado y PIN. La respuesta solo dice qué se registró y a qué
   hora; nunca el nombre. La pantalla vuelve al inicio a los 5 s y, sin actividad, a los 30 s.

Protecciones: 5 fallos seguidos bloquean el PIN de esa persona 15 minutos; 20 fallos en 10 minutos
bloquean el terminal 10 minutos; un código inexistente da el mismo mensaje que un PIN erróneo y
cuesta lo mismo de comprobar. Desactivar el terminal en Administración lo invalida al instante.
RR. HH. puede anular un PIN (la persona crea otro).

## 7. Correcciones

- La persona (o RR. HH. en su nombre) solicita añadir, cambiar o anular un fichaje, con motivo.
- Decide su **aprobador de correcciones de fichaje** (el mismo cálculo de aprobadores y suplencias
  de `docs/VIGENCIA_Y_BAJAS.md`) o RR. HH. de su ámbito. Nadie aprueba sus propias correcciones ni
  las que ha solicitado.
- Aprobar crea un **ajuste** con la jornada antes y después, el motivo y los autores; el fichaje
  original no cambia. La jornada se recalcula en la misma transacción: si el resultado fuera
  imposible (por ejemplo, dos salidas), la aprobación falla y nada cambia.
- Un fichaje solo se corrige una vez; para volver a cambiarlo se corrige su valor actual con otra
  solicitud.
- Una jornada olvidada entera se solicita empezando por la entrada; queda "incompleta" hasta que se
  apruebe también la salida.

## 8. Incidencias

| Tipo                                 | Cuándo                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------- |
| Entrada / salida fuera de tolerancia | Fuera del margen de la plantilla (o de la ventana en jornada flexible) |
| Fichaje fuera de horario             | Día de descanso, festivo, ausencia aprobada o sin contrato vigente     |
| Salida no registrada                 | Jornada cerrada como incompleta                                        |
| Jornada abierta demasiado tiempo     | Más de 16 h abierta                                                    |
| Jornadas solapadas                   | Dos jornadas de la misma persona se pisan (tras correcciones)          |
| Ubicación no disponible              | Política "exigida" y no se obtuvo                                      |
| Hora del dispositivo distinta        | Más de 5 min de diferencia (típico de envíos sin conexión)             |

El plan se calcula en SQL con las mismas reglas que el resolvedor de horarios (`docs/HORARIOS.md`).
Las incidencias se cierran solas cuando una corrección las resuelve, o las cierra el manager o
RR. HH. con una nota. No se califica ninguna diferencia como hora extra.

## 9. Recordatorios

`generate_time_reminders()` (solo con la clave de servicio, pensada para una tarea programada cada
15 minutos) crea eventos de trabajo idempotentes: jornada abierta más allá del fin previsto o más de
12 h, y entrada no fichada 30 minutos después del inicio planificado. También se crean eventos al
detectar incidencias y al decidir correcciones. Mientras no haya adaptador de correo o
notificaciones, quedan en `work_events` con `delivered_at` vacío. **Pendiente**: programar la tarea
(por ejemplo, Supabase Cron) y el adaptador de envío respetando la desconexión digital.

## 10. Permisos

| Quién                               | Fichar           | Ver registros                | Decidir correcciones | Incidencias | Políticas y terminales |
| ----------------------------------- | ---------------- | ---------------------------- | -------------------- | ----------- | ---------------------- |
| Persona empleada                    | Sí               | Los suyos                    | No                   | Ver         | No                     |
| Manager                             | Sí               | Quien supervisa              | Si es su aprobador   | Cerrar      | No                     |
| RR. HH. / administración de empresa | Sí               | Su ámbito (empresa o centro) | Su ámbito            | Cerrar      | Su ámbito              |
| Auditoría                           | —                | Toda la empresa              | No                   | Ver         | No                     |
| Terminal (sin sesión)               | Con código y PIN | Nada                         | No                   | No          | No                     |

Nadie puede insertar, modificar ni borrar fichajes, jornadas, ajustes ni incidencias desde la API:
solo mediante las funciones descritas, que comprueban la identidad y el ámbito.

## 11. Operación y soporte

| Situación                       | Qué hacer                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| Alguien olvidó fichar la salida | Solicitud de corrección "Añadir · Salida"; al aprobarse se cierra la incidencia        |
| Fichó dos veces por error       | Corrección "Anular" del fichaje sobrante                                               |
| Terminal perdido o robado       | Desactivarlo en Administración › Control horario (efecto inmediato) y dar de alta otro |
| PIN olvidado o comprometido     | Anularlo en Administración y que la persona cree otro en su perfil                     |
| Terminal bloqueado por intentos | Se desbloquea solo a los 10 minutos; desactivar y reactivar lo libera antes            |
| Exportación para la Inspección  | Pendiente (fase 1): se hará desde jornadas, fichajes y ajustes, sin perder el original |

Conservación: los fichajes, jornadas, ajustes y solicitudes se conservan al menos 4 años
(art. 34.9 ET, `docs/NORMATIVA.md`); las selfies, 30 días.
