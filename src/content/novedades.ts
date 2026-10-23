/**
 * Novedades de Workia para las personas usuarias (icono «Novedades» de la
 * cabecera, /novedades y aviso tras una actualización). ADR-068.
 *
 * Cómo añadir una novedad (en el mismo cambio que la introduce):
 *  - Al principio de la lista (la más reciente primero), con un `id` nuevo,
 *    estable y en minúsculas con guiones. No se reutilizan ids.
 *  - La versión NO se escribe: se calcula al publicar (scripts/version.mjs), y
 *    es la del commit que añadió la novedad.
 *  - Se explica qué cambia para quien usa la aplicación, no cómo se ha hecho.
 *  - Si cambia la forma de trabajar (`tipo: "funcionamiento"`), `antes` cuenta
 *    qué pasaba y `ahora` lo que pasa ahora, paso a paso (mínimo dos pasos).
 *
 * tests/unit/novedades.test.ts comprueba estas reglas.
 */

export type TipoNovedad = "funcionamiento" | "mejora" | "correccion";

export type Novedad = {
  id: string;
  /** Fecha de la novedad (AAAA-MM-DD). */
  fecha: string;
  tipo: TipoNovedad;
  /** Apartado de la aplicación al que afecta. */
  apartado: string;
  titulo: string;
  /** Qué cambia y por qué, en lenguaje de uso. */
  resumen: string;
  /** Solo en cambios de funcionamiento: cómo era antes. */
  antes?: string;
  /** Solo en cambios de funcionamiento: cómo es ahora, paso a paso. */
  ahora?: string[];
};

export const TIPO_LABELS: Record<TipoNovedad, string> = {
  funcionamiento: "Cambio de funcionamiento",
  mejora: "Mejora",
  correccion: "Corrección",
};

export const NOVEDADES: Novedad[] = [
  {
    id: "ayuda-y-manual",
    fecha: "2026-10-23",
    tipo: "mejora",
    apartado: "Ayuda",
    titulo: "Nuevo apartado de Ayuda con el manual de uso",
    resumen:
      "En la parte de arriba hay un botón de Ayuda (el signo de interrogación). Abre una guía de uso y formación organizada por apartados: fichajes, horario, ausencias, gastos, equipo, informes, auditoría, administración y perfil. Cada apartado explica para qué sirve y cómo hacer las tareas más habituales.",
  },
  {
    id: "historial-de-novedades",
    fecha: "2026-10-23",
    tipo: "mejora",
    apartado: "General",
    titulo: "Historial de novedades y aviso tras cada actualización",
    resumen:
      "El icono del regalo, arriba, abre este historial: cada cambio de la aplicación aparece con su versión y una explicación. Cuando Workia se actualiza, al entrar verás un aviso con lo nuevo; al pulsar «Entendido» o «Ver novedades» no vuelve a salir hasta la siguiente actualización, en ningún dispositivo.",
  },
  {
    id: "autoguardado-formularios",
    fecha: "2026-10-23",
    tipo: "funcionamiento",
    apartado: "Formularios",
    titulo: "El texto que escribes se guarda solo",
    resumen:
      "Lo que escribes en los formularios se guarda en tu dispositivo mientras escribes. Si la sesión se cierra antes de enviarlo, no lo pierdes.",
    antes:
      "Si la sesión se cerraba o fallaba la conexión mientras rellenabas un formulario (por ejemplo, el motivo de una ausencia o la descripción de un gasto), al volver a entrar el formulario aparecía vacío y había que escribirlo todo otra vez.",
    ahora: [
      "Escribe en el formulario como siempre: el texto se guarda solo en este dispositivo, sin pulsar nada.",
      "Si la sesión se cierra, vuelve a entrar con tu usuario y contraseña: la aplicación te devuelve a la misma pantalla.",
      "El formulario aparece relleno con lo que habías escrito y un aviso: «Hemos recuperado el texto que escribiste en este formulario».",
      "Revísalo y envíalo. Si prefieres empezar de cero, pulsa «Descartar» en el aviso.",
      "Al enviar con éxito, el texto guardado se borra. También se borra todo al cerrar la sesión tú mismo y, en cualquier caso, a las 24 horas.",
      "Las contraseñas, los PIN y los códigos de verificación nunca se guardan.",
    ],
  },
  {
    id: "cierre-de-sesion-por-tiempo",
    fecha: "2026-10-23",
    tipo: "funcionamiento",
    apartado: "Acceso",
    titulo: "La sesión se cierra sola al cabo de una hora",
    resumen:
      "Por seguridad, la sesión dura un tiempo máximo desde que entras (60 minutos, salvo que tu empresa haya fijado otro valor), aunque la estés usando. Así nadie puede seguir usando tu cuenta en un equipo que se ha quedado abierto.",
    antes:
      "La sesión seguía abierta indefinidamente hasta que pulsabas «Cerrar sesión», incluso días después, si dejabas la pestaña abierta.",
    ahora: [
      "Entra con tu usuario y contraseña como siempre: desde ese momento empieza a contar el tiempo máximo de la sesión.",
      "Cinco minutos antes del cierre aparece un aviso con la hora exacta. Pulsa «Entendido» y termina lo que estés haciendo.",
      "A la hora indicada, la sesión se cierra y vuelves a la pantalla de acceso, con un mensaje que explica el motivo.",
      "Vuelve a entrar para seguir: lo que estuvieras escribiendo se recupera automáticamente.",
      "Si vuelves a una pestaña que dejaste abierta (por ejemplo, desde ayer), la sesión se cierra en ese momento y te pide entrar de nuevo.",
      "La administración de tu empresa puede cambiar los 60 minutos en Administración › Configuración.",
    ],
  },
  {
    id: "version-visible",
    fecha: "2026-10-23",
    tipo: "mejora",
    apartado: "General",
    titulo: "Número de versión a la vista",
    resumen:
      "La versión de Workia aparece debajo del formulario de acceso y, dentro de la aplicación, al pie del menú de la izquierda (en el móvil, en el menú de tu usuario). Tiene la forma vAA.N: «v» de versión, el año en dos cifras y el número de cambios publicados ese año (por ejemplo, v26.11). Sirve para saber qué versión usas cuando pidas ayuda.",
  },
];
