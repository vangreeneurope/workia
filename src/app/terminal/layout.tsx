import type { ReactNode } from "react";

/** Terminal compartido: pantalla completa, sin navegación ni datos de sesión. */
export default function TerminalLayout({ children }: { children: ReactNode }) {
  return (
    <main className="bg-background flex min-h-dvh items-center justify-center px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="w-full max-w-md py-8">{children}</div>
    </main>
  );
}
