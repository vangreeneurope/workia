# Estado del proyecto

**Última actualización**: 2026-10-21 · **Fase actual**: 0 (base técnica) completada en código;
pendiente de validación contra un proyecto Supabase real.

## 1. Qué está hecho

**Estructura y herramientas**

- Next.js 16.4.2 (App Router, Turbopack), React 19.3, TypeScript estricto
  (`strict`, `noUncheckedIndexedAccess`, `noImplicitReturns`…), Tailwind CSS 4, shadcn/ui (Radix).
- ESLint (sin avisos permitidos, prohíbe `any`), Prettier con orden de clases, Vitest +
  Testing Library, Playwright 1.56.1 (perfiles móvil y escritorio).
- `.env.example`, `.nvmrc`, `supabase/config.toml` endurecido para desarrollo local.

**Supabase**

- Migraciones: identidad y multiempresa (`companies`, `profiles`, `platform_admins`,
  `company_memberships`, `manager_assignments`), auditoría inmutable (`audit_log`) y bucket privado
  `company-logos`. RLS y privilegios mínimos en todas las tablas.
- Clientes de servidor y navegador, proxy de sesión, capa de acceso a datos (DAL).

**Aplicación**

- Acceso con contraseña, recuperación de contraseña, confirmación de enlaces de correo
  (invitación, recuperación, cambio de email), cambio de contraseña, cierre de sesión.
- Layout responsive mobile-first: barra lateral en escritorio, barra inferior con "Más" en móvil,
  cabecera con selector de empresa activa y menú de usuario, márgenes `safe-area` para iOS.
- Navegación filtrada por rol y empresa activa; cada página privada verifica permisos en servidor.
- Identidad visual por empresa (color y logotipo privado con URL firmada).
- Panel de inicio y perfil con datos reales del usuario. Módulos funcionales con estado honesto
  "en preparación", sin datos simulados.
- PWA: manifiesto, iconos (192, 512, maskable, apple-touch), service worker sin caché de datos
  personales y página sin conexión.
- Cabeceras de seguridad (CSP, HSTS en producción, X-Frame-Options, Permissions-Policy…).

**Documentación**: CLAUDE.md, README.md y `docs/` completos (PRD, arquitectura, base de datos,
permisos, normativa, plan, 16 ADR, estado).

## 2. Resultados de verificación (2026-10-21)

| Verificación               | Comando                | Resultado                                                                                                                                                                     |
| -------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tipos                      | `npm run typecheck`    | Sin errores                                                                                                                                                                   |
| Lint                       | `npm run lint`         | 0 errores, 0 avisos                                                                                                                                                           |
| Formato                    | `npm run format:check` | Correcto                                                                                                                                                                      |
| Unitarias                  | `npm test`             | 4 archivos, 36 pruebas superadas                                                                                                                                              |
| RLS y migraciones          | `npm run test:db`      | 3 migraciones aplicadas, 52 comprobaciones superadas (PostgreSQL 16 local)                                                                                                    |
| Build de producción        | `npm run build`        | Correcto; 16 rutas (privadas como prerender parcial)                                                                                                                          |
| E2E                        | `npm run test:e2e`     | 18 pruebas superadas (9 en móvil Pixel 7, 9 en escritorio Chrome)                                                                                                             |
| Dependencias de producción | `npm audit --omit=dev` | 0 vulnerabilidades                                                                                                                                                            |
| Dependencias de desarrollo | `npm audit`            | 5 altas en la cadena `eslint-config-next` → `fast-glob` → `micromatch` → `braces` (solo herramientas de lint; la corrección propuesta por npm es bajar a Next 14, descartada) |

Las pruebas E2E y el build se ejecutaron con valores de Supabase de relleno: cubren todo lo que
ocurre sin sesión (redirecciones, formularios, validación, manifiesto, cabeceras), pero **no** el
flujo con una sesión real.

Además, se comprobó que el script de pruebas de base de datos falla correctamente ante una aserción
falsa (control negativo) y se revisó visualmente la pantalla de acceso en formato móvil.

## 3. Bloqueantes y riesgos

1. **Sin proyecto Supabase conectado.** Falta aplicar las migraciones en Supabase real, regenerar
   tipos y probar el flujo con sesión (panel, selector de empresa, logotipo, cambio de contraseña).
   El armazón privado no se ha podido ver renderizado con datos.
2. **Sin repositorio remoto en GitHub.** El código está versionado en git local, en un contenedor
   temporal. Hay que conectar un repositorio y subirlo para no perderlo.
3. **Red del entorno**: `ui.shadcn.com` bloqueado (componentes escritos a mano, ADR-010).
4. **Emulación de Supabase en pruebas de RLS** (ADR-012): validar también en un proyecto real.
5. **CSP con `'unsafe-inline'`** (ADR-009), a resolver en la fase 5.
6. **Vulnerabilidades en herramientas de desarrollo** (ver tabla): vigilar actualizaciones de
   `eslint-config-next`.
7. **Normativa**: confirmar el estado de la reforma del registro de jornada y revisar
   `docs/NORMATIVA.md` con la asesoría antes de la fase 1.

## 4. Próximos pasos

1. Crear el repositorio en GitHub y subir la rama de la fase 0.
2. Crear proyecto Supabase de pruebas (región UE), `supabase db push`, configurar Auth (README) y
   crear el primer administrador global.
3. Regenerar `src/types/database.ts` y añadir E2E con sesión real.
4. Responder las preguntas abiertas del PRD (OCR, hosting, ubicación al fichar, políticas).
5. Iniciar la fase 1 (administración y control horario).
