import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/admin/back-link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { updateTeam } from "@/features/admin/organization/actions";
import { TeamForm } from "@/features/admin/organization/components/team-form";
import { requireAdminArea } from "@/lib/admin/context";
import { uuidParam } from "@/lib/admin/pagination";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Editar equipo" };

export default async function EditarEquipoPage({ params }: PageProps<"/admin/equipos/[id]">) {
  const ctx = await requireAdminArea("equipos");
  const id = uuidParam((await params).id);
  if (!id) notFound();
  const supabase = await createClient();
  const [team, centers] = await Promise.all([
    supabase
      .from("teams")
      .select("name, work_center_id")
      .eq("id", id)
      .eq("company_id", ctx.companyId)
      .maybeSingle(),
    supabase
      .from("work_centers")
      .select("id, name")
      .eq("company_id", ctx.companyId)
      .eq("status", "active")
      .order("name"),
  ]);
  if (!team.data) notFound();
  return (
    <>
      <BackLink href="/admin/equipos" label="Equipos" />
      <PageHeader title={team.data.name} />
      <Card className="max-w-2xl">
        <CardContent>
          <TeamForm
            action={updateTeam.bind(null, id)}
            defaults={team.data}
            workCenters={centers.data ?? []}
            submitLabel="Guardar cambios"
          />
        </CardContent>
      </Card>
    </>
  );
}
