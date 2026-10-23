/**
 * Manual de uso y formación (/ayuda). Cada apartado explica para qué sirve y
 * cómo hacer las tareas habituales, con los nombres de botones y pantallas
 * tal como aparecen en la aplicación. Al cambiar una pantalla, actualiza aquí
 * su apartado (y añade la novedad en src/content/novedades.ts).
 */

export type Tarea = { titulo: string; pasos: string[] };

export type ApartadoAyuda = {
  slug: string;
  titulo: string;
  /** Quién lo usa. */
  paraQuien: string;
  resumen: string;
  /** Dónde está en la aplicación. */
  donde: string;
  tareas: Tarea[];
  consejos?: string[];
};

export const APARTADOS_AYUDA: ApartadoAyuda[] = [
  {
    slug: "primeros-pasos",
    titulo: "Primeros pasos",
    paraQuien: "Todas las personas",
    resumen:
      "Cómo entrar, moverte por la aplicación, cambiar de empresa y qué ocurre con tu sesión.",
    donde: "Pantalla de acceso, menú de la izquierda (abajo en el móvil) y cabecera.",
    tareas: [
      {
        titulo: "Entrar por primera vez",
        pasos: [
          "Abre el enlace de invitación que te ha enviado RR. HH. por correo.",
          "Crea tu contraseña en la pantalla «Cambiar contraseña».",
          "A partir de entonces, entra en la pantalla de acceso con tu correo y tu contraseña y pulsa «Acceder».",
          "Si has olvidado la contraseña, pulsa «¿Has olvidado tu contraseña?» y sigue el enlace que recibirás.",
        ],
      },
      {
        titulo: "Moverte por la aplicación",
        pasos: [
          "En el ordenador, usa el menú de la izquierda. En el móvil, la barra inferior.",
          "Solo ves los apartados que tu rol permite usar.",
          "Arriba a la derecha tienes la Ayuda (signo de interrogación), las Novedades (regalo), los Avisos (campana) y el menú de tu usuario.",
          "Si trabajas en varias empresas del grupo, elige la empresa activa en el selector de la cabecera: todo lo que ves y haces se refiere a esa empresa.",
        ],
      },
      {
        titulo: "Instalar Workia en el móvil",
        pasos: [
          "Ve a «Mi perfil».",
          "En la tarjeta «Instalar la aplicación», pulsa «Instalar en este dispositivo» o sigue las indicaciones de tu navegador («Añadir a pantalla de inicio»).",
          "Desde entonces podrás abrir Workia con su icono, como cualquier otra aplicación.",
        ],
      },
      {
        titulo: "Tu sesión y lo que escribes",
        pasos: [
          "La sesión dura un tiempo máximo desde que entras (60 minutos, salvo que tu empresa haya fijado otro valor), aunque la estés usando.",
          "Cinco minutos antes del cierre verás un aviso con la hora. Al llegar, vuelves a la pantalla de acceso.",
          "Lo que estuvieras escribiendo en un formulario se guarda en tu dispositivo y se recupera al volver a entrar.",
          "Si usas un equipo compartido, cierra la sesión tú mismo desde el menú de tu usuario: así se borra también el texto guardado.",
        ],
      },
    ],
    consejos: [
      "La versión de Workia (por ejemplo, v26.11) aparece bajo el formulario de acceso y al pie del menú. Indícala cuando pidas ayuda.",
    ],
  },
  {
    slug: "fichajes",
    titulo: "Fichajes",
    paraQuien: "Todas las personas con jornada registrada; responsables y RR. HH. para revisar",
    resumen:
      "Registro diario de jornada: entrada, pausas y salida. La hora oficial es siempre la del servidor y los fichajes originales no se modifican nunca: los errores se corrigen con una solicitud.",
    donde:
      "Menú › Fichajes (también «Historial de fichajes» y, si gestionas personas, «Revisión de fichajes»).",
    tareas: [
      {
        titulo: "Fichar la jornada",
        pasos: [
          "Abre Fichajes. Verás tu estado: «Sin jornada abierta», trabajando o en pausa.",
          "Al empezar, pulsa «Entrada».",
          "Para descansar, pulsa «Pausa» y, al volver, «Reanudar».",
          "Al terminar, pulsa «Salida».",
          "Solo aparecen los botones posibles en cada momento: no puedes, por ejemplo, salir estando en pausa.",
        ],
      },
      {
        titulo: "Fichar sin conexión",
        pasos: [
          "Si no hay red, pulsa el botón igualmente: verás el aviso «Sin conexión. El fichaje se enviará al recuperarla».",
          "Cuando vuelva la conexión, el fichaje se envía solo, sin duplicarse.",
          "La hora oficial será la de llegada al servidor; si difiere mucho de la de tu dispositivo, tu responsable lo verá como incidencia para revisarlo.",
        ],
      },
      {
        titulo: "Corregir un fichaje",
        pasos: [
          "Ve a «Historial de fichajes» y localiza el día.",
          "Elige qué hay que corregir: «Añadir un fichaje olvidado», «Cambiar la hora de un fichaje» o «Anular un fichaje erróneo».",
          "Indica la fecha y hora correctas y el motivo (sin datos de salud).",
          "Envíalo. Lo aprueba tu responsable o RR. HH.; nadie aprueba sus propias correcciones.",
          "Al aprobarse, la jornada se recalcula y el fichaje original se conserva con el ajuste enlazado.",
        ],
      },
      {
        titulo: "Revisar correcciones e incidencias (responsables y RR. HH.)",
        pasos: [
          "Abre «Revisión de fichajes»: verás las correcciones pendientes y las incidencias abiertas de tu ámbito.",
          "En cada corrección, pulsa «Aprobar» o «Rechazar».",
          "Las incidencias (por ejemplo, «Salida no registrada» o entrada fuera de tolerancia) se cierran solas si una corrección las resuelve, o puedes cerrarlas como «Resuelta» o «Descartada (no procede)» con una nota.",
        ],
      },
      {
        titulo: "Fichar en un terminal compartido",
        pasos: [
          "En el terminal de tu centro, introduce tu código de persona y tu PIN de 6 cifras.",
          "Elige la acción (entrada, pausa, reanudar o salida).",
          "Tras 5 PIN fallidos seguidos, tu PIN se bloquea 15 minutos. Si lo olvidas, RR. HH. puede restablecerlo.",
        ],
      },
    ],
    consejos: [
      "Si tu empresa lo ha activado, al fichar se toma una única lectura de ubicación, con aviso previo. Nunca hay seguimiento continuo.",
    ],
  },
  {
    slug: "horario",
    titulo: "Horario",
    paraQuien: "Todas las personas",
    resumen:
      "Tu horario planificado: los turnos que te ha asignado tu empresa, los festivos y tus ausencias aprobadas.",
    donde: "Menú › Horario.",
    tareas: [
      {
        titulo: "Consultar tu horario",
        pasos: [
          "Abre Horario para ver tus próximos días de trabajo con su turno.",
          "Los festivos de tu calendario laboral y las ausencias aprobadas aparecen en sus días.",
          "Si ves algo que no cuadra, avisa a RR. HH.: los horarios los asigna y publica la administración de tu empresa.",
        ],
      },
    ],
  },
  {
    slug: "ausencias",
    titulo: "Vacaciones y ausencias",
    paraQuien: "Todas las personas; responsables y RR. HH. para aprobar",
    resumen:
      "Tu saldo, tus solicitudes y el calendario de tu equipo. El saldo se calcula solo según la política de tu empresa y se reserva en cuanto envías la solicitud.",
    donde: "Menú › Ausencias (y «Bandeja de aprobación» si apruebas solicitudes).",
    tareas: [
      {
        titulo: "Pedir vacaciones o una ausencia",
        pasos: [
          "Abre Ausencias y revisa tu saldo disponible.",
          "Elige el «Tipo de ausencia».",
          "Indica «Desde» y «Hasta (incluido)»; si el tipo lo permite, puedes pedir medio día («Mañana» o «Tarde») u horas.",
          "Si quieres, añade un «Comentario para quien aprueba».",
          "Pulsa «Enviar solicitud» (o «Registrar ausencia» si ese tipo no necesita aprobación).",
          "La aplicación calcula los días según tu horario y festivos, y te avisa si no tienes saldo o si se solapa con otra solicitud.",
        ],
      },
      {
        titulo: "Seguir, responder o cancelar una solicitud",
        pasos: [
          "Tus solicitudes aparecen en Ausencias con su estado.",
          "Si quien aprueba te pide información, responde en «Tu respuesta»; la solicitud vuelve a quedar pendiente.",
          "Si el tipo lo pide, añade el justificante con «Añadir justificante». Solo lo ve RR. HH.",
          "Mientras esté pendiente puedes cancelarla; una ausencia aprobada que aún no ha empezado se puede retirar. En ambos casos el saldo se devuelve.",
        ],
      },
      {
        titulo: "Aprobar solicitudes (responsables y RR. HH.)",
        pasos: [
          "Abre la «Bandeja de aprobación»: verás las solicitudes de las personas que apruebas.",
          "Revisa fechas, días y saldo.",
          "Pulsa «Aprobar», «Pedir información» o «Rechazar». Para rechazar o pedir información, el mensaje es obligatorio.",
          "Si tienes una suplencia vigente, también verás las solicitudes de la persona a la que sustituyes.",
        ],
      },
    ],
  },
  {
    slug: "gastos",
    titulo: "Gastos",
    paraQuien: "Personas con gastos; responsables y Contabilidad para aprobar y cerrar",
    resumen:
      "Fotografía tus tickets, revisa los datos que propone la lectura automática, marca cada gasto como listo y envía cada mes tu informe de gastos para aprobarlo.",
    donde:
      "Menú › Gastos (y «Informes de gastos», «Bandeja de informes» o «Contabilidad de gastos» según tu rol).",
    tareas: [
      {
        titulo: "Registrar un gasto con ticket",
        pasos: [
          "En Gastos, pulsa «Nuevo gasto».",
          "Pulsa «Hacer foto del ticket» (abre la cámara del móvil) o «Subir foto o PDF».",
          "Comprueba la vista previa; si no se lee bien, repítela.",
          "En la pantalla de revisión, los datos leídos aparecen como propuestos. Los dudosos se marcan en ámbar: corrígelos si hace falta y marca «Lo he comprobado».",
          "Elige la categoría, la forma de pago y, si tu empresa lo pide, cliente, proyecto, centro de coste o notas.",
          "Pulsa «Confirmar gasto»: queda listo para el informe del mes.",
        ],
      },
      {
        titulo: "Registrar kilometraje o un gasto sin ticket",
        pasos: [
          "Pulsa «Nuevo gasto» y ve a la tarjeta «Sin ticket».",
          "Elige «Kilometraje» e indica los kilómetros: el importe se calcula con el precio por kilómetro de tu empresa.",
          "O elige «Gasto sin ticket», si la política de tu empresa lo permite, y completa los datos.",
        ],
      },
      {
        titulo: "Enviar el informe del mes",
        pasos: [
          "Abre «Informes de gastos». En «Listos para enviar» verás tus gastos confirmados por mes.",
          "Pulsa «Enviar informe de …» del mes que corresponda.",
          "Tu responsable revisa cada línea. Si te devuelve alguna, corrígela y vuelve a enviar: las líneas ya aprobadas que no cambies conservan su aprobación.",
        ],
      },
      {
        titulo: "Aprobar informes (responsables)",
        pasos: [
          "Abre la «Bandeja de informes».",
          "En cada línea, pulsa «Aprobar», «Devolver para corregir» o «Rechazar» (devolver y rechazar exigen comentario).",
          "Si tu empresa tiene pasos adicionales por importe, se aprueba o devuelve el informe entero con «Aprobar informe» o «Devolver informe».",
          "Nadie aprueba sus propios gastos.",
        ],
      },
      {
        titulo: "Cerrar el periodo (Contabilidad)",
        pasos: [
          "Abre «Contabilidad de gastos» y elige el periodo.",
          "Revisa la conciliación, los pendientes y los bloqueos (por ejemplo, categorías sin cuenta contable).",
          "Cierra el periodo: los informes aprobados pasan a un lote con número correlativo y se genera el paquete contable.",
          "Un lote cerrado no se modifica: los ajustes se hacen con un lote corrector.",
        ],
      },
    ],
  },
  {
    slug: "equipo",
    titulo: "Equipo",
    paraQuien: "Responsables y RR. HH.",
    resumen: "Las personas a tu cargo y, si tu rol lo permite, la plantilla de la empresa.",
    donde: "Menú › Equipo.",
    tareas: [
      {
        titulo: "Consultar tu equipo",
        pasos: [
          "Abre Equipo para ver las personas que supervisas.",
          "Desde Fichajes, Ausencias y Gastos revisas lo que te toca aprobar de cada una.",
        ],
      },
    ],
  },
  {
    slug: "avisos",
    titulo: "Avisos",
    paraQuien: "Todas las personas",
    resumen:
      "Solicitudes, aprobaciones, recordatorios y cambios que te afectan. La campana de la cabecera muestra cuántos tienes sin leer.",
    donde: "Campana de la cabecera › Avisos (y «Preferencias de avisos»).",
    tareas: [
      {
        titulo: "Leer tus avisos",
        pasos: [
          "Pulsa la campana. Los avisos sin leer aparecen destacados.",
          "Abre un aviso para ver el detalle e ir a lo que se refiere.",
        ],
      },
      {
        titulo: "Elegir qué avisos recibes por correo",
        pasos: [
          "En Avisos, abre «Preferencias de avisos».",
          "Marca qué avisos quieres recibir también por correo y guarda.",
        ],
      },
    ],
  },
  {
    slug: "informes",
    titulo: "Informes",
    paraQuien: "Responsables, RR. HH., Contabilidad y auditoría, según su ámbito",
    resumen:
      "Información de tu ámbito calculada en el servidor (por ejemplo, el registro de jornada), con filtros y exportación.",
    donde: "Menú › Informes (y «Mis exportaciones»).",
    tareas: [
      {
        titulo: "Consultar y exportar un informe",
        pasos: [
          "Abre Informes y elige el informe.",
          "Aplica los filtros (periodo, centro, equipo o persona, según el informe).",
          "Pide la exportación en el formato que necesites.",
          "Descárgala desde «Mis exportaciones»: solo tú puedes descargarla, durante 7 días, y cada descarga queda registrada.",
        ],
      },
    ],
  },
  {
    slug: "auditoria",
    titulo: "Auditoría",
    paraQuien: "Administración y auditoría",
    resumen: "Quién cambió qué y cuándo. El registro de auditoría no se puede modificar ni borrar.",
    donde: "Menú › Auditoría.",
    tareas: [
      {
        titulo: "Buscar un cambio",
        pasos: [
          "Abre Auditoría.",
          "Busca por actor, objeto, acción, periodo o identificador.",
          "Abre el resultado para ver el detalle del cambio.",
        ],
      },
    ],
  },
  {
    slug: "administracion",
    titulo: "Administración",
    paraQuien: "Administración de la empresa o del grupo y RR. HH.",
    resumen:
      "Configuración de la empresa activa. Solo ves las áreas que tu rol permite gestionar; algunas exigen haber verificado tu identidad con el segundo factor.",
    donde: "Menú › Administración.",
    tareas: [
      {
        titulo: "Dar de alta a una persona",
        pasos: [
          "En Administración › Personas, crea su ficha.",
          "Registra sus condiciones y, en «Cuentas y roles», su acceso y sus roles.",
          "En «Aprobadores», indica quién aprueba sus solicitudes (puede ser de otra empresa del grupo).",
          "Para muchas personas a la vez, usa «Importar CSV»: se valida todo el archivo antes de importar.",
        ],
      },
      {
        titulo: "Organizar horarios y calendarios",
        pasos: [
          "En «Plantillas de turno», define tramos, pausas y horas objetivo; cada cambio es una versión con fecha de efecto.",
          "En «Asignación de horarios», asigna turnos por persona, equipo o contrato y revisa los conflictos antes de publicar.",
          "En «Calendarios laborales», registra los festivos desde una fuente validada.",
        ],
      },
      {
        titulo: "Políticas de fichaje, ausencias y gastos",
        pasos: [
          "«Control horario»: ubicación y selfie al fichar, terminales compartidos y PIN.",
          "«Vacaciones y ausencias»: tipos, políticas con vigencia y ajustes de saldo.",
          "«Gastos»: política, categorías, kilometraje y campos obligatorios.",
        ],
      },
      {
        titulo: "Cambiar la duración de la sesión",
        pasos: [
          "Abre Administración › Configuración.",
          "En «Cierre automático de la sesión», indica los minutos (entre 15 y 720; por defecto, 60).",
          "Pulsa «Guardar». Se aplica a todas las personas de la empresa desde la siguiente página que abran.",
        ],
      },
    ],
  },
  {
    slug: "perfil",
    titulo: "Mi perfil",
    paraQuien: "Todas las personas",
    resumen: "Tus datos de acceso, tus empresas, la seguridad de tu cuenta y tus datos personales.",
    donde: "Menú de tu usuario › Mi perfil.",
    tareas: [
      {
        titulo: "Cambiar la contraseña",
        pasos: [
          "En el menú de tu usuario, pulsa «Cambiar contraseña».",
          "Escribe la nueva contraseña dos veces y guarda.",
        ],
      },
      {
        titulo: "Activar la verificación en dos pasos",
        pasos: [
          "Ve a Mi perfil › «Seguridad de la cuenta».",
          "Escanea el código con una aplicación de autenticación (TOTP) e introduce el código que te muestra.",
          "Si tu rol incluye administración, RR. HH., contabilidad o auditoría, necesitarás este segundo factor para usar esos permisos.",
        ],
      },
      {
        titulo: "Ejercer tus derechos sobre tus datos",
        pasos: [
          "Ve a Mi perfil › «Mis datos y privacidad».",
          "Elige la solicitud: acceso, rectificación, supresión, limitación, portabilidad u oposición.",
          "Una persona de RR. HH. revisa cada solicitud y te responde.",
        ],
      },
    ],
  },
];

export function apartadoAyuda(slug: string): ApartadoAyuda | undefined {
  return APARTADOS_AYUDA.find((a) => a.slug === slug);
}
