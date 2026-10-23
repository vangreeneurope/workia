import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { BackLink } from "@/components/admin/back-link";
import { DataTable } from "@/components/admin/data-table";
import { StatusToggle } from "@/components/admin/status-toggle";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { setTeamStatus } from "@/features/admin/organization/actions";
import { requireAdminArea } from "@/lib/admin/context";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Equipos" };

export default async function EquiposPage() {
  const ctx = await requireAdminArea("equipos");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("teams")
    .select("id, name, status, work_centers (name)")
    .eq("company_id", ctx.companyId)
    .order("status")
    .order("name");
  if (error) throw new Error("No se pudieron cargar los equipos.");

  return (
    <>
      <BackLink href="/admin" label="Administración" />
      <PageHeader
        title="Equipos"
        description="Los equipos permiten asignar un aprobador a varias personas a la vez."
        actions={
          <Button asChild>
            <Link href="/admin/equipos/nuevo">
              <Plus aria-hidden /> Nuevo equipo
            </Link>
          </Button>
        }
      />
      <DataTable
        caption="Equipos"
        rows={data ?? []}
        rowKey={(r) => r.id}
        empty="Aún no hay equipos."
        columns={[
          {
            key: "name",
            header: "Equipo",
            cell: (r) => (
              <Link href={`/admin/equipos/${r.id}`} className="underline underline-offset-4">
                {r.name}
              </Link>
            ),
          },
          { key: "center", header: "Centro", cell: (r) => r.work_centers?.name ?? "—" },
          {
            key: "status",
            header: "Estado",
            cell: (r) => (
              <StatusToggle
                id={r.id}
                status={r.status}
                action={setTeamStatus}
                entityLabel={`el equipo ${r.name}`}
              />
            ),
          },
        ]}
      />
    </>
  );
}
