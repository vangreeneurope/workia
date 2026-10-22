import { Download, FileText } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionButton } from "@/components/admin/action-button";
import { BackLink } from "@/components/admin/back-link";
import { StatusBadge } from "@/components/admin/status-badge";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/features/expenses/money";
import { getExpenseAccess } from "@/features/expenses/queries";
import { generateExports, markAccounted } from "@/features/settlement/actions";
import { CorrectiveBatchForm } from "@/features/settlement/components/forms";
import { loadBatchData } from "@/features/settlement/data";
import type { TotalRow } from "@/features/settlement/export/types";
import { periodLabel } from "@/features/settlement/labels";
import { requireSection } from "@/lib/auth/dal";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Lote contable" };

const DIMENSIONS: [TotalRow["dimension"], string][] = [
  ["employee", "Por empleado"],
  ["category", "Por categoría"],
  ["account", "Por cuenta"],
  ["cost_center", "Por centro de coste"],
  ["project", "Por proyecto"],
];

const FORMAT_LABELS: Record<string, string> = {
  pdf: "Liquidación (PDF)",
  csv: "Líneas (CSV)",
  xlsx: "Líneas y totales (XLSX)",
  zip: "Justificantes (ZIP)",
};

function TotalsTable({ rows, caption }: { rows: TotalRow[]; caption: string }) {
  return (
    <div className="overflow-x-auto" role="region" aria-label={caption} tabIndex={0}>
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-muted-foreground text-left">
          <tr>
            <th scope="col" className="py-2 pr-2 font-medium">
              Clave
            </th>
            <th scope="col" className="py-2 pr-2 font-medium">
              Nombre
            </th>
            <th scope="col" className="py-2 pr-2 text-right font-medium">
              Total
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Líneas
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((t) => (
            <tr key={`${t.key}-${t.currency}`}>
              <td className="py-2 pr-2">{t.key || "—"}</td>
              <td className="py-2 pr-2">{t.label}</td>
              <td className="py-2 pr-2 text-right tabular-nums">
                {formatCents(t.total_cents, t.currency)}
              </td>
              <td className="py-2 text-right tabular-nums">{t.lines}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function LotePage({ params }: PageProps<"/gastos/contabilidad/lotes/[id]">) {
  const ctx = await requireSection("gastos");
  const access = await getExpenseAccess();
  if (!access.accounting) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const data = await loadBatchData(supabase, id);
  if (!data) notFound();
  const companyId = ctx.activeCompanyId as string;
  const [batchRes, exportsRes, exclusionsRes, correctionsRes, employeesRes, categoriesRes] =
    await Promise.all([
      supabase.from("accounting_batches").select("status, accounted_at").eq("id", id).single(),
      supabase
        .from("accounting_exports")
        .select("id, format, file_name, sha256, size_bytes, generated_at")
        .eq("batch_id", id),
      supabase
        .from("accounting_batch_exclusions")
        .select("id, reason, created_at, expense_reports (employees (first_name, last_name))")
        .eq("batch_id", id),
      supabase.from("accounting_batches").select("id, sequence").eq("corrects_batch_id", id),
      supabase
        .from("employees")
        .select("id, first_name, last_name, employee_code")
        .eq("company_id", companyId)
        .order("last_name")
        .limit(1000),
      supabase
        .from("expense_categories")
        .select("id, code, name")
        .eq("company_id", companyId)
        .order("code"),
    ]);
  const b = data.batch;
  const seq = String(b.sequence).padStart(4, "0");
  const grand = data.totals.filter((t) => t.dimension === "total");
  const exports = [...(exportsRes.data ?? [])].sort((a, z) => a.format.localeCompare(z.format));
  const accounted = batchRes.data?.status === "accounted";

  return (
    <>
      <BackLink
        href={`/gastos/contabilidad?periodo=${b.periodMonth.slice(0, 7)}`}
        label="Contabilidad"
      />
      <PageHeader
        title={`Lote ${seq}`}
        description={`${b.kind === "corrective" ? `Corrector del lote ${String(b.correctsSequence ?? 0).padStart(4, "0")}` : "Cierre ordinario"} · ${periodLabel(b.periodMonth)} · cerrado el ${formatDate(b.closedAt)}`}
        actions={
          <StatusBadge
            status={accounted ? "published" : "active"}
            label={accounted ? "Contabilizado" : "Cerrado"}
          />
        }
      />
      {b.note ? <p className="text-muted-foreground mb-4 text-sm">Motivo: {b.note}</p> : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {grand.map((t) => (
          <div key={t.currency} className="bg-card shadow-soft rounded-2xl border p-4">
            <p className="text-muted-foreground text-xs tracking-wide uppercase">
              Total {t.currency}
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatCents(t.total_cents, t.currency)}
            </p>
            <p className="text-muted-foreground text-xs">
              {t.lines} líneas · base {formatCents(t.base_cents, t.currency)} · impuestos{" "}
              {formatCents(t.tax_cents, t.currency)}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Paquete contable</CardTitle>
            <CardDescription>
              Archivos deterministas: regenerarlos da exactamente los mismos bytes (misma huella
              SHA-256). Solo Contabilidad los descarga; cada descarga queda registrada.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {exports.length === 0 ? (
              <p className="text-muted-foreground text-sm">Aún no se ha generado el paquete.</p>
            ) : (
              <ul className="grid gap-2">
                {exports.map((e) => (
                  <li key={e.id} className="grid gap-1 rounded-xl border p-3 text-sm">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2 font-medium">
                        <FileText className="size-4" aria-hidden /> {FORMAT_LABELS[e.format]}
                      </span>
                      {access.close ? (
                        <a
                          href={`/gastos/contabilidad/descargas/${e.id}`}
                          className="hover:bg-accent inline-flex min-h-11 items-center gap-2 rounded-lg border px-3"
                        >
                          <Download className="size-4" aria-hidden /> Descargar
                        </a>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground text-xs break-all">
                      {e.file_name} · SHA-256 {e.sha256}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {access.close ? (
              <div className="flex flex-wrap gap-2">
                {exports.length < 4 ? (
                  <ActionButton
                    action={generateExports.bind(null, id)}
                    label="Generar paquete"
                    variant="default"
                  />
                ) : null}
                {!accounted ? (
                  <ActionButton
                    action={markAccounted.bind(null, id)}
                    label="Marcar como contabilizado"
                    confirmMessage="¿Confirmas que el lote ya está registrado en vuestra contabilidad?"
                  />
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Exclusiones y correcciones</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {(exclusionsRes.data ?? []).length === 0 ? (
              <p className="text-muted-foreground">
                Ningún informe pendiente se excluyó del cierre.
              </p>
            ) : (
              <ul className="grid gap-1">
                {(exclusionsRes.data ?? []).map((x) => (
                  <li key={x.id}>
                    Excluido:{" "}
                    {x.expense_reports?.employees
                      ? `${x.expense_reports.employees.last_name}, ${x.expense_reports.employees.first_name}`
                      : "informe"}{" "}
                    · {x.reason}
                  </li>
                ))}
              </ul>
            )}
            {(correctionsRes.data ?? []).map((c) => (
              <a key={c.id} className="underline" href={`/gastos/contabilidad/lotes/${c.id}`}>
                Corregido por el lote {String(c.sequence).padStart(4, "0")}
              </a>
            ))}
            {access.close && b.kind === "regular" ? (
              <details className="rounded-xl border p-3">
                <summary className="min-h-11 cursor-pointer py-2 font-medium">
                  Crear lote corrector
                </summary>
                <CorrectiveBatchForm
                  batchId={id}
                  employees={(employeesRes.data ?? []).map((e) => ({
                    id: e.id,
                    label: `${e.last_name}, ${e.first_name} (${e.employee_code})`,
                  }))}
                  categories={(categoriesRes.data ?? []).map((c) => ({
                    id: c.id,
                    label: `${c.code} · ${c.name}`,
                  }))}
                />
              </details>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {DIMENSIONS.map(([dimension, title]) => {
          const rows = data.totals.filter((t) => t.dimension === dimension);
          return rows.length ? (
            <Card key={dimension}>
              <CardHeader>
                <CardTitle className="text-base">{title}</CardTitle>
              </CardHeader>
              <CardContent>
                <TotalsTable rows={rows} caption={title} />
              </CardContent>
            </Card>
          ) : null;
        })}
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Líneas ({data.lines.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto" role="region" aria-label="Líneas del lote" tabIndex={0}>
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Líneas del lote</caption>
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th scope="col" className="py-2 pr-2 font-medium">
                    Nº
                  </th>
                  <th scope="col" className="py-2 pr-2 font-medium">
                    Fecha
                  </th>
                  <th scope="col" className="py-2 pr-2 font-medium">
                    Empleado
                  </th>
                  <th scope="col" className="py-2 pr-2 font-medium">
                    Categoría
                  </th>
                  <th scope="col" className="py-2 pr-2 font-medium">
                    Cuenta
                  </th>
                  <th scope="col" className="py-2 pr-2 font-medium">
                    Proveedor o motivo
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.lines.map((l) => (
                  <tr key={l.line_no}>
                    <td className="py-2 pr-2 tabular-nums">{l.line_no}</td>
                    <td className="py-2 pr-2">{formatDate(l.expense_date)}</td>
                    <td className="py-2 pr-2">{l.employee_code}</td>
                    <td className="py-2 pr-2">{l.category_name}</td>
                    <td className="py-2 pr-2">{l.account_code}</td>
                    <td className="py-2 pr-2">
                      {l.adjustment_reason ? `Ajuste: ${l.adjustment_reason}` : l.merchant_name}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCents(l.total_cents, l.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
