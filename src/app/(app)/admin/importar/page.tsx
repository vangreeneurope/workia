import type { Metadata } from "next";

import { BackLink } from "@/components/admin/back-link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ImportWizard } from "@/features/admin/import/components/import-wizard";
import { requireAdminArea } from "@/lib/admin/context";

export const metadata: Metadata = { title: "Importar personas" };

export default async function ImportarPage() {
  await requireAdminArea("importar");
  return (
    <>
      <BackLink href="/admin" label="Administración" />
      <PageHeader
        title="Importar personas desde CSV"
        description="Primero se valida todo el archivo; solo si no hay errores se importa, en una única operación."
      />
      <Card className="max-w-4xl">
        <CardContent>
          <ImportWizard />
        </CardContent>
      </Card>
    </>
  );
}
