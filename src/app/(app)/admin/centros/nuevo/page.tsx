import type { Metadata } from "next";

import { BackLink } from "@/components/admin/back-link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { createWorkCenter } from "@/features/admin/organization/actions";
import { WorkCenterForm } from "@/features/admin/organization/components/work-center-form";
import { requireAdminArea } from "@/lib/admin/context";

export const metadata: Metadata = { title: "Nuevo centro" };

export default async function NuevoCentroPage() {
  await requireAdminArea("centros");
  return (
    <>
      <BackLink href="/admin/centros" label="Centros de trabajo" />
      <PageHeader title="Nuevo centro de trabajo" />
      <Card className="max-w-2xl">
        <CardContent>
          <WorkCenterForm action={createWorkCenter} submitLabel="Crear centro" />
        </CardContent>
      </Card>
    </>
  );
}
