import type { Metadata } from "next";

import { BackLink } from "@/components/admin/back-link";
import { DataTable } from "@/components/admin/data-table";
import { StatusToggle } from "@/components/admin/status-toggle";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { setCategoryStatus } from "@/features/expenses/actions";
import { CategoryForm, PolicyForm } from "@/features/expenses/components/admin-forms";
import { formatCents } from "@/features/expenses/money";
import { requireAdminArea } from "@/lib/admin/context";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Gastos" };

export default async function AdminGastosPage() {
  const ctx = await requireAdminArea("gastos");
  const supabase = await createClient();
  const [policyRes, categoriesRes] = await Promise.all([
    supabase.from("expense_policies").select("*").eq("company_id", ctx.companyId).maybeSingle(),
    supabase
      .from("expense_categories")
      .select(
        "id, code, name, is_mileage, max_amount_cents, requires_client, requires_project, requires_cost_center, requires_notes, status",
      )
      .eq("company_id", ctx.companyId)
      .order("code"),
  ]);
  const policy = policyRes.data;
  const categories = categoriesRes.data ?? [];

  return (
    <>
      <BackLink href="/admin" label="Administración" />
      <PageHeader
        title="Gastos"
        description="Política y categorías de gastos de tu empresa. Las cifras (límites, precio por kilómetro, antigüedad) las decide la empresa según su convenio, sus acuerdos y el criterio de su asesoría."
      />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Política de gastos</CardTitle>
            <CardDescription>
              {policy
                ? "Se aplica al confirmar cada gasto."
                : "Aún no hay política: hasta que la guardes se aplican 90 días de antigüedad, euros y ticket obligatorio."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PolicyForm
              defaults={{
                max_days_past: policy?.max_days_past ?? 90,
                default_currency: policy?.default_currency ?? "EUR",
                allowed_currencies: Array.isArray(policy?.allowed_currencies)
                  ? policy.allowed_currencies.filter((c): c is string => typeof c === "string")
                  : ["EUR"],
                receipt_required: policy?.receipt_required ?? true,
                mileage_rate_milli: policy?.mileage_rate_milli ?? null,
                ocr_total_tolerance_cents: policy?.ocr_total_tolerance_cents ?? 0,
                legal_reference: policy?.legal_reference ?? null,
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Categorías</CardTitle>
            <CardDescription>
              Cada categoría puede exigir cliente, proyecto, centro de coste o nota, y fijar un
              importe a partir del cual hay que justificar el gasto.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <DataTable
              caption="Categorías de gasto"
              rows={categories}
              rowKey={(c) => c.id}
              empty="Aún no hay categorías."
              columns={[
                { key: "name", header: "Categoría", cell: (c) => `${c.code} · ${c.name}` },
                {
                  key: "rules",
                  header: "Reglas",
                  cell: (c) =>
                    [
                      c.is_mileage ? "kilometraje" : null,
                      c.max_amount_cents
                        ? `justificar desde ${formatCents(c.max_amount_cents)}`
                        : null,
                      c.requires_client ? "cliente" : null,
                      c.requires_project ? "proyecto" : null,
                      c.requires_cost_center ? "centro de coste" : null,
                      c.requires_notes ? "nota" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—",
                },
                {
                  key: "status",
                  header: "Estado",
                  cell: (c) => (
                    <StatusToggle
                      id={c.id}
                      status={c.status === "active" ? "active" : "inactive"}
                      action={setCategoryStatus}
                      entityLabel={`la categoría ${c.code}`}
                    />
                  ),
                },
              ]}
            />
            <CategoryForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
