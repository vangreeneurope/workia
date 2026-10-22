import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/admin/back-link";
import { PageHeader } from "@/components/page-header";
import { reportBySlug, reportVisible } from "@/features/reports/catalog";
import { ReportView } from "@/features/reports/components/report-view";
import { requireSection } from "@/lib/auth/dal";

export async function generateMetadata({
  params,
}: PageProps<"/informes/[informe]">): Promise<Metadata> {
  const def = reportBySlug((await params).informe);
  return { title: def ? def.title : "Informe" };
}

export default async function InformePage({
  params,
  searchParams,
}: PageProps<"/informes/[informe]">) {
  const ctx = await requireSection("informes");
  const { informe } = await params;
  const def = reportBySlug(informe);
  if (!def || !reportVisible(ctx, def.key)) notFound();
  return (
    <>
      <BackLink href="/informes" label="Informes" />
      <PageHeader title={def.title} />
      <ReportView
        def={def}
        companyId={ctx.activeCompanyId as string}
        basePath={`/informes/${def.slug}`}
        search={await searchParams}
      />
    </>
  );
}
