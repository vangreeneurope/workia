import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { getCompanyLogoUrl, getUserContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { brandForeground, mfaPending, safeBrandColor } from "@/lib/auth/permissions";
import { visibleNavKeys } from "@/lib/navigation";

import { AppHeader } from "./app-header";
import { CompanyBrand } from "./company-brand";
import { MobileNav } from "./mobile-nav";
import { SidebarNav } from "./sidebar-nav";

/**
 * Armazón de la zona privada. Lee la sesión, así que siempre se renderiza
 * dentro de un <Suspense> (requisito de Cache Components).
 */
export async function AppShell({ children }: { children: ReactNode }) {
  const ctx = await getUserContext();
  const activeCompany = ctx.companies.find((c) => c.id === ctx.activeCompanyId) ?? null;
  const logoUrl = await getCompanyLogoUrl(activeCompany?.logoPath ?? null);
  const brand = safeBrandColor(activeCompany?.primaryColor);
  const navKeys = visibleNavKeys(ctx);
  // Avisos sin leer de la empresa activa (RLS: solo los propios).
  let unread = 0;
  if (ctx.activeCompanyId) {
    const supabase = await createClient();
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("company_id", ctx.activeCompanyId)
      .is("read_at", null);
    unread = count ?? 0;
  }

  const brandStyle = {
    "--brand": brand,
    "--brand-foreground": brandForeground(brand),
  } as CSSProperties;

  return (
    <div style={brandStyle} className="min-h-dvh md:grid md:grid-cols-[16rem_1fr]">
      <aside className="from-sidebar to-sidebar-end text-sidebar-foreground sticky top-0 hidden h-dvh flex-col bg-linear-to-b md:flex">
        <div className="flex h-16 items-center border-b border-white/10 px-4">
          <CompanyBrand name={activeCompany?.name ?? "Portal del empleado"} logoUrl={logoUrl} />
        </div>
        <SidebarNav visibleKeys={navKeys} />
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        <AppHeader
          user={{ fullName: ctx.fullName, email: ctx.email, isGlobalAdmin: ctx.isGlobalAdmin }}
          companies={ctx.companies.map(({ id, name }) => ({ id, name }))}
          activeCompanyId={ctx.activeCompanyId}
          unread={unread}
          brand={
            <CompanyBrand name={activeCompany?.name ?? "Portal del empleado"} logoUrl={logoUrl} />
          }
        />
        <main
          id="contenido"
          className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-8 md:pb-10"
        >
          {mfaPending(ctx) ? (
            <p
              role="status"
              className="mb-4 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50"
            >
              <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Tus permisos de gestión están en pausa hasta que verifiques tu identidad con un
                segundo factor.{" "}
                <Link href="/perfil/seguridad" className="font-medium underline">
                  Verificar ahora
                </Link>
              </span>
            </p>
          ) : null}
          {children}
        </main>
      </div>

      <MobileNav visibleKeys={navKeys} />
    </div>
  );
}
