import type { Metadata } from "next";

import { BackLink } from "@/components/admin/back-link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { createCompany } from "@/features/admin/organization/actions";
import { CompanyForm } from "@/features/admin/organization/components/company-form";
import { requireAdminArea } from "@/lib/admin/context";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Nueva empresa" };

export default async function NuevaEmpresaPage() {
  const ctx = await requireAdminArea("empresas");
  const supabase = await createClient();
  const { data } = await supabase
    .from("groups")
    .select("id, name")
    .in("id", ctx.user.administeredGroupIds)
    .order("name");

  return (
    <>
      <BackLink href="/admin/empresas" label="Empresas" />
      <PageHeader title="Nueva empresa" description="El CIF y la razón social son opcionales." />
      <Card className="max-w-2xl">
        <CardContent>
          <CompanyForm action={createCompany} groups={data ?? []} />
        </CardContent>
      </Card>
    </>
  );
}
