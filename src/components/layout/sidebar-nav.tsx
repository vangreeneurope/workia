"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { SectionKey } from "@/lib/auth/permissions";
import { NAV_ITEMS, isActivePath } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function SidebarNav({ visibleKeys }: { visibleKeys: SectionKey[] }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => visibleKeys.includes(item.key));

  return (
    <nav aria-label="Navegación principal" className="flex-1 overflow-y-auto p-3">
      <ul className="grid gap-1">
        {items.map((item) => {
          const active = isActivePath(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-foreground shadow-xs"
                    : "text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
