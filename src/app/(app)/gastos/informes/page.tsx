import { ChevronRight, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { BackLink } from "@/components/admin/back-link";
import { StatusBadge } from "@/components/admin/status-badge";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/features/expenses/money";
import { getOwnEmployeeId } from "@/features/schedules/queries";
import { todayIn } from "@/features/schedules/zoned-time";
import { SubmitReportForm } from "@/features/settlement/components/forms";
import {
  periodLabel,
  REPORT_STATUS_BADGE,
  REPORT_STATUS_LABELS,
  sumByCurrency,
  type ReportStatus,
} from "@/features/settlement/labels";
import { requireSection } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Informes de gastos" };

export default async function InformesPage() {
  await requireSection("gastos");
  const employeeId = await getOwnEmployeeId();
  if (!employeeId) {
    return (
      <>
        <BackLink href="/gastos" label="Gastos" />
        <PageHeader title="Informes de gastos" />
        <Alert>
          <Info />
          <AlertTitle>No tienes ficha de empleado en la empresa activa</AlertTitle>
          <AlertDescription>Pide a RR. HH. que complete tu ficha.</AlertDescription>
        </Alert>
      </>
    );
  }
  const supabase = await createClient();
  const today = todayIn("Europe/Madrid");
  const [readyRes, lockedRes, reportsRes] = await Promise.all([
    supabase
      .from("expenses")
      .select("id, expense_date, currency, total_cents")
      .eq("employee_id", employeeId)
      .eq("status", "ready")
      .lte("expense_date", today),
    supabase
      .from("expense_report_items")
      .select("expense_id, decision, expense_reports (status)")
      .eq("employee_id", employeeId),
    supabase
      .from("expense_reports")
      .select(
        "id, period_month, version, status, submitted_at, expense_report_items (currency, total_cents, decision)",
      )
      .eq("employee_id", employeeId)
      .order("period_month", { ascending: false })
      .order("version", { ascending: false })
      .limit(36),
  ]);
  // Gastos que ya están en un informe vigente o fueron rechazados: no se vuelven a enviar.
  const locked = new Set(
    (lockedRes.data ?? [])
      .filter((i) => i.decision === "rejected" || i.expense_reports?.status !== "returned")
      .map((i) => i.expense_id),
  );
  const byMonth = new Map<string, { currency: string; total_cents: number }[]>();
  for (const x of readyRes.data ?? []) {
    if (!x.expense_date || !x.currency || x.total_cents === null || locked.has(x.id)) continue;
    const month = `${x.expense_date.slice(0, 7)}`;
    byMonth.set(month, [
      ...(byMonth.get(month) ?? []),
      { currency: x.currency, total_cents: x.total_cents },
    ]);
  }
  const pendingMonths = [...byMonth.entries()].sort(([a], [b]) => b.localeCompare(a));
  const reports = reportsRes.data ?? [];

  return (
    <>
      <BackLink href="/gastos" label="Gastos" />
      <PageHeader
        title="Informes de gastos"
        description="Cada mes envías tus gastos listos en un informe para que lo apruebe tu responsable."
      />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Listos para enviar</CardTitle>
            <CardDescription>
              Al enviar se guarda una copia de cada gasto: lo que revisa tu responsable ya no
              cambia.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pendingMonths.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No tienes gastos listos sin enviar. Confirma tus borradores en Gastos.
              </p>
            ) : (
              <ul className="grid gap-3">
                {pendingMonths.map(([month, rows]) => (
                  <li
                    key={month}
                    className="bg-card/70 grid gap-3 rounded-xl border p-3 sm:flex sm:items-center sm:justify-between"
                  >
                    <div className="grid gap-0.5 text-sm">
                      <span className="font-medium first-letter:uppercase">
                        {periodLabel(`${month}-01`)}
                      </span>
                      <span className="text-muted-foreground">
                        {rows.length === 1 ? "1 gasto" : `${rows.length} gastos`} ·{" "}
                        {sumByCurrency(rows)
                          .map(([c, t]) => formatCents(t, c))
                          .join(" + ")}
                      </span>
                    </div>
                    <SubmitReportForm period={month} label={periodLabel(`${month}-01`)} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mis informes</CardTitle>
          </CardHeader>
          <CardContent>
            {reports.length === 0 ? (
              <p className="text-muted-foreground text-sm">Aún no has enviado informes.</p>
            ) : (
              <ul className="divide-y">
                {reports.map((r) => {
                  const status = r.status as ReportStatus;
                  const approved = r.expense_report_items.filter((i) => i.decision === "approved");
                  const shown = ["approved", "included_in_batch", "accounted"].includes(status)
                    ? approved
                    : r.expense_report_items;
                  return (
                    <li key={r.id}>
                      <Link
                        href={`/gastos/informes/${r.id}`}
                        className="hover:bg-accent/60 -mx-2 flex min-h-14 items-center gap-3 rounded-lg px-2 py-3 text-sm"
                      >
                        <span className="grid min-w-0 flex-1 gap-0.5">
                          <span className="font-medium first-letter:uppercase">
                            {periodLabel(r.period_month)}
                            {r.version > 1 ? ` · versión ${r.version}` : ""}
                          </span>
                          <span className="text-muted-foreground">
                            {sumByCurrency(shown)
                              .map(([c, t]) => formatCents(t, c))
                              .join(" + ") || "—"}
                          </span>
                        </span>
                        <StatusBadge
                          status={REPORT_STATUS_BADGE[status]}
                          label={REPORT_STATUS_LABELS[status]}
                        />
                        <ChevronRight
                          className="text-muted-foreground size-4 shrink-0"
                          aria-hidden
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
