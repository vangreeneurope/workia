# Calendarios, plantillas de turno y horario planificado

Este documento explica cómo se modela el horario planificado, cómo se resuelve para una persona y
un día, y qué reglas se aplican con las zonas horarias y los cambios de hora. Las reglas se aplican
en la base de datos (migración `20261024100000_calendarios_turnos`) y en el resolvedor
(`src/features/schedules/resolver.ts`), y están probadas en `supabase/tests/50_horarios.test.sql`
y `tests/unit/schedule-resolver.test.ts` y `tests/unit/zoned-time.test.ts`.

El horario **planificado** es lo que se espera que una persona trabaje. No es el registro de jornada
(los fichajes, aún pendientes) ni decide qué es una hora extra: la diferencia entre lo planificado y
lo fichado se clasificará solo con reglas aprobadas (ver sección 7).

## 1. Piezas del modelo

| Pieza                  | Tabla                                         | Qué guarda                                                                                                              |
| ---------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Calendario laboral     | `holiday_calendars`                           | Nombre, ámbito (nacional, autonómico, local, propio), región ISO, localidad y **fuente obligatoria**                    |
| Festivo                | `holidays`                                    | Fecha y nombre dentro de un calendario                                                                                  |
| Aplicación a un centro | `work_center_holiday_calendars`               | Qué calendario rige en qué centro y desde cuándo (o "todos los centros" en el propio calendario)                        |
| Plantilla de turno     | `shift_templates`                             | Código y nombre (por ejemplo, `M` Mañana)                                                                               |
| Versión de plantilla   | `shift_template_versions`                     | Tipo de jornada, horas objetivo, tolerancias, ventana flexible y **vigencia**; inmutable una vez publicada              |
| Tramo                  | `shift_template_segments`                     | Inicio y fin en minutos enteros, trabajo o pausa, pausa retribuida o no                                                 |
| Asignación             | `shift_assignments` + `shift_assignment_days` | A quién (excepción, persona, equipo o contrato), vigencia, ciclo de N días y plantilla o descanso de cada día del ciclo |
| Ausencia aprobada      | `leave_periods`                               | Punto de integración con el futuro módulo de ausencias; hoy solo se usa para detectar conflictos y mostrar la ausencia  |
| Evento de cambio       | `schedule_events`                             | Bandeja de salida de avisos a cada persona afectada (sin proveedor de correo todavía)                                   |

### Tiempo sin coma flotante

Los tramos se guardan como **minutos enteros desde la medianoche local del día del turno**, de 0 a 2880. Un valor mayor que 1440 es una hora del día siguiente. Ejemplos:

| Turno                                   | Tramos                                | Horas objetivo |
| --------------------------------------- | ------------------------------------- | -------------- |
| Continua 08:00–15:00                    | 480–900                               | 420 min (7 h)  |
| Partida 09:00–14:00 y 16:00–19:00       | 540–840, 960–1140                     | 480 min        |
| Noche 22:00–06:00 con 30 min sin cobrar | 1320–1560, pausa 1560–1590, 1590–1800 | 450 min        |
| Flexible: 8 h entre 07:00 y 20:00       | ventana 420–1200, presencia 600–840   | 480 min        |

Las horas objetivo de una jornada no flexible deben coincidir exactamente con la suma de tramos de
trabajo y pausas retribuidas; si no, la plantilla no se publica. Se usan enteros para que la suma
sea exacta (con decimales, 7,5 h repetidas en un mes acumulan errores de redondeo).

Reglas de una versión válida (idénticas en `private.template_version_problems()` y en
`src/features/schedules/template-rules.ts`): al menos un tramo de trabajo (salvo flexible), sin
solapes, empieza antes de las 24:00 de su día, dura como mucho 24 h, las pausas quedan dentro de la
jornada; la continua no tiene huecos, la partida tiene dos tramos con hueco, la nocturna incluye
trabajo entre las 22:00 y las 06:00, y la flexible cabe en su ventana.

## 2. Versiones y fecha de efecto: nada retroactivo

- Editar una plantilla crea o actualiza un **borrador**; el borrador no afecta a nadie.
- Publicar exige una fecha de efecto **hoy o futura** (hoy en la zona de la empresa). La versión
  anterior se cierra ese día; los días anteriores conservan la versión que tenían. Una versión
  publicada y sus tramos no se pueden modificar ni borrar, ni siquiera con permisos de servicio.
- Una asignación publicada solo cambia su fin (nunca hacia el pasado) o se anula si aún no había
  empezado. Para cambiar un horario se finaliza el actual y se publica otro con la fecha del cambio.
- Los festivos pasados no se crean ni se modifican, y un calendario se aplica a un centro desde hoy
  o una fecha futura.

Ejemplo: la plantilla `M` (v1, 08:00–15:00) se cambia el 21/10 a 09:00–16:00 con efecto el 02/11.
Del 21/10 al 01/11 la persona sigue con 08:00–15:00; desde el 02/11, 09:00–16:00. Una jornada de
octubre ya cerrada no cambia.

## 3. Precedencia

Para una persona y un día, el resolvedor aplica este orden (gana el primero que exista):

1. **Excepción individual** (como mucho 31 días): permite, por ejemplo, trabajar un festivo.
2. **Festivo** de un calendario que aplica a su centro ese día: no hay turno.
3. **Asignación individual**.
4. **Asignación del equipo** (equipo actual de la persona).
5. **Patrón del contrato**: ligado a unas condiciones de empleo; solo vale mientras esas condiciones
   están vigentes.

Antes de todo eso: sin condiciones de empleo vigentes o después del último día de una baja no hay
horario planificado (`no_contract`). Una **ausencia aprobada** no borra el plan: se informa encima
para que se vea qué turno cubre.

Dentro de cada nivel solo puede haber una asignación publicada por día (restricción de exclusión en
la base de datos). Si por un error de datos hubiera dos, el resolvedor elige la de inicio más
reciente y, a igualdad, por identificador, de modo que el resultado es siempre el mismo.

### Recurrencia

Cada asignación tiene un ciclo de N días (1 a 56) anclado en una fecha. El día del ciclo de una
fecha es `((fecha − ancla) mod N + N) mod N`, que también funciona para fechas anteriores al ancla.
Ejemplos: ciclo 7 anclado en lunes con L–V `M` y S–D descanso; ciclo 14 con una semana de mañana
y otra de tarde.

## 4. Zonas horarias y cambios de hora

- La zona horaria es la del **centro de trabajo** de la persona; si no tiene centro, la de la
  empresa. Empresas y centros solo admiten nombres IANA que PostgreSQL conoce (por ejemplo
  `Europe/Madrid`, `Atlantic/Canary`); un valor como `UTC+1` se rechaza.
- Se guardan horas locales **junto con la zona** y se convierten a instantes reales (UTC) al
  resolver, con estas reglas:

| Situación                                 | Ejemplo (Madrid)  | Regla                                                            | Resultado                    |
| ----------------------------------------- | ----------------- | ---------------------------------------------------------------- | ---------------------------- |
| Hora inexistente (adelanto de primavera)  | 29/03/2026 02:30  | Se interpreta con el desfase anterior: se desplaza hacia delante | 03:30 CEST (01:30 UTC)       |
| Hora repetida (retraso de otoño)          | 25/10/2026 02:30  | Primera vez que ocurre (horario de verano)                       | 02:30 CEST (00:30 UTC)       |
| Turno de noche 22:00–06:00 del 28/03/2026 | Cruza el adelanto | Las horas de reloj se mantienen                                  | 7 h reales para 8 h de reloj |
| Turno de noche 22:00–06:00 del 24/10/2026 | Cruza el retraso  | Las horas de reloj se mantienen                                  | 9 h reales para 8 h de reloj |
| Mismo turno en Canarias                   | `Atlantic/Canary` | Su propia zona                                                   | Una hora más tarde en UTC    |

El resolvedor devuelve a la vez las horas de reloj (`plannedMinutes`), las horas reales
(`elapsedWorkMinutes`) y las horas objetivo de la plantilla (`targetMinutes`), y añade una nota
explicativa cuando un tramo cae en una hora inexistente o repetida o cuando el cambio de hora
alarga o acorta el turno. **No decide** si esa hora de más o de menos es exceso de jornada: eso lo
fijarán las reglas aprobadas del control horario.

## 5. Conflictos antes de publicar

`shift_assignment_conflicts(asignación)` explica, por persona (código de empleado, nunca el nombre)
y rango de fechas:

| Código                     | Gravedad | Significado                                                  |
| -------------------------- | -------- | ------------------------------------------------------------ |
| `OVERLAP`                  | error    | Ya hay un horario publicado del mismo nivel para esas fechas |
| `TEMPLATE_WITHOUT_VERSION` | error    | Una plantilla del ciclo no tiene versión vigente algún día   |
| `ABSENCE`                  | aviso    | Hay ausencias aprobadas en días con turno                    |
| `AFTER_TERMINATION`        | aviso    | La persona causa baja antes de algunos días con turno        |
| `NO_CONTRACT`              | aviso    | Hay días con turno sin condiciones de empleo vigentes        |

Los errores impiden publicar; los avisos exigen marcar "He revisado los avisos". Se revisan como
mucho 400 días desde el inicio (o hasta el fin, si es antes).

## 6. Publicación y avisos

Publicar registra quién y cuándo (`published_by`, `published_at`), deja un evento `publish` en
`audit_events` y crea un `schedule_events` por cada persona afectada (la persona, o cada miembro del
equipo): `shift_assignment_published`, `shift_assignment_changed` (al finalizar) o
`shift_template_published` (nueva versión de una plantilla que usa). Los eventos llevan solo ids,
fechas y versión. La persona los ve en "Horario › Cambios recientes"; un futuro proveedor de
notificaciones los leerá con `delivered_at` vacío y los marcará como entregados.

Limitación: cambiar un festivo o la aplicación de un calendario todavía no genera eventos.

## 7. Qué no hace (a propósito)

- No descarga ni precarga festivos: se registran o se pegan desde una fuente validada que queda
  anotada en el calendario (la importación es de todo o nada y rechaza fechas pasadas).
- No clasifica horas extra ni complementarias.
- No recalcula periodos pasados al editar plantillas, asignaciones o festivos.
- No programa cambios de equipo: la asignación de equipo usa el equipo actual (ADR-029).

## 8. Permisos

| Quién                               | Ver horarios publicados                            | Borradores | Plantillas y calendarios   | Asignar y publicar |
| ----------------------------------- | -------------------------------------------------- | ---------- | -------------------------- | ------------------ |
| Empleado                            | El suyo (individual, de su equipo, de su contrato) | No         | Ver                        | No                 |
| Manager                             | El de las personas que supervisa y de sus equipos  | No         | Ver                        | No                 |
| RR. HH. / administración de empresa | Su ámbito (empresa, centro o equipo)               | Su ámbito  | Gestionar (ámbito empresa) | Su ámbito          |
| Auditoría                           | Toda la empresa                                    | No         | Ver                        | No                 |
| Administración de grupo             | Empresas de su grupo                               | Sí         | Gestionar                  | Sí                 |

Una membresía caducada o un rol con vigencia futura no dan acceso. Detalle en
[PERMISOS.md](PERMISOS.md) y decisión en ADR-030.
