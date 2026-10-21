import {
  Building2,
  Clock,
  History,
  House,
  type LucideIcon,
  Receipt,
  CalendarDays,
  UserRound,
  Users,
} from "lucide-react";

import { canAccessSection, type SectionKey, type UserContext } from "@/lib/auth/permissions";

export type NavItem = {
  key: SectionKey;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Aparece en la barra inferior del móvil (máximo 4; el resto va en "Más"). */
  mobilePrimary?: boolean;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "panel", label: "Inicio", href: "/panel", icon: House, mobilePrimary: true },
  { key: "fichajes", label: "Fichajes", href: "/fichajes", icon: Clock, mobilePrimary: true },
  {
    key: "ausencias",
    label: "Ausencias",
    href: "/ausencias",
    icon: CalendarDays,
    mobilePrimary: true,
  },
  { key: "gastos", label: "Gastos", href: "/gastos", icon: Receipt, mobilePrimary: true },
  { key: "equipo", label: "Equipo", href: "/equipo", icon: Users },
  { key: "auditoria", label: "Auditoría", href: "/auditoria", icon: History },
  { key: "empresas", label: "Empresas", href: "/empresas", icon: Building2 },
  { key: "perfil", label: "Mi perfil", href: "/perfil", icon: UserRound },
] as const;

export function visibleNavKeys(ctx: UserContext): SectionKey[] {
  return NAV_ITEMS.filter((item) => canAccessSection(ctx, item.key)).map((item) => item.key);
}

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
