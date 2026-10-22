import { ChevronRight, Download, History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { visibleReports, type ReportDef } from "@/features/reports/catalog";
import { requireSection } from "@/lib/auth/dal";
import { canAccessSection } from "@/lib/auth/permissions";
import { businessDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Informes" };

const GROUPS: { title: string; keys: ReportDef["key"][] }[] = [
  { title: "Jornada", keys: ["time_daily", "time_summary", "time_register"] },
  { title: "Ausencias y vacaciones", keys: ["absence_balances", "absence_requests"] },
  { title: "Gastos", keys: ["expenses", "closures"] },
  { title: "Aprobaciones", keys: ["approvals"] },
];

const APPROVAL_LABELS: Record<string, string> = {
  absences: "Ausencias",
  expense_reports: "Informes de gastos",
  time_corrections: "Correcciones de fichaje",
};

export default async function InformesPage() {
  const ctx = await requireSection("informes");
  const companyId = ctx.activeCompanyId as string;
  const reports = visibleReports(ctx);
  const visible = new Set(reports.map((r) => r.key));
  const today = businessDate();
  const supabase = await createClient();
  // Recuentos del mes calculados en la base de datos, solo de tu ámbito.
  const [approvalsRes, exportsRes] = await Promise.all([
    visible.has("approvals")
      ? supabase.rpc("report_approvals", {
          p_company: companyId,
          p_from: `${today.slice(0, 7)}-01`,
          p_to: today,
        })
      : null,
    supabase
      .from("report_exports")
      .select("id", { count: "exact", head: true })
      .eq("requested_by", ctx.userId)
      .eq("status", "ready"),
  ]);
  const approvals = approvalsRes?.data ?? [];

  return (
    <>
      <PageHeader
        title="Informes"
        description="Información de tu ámbito calculada en el servidor, con filtros que puedes guardar en la dirección y exportar."
        actions={
          <Link
            href="/informes/exportaciones"
            className="hover:bg-accent inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm"
          >
            <Download className="size-4" aria-hidden /> Mis exportaciones
            {exportsRes.count ? <span className="tabular-nums">({exportsRes.count})</span> : null}
          </Link>
        }
      />

      {approvals.length > 0 ? (
        <section aria-labelledby="h-aprobaciones" className="mb-6">
          <h2 id="h-aprobaciones" className="mb-3 text-lg font-semibold">
            Aprobaciones de este mes
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {approvals.map((a) => (
              <Card key={a.kind}>
                <CardHeader>
                  <CardDescription>{APPROVAL_LABELS[a.kind] ?? a.kind}</CardDescription>
                  <CardTitle className="text-3xl tabular-nums">{a.pending}</CardTitle>
                </CardHeader>
                <CardContent className="text-muted-foreground text-sm">
                  pendientes · {a.overdue} vencidas · {a.decided} decididas
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-6">
        {GROUPS.map((g) => {
          const list = reports.filter((r) => g.keys.includes(r.key));
          if (list.length === 0) return null;
          return (
            <section key={g.title} aria-label={g.title}>
              <h2 className="mb-3 text-lg font-semibold">{g.title}</h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((r) => (
                  <li key={r.key}>
                    <Link
                      href={`/informes/${r.slug}`}
                      className="bg-card hover:bg-accent/60 flex h-full min-h-24 items-start gap-3 rounded-xl border p-4 shadow-xs"
                    >
                      <span className="grid flex-1 gap-1">
                        <span className="font-medium">{r.title}</span>
                        <span className="text-muted-foreground text-sm">{r.description}</span>
                      </span>
                      <ChevronRight
                        className="text-muted-foreground mt-1 size-4 shrink-0"
                        aria-hidden
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {canAccessSection(ctx, "auditoria") ? (
          <Link
            href="/auditoria"
            className="bg-card hover:bg-accent/60 flex min-h-14 items-center gap-3 rounded-xl border p-4 shadow-xs"
          >
            <History className="size-5" aria-hidden />
            <span className="flex-1">Auditoría: quién cambió qué y cuándo</span>
            <ChevronRight className="text-muted-foreground size-4" aria-hidden />
          </Link>
        ) : null}
      </div>
    </>
  );
}
