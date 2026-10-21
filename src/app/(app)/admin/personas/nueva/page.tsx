import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/admin/back-link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { createEmployee } from "@/features/admin/people/actions";
import { EmployeeForm } from "@/features/admin/people/components/employee-form";
import { organizationOptions } from "@/features/admin/people/queries";
import { hasPermission } from "@/lib/admin/access";
import { requireAdminArea } from "@/lib/admin/context";

export const metadata: Metadata = { title: "Nueva persona" };

export default async function NuevaPersonaPage() {
  const ctx = await requireAdminArea("personas");
  if (!hasPermission(ctx.permissions, "employees.manage")) notFound();
  const { workCenters, teams } = await organizationOptions(ctx);
  return (
    <>
      <BackLink href="/admin/personas" label="Personas" />
      <PageHeader
        title="Nueva persona"
        description="Después podrás registrar sus condiciones, su cuenta de acceso y su aprobador."
      />
      <Card className="max-w-2xl">
        <CardContent>
          <EmployeeForm
            action={createEmployee}
            workCenters={workCenters.filter((w) => w.status === "active")}
            teams={teams.filter((t) => t.status === "active")}
            submitLabel="Crear ficha"
          />
        </CardContent>
      </Card>
    </>
  );
}
