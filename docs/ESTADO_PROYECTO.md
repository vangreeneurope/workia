# Estado del proyecto

**Última actualización**: 2026-10-22 · **Fase actual**: 0 completada y modelo de autorización
multiempresa implementado y probado en local. Pendiente de validación contra un proyecto Supabase
real.

## 1. Qué está hecho

### Fase 0 · Base técnica (2026-10-21)

- Next.js 16.4.2 (App Router, Cache Components), React 19.3, TypeScript estricto, Tailwind CSS 4,
  shadcn/ui (Radix), ESLint sin avisos, Prettier, Vitest, Playwright 1.56.1.
- Autenticación con Supabase (acceso, recuperación, invitación, cambio de contraseña), proxy de
  sesión, capa de acceso a datos, layout mobile-first con navegación protegida, selector de empresa
  con identidad visual, PWA, cabeceras de seguridad.

### Modelo de autorización multiempresa (2026-10-22)

- Migraciones `20261022100000_modelo_multiempresa` y `20261022100100_empleados`: `groups`,
  `group_admins`, `work_centers`, `teams`, `role_assignments`, `employees`, `employment_terms`;
  cambios en `companies` (grupo, estado), `company_memberships` (estado y vigencia) y
  `manager_assignments` (sobre empleados, con estado y vigencia).
- Roles: administración de plataforma, administrador de grupo, `company_admin`, `hr`, `manager`,
  `accounting`, `employee`, `auditor`, con ámbito (empresa, centro, equipo) y vigencia.
- Funciones seguras `current_membership_id()` y `has_permission(empresa, permiso, centro, equipo)`
  sin recursión de RLS; techo de concesión de roles; prohibición de autoconcesiones; permisos solo
  en tablas del servidor (nunca en metadatos de Auth).
- Aislamiento también frente a inferencia: claves foráneas compuestas, índices únicos por empresa,
  claves inmutables, ids generados por el servidor (ADR-018).
- Auditoría de cambios privilegiados con actor, empresa y grupo.
- Reversión documentada y verificada de cada migración nueva (`supabase/rollbacks/`).
- Semillas sintéticas solo locales (`supabase/seeds/`).
- Tipos TypeScript generados desde las migraciones (`npm run db:types`) con control de divergencia.
- La aplicación lee roles de `role_assignments` aplicando vigencias (`assembleUserContext`) y
  reconoce la administración de grupo.
- CI en GitHub Actions (`.github/workflows/ci.yml`).
- Documentación: BASE_DATOS (diagrama de relaciones, reversibilidad), PERMISOS (matrices por tabla
  y rol), ADR-017 a ADR-022, README y CLAUDE.md.

## 2. Resultados de verificación (2026-10-22)

| Verificación               | Comando                                           | Resultado                                                                                                                      |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Tipos                      | `npm run typecheck`                               | Sin errores                                                                                                                    |
| Lint                       | `npm run lint`                                    | 0 errores, 0 avisos                                                                                                            |
| Formato                    | `npm run format:check`                            | Correcto                                                                                                                       |
| Unitarias                  | `npm test`                                        | 5 archivos, 45 pruebas superadas                                                                                               |
| Aislamiento multiempresa   | `npm run test:db` → `10_aislamiento_multiempresa` | 134 aserciones superadas                                                                                                       |
| Integridad y escalada      | `npm run test:db` → `20_integridad_y_escalada`    | 26 aserciones superadas                                                                                                        |
| Semillas sintéticas        | `npm run test:db` → `30_seed_sintetico`           | 15 aserciones superadas                                                                                                        |
| Reversibilidad             | `npm run test:db`                                 | 2 reversiones restauran el esquema exacto, reaplicar reproduce el esquema, 2 reversiones exigen autorización para perder datos |
| Tipos frente a esquema     | `npm run db:types:check`                          | Al día                                                                                                                         |
| Build de producción        | `npm run build`                                   | Correcto                                                                                                                       |
| E2E                        | `npm run test:e2e`                                | 18 pruebas superadas (móvil y escritorio)                                                                                      |
| Dependencias de producción | `npm audit --omit=dev`                            | 0 vulnerabilidades                                                                                                             |
| Dependencias de desarrollo | `npm audit`                                       | 5 altas en la cadena de `eslint-config-next` (sin cambios desde la fase 0)                                                     |

Comprobaciones adicionales realizadas:

- **Control negativo**: al abrir a propósito la política de lectura de empleados (`true or …`),
  `npm run test:db` falla en dos pruebas; las pruebas negativas detectan fugas reales.
- **Modo CI**: `test:db` y `db:types:check` probados contra un servidor PostgreSQL externo
  (`TEST_DB_EXTERNAL=1`), como el servicio `postgres:16` del workflow.
- **Hallazgo corregido durante las pruebas**: un índice único sin `company_id` permitía deducir los
  roles de una persona de otra empresa por el error "clave duplicada" (ADR-018).

El workflow de CI está escrito y validado como YAML, pero **aún no se ha ejecutado en GitHub**
porque el repositorio no tiene remoto.

## 3. Bloqueantes y riesgos

1. **Sin repositorio remoto en GitHub**: el código está en git local en un contenedor temporal, y
   CI no se puede ejecutar hasta subirlo.
2. **Sin proyecto Supabase**: las migraciones y las pruebas de RLS se han ejecutado sobre
   PostgreSQL 16 con una emulación mínima de Supabase (ADR-012). Falta aplicarlas en un proyecto
   real (Supabase usa PostgreSQL 17 en `config.toml`) y validar las semillas con
   `supabase db reset` (columnas reales de `auth.users`/`auth.identities` y acceso con GoTrue).
3. **Altas de personas**: crear membresías para usuarios que aún no existen en Auth requiere un flujo
   de invitación con privilegios de servidor (ADR-011, pendiente para la fase 1).
4. **Rendimiento de RLS**: las políticas llaman a funciones por fila; correcto para el volumen
   previsto, pero habrá que medir con datos reales (ADR-017).
5. Riesgos heredados: CSP con `'unsafe-inline'` (ADR-009), componentes shadcn escritos a mano
   (ADR-010), vulnerabilidades en herramientas de lint, revisión normativa pendiente.

## 4. Próximos pasos

1. Crear el repositorio en GitHub, subir la rama y comprobar que CI pasa.
2. Crear un proyecto Supabase de pruebas (región UE), `supabase db push`, ejecutar las pruebas SQL
   contra él y comparar `supabase gen types` con `src/types/database.ts`.
3. Fase 1: administración (empresas, centros, equipos, invitaciones, roles, asignaciones) y control
   horario sobre `employees`, con las mismas reglas de aislamiento y reversión.
