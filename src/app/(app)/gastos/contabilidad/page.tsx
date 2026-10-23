import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/admin/back-link";
import { StatusBadge } from "@/components/admin/status-badge";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/features/expenses/money";
import { getExpenseAccess } from "@/features/expenses/queries";
import { addMonths } from "@/features/schedules/calendar";
import { todayIn } from "@/features/schedules/zoned-time";
import { ClosePeriodForm } from "@/features/settlement/components/forms";
import {
  periodLabel,
  REPORT_STATUS_BADGE,
  REPORT_STATUS_LABELS,
  sumByCurrency,
  type ReportStatus,
} from "@/features/settlement/labels";
import { requireSection } from "@/lib/auth/dal";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Contabilidad de gastos" };

const STATUS_ORDER: ReportStatus[] = [
  "submitted",
  "in_review",
  "returned",
  "approved",
  "included_in_batch",
  "accounted",
];

export default async function ContabilidadPage({
  searchParams,
}: PageProps<"/gastos/contabilidad">) {
  const ctx = await requireSection("gastos");
  const access = await getExpenseAccess();
  if (!access.accounting) notFound();
  const companyId = ctx.activeCompanyId as string;
  const params = await searchParams;
  const current = todayIn("Europe/Madrid").slice(0, 7);
  const period =
    typeof params.periodo === "string" &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(params.periodo) &&
    params.periodo <= current
      ? params.periodo
      : addMonths(`${current}-01`, -1).slice(0, 7);
  const periodDate = `${period}-01`;
  const supabase = await createClient();

  const [reportsRes, blockersRes, batchesRes, categoriesRes] = await Promise.all([
    supabase
      .from("expense_reports")
      .select(
        "id, version, status, previous_version_id, employees (first_name, last_name, employee_code), expense_report_items (currency, total_cents, decision)",
      )
      .eq("company_id", companyId)
      .eq("period_month", periodDate),
    supabase.rpc("accounting_close_blockers", { p_company: companyId, p_period: periodDate }),
    supabase
      .from("accounting_batches")
      .select("id, sequence, kind, period_month, status, closed_at")
      .eq("company_id", companyId)
      .order("sequence", { ascending: false })
      .limit(24),
    supabase.from("expense_categories").select("id, code, name").eq("company_id", companyId),
  ]);
  const reports = reportsRes.data ?? [];
  // Solo cuenta la última versión de cada informe.
  const superseded = new Set(reports.map((r) => r.previous_version_id).filter(Boolean));
  const latest = reports.filter((r) => !superseded.has(r.id));
  const blockers = blockersRes.data ?? [];
  const pending = blockers.filter((b) => b.kind === "pending_report");
  const missing = blockers.filter((b) => b.kind === "missing_account");
  const batches = batchesRes.data ?? [];
  const regular = batches.find((b) => b.kind === "regular" && b.period_month === periodDate);
  const categories = new Map(
    (categoriesRes.data ?? []).map((c) => [c.id, `${c.code} · ${c.name}`]),
  );
  const name = (r: (typeof reports)[number]) =>
    r.employees
      ? `${r.employees.last_name}, ${r.employees.first_name} (${r.employees.employee_code})`
      : "";

  const rows = STATUS_ORDER.map((status) => {
    const list = latest.filter((r) => r.status === status);
    const items = list.flatMap((r) =>
      r.expense_report_items.filter(
        (i) =>
          !["approved", "included_in_batch", "accounted"].includes(status) ||
          i.decision === "approved",
      ),
    );
    return { status, count: list.length, totals: sumByCurrency(items) };
  }).filter((r) => r.count > 0);

  return (
    <>
      <BackLink href="/gastos" label="Gastos" />
      <PageHeader
        title="Contabilidad de gastos"
        description="Conciliación por periodo, informes pendientes, cierre en lotes y paquete contable."
      />
      <nav aria-label="Cambiar de periodo" className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          href={`/gastos/contabilidad?periodo=${addMonths(periodDate, -1).slice(0, 7)}`}
          className="hover:bg-accent inline-flex min-h-11 items-center gap-1 rounded-lg border px-3 text-sm"
        >
          <ChevronLeft className="size-4" aria-hidden /> Anterior
        </Link>
        <span className="px-2 font-medium first-letter:uppercase">{periodLabel(periodDate)}</span>
        {period < current ? (
          <Link
            href={`/gastos/contabilidad?periodo=${addMonths(periodDate, 1).slice(0, 7)}`}
            className="hover:bg-accent inline-flex min-h-11 items-center gap-1 rounded-lg border px-3 text-sm"
          >
            Siguiente <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : null}
      </nav>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conciliación</CardTitle>
            <CardDescription>
              Informes del periodo por estado (última versión). En aprobados y posteriores, solo las
              líneas aprobadas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">No hay informes en este periodo.</p>
            ) : (
              <table className="w-full text-sm">
                <caption className="sr-only">Conciliación por estado</caption>
                <thead className="text-muted-foreground text-left">
                  <tr>
                    <th scope="col" className="py-2 font-medium">
                      Estado
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Informes
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Importe
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.status}>
                      <td className="py-2">
                        <StatusBadge
                          status={REPORT_STATUS_BADGE[r.status]}
                          label={REPORT_STATUS_LABELS[r.status]}
                        />
                      </td>
                      <td className="py-2 text-right tabular-nums">{r.count}</td>
                      <td className="py-2 text-right tabular-nums">
                        {r.totals.map(([c, t]) => formatCents(t, c)).join(" + ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cierre del periodo</CardTitle>
            <CardDescription>
              {regular
                ? `Cerrado en el lote ${String(regular.sequence).padStart(4, "0")} el ${formatDate(regular.closed_at)}.`
                : "Pasa los informes aprobados a un lote numerado e inmutable."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {pending.length > 0 ? (
              <div className="grid gap-1 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="size-4 text-amber-600" aria-hidden /> Informes
                  pendientes ({pending.length})
                </p>
                <ul className="grid gap-1">
                  {pending.map((p) => {
                    const r = reports.find((x) => x.id === p.report_id);
                    return (
                      <li key={p.report_id}>
                        <Link className="underline" href={`/gastos/informes/${p.report_id}`}>
                          {r ? name(r) : "Informe"}
                        </Link>{" "}
                        · {REPORT_STATUS_LABELS[p.detail as ReportStatus] ?? p.detail}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {missing.length > 0 ? (
              <div className="grid gap-1 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="size-4 text-amber-600" aria-hidden /> Categorías sin
                  cuenta contable
                </p>
                <p>
                  {missing
                    .map((m) => categories.get(m.category_id ?? "") ?? "Categoría")
                    .join(", ")}
                  . Configúralas en Administración › Gastos.
                </p>
              </div>
            ) : null}
            {regular ? (
              <Link className="underline" href={`/gastos/contabilidad/lotes/${regular.id}`}>
                Ver el lote y su paquete contable
              </Link>
            ) : access.close ? (
              missing.length > 0 ? null : (
                <ClosePeriodForm
                  period={period}
                  label={periodLabel(periodDate)}
                  pending={pending.map((p) => {
                    const r = reports.find((x) => x.id === p.report_id);
                    return { id: p.report_id ?? "", label: r ? name(r) : "informe" };
                  })}
                />
              )
            ) : (
              <p className="text-muted-foreground text-sm">
                Solo Contabilidad puede cerrar periodos.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Lotes contables</CardTitle>
        </CardHeader>
        <CardContent>
          {batches.length === 0 ? (
            <p className="text-muted-foreground text-sm">Aún no hay lotes.</p>
          ) : (
            <ul className="divide-y">
              {batches.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/gastos/contabilidad/lotes/${b.id}`}
                    className="hover:bg-accent/60 -mx-2 flex min-h-12 items-center gap-3 rounded-lg px-2 py-2 text-sm"
                  >
                    <span className="flex-1">
                      Lote {String(b.sequence).padStart(4, "0")} ·{" "}
                      {b.kind === "corrective" ? "corrector" : "ordinario"} ·{" "}
                      {periodLabel(b.period_month)}
                    </span>
                    <StatusBadge
                      status={b.status === "accounted" ? "published" : "active"}
                      label={b.status === "accounted" ? "Contabilizado" : "Cerrado"}
                    />
                    <ChevronRight className="text-muted-foreground size-4" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
