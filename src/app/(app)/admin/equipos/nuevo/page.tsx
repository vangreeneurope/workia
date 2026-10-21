import type { Metadata } from "next";

import { BackLink } from "@/components/admin/back-link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { createTeam } from "@/features/admin/organization/actions";
import { TeamForm } from "@/features/admin/organization/components/team-form";
import { requireAdminArea } from "@/lib/admin/context";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Nuevo equipo" };

export default async function NuevoEquipoPage() {
  const ctx = await requireAdminArea("equipos");
  const supabase = await createClient();
  const { data } = await supabase
    .from("work_centers")
    .select("id, name")
    .eq("company_id", ctx.companyId)
    .eq("status", "active")
    .order("name");
  return (
    <>
      <BackLink href="/admin/equipos" label="Equipos" />
      <PageHeader title="Nuevo equipo" />
      <Card className="max-w-2xl">
        <CardContent>
          <TeamForm action={createTeam} workCenters={data ?? []} submitLabel="Crear equipo" />
        </CardContent>
      </Card>
    </>
  );
}
