import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/admin/back-link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { updateCompany } from "@/features/admin/organization/actions";
import { CompanyForm } from "@/features/admin/organization/components/company-form";
import { requireAdminArea } from "@/lib/admin/context";
import { uuidParam } from "@/lib/admin/pagination";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Editar empresa" };

export default async function EditarEmpresaPage({ params }: PageProps<"/admin/empresas/[id]">) {
  const ctx = await requireAdminArea("empresas");
  const id = uuidParam((await params).id);
  if (!id || !ctx.user.administeredCompanyIds.includes(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase
    .from("companies")
    .select("id, name, legal_name, tax_id, primary_color, timezone")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();

  return (
    <>
      <BackLink href="/admin/empresas" label="Empresas" />
      <PageHeader title={data.name} description="Datos e identidad visual de la empresa." />
      <Card className="max-w-2xl">
        <CardContent>
          <CompanyForm action={updateCompany.bind(null, id)} defaults={data} />
        </CardContent>
      </Card>
    </>
  );
}
