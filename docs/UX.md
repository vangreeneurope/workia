# Experiencia de uso: móvil, escritorio, PWA y accesibilidad

Guía del sistema visual y de interacción, de los tamaños y navegadores objetivo y de cómo se
comprueba. Las reglas de negocio, permisos y cálculos no dependen de nada de lo que aquí se describe.

## 1. Uso previsto

| Perfil                   | Dispositivo principal | Tareas críticas                                  |
| ------------------------ | --------------------- | ------------------------------------------------ |
| Personas empleadas       | Móvil, una mano       | Fichar, solicitar ausencias, fotografiar tickets |
| Managers                 | Móvil y escritorio    | Aprobar solicitudes y gastos, revisar fichajes   |
| RR. HH., administración  | Escritorio            | Configuración, informes, exportaciones           |
| Contabilidad y auditoría | Escritorio            | Cierres, liquidaciones, consulta de auditoría    |

## 2. Tamaños objetivo

Se diseña primero para 360 px. La auditoría automática recorre todas las rutas a **360, 390 y 768 px
(táctil) y 1024 y 1440 px (puntero)**.

- Hasta 767 px: barra inferior fija (zona del pulgar) con **Inicio, Fichar, Solicitudes, Gastos y
  Más**; las demás secciones permitidas están en «Más» (hoja inferior). La empresa activa aparece
  siempre en la cabecera junto a su logotipo y el selector de empresa.
- Desde 768 px: columna lateral con todas las secciones y la empresa activa arriba; la barra
  inferior desaparece.
- Las secciones visibles salen de los permisos (`visibleNavKeys`); la navegación no concede ni
  oculta permisos por sí misma.

## 3. Sistema visual

- **Tokens** en `src/app/globals.css` (`--primary`, `--brand`, `--ring`, `--destructive`…); el color
  de la empresa activa se inyecta como `--brand`. Existen tokens oscuros (`.dark`) pero el modo
  oscuro **no está activado** todavía (limitación conocida).
- **Objetivos táctiles**: 44 × 44 px como mínimo en pantallas táctiles. Botones, campos y
  desplegables miden 44 px hasta 1023 px y se compactan a 40 px (32 px los `sm`) solo desde 1024 px,
  donde se usa puntero. Los enlaces dentro de un texto quedan exentos (WCAG 2.5.8).
- **Sin dependencia de hover**: los enlaces van siempre subrayados; ningún contenido ni acción
  aparece solo al pasar el ratón.
- **Estado activo** de la navegación: color, peso del texto y una barra (superior en móvil, lateral
  en escritorio), además de `aria-current="page"`. Los errores de campo llevan icono y texto, no solo
  color rojo.
- **Tablas**: dentro de un contenedor con desplazamiento propio; la cuadrícula principal usa
  `minmax(0, 1fr)` y las tarjetas `min-w-0`, de modo que una tabla ancha nunca desborda la página.
- **Movimiento reducido**: con `prefers-reduced-motion` se anulan animaciones y transiciones.

## 4. Formularios

- Server Action + `useActionState` + esquema zod; el navegador valida con el mismo esquema y el
  servidor vuelve a validar.
- `FormField`: etiqueta asociada, ayuda opcional (`description`) y error, ambos enlazados con
  `aria-describedby`; `aria-invalid` en el campo con error.
- `FormMessage`: con errores de campo muestra **«Revisa N campos»**, recibe el foco tras el envío y
  cada error es un enlace que lleva el foco a su campo. Los mensajes nunca incluyen nombres ni
  correos.
- Teclado adecuado (`inputMode="decimal"` en importes y kilómetros, `numeric` en códigos y PIN,
  `type="email"`), autocompletado seguro (`username`, `current-password`, `new-password`,
  `one-time-code`; `off` en PIN, códigos y campos administrativos).
- Autoguardado (ADR-069): lo escrito se guarda en el dispositivo mientras se escribe y se recupera
  al volver a la pantalla con el aviso «Hemos recuperado el texto…» y la opción «Descartar». Nunca
  contraseñas, PIN ni códigos; un campo sensible se excluye con `data-sin-borrador`.
- Sesión (ADR-067): aviso 5 minutos antes del cierre por tiempo máximo y explicación en el acceso.
- Estado pendiente: el botón de envío se desactiva, muestra un indicador y anuncia «enviando» a
  los lectores de pantalla mientras espera; un doble toque no envía dos veces.

## 5. Accesibilidad

- Enlace «Saltar al contenido» como primer elemento enfocable; `main#contenido` lo recibe.
- Landmarks: `header`, `nav` (con `aria-label`), un único `main` y un único `h1` por página.
- Foco visible global (`:focus-visible`, contorno de 3 px con el token `--ring`; blanco sobre la
  columna lateral oscura).
- Diálogos y hojas de Radix (foco atrapado, Escape, título y descripción).
- Regiones vivas moderadas (`aria-live="polite"`) para resultados; `role="alert"` solo para errores.
- Gestión del foco en el fichaje: el aviso de ubicación recibe el foco al abrirse y, tras fichar, el
  foco vuelve a la siguiente acción.

## 6. Cámara y ubicación

- **Ubicación**: solo si la política de la empresa la pide. Antes del permiso del navegador se
  explica para qué se usa y que es una única lectura (nunca seguimiento). Siempre hay «Fichar sin
  ubicación»; si se deniega, no está disponible o se agota el tiempo, el fichaje se registra igual
  con ese estado (y, si la política la exige, con una incidencia para revisión).
- **Cámara** (tickets y selfie opcional): se abre solo al pulsar, mediante el selector del sistema
  (`capture`), sin pedir permisos por adelantado. Alternativas siempre visibles: subir foto o PDF, y
  gasto sin ticket (kilometraje o manual si la política lo permite). La selfie nunca es obligatoria
  y no hay reconocimiento facial.

## 7. PWA

- `src/app/manifest.ts`: nombre, `start_url=/panel`, `display: standalone`, iconos 192/512 y
  maskable, `apple-touch-icon` y metadatos `appleWebApp`.
- Instalación a petición en **Mi perfil › Instalar la aplicación** (ADR-062): botón en Chrome/Edge
  (Android y escritorio); pasos de Safari en iOS.
- Service worker (`public/sw.js`, ADR-008): precachea solo `/offline.html` e iconos; las
  navegaciones van siempre a red y, sin conexión, muestran la página estática. **No se guardan** en
  cachés respuestas autenticadas, tickets, coordenadas, tokens ni informes.

## 8. Red inestable

- **Fichajes**: si el envío falla por red se guardan en el dispositivo (solo tipo, clave de
  idempotencia, hora declarada y origen; sin ubicación ni foto) y se reenvían con la misma clave al
  recuperar la conexión o abrir la pantalla. Se muestra «N fichaje(s) pendiente(s) de enviar»; la
  hora oficial es la del servidor y un rechazo se comunica como error.
- **Resto de operaciones**: no se encolan. Un fallo de red se muestra en el formulario sin perder lo
  escrito (ADR-060) y el reintento reutiliza la clave de idempotencia donde la hay (solicitudes,
  gastos, tickets), por lo que no duplica.
- Nunca se muestra éxito antes de la respuesta del servidor.

## 9. Carga, vacío y error

- Esqueletos (`ShellSkeleton`, `loading.tsx` con «Cargando…» para lectores de pantalla) en lugar de
  indicadores giratorios indefinidos; los giratorios solo acompañan a un botón mientras dura su
  envío.
- Listas vacías con texto que explica qué falta y, cuando procede, qué hacer.
- Página de error con «Reintentar» que vuelve a pedir los datos (`retry`), distinción de «Sin
  conexión» y código para soporte (sin detalles internos).

## 10. Rendimiento

Presupuestos por ruta de uso diario en móvil, medidos en `tests/e2e/sesion/rendimiento.spec.ts` con
la caché del navegador vacía:

| Métrica                                   | Presupuesto |
| ----------------------------------------- | ----------- |
| JavaScript transferido (comprimido)       | 260 KB      |
| Imágenes transferidas                     | 150 KB      |
| Consultas a la API de datos para pintarla | 20          |

Medidas (2026-10-22, entorno E2E local, sin limitación de red, con el resto de pruebas en paralelo):

| Ruta            | JS (KB) | Imágenes (KB) | Consultas | Carga completa (ms) |
| --------------- | ------- | ------------- | --------- | ------------------- |
| `/panel`        | 201     | 0             | 7         | 1364                |
| `/fichajes`     | 207     | 0             | 10        | 1571                |
| `/ausencias`    | 243     | 0             | 14        | 1436                |
| `/gastos`       | 201     | 0             | 11        | 1567                |
| `/gastos/nuevo` | 240     | 0             | 10        | 1508                |
| `/horario`      | 204     | 0             | 18        | 1444                |

Los tiempos se miden en local (servidor, base y navegador en la misma máquina) y solo sirven para
comparar ejecuciones; no representan una red móvil real. Las imágenes son 0 KB porque las pantallas
diarias solo usan iconos SVG en línea; el logotipo de empresa (URL firmada) aparece cuando la
empresa lo tiene configurado. No se han medido Core Web Vitals en dispositivos reales.

## 11. Navegadores

| Navegador                         | Estado            | Cómo se comprueba                                    |
| --------------------------------- | ----------------- | ---------------------------------------------------- |
| Chrome Android (2 últimas)        | Objetivo          | E2E en Chromium con perfil Pixel 7                   |
| Safari iOS 16.4+                  | Objetivo          | Emulación de iPhone 13 **sobre Chromium** (ver § 12) |
| Chrome, Edge escritorio (2 últ.)  | Objetivo          | E2E en Chromium escritorio                           |
| Safari macOS, Firefox (2 últ.)    | Objetivo, sin E2E | Revisión manual pendiente                            |
| Navegadores sin soporte de ES2022 | No soportados     | —                                                    |

iOS 16.4 es la primera versión con notificaciones web y mejoras de PWA; la lista definitiva la debe
acordar la organización.

## 12. Verificación y limitaciones conocidas

Pruebas automáticas (resultados de la última ejecución en `docs/ESTADO_PROYECTO.md`):

| Prueba                                      | Qué comprueba                                                                                                                                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/e2e/sesion/auditoria-vistas.spec.ts` | 62 rutas de 7 perfiles × 5 tamaños: estado HTTP, un `h1` y un `main`, sin desbordamiento, sin controles recortados, objetivos de 44 px y axe-core (WCAG 2.2 A/AA) sin infracciones graves ni críticas |
| `tests/e2e/sesion/flujos.spec.ts`           | Fichaje, solicitud, aprobación y gasto con teclado en perfil móvil; respuesta perdida y reintento sin duplicar                                                                                        |
| `tests/e2e/sesion/rendimiento.spec.ts`      | Presupuestos de § 10                                                                                                                                                                                  |
| `tests/unit/ux.test.tsx`                    | Resumen de errores y foco, `aria-describedby`, avisador global, errores de red sin falso éxito                                                                                                        |

Revisión manual realizada: recorrido con teclado de los flujos críticos (orden de foco, salto al
contenido, foco en el aviso de ubicación y en los errores) y lectura del árbol de accesibilidad de
fichaje, bandeja de aprobación y revisión de gasto (nombres, roles y estados).

Limitaciones conocidas:

- **WebKit no está disponible en este entorno**: Safari iOS solo se emula (tamaño, densidad,
  agente y táctil sobre Chromium). Comportamientos propios de WebKit (zoom al enfocar campos de
  menos de 16 px, `capture` de cámara, `beforeinstallprompt` inexistente, almacenamiento en modo
  privado) deben verificarse en un iPhone real antes del piloto.
- **Lector de pantalla**: no se ha probado con VoiceOver ni TalkBack reales. Se ha revisado el
  árbol de accesibilidad (nombres, roles, foco) y axe-core; queda pendiente una sesión manual.
- La auditoría automática usa las semillas sintéticas; pantallas con muchos datos reales pueden
  mostrar densidades distintas.
- Modo oscuro no activado.
