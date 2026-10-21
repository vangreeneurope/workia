/**
 * Qué áreas de administración ve cada usuario en la empresa activa. Se basa en
 * los permisos reales que devuelve la base de datos (my_company_permissions),
 * así que no duplica la matriz de roles. La autorización definitiva es RLS.
 */

export type CompanyPermission = {
  permission: string;
  scope_type: string;
  work_center_id: string | null;
  team_id: string | null;
};

export type AdminArea =
  "empresas" | "centros" | "equipos" | "personas" | "membresias" | "aprobadores" | "importar";

export const ADMIN_AREAS: { key: AdminArea; label: string; href: string; description: string }[] = [
  {
    key: "empresas",
    label: "Empresas",
    href: "/admin/empresas",
    description: "Empresas de tu grupo e identidad visual.",
  },
  {
    key: "centros",
    label: "Centros de trabajo",
    href: "/admin/centros",
    description: "Sedes y delegaciones.",
  },
  { key: "equipos", label: "Equipos", href: "/admin/equipos", description: "Equipos y su centro." },
  {
    key: "personas",
    label: "Personas",
    href: "/admin/personas",
    description: "Fichas, condiciones, bajas y reactivaciones.",
  },
  {
    key: "membresias",
    label: "Cuentas y roles",
    href: "/admin/membresias",
    description: "Acceso a la plataforma y roles.",
  },
  {
    key: "aprobadores",
    label: "Aprobadores",
    href: "/admin/aprobadores",
    description: "Managers por persona o equipo y suplencias.",
  },
  {
    key: "importar",
    label: "Importar CSV",
    href: "/admin/importar",
    description: "Alta masiva de personas con validación previa.",
  },
];

export function hasPermission(
  permissions: CompanyPermission[],
  permission: string,
  scope: "any" | "company" = "any",
): boolean {
  return permissions.some(
    (p) => p.permission === permission && (scope === "any" || p.scope_type === "company"),
  );
}

export function canUseArea(
  area: AdminArea,
  permissions: CompanyPermission[],
  options: { groupAdmin: boolean },
): boolean {
  switch (area) {
    case "empresas":
      return options.groupAdmin;
    case "centros":
    case "equipos":
      return hasPermission(permissions, "org.manage", "company");
    case "personas":
      return hasPermission(permissions, "employees.read");
    case "membresias":
      return hasPermission(permissions, "members.read", "company");
    case "aprobadores":
      return hasPermission(permissions, "assignments.manage");
    case "importar":
      return hasPermission(permissions, "employees.manage");
  }
}

export function visibleAdminAreas(
  permissions: CompanyPermission[],
  options: { groupAdmin: boolean },
) {
  return ADMIN_AREAS.filter((a) => canUseArea(a.key, permissions, options));
}
