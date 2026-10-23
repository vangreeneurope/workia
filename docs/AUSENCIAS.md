# Vacaciones y ausencias: reglas y privacidad

Funcionamiento del módulo de ausencias (migración `20261026100000_ausencias`). Las reglas se
aplican en la base de datos y están probadas en `supabase/tests/70_ausencias.test.sql`,
`scripts/test-db-concurrency.sh` (dos solicitudes simultáneas) y `tests/unit/absences.test.tsx`.

> **Importante**: el catálogo de tipos y políticas lo configura cada empresa. La plataforma no
> incluye ninguna lista de permisos legales ni afirma que la configuración cumpla el Estatuto de
> los Trabajadores, el convenio colectivo o el criterio de la asesoría: eso lo valida la empresa
> (ver `docs/NORMATIVA.md`).

## 1. Piezas

| Pieza                | Tabla                      | Qué es                                                                                            |
| -------------------- | -------------------------- | ------------------------------------------------------------------------------------------------- |
| Tipo de ausencia     | `absence_types`            | Lo que se puede pedir: unidades, cómputo, si consume saldo, si necesita aprobación y justificante |
| Política             | `vacation_policies`        | Regla de saldo de un tipo (por ejemplo, "Vacaciones general") y mes en que empieza su periodo     |
| Versión de política  | `vacation_policy_versions` | Derecho, devengo, prorrateo, redondeo, arrastre, caducidad, unidad y saldo negativo, con vigencia |
| Asignación           | `policy_assignments`       | Qué política aplica a quién: persona › equipo › centro › empresa                                  |
| Saldo                | `vacation_balances`        | Persona + política + periodo. **No guarda importes**                                              |
| Libro de movimientos | `balance_movements`        | Apertura, devengo, arrastre, caducidad, reservas, usos y ajustes. Inmutable                       |
| Solicitud            | `absence_requests`         | Fechas, unidad, cantidad, estado y comentario para quien aprueba                                  |
| Aprobación           | `absence_approvals`        | Quién debía decidir al enviarse (manager, suplente o RR. HH.) y cómo terminó                      |
| Historial            | `absence_request_events`   | Envío, información pedida y respondida, decisión, cancelación, retirada                           |
| Justificante         | `absence_attachments`      | Metadatos; el archivo va al bucket privado `absence-attachments`                                  |

## 2. Saldo: un libro, no un número editable

El saldo disponible es la **suma** de los movimientos del periodo. Nadie puede escribir un saldo:
solo se añaden movimientos, y no se modifican ni se borran.

| Movimiento           | Signo | Cuándo                                                                 |
| -------------------- | ----- | ---------------------------------------------------------------------- |
| Apertura             | +     | Al abrir el periodo (devengo "todo al inicio"), prorrateado si procede |
| Devengo              | +     | Al terminar cada mes (devengo mensual)                                 |
| Arrastre             | ±     | Sale del periodo cerrado (−) y entra en el nuevo (+), con caducidad    |
| Caducidad            | −     | Lo no disfrutado al cerrar o lo arrastrado sin usar a su fecha         |
| Reserva / liberación | − / + | Al enviar una solicitud / al rechazarla o cancelarla                   |
| Uso / reversión      | − / + | Al aprobarla / al retirarla antes de empezar                           |
| Ajuste               | ±     | Regularización manual de RR. HH. con motivo (queda en `audit_log`)     |

**Cantidades enteras**: las políticas en días cuentan **medios días** (22 días = 44) y las de horas
cuentan **minutos** (10 h = 600). El redondeo es entero: `round_ratio` calcula n/d redondeado
abajo, arriba o al más cercano, en múltiplos del paso configurado.

**Prorrateo**: con "según días con contrato", el derecho se multiplica por los días con condiciones
de empleo vigentes en el periodo y se divide por los días del periodo. Ejemplo: alta el 1 de junio
con 22 días anuales → 214/365 × 44 = 25,8 → 26 medios días (13 días) redondeando al más cercano.
Si la relación cambia después de abrir el periodo (por ejemplo, una baja), no se recalcula: RR. HH.
registra un ajuste.

**Devengo mensual**: cada mes cerrado se asienta la diferencia entre el acumulado debido y lo ya
devengado (sin arrastrar errores de redondeo). Se usa la versión vigente al empezar ese mes.

**Arrastre y caducidad**: al cerrar un periodo, lo sobrante pasa al siguiente hasta el máximo de la
versión; el resto caduca. Lo arrastrado se consume primero; lo que no se haya usado o reservado
antes de su fecha de caducidad caduca ese día. Un saldo negativo autorizado pasa entero al periodo
siguiente como deuda. Si cambia la unidad entre versiones, no hay arrastre.

**Saldo negativo**: solo si la versión lo permite, con un límite y la justificación de quien lo
autoriza; la solicitud lo avisa y queda en el libro.

**Cierre de periodos**: un periodo se cierra (con su arrastre) cuando se abre el siguiente y ya ha
terminado, y solo si no le quedan solicitudes pendientes. `settle_vacation_balances()` (tarea
programada con la clave de servicio) asienta devengos, caducidades y cierres pendientes.

## 3. Al enviar una solicitud

En una sola transacción, la base de datos:

1. Comprueba el tipo (activo, unidad admitida), las fechas (no pasadas salvo los días admitidos
   por el tipo; medio día y horas en un solo día) y que **todos los días tengan contrato vigente**.
2. Calcula la cantidad: en "laborables", solo cuentan los días de trabajo del **horario
   planificado** (turno publicado, sin festivos ni descansos); sin horario asignado, de lunes a
   viernes no festivos. En "naturales", todos los días. Si no queda ningún día, se rechaza.
3. Rechaza **solapes** con otras solicitudes pendientes o aprobadas (también por medio día y horas;
   además hay una restricción de exclusión en la tabla).
4. Busca la política (persona › equipo › centro › empresa), exige que no cruce dos periodos y
   comprueba la **unidad** y el **saldo**.
5. **Bloquea el saldo** (`FOR UPDATE`) y la persona antes de calcular lo disponible y reservar: dos
   solicitudes simultáneas no pueden consumir el mismo saldo (probado con dos sesiones a la vez).
6. Crea la instancia de aprobación y el primer evento del historial.

La solicitud lleva una clave de idempotencia: un reintento no la duplica.

## 4. Aprobación

| Situación                                          | Quién decide                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| Hay manager vigente para "vacaciones y ausencias"  | Ese manager (o su **suplente** si hay suplencia vigente)                 |
| Sin aprobador asignado o con el aprobador inactivo | RR. HH. con gestión en su ámbito (`hr_no_approver`)                      |
| La persona sería su propia aprobadora              | RR. HH. (`hr_self_approval`)                                             |
| Tipo con regla expresa aprobada                    | Nadie: se aprueba solo y queda la referencia de la regla en el historial |

El aprobador se recalcula al decidir: si empieza una suplencia después del envío, decide la persona
suplente. RR. HH. con gestión siempre puede decidir. Nadie decide sus propias solicitudes.

| Acción            | Desde                           | Efecto en el saldo                                                    |
| ----------------- | ------------------------------- | --------------------------------------------------------------------- |
| Aprobar           | Pendiente                       | La reserva se convierte en uso                                        |
| Rechazar (motivo) | Pendiente                       | Se libera la reserva                                                  |
| Pedir información | Pendiente                       | Se mantiene la reserva; vuelve a pendiente cuando la persona responde |
| Cancelar          | Pendiente o información pedida  | Se libera la reserva                                                  |
| Retirar           | Aprobada que aún no ha empezado | Se revierte el uso; deja de figurar en el horario                     |

Las ausencias aprobadas de días completos se registran en `leave_periods`: el horario planificado
las muestra y el control horario detecta fichajes en esos días.

## 5. Privacidad

| Dato                           | Persona | Compañeros del equipo     | Manager / aprobador                                      | RR. HH. (lectura) | RR. HH. con permiso de justificantes |
| ------------------------------ | ------- | ------------------------- | -------------------------------------------------------- | ----------------- | ------------------------------------ |
| Que está ausente (fechas)      | Sí      | Sí, solo si está aprobada | Sí                                                       | Sí                | Sí                                   |
| Tipo de ausencia               | Sí      | No ("Ausente")            | Sí; si el tipo es reservado, "Ausencia" en el calendario | Sí                | Sí                                   |
| Comentario de la persona       | Sí      | No                        | Sí (para decidir)                                        | Sí                | Sí                                   |
| Saldo y movimientos            | Sí      | No                        | Sí                                                       | Sí                | Sí                                   |
| Que hay justificante           | Sí      | No                        | Sí                                                       | Sí                | Sí                                   |
| Abrir justificante sensible    | Sí      | No                        | **No**                                                   | **No**            | Sí                                   |
| Abrir justificante no sensible | Sí      | No                        | Sí                                                       | No                | Sí                                   |

- El permiso de justificantes solo lo tiene el rol RR. HH.: ni la administración de empresa ni la de
  grupo lo tienen por defecto.
- Justificantes en el bucket privado `absence-attachments`, ruta
  `<empresa>/<persona>/<solicitud>/<aleatorio>.<ext>`; se comprueba el contenido (PDF, JPEG o PNG,
  5 MB), se eliminan los metadatos de las fotos y no se guarda el nombre original. Se abren con una
  URL firmada de 60 segundos que solo se emite si la política de Storage lo permite.
- La interfaz pide no escribir diagnósticos en el comentario. Ni las solicitudes ni sus comentarios
  van a `audit_log`; su rastro es el historial de la solicitud. Los avisos (`work_events`) no
  incluyen el tipo si es reservado. Los calendarios de compañeros solo dicen "Ausente".
- Un manager solo ve solicitudes de las personas que supervisa o de las que es aprobador; con la
  asignación caducada o la membresía caducada no ve nada (probado).

## 6. Cambios de política

- Una versión se publica con efecto desde hoy o una fecha futura; la anterior se cierra ese día.
- Las versiones publicadas no cambian (ni siquiera con la clave de servicio).
- Cada periodo se abre con la versión vigente en su inicio y la conserva: **un cambio no recalcula
  periodos ya abiertos ni cerrados**. Los devengos mensuales futuros usan la versión vigente de su
  mes. Las asignaciones solo empiezan hoy o en el futuro.

## 7. Configuración de ejemplo (no normativa)

Vacaciones de 22 días laborables al año, prorrateadas, con redondeo al medio día más cercano,
hasta 5 días de arrastre que caducan a los 3 meses:

| Campo           | Valor                      |
| --------------- | -------------------------- |
| Unidad          | Días (y medios días)       |
| Derecho         | 22                         |
| Devengo         | Todo al inicio del periodo |
| Prorrateo       | Según días con contrato    |
| Redondeo        | Al más cercano, paso 0,5   |
| Arrastre máximo | 5 · caducidad: 3 meses     |

Comprueba siempre las cifras con tu convenio y tu asesoría antes de publicarlas.

## 8. Pendiente

- Programar `settle_vacation_balances()` (diaria) con la clave de servicio.
- Adaptador de avisos (correo o notificaciones) para `work_events`, respetando la desconexión digital.
- Conservación de justificantes: definir el plazo con la asesoría y una tarea de borrado.
