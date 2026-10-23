import { Bell, CircleHelp, Gift } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { CompanySwitcher } from "./company-switcher";
import { UserMenu } from "./user-menu";

type AppHeaderProps = {
  user: { fullName: string; email: string; isGlobalAdmin: boolean; version: string | null };
  companies: { id: string; name: string }[];
  activeCompanyId: string | null;
  brand: ReactNode;
  unread?: number;
  /** Hay novedades que la persona aún no ha visto. */
  newsPending?: boolean;
};

export function AppHeader({
  user,
  companies,
  activeCompanyId,
  brand,
  unread = 0,
  newsPending = false,
}: AppHeaderProps) {
  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-40 border-b pt-[env(safe-area-inset-top)] backdrop-blur">
      <a
        href="#contenido"
        className="bg-primary text-primary-foreground sr-only rounded-md px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Saltar al contenido
      </a>
      <div className="flex h-16 items-center gap-3 px-4 md:px-8">
        <div className="min-w-0 flex-1 md:hidden">{brand}</div>
        <div className="hidden flex-1 md:block" />
        {companies.length > 1 ? (
          <CompanySwitcher companies={companies} activeCompanyId={activeCompanyId} />
        ) : null}
        <Link
          href="/ayuda"
          aria-label="Ayuda y manual de uso"
          title="Ayuda"
          className="hover:bg-accent inline-flex size-11 items-center justify-center rounded-full"
        >
          <CircleHelp className="size-5" aria-hidden />
        </Link>
        <Link
          href="/novedades"
          aria-label={newsPending ? "Novedades: hay cambios nuevos" : "Novedades"}
          title="Novedades"
          className="hover:bg-accent relative inline-flex size-11 items-center justify-center rounded-full"
        >
          <Gift className="size-5" aria-hidden />
          {newsPending ? (
            <span className="bg-primary absolute top-2 right-2 size-2.5 rounded-full" aria-hidden />
          ) : null}
        </Link>
        <Link
          href="/avisos"
          aria-label={unread > 0 ? `Avisos: ${unread} sin leer` : "Avisos"}
          className="hover:bg-accent relative inline-flex size-11 items-center justify-center rounded-full"
        >
          <Bell className="size-5" aria-hidden />
          {unread > 0 ? (
            <span className="bg-primary text-primary-foreground absolute top-1 right-1 min-w-5 rounded-full px-1 text-center text-[11px] leading-5 font-semibold">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Link>
        <UserMenu {...user} />
      </div>
    </header>
  );
}
