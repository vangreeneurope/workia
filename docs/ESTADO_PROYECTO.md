# Estado del proyecto

**Última actualización**: 2026-10-23 · **Fase actual**: 1 en curso. Administración implementada y
probada en local; control horario pendiente. Nada se ha validado aún contra un proyecto Supabase
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

### Módulo de administración (2026-10-23)

- Pantallas responsive en `/admin` (listas, formularios y fichas): empresas del grupo, centros,
  equipos, personas, condiciones de empleo, cuentas y roles, aprobadores y suplencias, importación
  CSV. Cada usuario ve solo las áreas de su ámbito según sus permisos reales.
- Validación compartida cliente/servidor (zod), Server Actions autorizadas con `adminAction`
  (empresa siempre del servidor), interfaz optimista solo en activar/desactivar (reversible).
- Altas, cambios con fecha de efecto (condiciones), desactivación y reactivación (empresas,
  centros, equipos), bajas atómicas con fecha efectiva y reactivación. Ningún borrado.
- Aprobadores por persona o equipo y tipo de solicitud, sin ambigüedad por construcción, con
  errores accionables; suplencias temporales con motivo y auditoría.
- Importación CSV con previsualización, mapeo de columnas, validación por fila y confirmación de
  todo o nada.
- Búsqueda (sin datos personales en la URL), filtros, paginación en servidor y exportación CSV
  auditada y protegida contra inyección de fórmulas.
- `audit_events` con antes/después minimizados; separación entre administración de plataforma y de
  empresa.
- Migración `20261023100000_administracion` con reversión verificada; reglas documentadas en
  `docs/VIGENCIA_Y_BAJAS.md`; ADR-023 a ADR-029.

## 2. Resultados de verificación (2026-10-23)

| Verificación               | Comando                                           | Resultado                                                                                                              |
| -------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Tipos                      | `npm run typecheck`                               | Sin errores                                                                                                            |
| Lint                       | `npm run lint`                                    | 0 errores, 0 avisos                                                                                                    |
| Formato                    | `npm run format:check`                            | Correcto                                                                                                               |
| Unitarias                  | `npm test`                                        | 10 archivos, 83 pruebas superadas                                                                                      |
| Aislamiento multiempresa   | `npm run test:db` → `10_aislamiento_multiempresa` | 134 aserciones superadas                                                                                               |
| Integridad y escalada      | `npm run test:db` → `20_integridad_y_escalada`    | 26 aserciones superadas                                                                                                |
| Semillas sintéticas        | `npm run test:db` → `30_seed_sintetico`           | 15 aserciones superadas                                                                                                |
| Administración             | `npm run test:db` → `40_administracion`           | 81 aserciones superadas                                                                                                |
| Reversibilidad             | `npm run test:db`                                 | 3 reversiones restauran el esquema exacto, reaplicar lo reproduce, 3 reversiones exigen autorización para perder datos |
| Tipos frente a esquema     | `npm run db:types:check`                          | Al día (incluye las funciones RPC)                                                                                     |
| Build de producción        | `npm run build`                                   | Correcto, 33 rutas                                                                                                     |
| E2E                        | `npm run test:e2e`                                | 20 pruebas superadas (móvil y escritorio)                                                                              |
| Dependencias de producción | `npm audit --omit=dev`                            | 0 vulnerabilidades                                                                                                     |

Comprobaciones adicionales: revisión visual en móvil (iPhone 13) de los formularios de asignación,
baja e importación mediante una página temporal ya eliminada; prueba unitaria de que el interruptor
optimista revierte cuando el servidor rechaza el cambio.

**Lo que no se ha podido verificar**: las pantallas de administración con una sesión y datos reales
(requiere un proyecto Supabase), la invitación por correo (requiere `SUPABASE_SECRET_KEY` y Auth
real) y la ejecución del workflow de CI en GitHub (el repositorio no tiene remoto). La lógica de
cada operación está cubierta por las pruebas SQL contra PostgreSQL 16 con la emulación de Supabase.

## 3. Bloqueantes y riesgos

1. **Sin repositorio remoto en GitHub**: CI no se puede ejecutar y el trabajo solo está en git local
   dentro de un contenedor temporal.
2. **Sin proyecto Supabase**: falta aplicar las migraciones y probar las pantallas con sesión real.
3. **Invitaciones**: necesitan `SUPABASE_SECRET_KEY` en el servidor y SMTP configurado.
4. **Cambio de centro o equipo con fecha futura**: no se programa todavía (ADR-029).
5. **Dos auditorías** (`audit_log` completa y `audit_events` minimizada): fijar con la asesoría el
   plazo de conservación de `audit_log` (ADR-026).
6. Riesgos heredados: CSP con `'unsafe-inline'`, componentes shadcn escritos a mano,
   vulnerabilidades en herramientas de lint, revisión normativa pendiente.

## 4. Próximos pasos

1. Subir el repositorio a GitHub y comprobar CI.
2. Proyecto Supabase de pruebas: `supabase db push`, configurar `SUPABASE_SECRET_KEY` y SMTP, probar
   el módulo con las cuentas sintéticas y añadir E2E con sesión.
3. Visor de auditoría sobre `audit_events` y control horario (resto de la fase 1).
