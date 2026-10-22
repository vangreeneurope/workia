import { FileText } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionButton } from "@/components/admin/action-button";
import { BackLink } from "@/components/admin/back-link";
import { StatusBadge } from "@/components/admin/status-badge";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { reopenExpense, setExpenseDiscarded } from "@/features/expenses/actions";
import { OcrStatus, type OcrView } from "@/features/expenses/components/ocr-status";
import { ReviewForm, type CategoryOption } from "@/features/expenses/components/review-form";
import {
  EXPENSE_EVENT_LABELS,
  EXPENSE_STATUS_BADGE,
  EXPENSE_STATUS_LABELS,
  OCR_DETAIL_LABELS,
  SOURCE_LABELS,
  type ExpenseStatus,
} from "@/features/expenses/labels";
import { formatCents } from "@/features/expenses/money";
import { lowConfidenceFields } from "@/features/expenses/ocr/normalize";
import { OCR_FIELDS, type NormalizedOcrResult } from "@/features/expenses/ocr/types";
import { PAYMENT_LABELS } from "@/features/expenses/schemas";
import { getOwnEmployeeId } from "@/features/schedules/queries";
import { todayIn } from "@/features/schedules/zoned-time";
import { requireSection } from "@/lib/auth/dal";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Revisar gasto" };

const DEVIATIONS: Record<string, string> = {
  over_category_limit: "Supera el límite de la categoría (justificado en las notas)",
  total_differs_from_ocr: "El total confirmado no coincide con el leído del ticket",
  possible_duplicate_acknowledged: "Posible duplicado revisado por la persona",
};

/** Solo campos conocidos con valor texto y confianza numérica. */
function toProposal(value: unknown): NormalizedOcrResult | null {
  if (!value || typeof value !== "object") return null;
  const out: NormalizedOcrResult = {};
  for (const key of OCR_FIELDS) {
    const f = (value as Record<string, unknown>)[key];
    if (f && typeof f === "object") {
      const v = (f as { value?: unknown }).value;
      const c = (f as { confidence?: unknown }).confidence;
      if (typeof v === "string" && typeof c === "number") out[key] = { value: v, confidence: c };
    }
  }
  return out;
}

export default async function GastoPage({ params }: PageProps<"/gastos/[id]">) {
  const ctx = await requireSection("gastos");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  // RLS: solo la persona, quien la supervisa y Contabilidad de su ámbito.
  const { data: expense } = await supabase.from("expenses").select("*").eq("id", id).maybeSingle();
  if (!expense) notFound();
  const companyId = ctx.activeCompanyId as string;
  const [ownId, receiptRes, categoriesRes, policyRes, eventsRes, reportRes] = await Promise.all([
    getOwnEmployeeId(),
    supabase.from("expense_receipts").select("id, mime_type").eq("expense_id", id).maybeSingle(),
    supabase
      .from("expense_categories")
      .select(
        "id, code, name, status, is_mileage, max_amount_cents, requires_client, requires_project, requires_cost_center, requires_notes",
      )
      .eq("company_id", expense.company_id)
      .order("name"),
    supabase
      .from("expense_policies")
      .select("default_currency, allowed_currencies, mileage_rate_milli")
      .eq("company_id", expense.company_id)
      .maybeSingle(),
    supabase
      .from("expense_events")
      .select("id, action, detail, created_at")
      .eq("expense_id", id)
      .order("id"),
    supabase
      .from("expense_report_items")
      .select("decision, report_id, expense_reports (status, period_month, version)")
      .eq("expense_id", id),
  ]);
  // Bloqueado si está en un informe no devuelto o se rechazó (docs/LIQUIDACION_GASTOS.md).
  const reportLink = (reportRes.data ?? []).find(
    (i) => i.decision === "rejected" || i.expense_reports?.status !== "returned",
  );
  const receipt = receiptRes.data;
  const [runsRes, jobRes] = receipt
    ? await Promise.all([
        supabase
          .from("ocr_runs")
          .select("status, result, finished_at")
          .eq("receipt_id", receipt.id)
          .order("started_at", { ascending: false })
          .limit(5),
        supabase
          .from("jobs")
          .select("status, requeues")
          .eq("dedupe_key", receipt.id)
          .eq("kind", "ocr_receipt")
          .maybeSingle(),
      ])
    : [{ data: [] }, { data: null }];
  const runs = runsRes.data ?? [];
  const job = jobRes.data;
  const lastResult = runs.find((r) => r.status === "succeeded" || r.status === "needs_review");
  const proposal = toProposal(lastResult?.result);
  const low = lowConfidenceFields(proposal);

  const owner = ownId !== null && expense.employee_id === ownId && expense.company_id === companyId;
  const status = expense.status as ExpenseStatus;
  const editable = owner && status === "draft";

  let ocrView: OcrView | null = null;
  if (receipt) {
    if (!job) ocrView = "disabled";
    else if (job.status === "succeeded")
      ocrView = lastResult?.status === "needs_review" ? "needs_review" : "succeeded";
    else if (job.status === "failed") ocrView = "failed";
    else if (job.status === "processing") ocrView = "processing";
    else ocrView = runs[0]?.status === "failed" ? "failed" : "pending";
  }
  const canRetry =
    editable &&
    job !== null &&
    (job.status === "pending" || (job.status === "failed" && job.requeues < 2));

  // Posibles duplicados propios: mismo proveedor, fecha, total y moneda.
  let similarCount = 0;
  if (editable && expense.merchant_key && expense.expense_date && expense.total_cents) {
    const { count } = await supabase
      .from("expenses")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", expense.employee_id)
      .eq("merchant_key", expense.merchant_key)
      .eq("expense_date", expense.expense_date)
      .eq("total_cents", expense.total_cents)
      .eq("currency", expense.currency ?? "")
      .neq("status", "discarded")
      .neq("id", expense.id);
    similarCount = count ?? 0;
  }

  const categories: CategoryOption[] = (categoriesRes.data ?? [])
    .filter((c) => c.status === "active" || c.id === expense.category_id)
    .map((c) => ({
      id: c.id,
      label: `${c.name} (${c.code})`,
      isMileage: c.is_mileage,
      maxAmountCents: c.max_amount_cents,
      requiresClient: c.requires_client,
      requiresProject: c.requires_project,
      requiresCostCenter: c.requires_cost_center,
      requiresNotes: c.requires_notes,
    }));
  const category = categories.find((c) => c.id === expense.category_id);
  const policy = policyRes.data;
  const currencies = Array.isArray(policy?.allowed_currencies)
    ? policy.allowed_currencies.filter((c): c is string => typeof c === "string")
    : ["EUR"];
  const deviations = Array.isArray(expense.deviations)
    ? expense.deviations.filter((d): d is string => typeof d === "string")
    : [];

  const summary: [string, string][] = [
    ["Origen", SOURCE_LABELS[expense.source] ?? expense.source],
    ["Categoría", category?.label ?? "—"],
    ["Fecha", expense.expense_date ? formatDate(expense.expense_date) : "—"],
    ...(expense.source === "mileage"
      ? ([
          [
            "Kilómetros",
            expense.distance_km_tenths
              ? String(expense.distance_km_tenths / 10).replace(".", ",")
              : "—",
          ],
        ] as [string, string][])
      : ([
          ["Proveedor", expense.merchant_name ?? "—"],
          ["NIF", expense.merchant_tax_id ?? "—"],
          ["Nº de documento", expense.document_number ?? "—"],
          [
            "Base",
            expense.base_cents !== null
              ? formatCents(expense.base_cents, expense.currency ?? "EUR")
              : "—",
          ],
          [
            "Impuestos",
            expense.tax_cents !== null
              ? formatCents(expense.tax_cents, expense.currency ?? "EUR")
              : "—",
          ],
          ["Forma de pago", expense.payment_method ? PAYMENT_LABELS[expense.payment_method] : "—"],
        ] as [string, string][])),
    [
      "Total",
      expense.total_cents !== null
        ? formatCents(expense.total_cents, expense.currency ?? "EUR")
        : "—",
    ],
    ["Cliente", expense.client_name ?? "—"],
    ["Proyecto", expense.project_code ?? "—"],
    ["Centro de coste", expense.cost_center ?? "—"],
    ["Notas", expense.notes ?? "—"],
  ];

  return (
    <>
      <BackLink href="/gastos" label="Gastos" />
      <PageHeader
        title={editable ? "Revisar gasto" : "Gasto"}
        description={
          editable
            ? "Comprueba cada dato con el ticket. El gasto no queda listo hasta que lo confirmes."
            : undefined
        }
        actions={
          <StatusBadge
            status={EXPENSE_STATUS_BADGE[status]}
            label={EXPENSE_STATUS_LABELS[status]}
          />
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="grid content-start gap-4">
          {receipt ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ticket original</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                {receipt.mime_type === "application/pdf" ? (
                  <a
                    href={`/gastos/ticket/${receipt.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:bg-accent flex min-h-11 items-center gap-2 rounded-lg border p-3 text-sm underline"
                  >
                    <FileText className="size-5" aria-hidden /> Abrir el ticket (PDF)
                  </a>
                ) : (
                  <a href={`/gastos/ticket/${receipt.id}`} target="_blank" rel="noreferrer">
                    {/* URL firmada de 60 s a través de una ruta propia: sin optimizador de imágenes. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/gastos/ticket/${receipt.id}`}
                      alt="Ticket del gasto (se abre a tamaño completo)"
                      className="bg-muted mx-auto max-h-[50vh] w-auto rounded-xl border object-contain lg:max-h-[70vh]"
                    />
                  </a>
                )}
                <p className="text-muted-foreground text-xs">
                  El original se conserva aunque corrijas los datos.
                </p>
              </CardContent>
            </Card>
          ) : null}
          {ocrView ? <OcrStatus view={ocrView} canRetry={canRetry} expenseId={expense.id} /> : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{editable ? "Datos del gasto" : "Resumen"}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {editable ? (
              <ReviewForm
                expense={{
                  id: expense.id,
                  source: expense.source,
                  category_id: expense.category_id,
                  expense_date: expense.expense_date,
                  merchant_name: expense.merchant_name,
                  merchant_tax_id: expense.merchant_tax_id,
                  document_number: expense.document_number,
                  currency: expense.currency,
                  base_cents: expense.base_cents,
                  tax_cents: expense.tax_cents,
                  total_cents: expense.total_cents,
                  payment_method: expense.payment_method,
                  client_name: expense.client_name,
                  project_code: expense.project_code,
                  cost_center: expense.cost_center,
                  notes: expense.notes,
                  distance_km_tenths: expense.distance_km_tenths,
                }}
                proposal={proposal}
                low={low}
                categories={categories}
                currencies={currencies}
                defaultCurrency={policy?.default_currency ?? "EUR"}
                mileageRateMilli={policy?.mileage_rate_milli ?? null}
                similarCount={similarCount}
                today={todayIn("Europe/Madrid")}
              />
            ) : (
              <>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  {summary.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="min-w-0 break-words">{v}</dd>
                    </div>
                  ))}
                </dl>
                {deviations.length > 0 ? (
                  <ul className="grid gap-1 rounded-xl border border-amber-500 p-3 text-sm">
                    {deviations.map((d) => (
                      <li key={d}>{DEVIATIONS[d] ?? d}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
            {owner ? (
              <div className="flex flex-wrap gap-2">
                {reportLink ? (
                  <a
                    className="text-sm underline"
                    href={`/gastos/informes/${reportLink.report_id}`}
                  >
                    {reportLink.decision === "rejected"
                      ? "Rechazado en su informe: no se puede volver a enviar"
                      : "Incluido en un informe enviado: ver el informe"}
                  </a>
                ) : null}
                {status === "ready" && !reportLink ? (
                  <ActionButton
                    action={reopenExpense.bind(null, expense.id)}
                    label="Corregir"
                    confirmMessage="¿Volver a borrador para corregir? El ticket original se conserva."
                  />
                ) : null}
                {status === "draft" ? (
                  <ActionButton
                    action={setExpenseDiscarded.bind(null, expense.id, true)}
                    label="Descartar"
                    confirmMessage="¿Descartar este borrador? No se borra: puedes recuperarlo."
                  />
                ) : null}
                {status === "discarded" ? (
                  <ActionButton
                    action={setExpenseDiscarded.bind(null, expense.id, false)}
                    label="Recuperar"
                  />
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {(eventsRes.data ?? []).length > 0 ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">Historial</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="text-muted-foreground grid gap-1 text-sm">
              {(eventsRes.data ?? []).map((e) => (
                <li key={e.id}>
                  {formatDate(e.created_at)} · {EXPENSE_EVENT_LABELS[e.action] ?? e.action}
                  {e.action === "ocr_finished" && e.detail
                    ? `: ${OCR_DETAIL_LABELS[e.detail.split(":")[0] ?? ""] ?? ""}`
                    : ""}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
