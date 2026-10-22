"use client";

import { Ellipsis } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { SectionKey } from "@/lib/auth/permissions";
import { NAV_ITEMS, isActivePath } from "@/lib/navigation";
import { cn } from "@/lib/utils";

// La pestaña activa se marca con color, peso del texto y una barra superior
// (no solo con color), además de aria-current.
const tabClass =
  "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors";
const activeTab =
  "text-brand font-semibold before:absolute before:inset-x-4 before:top-0 before:h-0.5 before:rounded-full before:bg-current";

/** Barra de navegación inferior para móvil (zona del pulgar). */
export function MobileNav({ visibleKeys }: { visibleKeys: SectionKey[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const visible = NAV_ITEMS.filter((item) => visibleKeys.includes(item.key));
  const primary = visible.filter((item) => item.mobilePrimary).slice(0, 4);
  const secondary = visible.filter((item) => !primary.includes(item));
  const secondaryActive = secondary.some((item) => isActivePath(pathname, item.href));

  return (
    <nav
      aria-label="Navegación principal"
      className="bg-background/95 supports-[backdrop-filter]:bg-background/85 fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="flex">
        {primary.map((item) => {
          const active = isActivePath(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.key} className="flex flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(tabClass, active ? activeTab : "text-muted-foreground")}
              >
                <Icon className="size-5" aria-hidden />
                {item.mobileLabel ?? item.label}
              </Link>
            </li>
          );
        })}
        {secondary.length > 0 ? (
          <li className="flex flex-1">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger
                className={cn(tabClass, secondaryActive ? activeTab : "text-muted-foreground")}
              >
                <Ellipsis className="size-5" aria-hidden />
                Más
              </SheetTrigger>
              <SheetContent side="bottom">
                <SheetHeader>
                  <SheetTitle>Más opciones</SheetTitle>
                  <SheetDescription className="sr-only">
                    Resto de secciones disponibles
                  </SheetDescription>
                </SheetHeader>
                <ul className="grid gap-1 px-2 pb-4">
                  {secondary.map((item) => {
                    const Icon = item.icon;
                    const active = isActivePath(pathname, item.href);
                    return (
                      <li key={item.key}>
                        <Link
                          href={item.href}
                          onClick={() => setOpen(false)}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex h-12 items-center gap-3 rounded-md px-3 text-base",
                            active ? "bg-brand text-brand-foreground" : "hover:bg-accent",
                          )}
                        >
                          <Icon className="size-5" aria-hidden />
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </SheetContent>
            </Sheet>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
