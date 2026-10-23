import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { REPORTS } from "@/features/reports/catalog";
import { ReportView } from "@/features/reports/components/report-view";
import { requireSection } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Auditoría" };

/**
 * Auditoría consultable (append-only): solo con permiso audit.read en la
 * empresa activa (la base de datos lo comprueba). Los datos personales y textos
 * libres llegan ya enmascarados.
 */
export default async function AuditoriaPage({ searchParams }: PageProps<"/auditoria">) {
  const ctx = await requireSection("auditoria");
  return (
    <>
      <PageHeader
        title="Auditoría"
        description="Quién cambió qué y cuándo. Busca por actor, objeto, acción, periodo o identificador."
      />
      <ReportView
        def={REPORTS.audit}
        companyId={ctx.activeCompanyId as string}
        basePath="/auditoria"
        search={await searchParams}
      />
    </>
  );
}
