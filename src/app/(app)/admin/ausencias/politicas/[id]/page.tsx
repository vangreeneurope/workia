import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/admin/back-link";
import { DataTable } from "@/components/admin/data-table";
import { StatusBadge } from "@/components/admin/status-badge";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PublishVersionForm,
  VersionForm,
  type VersionDefaults,
} from "@/features/absences/components/admin-forms";
import { formatAmount } from "@/features/absences/units";
import { todayIn } from "@/features/schedules/zoned-time";
import { requireAdminArea } from "@/lib/admin/context";
import { uuidParam } from "@/lib/admin/pagination";
import { addDays, formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Política de ausencias" };

/** Cantidad en la unidad -> texto del formulario ("22,5" días o "10:30" horas). */
function toInput(amount: number, unit: "half_days" | "minutes"): string {
  if (unit === "half_days")
    return amount % 2 === 0 ? String(amount / 2) : `${Math.floor(amount / 2)},5`;
  return `${Math.floor(amount / 60)}:${String(amount % 60).padStart(2, "0")}`;
}

export default async function PoliticaPage({
  params,
}: PageProps<"/admin/ausencias/politicas/[id]">) {
  const ctx = await requireAdminArea("ausencias");
  const id = uuidParam((await params).id);
  if (!id) notFound();
  const supabase = await createClient();
  const { data: policy } = await supabase
    .from("vacation_policies")
    .select(
      "id, code, name, period_start_month, absence_types (name), vacation_policy_versions (id, version, unit, entitlement, accrual_method, proration, rounding_mode, rounding_step, carryover_max, carryover_expiry_months, allow_negative, negative_limit, negative_reason, status, valid_from, valid_to)",
    )
    .eq("id", id)
    .eq("company_id", ctx.companyId)
    .maybeSingle();
  if (!policy) notFound();
  const today = todayIn("Europe/Madrid");
  const versions = [...policy.vacation_policy_versions].sort((a, b) => b.version - a.version);
  const draft = versions.find((v) => v.status === "draft");
  const base = draft ?? versions.find((v) => v.status === "published");
  const defaults: VersionDefaults = base
    ? {
        unit: base.unit,
        entitlement: toInput(base.entitlement, base.unit),
        accrual_method: base.accrual_method,
        proration: base.proration,
        rounding_mode: base.rounding_mode,
        rounding_step: toInput(base.rounding_step, base.unit),
        carryover_max: toInput(base.carryover_max, base.unit),
        carryover_expiry_months: base.carryover_expiry_months
          ? String(base.carryover_expiry_months)
          : "",
        allow_negative: base.allow_negative,
        negative_limit: toInput(base.negative_limit, base.unit),
        negative_reason: base.negative_reason ?? "",
      }
    : {
        unit: "half_days",
        entitlement: "",
        accrual_method: "upfront",
        proration: "by_employment",
        rounding_mode: "nearest",
        rounding_step: "0,5",
        carryover_max: "0",
        carryover_expiry_months: "",
        allow_negative: false,
        negative_limit: "0",
        negative_reason: "",
      };

  return (
    <>
      <BackLink href="/admin/ausencias" label="Vacaciones y ausencias" />
      <PageHeader
        title={`${policy.code} · ${policy.name}`}
        description={`Tipo: ${policy.absence_types?.name ?? ""}`}
      />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Versiones</CardTitle>
            <CardDescription>
              Una versión publicada no cambia. Cada periodo se abre con la versión vigente en su
              inicio.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              caption="Versiones de la política"
              rows={versions}
              rowKey={(v) => v.id}
              empty="Sin versiones todavía."
              columns={[
                { key: "version", header: "Versión", cell: (v) => `v${v.version}` },
                {
                  key: "rules",
                  header: "Reglas",
                  cell: (v) =>
                    [
                      `${formatAmount(v.entitlement, v.unit)} por periodo`,
                      v.accrual_method === "monthly" ? "devengo mensual" : "al inicio",
                      v.proration === "by_employment" ? "prorrateado" : null,
                      v.carryover_max
                        ? `arrastre ${formatAmount(v.carryover_max, v.unit)}${v.carryover_expiry_months ? ` (caduca a los ${v.carryover_expiry_months} meses)` : ""}`
                        : "sin arrastre",
                      v.allow_negative
                        ? `negativo hasta ${formatAmount(v.negative_limit, v.unit)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                },
                {
                  key: "validity",
                  header: "Vigencia",
                  cell: (v) =>
                    v.status === "published"
                      ? `${formatDate(v.valid_from)} – ${v.valid_to ? formatDate(addDays(v.valid_to, -1)) : "sin fin"}`
                      : "—",
                },
                { key: "status", header: "Estado", cell: (v) => <StatusBadge status={v.status} /> },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {draft ? `Borrador v${draft.version}` : "Nueva versión"}
            </CardTitle>
            <CardDescription>
              Ejemplo: 22 días laborables al año, prorrateados por los días con contrato, redondeo
              al medio día más cercano, hasta 5 días de arrastre que caducan a los 3 meses.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VersionForm policyId={policy.id} defaults={defaults} />
          </CardContent>
        </Card>
        {draft ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Publicar el borrador</CardTitle>
            </CardHeader>
            <CardContent>
              <PublishVersionForm versionId={draft.id} today={today} />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
