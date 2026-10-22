import type { Metadata } from "next";

import { BackLink } from "@/components/admin/back-link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CaptureForm } from "@/features/expenses/components/capture-form";
import { NoReceiptForm } from "@/features/expenses/components/no-receipt-form";
import { getOwnEmployeeId } from "@/features/schedules/queries";
import { requireSection } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Nuevo gasto" };

export default async function NuevoGastoPage() {
  const ctx = await requireSection("gastos");
  if (!(await getOwnEmployeeId())) notFound();
  const supabase = await createClient();
  const companyId = ctx.activeCompanyId as string;
  const [policyRes, mileageRes] = await Promise.all([
    supabase
      .from("expense_policies")
      .select("receipt_required, mileage_rate_milli")
      .eq("company_id", companyId)
      .maybeSingle(),
    supabase
      .from("expense_categories")
      .select("id")
      .eq("company_id", companyId)
      .eq("status", "active")
      .eq("is_mileage", true)
      .limit(1),
  ]);
  const policy = policyRes.data;
  const mileage = Boolean(policy?.mileage_rate_milli) && (mileageRes.data?.length ?? 0) > 0;
  const manual = policy ? !policy.receipt_required : false;

  return (
    <>
      <BackLink href="/gastos" label="Gastos" />
      <PageHeader title="Nuevo gasto" description="Haz una foto del ticket o sube el archivo." />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ticket o factura</CardTitle>
            <CardDescription>
              Pon el ticket sobre una superficie lisa, con buena luz y entero en la foto. Se guarda
              en privado; la lectura automática solo propone datos y tú los confirmas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CaptureForm />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sin ticket</CardTitle>
          </CardHeader>
          <CardContent>
            <NoReceiptForm mileage={mileage} manual={manual} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
