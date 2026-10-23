import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/admin/back-link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { updateWorkCenter } from "@/features/admin/organization/actions";
import { WorkCenterForm } from "@/features/admin/organization/components/work-center-form";
import { requireAdminArea } from "@/lib/admin/context";
import { uuidParam } from "@/lib/admin/pagination";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Editar centro" };

export default async function EditarCentroPage({ params }: PageProps<"/admin/centros/[id]">) {
  const ctx = await requireAdminArea("centros");
  const id = uuidParam((await params).id);
  if (!id) notFound();
  const supabase = await createClient();
  const { data } = await supabase
    .from("work_centers")
    .select("name, code, address_line, city, postal_code, province, timezone")
    .eq("id", id)
    .eq("company_id", ctx.companyId)
    .maybeSingle();
  if (!data) notFound();

  return (
    <>
      <BackLink href="/admin/centros" label="Centros de trabajo" />
      <PageHeader title={data.name} />
      <Card className="max-w-2xl">
        <CardContent>
          <WorkCenterForm
            action={updateWorkCenter.bind(null, id)}
            defaults={data}
            submitLabel="Guardar cambios"
          />
        </CardContent>
      </Card>
    </>
  );
}
