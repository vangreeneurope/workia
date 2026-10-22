/**
 * Qué áreas de administración ve cada usuario en la empresa activa. Se basa en
 * los permisos reales que devuelve la base de datos (my_company_permissions y,
 * para horarios y control horario, my_schedule_access, my_time_access y
 * my_absence_access como "schedule.*", "time.*" y "absence.*"),
 * así que no duplica la matriz de roles. La autorización definitiva es RLS.
 */

export type CompanyPermission = {
  permission: string;
  scope_type: string;
  work_center_id: string | null;
  team_id: string | null;
};

export type AdminArea =
  | "empresas"
  | "centros"
  | "equipos"
  | "personas"
  | "membresias"
  | "aprobadores"
  | "importar"
  | "plantillas"
  | "horarios"
  | "calendarios"
  | "fichajes"
  | "ausencias";

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
  {
    key: "plantillas",
    label: "Plantillas de turno",
    href: "/admin/plantillas",
    description: "Tramos, pausas y horas objetivo, con versiones y fecha de efecto.",
  },
  {
    key: "horarios",
    label: "Asignación de horarios",
    href: "/admin/horarios",
    description: "Turnos por persona, equipo o contrato; conflictos y publicación.",
  },
  {
    key: "calendarios",
    label: "Calendarios laborales",
    href: "/admin/calendarios",
    description: "Festivos con su fuente y centros a los que aplican.",
  },
  {
    key: "fichajes",
    label: "Control horario",
    href: "/admin/fichajes",
    description: "Ubicación y selfie al fichar, terminales compartidos y PIN.",
  },
  {
    key: "ausencias",
    label: "Vacaciones y ausencias",
    href: "/admin/ausencias",
    description: "Tipos de ausencia, políticas con vigencia, asignaciones y ajustes de saldo.",
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
    case "plantillas":
    case "calendarios":
      // Plantillas y calendarios son de toda la empresa.
      return hasPermission(permissions, "schedule.manage", "company");
    case "horarios":
      return hasPermission(permissions, "schedule.manage");
    case "fichajes":
      return hasPermission(permissions, "time.manage");
    case "ausencias":
      return hasPermission(permissions, "absence.manage");
  }
}

export function visibleAdminAreas(
  permissions: CompanyPermission[],
  options: { groupAdmin: boolean },
) {
  return ADMIN_AREAS.filter((a) => canUseArea(a.key, permissions, options));
}
