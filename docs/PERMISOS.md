# Permisos

## 1. Principios

1. **Mínimo privilegio**: cada rol ve y hace solo lo necesario.
2. **Por empresa**: los roles se asignan por empresa. Ser RR. HH. en la empresa A no da permisos en B.
3. **Varios roles**: una persona puede tener varios roles en una empresa (por ejemplo, `manager` y
   `employee`) y pertenecer a varias empresas.
4. **Supervisión entre empresas**: un responsable puede supervisar a personas de otras empresas
   mediante `manager_assignments`, sin necesidad de pertenecer a ellas.
5. **El backend decide**: la interfaz oculta lo que no procede, pero la autorización real está en
   servidor (DAL) y en RLS.

## 2. Roles

| Clave técnica   | Nombre en la interfaz    | Dónde se guarda                            |
| --------------- | ------------------------ | ------------------------------------------ |
| (global)        | Administrador global     | `platform_admins`                          |
| `company_admin` | Administración / RR. HH. | `company_memberships.roles`                |
| `manager`       | Responsable              | `company_memberships.roles` + asignaciones |
| `employee`      | Empleado                 | `company_memberships.roles`                |
| `accounting`    | Contabilidad             | `company_memberships.roles`                |

## 3. Matriz de datos (aplicada por RLS, fase 0)

| Dato                           | Empleado               | Responsable                    | RR. HH. (su empresa)    | Contabilidad | Admin. global |
| ------------------------------ | ---------------------- | ------------------------------ | ----------------------- | ------------ | ------------- |
| Empresas (ver)                 | Las suyas              | Las suyas + donde supervisa    | Las suyas               | Las suyas    | Todas         |
| Empresas (crear/editar)        | No                     | No                             | No (fase base)          | No           | Sí            |
| Perfil propio (ver/editar)     | Sí / nombre y teléfono | Sí                             | Sí                      | Sí           | Sí            |
| Perfiles de otras personas     | No                     | Solo supervisadas              | Plantilla de su empresa | No           | Todos         |
| Membresías (ver)               | La suya                | La suya + supervisadas         | Todas las de su empresa | La suya      | Todas         |
| Membresías (alta/edición)      | No                     | No                             | Sí, en su empresa       | No           | Sí            |
| Asignar responsables           | No                     | No                             | Sí, en su empresa       | No           | Sí            |
| Ver su responsable             | Sí                     | Sí                             | Sí                      | Sí           | Sí            |
| Auditoría                      | No                     | No                             | De su empresa           | No           | Toda          |
| Logotipos (ver)                | Su empresa             | Sus empresas + donde supervisa | Su empresa              | Su empresa   | Todos         |
| Logotipos (subir)              | No                     | No                             | No (fase base)          | No           | Sí            |
| Crear administradores globales | No                     | No                             | No                      | No           | No (solo SQL) |

Una membresía desactivada (`active = false`) o una empresa desactivada retiran todos los permisos
derivados de ellas.

## 4. Matriz de secciones (interfaz, según la empresa activa)

Implementada en `canAccessSection()` (`src/lib/auth/permissions.ts`).

| Sección   | Empleado | Responsable | RR. HH. | Contabilidad | Admin. global              |
| --------- | -------- | ----------- | ------- | ------------ | -------------------------- |
| Inicio    | Sí       | Sí          | Sí      | Sí           | Sí                         |
| Fichajes  | Sí       | Sí          | Sí      | No           | Solo si además es empleado |
| Ausencias | Sí       | Sí          | Sí      | No           | Solo si además es empleado |
| Gastos    | Sí       | Sí          | Sí      | Sí           | Solo si además tiene rol   |
| Equipo    | No (*)   | Sí          | Sí      | No           | Sí                         |
| Auditoría | No       | No          | Sí      | No           | Sí                         |
| Empresas  | No       | No          | No      | No           | Sí                         |
| Mi perfil | Sí       | Sí          | Sí      | Sí           | Sí                         |

(*) Quien supervisa al menos a una persona (aunque sea de otra empresa) ve "Equipo".

## 5. Cómo se aplica

1. **Proxy**: sin sesión, cualquier ruta privada redirige a `/acceder`.
2. **Página**: cada página privada empieza con `await requireSection("<seccion>")`; sin permiso
   responde 404.
3. **Server Action**: obtiene el contexto con `getUserContext()` y valida cada identificador
   recibido contra él (ver `features/companies/actions.ts`).
4. **RLS**: políticas en cada tabla basadas en `private.has_company_role()` y similares. Probadas en
   `supabase/tests/10_rls_base.test.sql` (52 comprobaciones en la fase 0).

## 6. Al añadir una tabla o una acción

- Define en esta matriz quién ve y quién modifica.
- Escribe las políticas RLS y los `grant` mínimos (por columna si hay campos sensibles).
- Añade pruebas positivas y negativas en `supabase/tests/`.
- Si hay una nueva sección, añádela a `SectionKey`, `canAccessSection()`, `NAV_ITEMS` y sus pruebas.
