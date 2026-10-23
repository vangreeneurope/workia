import type { ReactNode } from "react";

import { DemoBanner } from "@/components/demo-banner";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <DemoBanner />
      <main className="flex min-h-dvh items-center justify-center px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <div className="w-full max-w-sm py-10">{children}</div>
      </main>
    </>
  );
}
