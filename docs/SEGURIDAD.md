# Seguridad: modelo de amenazas y revisión

Revisión de seguridad de extremo a extremo antes del piloto (migración `20261031100000_seguridad`).
Este documento describe riesgos y controles técnicos; **no acredita el cumplimiento legal**, que
corresponde validar a la organización (ver [PENDIENTES_LEGALES.md](PENDIENTES_LEGALES.md)).
Datos, finalidades y plazos en [PRIVACIDAD.md](PRIVACIDAD.md); procedimientos en
[RUNBOOKS.md](RUNBOOKS.md).

Pruebas que lo sostienen: `supabase/tests/97_seguridad_catalogo.test.sql` (escáner del catálogo),
`98_privacidad.test.sql` (MFA, soporte, evidencias, frecuencia, retención y derechos), el resto de
pruebas SQL de aislamiento por módulo, `tests/unit/security-static.test.ts` (escáner del código),
`tests/unit/security.test.ts`, `tests/e2e/seguridad.spec.ts` y `npm run security` (secretos y
dependencias).

## 1. Activos

| Activo                                                    | Dónde                                                | Sensibilidad |
| --------------------------------------------------------- | ---------------------------------------------------- | ------------ |
| Registro de jornada (fichajes, correcciones, incidencias) | `time_entries`, `punches`, `time_adjustments`…       | Alta (legal) |
| Ubicación puntual y selfie del fichaje                    | `punches.latitude/longitude`, bucket `punch-selfies` | Muy alta     |
| Ausencias, tipos reservados (salud) y justificantes       | `absence_requests`, bucket `absence-attachments`     | Muy alta     |
| Gastos, tickets y lectura OCR                             | `expenses`, `ocr_runs`, bucket `expense-receipts`    | Alta         |
| Decisiones laborales (aprobaciones, bajas, roles)         | tablas de aprobación, `role_assignments`             | Alta         |
| Exportaciones e informes                                  | bucket `report-exports`, `accounting-exports`        | Alta         |
| Identidades y credenciales                                | Supabase Auth, cookies de sesión, factores TOTP      | Crítica      |
| Secretos de plataforma                                    | `SUPABASE_SECRET_KEY`, `CRON_SECRET`, webhook        | Crítica      |
| Auditoría                                                 | `audit_log`, `audit_events`                          | Alta         |

## 2. Actores

| Actor                                | Capacidad legítima                      | Abuso posible                                             |
| ------------------------------------ | --------------------------------------- | --------------------------------------------------------- |
| Persona empleada                     | Sus fichajes, ausencias, gastos y datos | Ver datos de compañeros, falsear fichajes, abusar subidas |
| Manager                              | Su equipo vigente                       | Ver fuera de su equipo, evidencias de ubicación           |
| RR. HH. / administración de empresa  | Gestión de su ámbito                    | Exceso de consulta, cuenta robada sin MFA                 |
| Contabilidad                         | Gastos y cierres                        | Ver jornadas o ausencias                                  |
| Auditoría                            | Lectura y auditoría                     | Ver evidencias sensibles                                  |
| Administración de grupo              | Empresas de su grupo                    | Salir del grupo                                           |
| Plataforma (soporte)                 | Grupos y administración                 | Leer datos de empresas sin motivo                         |
| Terminal compartido (kiosco)         | Fichar con código y PIN                 | Fuerza bruta del PIN, suplantación                        |
| Planificador y proveedor de correo   | `/api/tareas`, webhook                  | Llamadas falsas, repetición                               |
| Proveedor de OCR (futuro)            | Leer tickets                            | Retener o reutilizar tickets                              |
| Atacante externo                     | Ninguna                                 | Phishing, robo de sesión, XSS, CSRF, subida maliciosa     |
| Persona con acceso al repositorio/CI | Código                                  | Filtrar secretos, introducir dependencias maliciosas      |

## 3. Fronteras de confianza y amenazas

| Frontera                       | Amenaza                                 | Mitigación                                                                                                                             | Prueba                              |
| ------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Navegador ↔ app                | Robo de sesión por XSS                  | Cookies de sesión `httpOnly`, `SameSite=Lax`, `Secure`; sin Supabase en el navegador; React escapa; sin `dangerouslySetInnerHTML`; CSP | `security-static`, `seguridad.spec` |
| Navegador ↔ app                | CSRF                                    | Server Actions con comprobación de origen de Next; descargas con `Sec-Fetch-Site`; cookies Lax; webhooks con firma                     | `security.test` (origen)            |
| Navegador ↔ app                | Clickjacking, incrustación              | `frame-ancestors 'none'`, `X-Frame-Options: DENY`, COOP/CORP                                                                           | `seguridad.spec`                    |
| App ↔ base de datos            | Acceso cruzado entre empresas           | RLS en todas las tablas; FK compuestas `(id, company_id)`; empresa siempre de la sesión; informes con el mismo predicado (ADR-050)     | 10, 96, 97, 98 y por módulo         |
| App ↔ base de datos            | Escalada (concederse permisos)          | Permisos solo en tablas; triggers anti-autoconcesión; claves inmutables                                                                | 20, 40                              |
| App ↔ base de datos            | Cuenta privilegiada robada              | MFA obligatoria por rol en la base de datos (aal2, ADR-053); step-up en la interfaz                                                    | 98 (MFA)                            |
| App ↔ base de datos            | Lectura masiva o abuso                  | Paginación y periodos máximos; límites por persona y acción (`check_rate_limit`)                                                       | 96, 98 (frecuencia)                 |
| App ↔ Storage                  | Archivos públicos o permanentes         | Buckets privados con tamaño y tipos; ruta `<empresa>/…`; URL firmada de 60 s; sin borrado/actualización desde la API (salvo logotipos) | 97, 80, 96                          |
| Persona ↔ subida               | Archivo malicioso                       | Detección por contenido (firma); PDF sin JavaScript ni acciones; imágenes sin metadatos; tamaño y dimensiones; sin SVG/HTML            | `security.test`, `expenses.test`    |
| Plataforma ↔ empresa           | Soporte curioso                         | Sin lectura por defecto; acceso temporal (≤ 24 h) concedido por la empresa, con motivo, MFA y auditoría; perfiles limitados (ADR-054)  | 98 (soporte)                        |
| Manager/auditoría ↔ evidencias | Exposición de ubicación y selfie        | Columnas fuera de la API; RPC `punch_evidence` solo persona, manager y RR. HH. con gestión; cada lectura auditada (ADR-058)            | 98 (evidencias), 97                 |
| Persona ↔ justificantes        | Datos de salud                          | Tipos reservados enmascarados; justificante sensible solo persona y RR. HH. con permiso; apertura auditada                             | 70                                  |
| Kiosco ↔ app                   | Fuerza bruta del PIN                    | Token de dispositivo (hash), intentos registrados y bloqueo; sin ubicación ni selfie                                                   | 60                                  |
| Planificador ↔ app             | Llamada falsa a tareas                  | `CRON_SECRET` (≥ 32, tiempo constante); clave de servicio solo para funciones de tareas; alerta en fallos                              | E2E (401), 97                       |
| Proveedor de correo ↔ app      | Eventos falsos o repetidos              | Firma HMAC con ventana de tiempo; deduplicación; límite de tamaño antes de leer                                                        | `notifications.test`                |
| OCR ↔ proveedor                | Envío de tickets a terceros             | Sin proveedor real; requiere ADR, contrato y configuración; lectura OCR recortada a 90 días                                            | 98 (retención)                      |
| Correo ↔ persona               | Datos en asunto, enlaces que dan acceso | Contenido mínimo; enlace sin token que exige sesión y revalida permiso                                                                 | 95                                  |
| Exportaciones                  | Filtración por archivo o enlace         | Generadas con la sesión del solicitante; privadas, 7 días, huella y descargas registradas                                              | 96                                  |
| Código ↔ repositorio/CI        | Secretos versionados, dependencias      | `security:secrets`, `npm audit` de producción en CI; CI sin secretos ni clave de servicio                                              | CI `seguridad`                      |
| Registros técnicos             | Datos personales o tokens en logs       | `src/lib/log.ts` con redacción; prohibido `console.*` fuera de él                                                                      | `security.test`, `security-static`  |

## 4. Auditoría de la base de datos (resultado)

Escáner automático `97_seguridad_catalogo` (24 comprobaciones, se ejecuta en CI):

- Todas las tablas de `public` con RLS; todas con `company_id` o `group_id` salvo `groups`,
  `platform_admins` y `profiles` (globales por naturaleza, con políticas propias).
- `anon` sin privilegios en tablas ni columnas, y sin acceso al esquema `private`. Solo ejecuta
  `kiosk_device_info` y `kiosk_punch` (terminal, ADR-036).
- `authenticated` sin `DELETE`, `TRUNCATE`, `REFERENCES` ni `TRIGGER`; sin `INSERT`/`UPDATE` a nivel
  de tabla; ninguna clave (`id`, `company_id`, `group_id`) actualizable.
- **Corregido**: las secuencias tenían `USAGE`/`SELECT` para `anon` y `authenticated` (privilegios por
  defecto de Supabase) y permitían leer recuentos globales; ahora no, y los privilegios por defecto
  ya no conceden nada a esos roles.
- Todas las funciones de `public` y `private` fijan `search_path`; las de tareas solo las ejecuta
  `service_role`. Revisado: `private.handle_new_user` y `handle_user_email_change` (trigger) y
  `private.current_request_id` conservan el `execute` por defecto: no se pueden invocar desde la API
  (esquema `private` sin acceso para `anon`; las de trigger no se pueden llamar directamente).
- No hay vistas; si se crean, deben ser `security_invoker` (el escáner lo exige).
- Ningún bucket público, todos con tamaño y tipos; ninguno admite SVG o HTML. Solo los logotipos
  admiten reemplazo desde la API.
- Ninguna política lee `user_metadata`, `app_metadata` ni claims del JWT; ninguna es incondicional
  ni se aplica a `anon`.
- **Corregido**: coordenadas y selfie de los fichajes eran legibles por auditoría y por cualquiera con
  lectura de tiempo; ahora solo vía `punch_evidence` (ADR-058).
- **Corregido**: la administración de plataforma podía leer los perfiles (nombre y correo) de toda
  la base; ahora solo los de administración y los de empresas con acceso de soporte vigente.
- **Edge Functions**: no hay ninguna en el repositorio. Si se añaden, deben verificar el JWT, no usar
  la clave de servicio sin ADR y figurar en este escáner.

## 5. Server Actions y Route Handlers (resultado)

El escáner `security-static` comprueba en cada cambio que **toda** Server Action exportada y todo
Route Handler obtiene la identidad de la sesión (salvo las excepciones de ADR-036 y ADR-048), que
el `company_id` nunca sale del formulario, que las descargas comprueban origen y frecuencia, y que no
se usa `getSession()`.

| Aspecto       | Estado                                                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Autenticación | `getClaims()` en el proxy y en `dal.ts`. **Corregido**: `setPeopleSearch` y `clearPeopleSearch` no comprobaban la identidad (solo guardaban una cookie).       |
| Autorización  | Sección o área de administración en la app; permisos y RLS en la base de datos, con MFA por rol.                                                               |
| Validación    | zod en el servidor (mismos esquemas que el cliente); la base de datos revalida.                                                                                |
| CSRF / origen | Server Actions: comprobación de origen de Next. Descargas: `Sec-Fetch-Site` (`isCrossSiteRequest`). Rutas de máquina: secreto o firma.                         |
| Frecuencia    | Supabase Auth limita acceso y verificaciones; `check_rate_limit`: subidas 60/h, exportaciones 30/h, descargas 120/h, segundo factor 10/15 min, derechos 5/día. |
| Idempotencia  | Claves en fichajes, ausencias, gastos, informes, cierres, exportaciones y derechos.                                                                            |
| Errores       | Mensajes genéricos o redactados por nosotros (`db-errors.ts`); nunca detalles internos ni datos personales.                                                    |

## 6. Navegador: cabeceras, CSP, cookies y subidas

- **CSP**: `default-src 'self'`; `script-src 'self' 'unsafe-inline'` (sin `unsafe-eval` en
  producción); `script-src-attr 'none'`; `object-src`, `frame-src` y `frame-ancestors` `'none'`;
  `base-uri` y `form-action` `'self'`; conexiones solo al propio origen y a Supabase;
  `upgrade-insecure-requests`. Una CSP con nonce exigiría renderizado dinámico de todas las páginas
  y es incompatible con el prerenderizado parcial (guía de Next.js); queda como riesgo aceptado con
  compensaciones (ADR-055).
- **Otras cabeceras**: HSTS con preload, `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy` restrictiva (cámara y geolocalización solo en el propio
  origen), COOP y CORP `same-origin`, `Origin-Agent-Cluster`, sin `X-Powered-By`.
  **Corregido**: `geolocation=()` bloqueaba la lectura puntual al fichar que la empresa puede
  activar; ahora `geolocation=(self)` (nunca seguimiento: sin `watchPosition`, comprobado).
- **Cookies**: sesión de Supabase `httpOnly`, `SameSite=Lax`, `Secure` en producción; empresa activa
  y búsqueda de personas `httpOnly`; terminal `SameSite=Strict` y ruta `/terminal`.
- **Subidas**: tipo por contenido (no por extensión), tamaño y dimensiones máximos, PDF sin contenido
  activo ni truncados (**corregido** también en justificantes), metadatos eliminados en JPEG y PNG
  (**corregido** en PNG de justificantes), nombre original no guardado, ruta aleatoria. Los buckets
  limitan tipos y tamaño. No se ejecuta antivirus: riesgo residual documentado.

## 7. Registro técnico, `request_id` y alertas

- **request_id**: el proxy acepta un `x-request-id` válido o genera uno, lo pasa a la petición y lo
  devuelve en la respuesta; el cliente de Supabase lo envía a PostgREST y `audit_events.request_id`
  lo guarda. Así se correlaciona una incidencia de soporte, el registro técnico y la auditoría.
- **Niveles**: `debug`, `info`, `warn`, `error` (`LOG_LEVEL`, por defecto `info`). Una línea JSON por
  evento con `ts`, `level`, `event` (código en minúsculas) y campos.
- **Redacción** (`src/lib/log.ts`): se sustituyen los campos cuyo nombre indica dato personal o
  secreto (correo, nombre, teléfono, NIF, coordenadas, nota, motivo, token, cookie, clave…) y se
  enmascaran en cualquier valor los correos, JWT, `Bearer`, claves de Supabase, IBAN y DNI. De los
  errores solo se guardan tipo y código.
- **Alertas** (`log.security`, campo `alert: true`): accesos no autorizados a `/api/tareas`, firmas
  de webhook no válidas, pasos de tareas fallidos, límites de frecuencia superados, verificaciones
  de segundo factor fallidas, factor eliminado y accesos de soporte concedidos. La plataforma de
  despliegue debe enviar a guardia toda línea con `alert: true` (ver RUNBOOKS, § 1).
- `audit_events` no es un registro técnico: no guarda errores, cabeceras, IP, tokens ni secretos.

## 8. Autenticación y MFA

- Altas solo por invitación; contraseña mínima de 12 caracteres con mayúsculas, minúsculas y
  dígitos; rotación de tokens de refresco.
- **MFA obligatoria** (TOTP) para administración de empresa, RR. HH., contabilidad, auditoría,
  administración de grupo y de plataforma. Se aplica **en la base de datos**: sin sesión aal2 esos
  roles no conceden ningún permiso (las personas siguen pudiendo fichar y gestionar lo suyo). La
  interfaz lleva a verificar (step-up) al entrar en secciones de gestión.
- Quien tenga un factor configurado debe verificarlo tras iniciar sesión, y cambiar la contraseña
  exige haberlo verificado.
- **Degradación**: si el proyecto de Supabase no tuviera MFA disponible, el propietario de la base de
  datos puede desactivar la exigencia (`private.security_settings.mfa_enforced`) siguiendo
  RUNBOOKS, § 6; queda documentado y debe ser temporal. `supabase/config.toml` tiene TOTP
  desactivado en local: en el proyecto real hay que activarlo (`[auth.mfa.totp]`).

## 9. Dependencias, secretos, configuración y copias

- **Dependencias**: `npm audit --omit=dev` sin vulnerabilidades (bloquea en CI si hay altas o
  críticas). Las 5 altas de `npm audit` completo son de `braces` dentro de `eslint-config-next`
  (herramienta de desarrollo): el aviso afecta a todas sus versiones y no hay corrección; solo se
  explota con patrones glob controlados por un atacante, que en el lint no existen. Riesgo aceptado
  y revisable en cada actualización de `eslint-config-next`. Versiones exactas fijadas para
  `pdf-lib` y `fflate`.
- **Secretos**: `npm run security:secrets` revisa los archivos versionados (claves de Supabase, JWT,
  claves privadas, tokens, `.env`, cadenas de conexión con contraseña). Revisado también el historial:
  sin hallazgos. Solo tres variables públicas (`NEXT_PUBLIC_*`), comprobado por prueba.
- **CI**: sin secretos; la base de datos de pruebas es un contenedor desechable; la clave de
  servicio no existe en CI. Permisos del flujo: `contents: read`.
- **Configuración**: registro abierto desactivado, anónimos desactivados, URL de redirección
  restringidas. Pendiente en el proyecto real: activar TOTP, CAPTCHA si hay abuso, SMTP propio y
  límites de Auth (RUNBOOKS, § 8).
- **Copias**: dependen del plan de Supabase (copias diarias; PITR en planes superiores). Procedimiento
  de restauración y prueba periódica en RUNBOOKS, § 4. Storage no entra en las copias de la base de
  datos: decidir copia de los buckets (pendiente legal y técnico).

## 10. Riesgos residuales

| Riesgo                                                    | Motivo                                                       | Seguimiento                                           |
| --------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| `'unsafe-inline'` en scripts                              | Incompatibilidad de nonce con prerenderizado parcial         | Revisar con cada versión de Next (ADR-055)            |
| Sin antivirus en subidas                                  | Sin proveedor; validación estructural y sin contenido activo | Decidir si se añade un escáner (pendiente)            |
| Límites de frecuencia en subidas directas a Storage       | Las cuotas por persona se aplican en las Server Actions      | Cuotas por bucket en el proyecto real                 |
| `audit_events` y registros técnicos sin plazo definido    | Decisión legal pendiente                                     | PENDIENTES_LEGALES                                    |
| Sin verificación con proyecto Supabase real               | No hay proyecto todavía                                      | ESTADO_PROYECTO                                       |
| Una persona con acceso al propietario de la base de datos | Puede desactivar MFA o leer todo                             | Acceso nominal, MFA en el panel de Supabase, registro |
