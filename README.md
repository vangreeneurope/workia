# Portal del empleado del grupo

Plataforma web multiempresa para el control horario, la gestión de vacaciones y ausencias y los
gastos comerciales con OCR de tickets. Una sola aplicación para todas las empresas del grupo, cada
una con su plantilla, responsables, calendarios, políticas e identidad visual.

Estado actual: **fase 0 (base técnica) y modelo de autorización multiempresa completados**. Los
módulos funcionales aún no están construidos. Ver [docs/ESTADO_PROYECTO.md](docs/ESTADO_PROYECTO.md).

## Tecnología

Next.js 16 (App Router) · React 19 · TypeScript estricto · Tailwind CSS 4 · shadcn/ui (Radix) ·
Supabase (PostgreSQL, Auth, Storage privado, Row Level Security) · PWA instalable en iOS y Android ·
Vitest, Testing Library y Playwright.

## Requisitos

- Node.js 22 o superior (`.nvmrc`).
- Un proyecto de Supabase (recomendado en una región de la UE).
- Opcional para `npm run test:db`: PostgreSQL 15+ instalado en local.
- Opcional para desarrollo local completo: Docker y la CLI de Supabase (`npx supabase`).

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # rellena URL y clave publicable de Supabase
npm run dev                  # http://localhost:3000
```

### 1. Aplicar las migraciones

Con la CLI de Supabase enlazada a tu proyecto:

```bash
npx supabase login
npx supabase link --project-ref <id-del-proyecto>
npx supabase db push
```

O en local con Docker: `npx supabase start` (aplica `supabase/migrations/` automáticamente).

### 2. Configurar Supabase Auth (panel de Supabase)

- **Authentication > Sign In / Providers**: desactiva "Allow new users to sign up". Las cuentas se
  crean por invitación.
- **Authentication > URL Configuration**: Site URL = URL pública de la app; añade
  `https://<tu-dominio>/auth/confirmar` a Redirect URLs.
- **Requisitos de contraseña** (en la configuración del proveedor Email; el nombre exacto del menú
  puede variar entre versiones del panel): longitud mínima 12, con minúsculas, mayúsculas y
  dígitos (coincide con la validación del formulario y con `supabase/config.toml`).
- **Authentication > Email Templates**: los enlaces deben apuntar a la ruta de la app con
  `token_hash`, por ejemplo:
  - Invitación: `{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=invite`
  - Recuperar contraseña: `{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=recovery`
  - Cambio de email: `{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=email_change`
- Configura un SMTP propio para producción (el de Supabase tiene límites bajos).

### 3. Crear la administración inicial

Invita a las personas desde **Authentication > Users > Invite user** y, después, en el editor SQL
(como `postgres`, nunca desde la aplicación):

```sql
-- Administración de plataforma (soporte técnico)
insert into public.platform_admins (user_id)
select id from auth.users where email = 'soporte@tu-grupo.es';

-- Grupo y su administrador
insert into public.groups (name, slug) values ('Mi Grupo', 'mi-grupo');
insert into public.group_admins (group_id, user_id)
select g.id, u.id from public.groups g, auth.users u
where g.slug = 'mi-grupo' and u.email = 'direccion@tu-grupo.es';
```

A partir de ahí, la administración de grupo crea empresas y la de cada empresa gestiona
membresías, roles y fichas. Los permisos **solo** viven en las tablas `platform_admins`,
`group_admins`, `role_assignments` y `manager_assignments`; nunca en los metadatos de Auth. Ver
[docs/PERMISOS.md](docs/PERMISOS.md).

### Desarrollo local con datos sintéticos

Con Docker: `npx supabase start` y `npx supabase db reset` aplican las migraciones y cargan
`supabase/seeds/` (dos empresas ficticias, sin contraseñas: entra con "¿Has olvidado tu
contraseña?" y el buzón local de Supabase). Nunca uses `--include-seed` contra un proyecto real.

## Comandos

| Comando                  | Descripción                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `npm run dev`            | Desarrollo                                                                          |
| `npm run build`          | Build de producción                                                                 |
| `npm run start`          | Servir el build                                                                     |
| `npm run check`          | Tipos + lint + formato + pruebas unitarias                                          |
| `npm test`               | Pruebas unitarias                                                                   |
| `npm run test:e2e`       | Pruebas E2E (tras `npm run build`)                                                  |
| `npm run test:db`        | Migraciones, aislamiento RLS, semillas y reversibilidad en un PostgreSQL desechable |
| `npm run db:types`       | Regenera `src/types/database.ts` desde las migraciones                              |
| `npm run db:types:check` | Falla si los tipos no coinciden con las migraciones                                 |

`test:db` y `db:types` levantan un PostgreSQL temporal (necesitan PostgreSQL 15+ instalado). Para
usar un servidor desechable existente: `TEST_DB_EXTERNAL=1 PGHOST=… PGUSER=… PGPASSWORD=…`.

## Módulo de administración

En **Administración** (`/admin`) cada persona ve solo las áreas de su ámbito: empresas del grupo,
centros, equipos, personas (fichas, condiciones con fecha de efecto, bajas y reactivaciones),
cuentas y roles, aprobadores con suplencias, e importación CSV con validación previa. Las reglas de
fechas están en [docs/VIGENCIA_Y_BAJAS.md](docs/VIGENCIA_Y_BAJAS.md).

Para invitar personas por correo hace falta `SUPABASE_SECRET_KEY` en el servidor (ver
`.env.example` y ADR-025). Sin ella, todo lo demás funciona.

## Control horario

**Fichajes** (`/fichajes`) registra entrada, pausas y salida desde el móvil o el ordenador, con
hora oficial del servidor, reintento sin conexión sin duplicados, ubicación puntual y selfie
opcional según la política de cada empresa. El **terminal compartido** (`/terminal`) permite fichar
con código de empleado y PIN. Historial, incidencias y correcciones (que nunca modifican el fichaje
original) en `/fichajes/historial` y `/fichajes/revision`. Operación y soporte en
[docs/CONTROL_HORARIO.md](docs/CONTROL_HORARIO.md).

## Vacaciones y ausencias

**Ausencias** (`/ausencias`) muestra el saldo (derivado de un libro de movimientos), permite
solicitar por días, medios días u horas con cálculo previo y justificante privado, y enseña el
calendario propio y del equipo (de los compañeros solo "Ausente"). La **bandeja**
(`/ausencias/bandeja`) permite aprobar, rechazar o pedir información. En Administración se
configuran tipos, políticas versionadas, asignaciones y ajustes. Reglas y privacidad en
[docs/AUSENCIAS.md](docs/AUSENCIAS.md).

## Horarios y calendarios laborales

**Horario** (`/horario`) muestra el horario planificado en vista semanal o mensual: la propia
persona ve el suyo y, según sus permisos, el de quien supervisa o gestiona. En Administración,
RR. HH. y la administración de empresa gestionan **plantillas de turno** versionadas (continua,
partida, nocturna y flexible), **asignaciones** por persona, equipo, contrato o excepción con
revisión de conflictos antes de publicar, y **calendarios laborales** con su fuente. No se
precarga ningún festivo. Precedencia, zonas horarias y cambios de hora en
[docs/HORARIOS.md](docs/HORARIOS.md).

## Integración continua

`.github/workflows/ci.yml` ejecuta en cada push y Pull Request: tipos, lint, formato y unitarias;
migraciones con las pruebas positivas y negativas de aislamiento, reversibilidad y comprobación de
tipos sobre un servicio `postgres:16`; y build con E2E.

## Despliegue

La aplicación es un servidor Node.js estándar (`npm run build && npm run start`) y puede
desplegarse en cualquier plataforma compatible con Next.js. Requisitos:

- **HTTPS obligatorio** (la PWA y las cookies `Secure` lo exigen). En producción se envía HSTS.
- Variables de entorno de `.env.example` configuradas en la plataforma, nunca en el repositorio.
- `NEXT_PUBLIC_SUPABASE_URL` debe estar disponible **en el build**, porque la cabecera
  Content-Security-Policy se genera con ella.

## Documentación

[CLAUDE.md](CLAUDE.md) (convenciones y reglas) · [PRD](docs/PRD.md) ·
[Arquitectura](docs/ARQUITECTURA.md) · [Base de datos](docs/BASE_DATOS.md) ·
[Permisos](docs/PERMISOS.md) · [Vigencia y bajas](docs/VIGENCIA_Y_BAJAS.md) ·
[Horarios](docs/HORARIOS.md) · [Control horario](docs/CONTROL_HORARIO.md) · [Ausencias](docs/AUSENCIAS.md) ·
[Normativa](docs/NORMATIVA.md) ·
[Plan de desarrollo](docs/PLAN_DESARROLLO.md) · [Decisiones](docs/DECISIONES.md) ·
[Estado del proyecto](docs/ESTADO_PROYECTO.md)
