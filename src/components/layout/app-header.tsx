import type { ReactNode } from "react";

import { CompanySwitcher } from "./company-switcher";
import { UserMenu } from "./user-menu";

type AppHeaderProps = {
  user: { fullName: string; email: string; isGlobalAdmin: boolean };
  companies: { id: string; name: string }[];
  activeCompanyId: string | null;
  brand: ReactNode;
};

export function AppHeader({ user, companies, activeCompanyId, brand }: AppHeaderProps) {
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
        <UserMenu {...user} />
      </div>
    </header>
  );
}
