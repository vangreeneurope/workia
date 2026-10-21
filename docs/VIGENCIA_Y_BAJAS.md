# Reglas de vigencia, bajas y aprobadores

Este documento explica cómo afectan las fechas a permisos, aprobaciones y operaciones. Las reglas
se aplican en la base de datos (no dependen de la interfaz) y están probadas en
`supabase/tests/40_administracion.test.sql`.

## 1. Vigencia: la regla común

Membresías, roles, asignaciones de manager y suplencias tienen `status` y un intervalo
`[valid_from, valid_to)`:

- **El inicio se incluye, el fin no.** Un rol con `valid_to = 2026-12-01 00:00 (Madrid)` deja de
  valer el 1 de diciembre a las 00:00; el 30 de noviembre todavía vale.
- `valid_to` vacío significa "sin fin".
- Solo produce efectos si `status = 'active'` **y** el momento actual está dentro del intervalo.
  Revocar (`status = 'revoked'`) anula al instante sin borrar la fila.
- En la interfaz las fechas se piden como días de calendario y se guardan como el inicio de ese día
  en Madrid. Si el usuario indica "hasta el 30/11 (incluido)", se guarda `valid_to = 01/12 00:00`.
- Las condiciones de empleo usan fechas de calendario con la misma regla: `valid_to` es el primer
  día en que ya no aplican.

| Ejemplo                                                  | Resultado                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| Rol de RR. HH. con inicio mañana                         | Hoy no da ningún permiso                                         |
| Membresía caducada ayer con rol de administración activo | Sin acceso a la empresa: la membresía manda                      |
| Asignación de manager que terminó ayer                   | El manager deja de ver a esa persona                             |
| Suplencia del 1 al 15 de noviembre                       | Del 1 al 15 aprueba la persona suplente; el 16 vuelve el titular |

## 2. Cambios con fecha de efecto

- **Condiciones de empleo**: "Registrar condiciones" con una fecha de efecto cierra las vigentes ese
  día y abre las nuevas, en una sola transacción (`change_employment_terms`). Si ya hay condiciones
  que empiezan en esa fecha o después, se rechaza: no se reescribe el futuro sin verlo. Nunca hay
  dos condiciones activas solapadas (restricción de exclusión).
- **Roles, asignaciones y suplencias**: se crean con fecha de inicio (hoy o futura) y fin opcional.
  Para cambiar un rol o un aprobador se finaliza el actual y se crea otro; el rol, el ámbito, la
  persona y el tipo de una fila no se modifican (trigger `prevent_key_change`).
- **Centro y equipo de una ficha**: el cambio se aplica al guardarlo y queda en la auditoría con
  fecha y autor. Los cambios futuros de centro o equipo aún no se programan (ver ADR-029).
- **Traslado a otra empresa**: no se cambia la empresa de una ficha. Se da de baja en la empresa
  de origen y se crea la ficha (y la cuenta, si procede) en la de destino.

## 3. Bajas

La baja se registra con el **último día de relación laboral (incluido)** y es una operación
atómica (`terminate_employee`). Desde el día siguiente:

| Qué                                                                 | Cómo queda                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Ficha de empleado                                                   | Se conserva con `end_date`; nada se borra                           |
| Condiciones de empleo                                               | Se cierran ese día; las que empezaban después se anulan (`ended`)   |
| Asignaciones donde la persona es supervisada                        | Terminan ese día (las futuras se revocan)                           |
| Asignaciones y suplencias donde la persona aprueba (en esa empresa) | Terminan ese día                                                    |
| Roles y cuenta en esa empresa                                       | Terminan ese día                                                    |
| Nuevas condiciones o asignaciones posteriores                       | Rechazadas por la base de datos con un mensaje que explica la causa |
| Nuevas solicitudes con fecha posterior                              | El cálculo de aprobador devuelve `APROBADOR_EMPLEADO_DE_BAJA`       |

Hasta su último día la persona conserva el acceso. Reglas adicionales:

- Nadie tramita su propia baja; RR. HH. no puede dar de baja a quien tiene rol de administración
  de empresa (solo la administración de la empresa o del grupo).
- No se puede registrar una segunda baja sin reactivar antes.
- **Reactivación** (`reactivate_employee`): la ficha y la cuenta vuelven a estar vigentes. Las
  condiciones, los roles y los aprobadores se registran de nuevo de forma explícita: no se restauran
  solos para evitar devolver permisos por error.
- Ninguna tabla operativa permite borrar desde la API.

## 4. Aprobadores sin ambigüedad

Una asignación de manager se hace a **una persona o a un equipo** y para un **tipo de solicitud**
(todas, vacaciones y ausencias, gastos, correcciones de fichaje). Para una persona, un tipo y un
momento, el aprobador se calcula así (`resolve_approver`):

1. Prioridad, de mayor a menor: persona + tipo concreto › persona + todas › equipo + tipo concreto ›
   equipo + todas.
2. En cada nivel solo puede haber **un** aprobador vigente: la base de datos rechaza la segunda
   asignación solapada (restricción de exclusión). Por eso nunca hay empates.
3. Si el aprobador tiene una **suplencia** vigente para ese tipo (o para todas), aprueba la persona
   suplente.
4. Si no se puede determinar, se devuelve un error accionable:

| Código                       | Significado                                                                  | Qué hacer                                     |
| ---------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------- |
| `APROBADOR_NO_ASIGNADO`      | Ninguna asignación vigente cubre a la persona                                | Asignar un manager a la persona o a su equipo |
| `APROBADOR_INACTIVO`         | El manager (o el suplente) ya no tiene cuenta vigente en el grupo            | Asignar otro o registrar una suplencia        |
| `APROBADOR_AUTOAPROBACION`   | La persona sería su propia aprobadora (p. ej. el manager del equipo es ella) | Asignarle un manager específico               |
| `APROBADOR_EMPLEADO_DE_BAJA` | La fecha de la solicitud es posterior a la baja                              | No se admiten solicitudes                     |
| `APROBADOR_AMBIGUO`          | Defensa adicional; no debería ocurrir por la regla 2                         | Cerrar una de las asignaciones                |

El mismo manager puede aprobar en varias empresas del grupo con asignaciones independientes en
cada una. No puede supervisar a personas de otro grupo.

## 5. Suplencias

- Motivo obligatorio (5-500 caracteres, sin datos de salud), fecha de fin obligatoria y duración
  máxima de un año.
- No puede haber dos suplencias vigentes para el mismo ausente y tipo.
- La persona suplente debe tener cuenta vigente en el grupo y no puede ser la propia persona que
  registra la suplencia ni la ausente.
- Mientras dura, la persona suplente ve a las personas que supervisa el ausente.
- Quedan en `audit_events` (sin el texto del motivo) y en `audit_log`.
