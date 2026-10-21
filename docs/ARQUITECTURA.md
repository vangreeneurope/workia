# Arquitectura

## 1. Visión general

```
Navegador / PWA (iOS, Android, escritorio)
        │  HTTPS
        ▼
Next.js 16 (Node.js)
  ├─ src/proxy.ts ............ refresca la sesión y redirige sin sesión (optimista)
  ├─ Server Components ....... leen datos con la sesión del usuario
  ├─ Server Actions .......... escrituras; validan con zod y reautorizan
  └─ src/lib/auth/dal.ts ..... única fuente de identidad y contexto del usuario
        │  supabase-js con la clave publicable + JWT del usuario (cookies)
        ▼
Supabase
  ├─ Auth ................... correo + contraseña, invitaciones, recuperación
  ├─ PostgreSQL + RLS ....... barrera definitiva de autorización
  ├─ Storage privado ........ logotipos, justificantes, tickets (URL firmada)
  └─ audit_log .............. auditoría inmutable por triggers
```

La aplicación no usa la clave `service_role` en la fase base: todo acceso a datos se hace con la
identidad del usuario, de modo que RLS se aplica siempre.

## 2. Defensa en profundidad

| Capa     | Dónde                                       | Qué hace                                                                    | ¿Es suficiente sola?          |
| -------- | ------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------- |
| 1. Proxy | `src/proxy.ts`, `src/lib/supabase/proxy.ts` | Refresca el token y redirige a `/acceder` si no hay sesión                  | No: es una optimización de UX |
| 2. DAL   | `src/lib/auth/dal.ts`                       | `requireSection()` en cada página, `getUserContext()` en cada Server Action | No: depende de que se llame   |
| 3. RLS   | `supabase/migrations/`                      | Filtra filas y bloquea escrituras según rol y empresa                       | Sí: es la garantía final      |

Una página sin permiso responde 404 (no revela que existe). Un error en la capa 2 nunca expone datos
porque la capa 3 los filtra igualmente.

## 3. Autenticación

- `@supabase/ssr` guarda la sesión en cookies `httpOnly` gestionadas por Supabase.
- En servidor se usa `supabase.auth.getClaims()`, que valida la firma del JWT. No se usa
  `getSession()` para decisiones de seguridad.
- El proxy propaga las cabeceras anti-caché que indica `@supabase/ssr` al renovar cookies, para que
  ningún CDN sirva la sesión de una persona a otra.
- Flujos: acceso con contraseña (`signIn`), cierre de sesión, recuperación de contraseña e
  invitación. Los enlaces de correo llegan a `/auth/confirmar` con `token_hash`, se verifican con
  `verifyOtp` y llevan a `/perfil/contrasena`.
- Destinos de redirección (`?siguiente=`) filtrados por `safeRedirectPath()` contra redirecciones
  abiertas.
- No hay registro público: las altas las hace RR. HH. por invitación (fase 1).

## 4. Multiempresa e identidad visual

- Jerarquía: grupo → empresas → centros y equipos. Una persona tiene una membresía por empresa,
  con estado y vigencia, y roles con ámbito (empresa, centro o equipo) en `role_assignments`.
  La administración de grupo (`group_admins`) cubre todas las empresas de su grupo.
- `getUserContext()` (DAL) lee esas tablas con la sesión del usuario y `assembleUserContext()`
  aplica vigencias y estados; la interfaz decide qué mostrar con `canAccessSection()`. La
  autorización real la aplica RLS con `private.has_permission()` (docs/PERMISOS.md).
- La "empresa activa" es una preferencia de interfaz guardada en la cookie `empresa_activa`
  (`httpOnly`, `SameSite=Lax`). Se valida en servidor contra las empresas del usuario
  (`resolveActiveCompanyId`): una cookie manipulada se ignora.
- La empresa activa determina los roles que se aplican a la navegación. Los datos siguen filtrados
  por RLS independientemente de la cookie.
- La identidad visual se inyecta como variables CSS `--brand` y `--brand-foreground` en el
  armazón. El color se valida con una expresión regular en base de datos y en la aplicación.
- Los logotipos están en el bucket privado `company-logos` y se sirven con URL firmada de 1 hora.

## 5. Renderizado y caché (Next.js 16)

- **Cache Components** y **Partial Prefetching** activados (configuración por defecto del proyecto
  generado y comportamiento previsto para la próxima versión mayor de Next.js).
- Consecuencia práctica: el armazón privado se prerenderiza como esqueleto estático y el contenido
  que depende de la sesión se transmite dentro de `<Suspense>`. Leer cookies fuera de un
  `<Suspense>` rompe el build, lo que actúa como salvaguarda.
- No se usa `"use cache"` con datos personales o de empresa en la fase base. Si se adopta, la clave
  de caché debe incluir el identificador del usuario o de la empresa y se documentará en un ADR.

## 6. Organización del código

- `src/app`: solo rutas y composición. Grupos: `(auth)` público, `(app)` privado.
- `src/features/<dominio>`: Server Actions, esquemas zod y componentes del dominio.
- `src/lib`: infraestructura transversal (Supabase, autenticación, permisos, entorno, navegación).
- `src/components/ui`: componentes shadcn/ui; `src/components/layout`: armazón.

## 7. PWA

- Manifiesto generado por `src/app/manifest.ts` (español, `standalone`, iconos 192/512 y maskable).
- Metadatos `appleWebApp` y `apple-touch-icon` para iOS; `viewport-fit=cover` y márgenes
  `safe-area` para el notch y la barra de inicio.
- `public/sw.js`: solo precachea una página sin conexión e iconos. **No cachea respuestas
  autenticadas** para no dejar datos personales en dispositivos compartidos. Se registra solo en
  producción.
- La instalación requiere HTTPS. En iOS se instala desde Safari con "Añadir a pantalla de inicio".

## 8. Seguridad en cabeceras

Definidas en `next.config.ts`: Content-Security-Policy (orígenes propios y de Supabase,
`frame-ancestors 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy`, `Permissions-Policy` (cámara solo en el propio origen para tickets;
geolocalización desactivada) y HSTS en producción. La CSP aún permite `'unsafe-inline'` en
scripts (ADR-009).

## 9. Despliegue

- Servidor Node.js 22 con `npm run build && npm run start`, detrás de HTTPS.
- Variables de entorno de `.env.example` configuradas en la plataforma. `NEXT_PUBLIC_SUPABASE_URL`
  debe existir en tiempo de build (la CSP la incluye).
- Migraciones con `supabase db push` desde CI o manualmente, siempre antes de desplegar el código
  que las necesita.
- Recomendación: proyecto de Supabase en región UE y un proyecto separado para pruebas.
