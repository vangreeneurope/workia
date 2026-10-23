import type { ReactNode } from "react";
import { Suspense } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { ShellSkeleton } from "@/components/layout/shell-skeleton";

/**
 * Zona privada. El proxy ya redirige a /acceder sin sesión, pero la
 * comprobación real se hace en AppShell -> getUserContext() y en cada página.
 */
export default function PrivateLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
