import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { BackLink } from "@/components/admin/back-link";
import { StatusBadge } from "@/components/admin/status-badge";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/features/expenses/money";
import {
  periodLabel,
  REPORT_STATUS_BADGE,
  REPORT_STATUS_LABELS,
  ROUTING_LABELS,
  sumByCurrency,
  type ReportStatus,
} from "@/features/settlement/labels";
import { requireSection } from "@/lib/auth/dal";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Bandeja de informes" };

export default async function BandejaGastosPage() {
  const ctx = await requireSection("gastos");
  const supabase = await createClient();
  const { data: pending } = await supabase.rpc("my_pending_expense_approvals", {
    p_company: ctx.activeCompanyId as string,
  });
  const ids = (pending ?? []).map((p) => p.report_id);
  const { data: reports } = ids.length
    ? await supabase
        .from("expense_reports")
        .select(
          "id, period_month, version, status, submitted_at, employees (first_name, last_name, employee_code), expense_report_items (currency, total_cents, decision)",
        )
        .in("id", ids)
        .order("submitted_at")
    : { data: [] };
  const routing = new Map((pending ?? []).map((p) => [p.report_id, p]));

  return (
    <>
      <BackLink href="/gastos" label="Gastos" />
      <PageHeader
        title="Bandeja de informes"
        description="Informes de gastos que te toca revisar: como manager, suplente o por una regla de la empresa."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pendientes ({reports?.length ?? 0})</CardTitle>
          <CardDescription>
            Aprueba, rechaza o devuelve cada línea con un comentario.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!reports?.length ? (
            <p className="text-muted-foreground text-sm">No tienes informes pendientes.</p>
          ) : (
            <ul className="divide-y">
              {reports.map((r) => {
                const status = r.status as ReportStatus;
                const p = routing.get(r.id);
                const undecided = r.expense_report_items.filter(
                  (i) => i.decision === "pending",
                ).length;
                return (
                  <li key={r.id}>
                    <Link
                      href={`/gastos/informes/${r.id}`}
                      className="hover:bg-accent/60 -mx-2 flex min-h-16 items-center gap-3 rounded-lg px-2 py-3 text-sm"
                    >
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="truncate font-medium">
                          {r.employees ? `${r.employees.last_name}, ${r.employees.first_name}` : ""}{" "}
                          ·{" "}
                          <span className="first-letter:uppercase">
                            {periodLabel(r.period_month)}
                          </span>
                        </span>
                        <span className="text-muted-foreground">
                          {sumByCurrency(r.expense_report_items)
                            .map(([c, t]) => formatCents(t, c))
                            .join(" + ")}{" "}
                          · {r.expense_report_items.length} líneas
                          {p?.step_order === 1 && undecided > 0
                            ? ` · ${undecided} sin decidir`
                            : ""}{" "}
                          · enviado el {formatDate(r.submitted_at)}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          Paso {p?.step_order}: {ROUTING_LABELS[p?.routing ?? ""] ?? ""}
                        </span>
                      </span>
                      <StatusBadge
                        status={REPORT_STATUS_BADGE[status]}
                        label={REPORT_STATUS_LABELS[status]}
                      />
                      <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
