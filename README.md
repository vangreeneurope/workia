# Portal del empleado del grupo

Plataforma web multiempresa para el control horario, la gestión de vacaciones y ausencias y los
gastos comerciales con OCR de tickets. Una sola aplicación para todas las empresas del grupo, cada
una con su plantilla, responsables, calendarios, políticas e identidad visual.

Estado actual: **fase 0 (base técnica) completada**. Los módulos funcionales aún no están
construidos. Ver [docs/ESTADO_PROYECTO.md](docs/ESTADO_PROYECTO.md).

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

### 3. Crear el primer administrador global

Invita al usuario desde **Authentication > Users > Invite user** y, después, en el editor SQL:

```sql
insert into public.platform_admins (user_id)
select id from auth.users where email = 'persona@tu-grupo.es';
```

Los administradores globales no pueden crearse desde la aplicación a propósito (ver
[docs/PERMISOS.md](docs/PERMISOS.md)).

## Comandos

| Comando            | Descripción                                              |
| ------------------ | -------------------------------------------------------- |
| `npm run dev`      | Desarrollo                                               |
| `npm run build`    | Build de producción                                      |
| `npm run start`    | Servir el build                                          |
| `npm run check`    | Tipos + lint + formato + pruebas unitarias               |
| `npm test`         | Pruebas unitarias                                        |
| `npm run test:e2e` | Pruebas E2E (tras `npm run build`)                       |
| `npm run test:db`  | Migraciones y pruebas de RLS en un PostgreSQL desechable |

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
[Permisos](docs/PERMISOS.md) · [Normativa](docs/NORMATIVA.md) ·
[Plan de desarrollo](docs/PLAN_DESARROLLO.md) · [Decisiones](docs/DECISIONES.md) ·
[Estado del proyecto](docs/ESTADO_PROYECTO.md)
