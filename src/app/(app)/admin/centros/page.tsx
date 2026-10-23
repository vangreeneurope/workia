import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { BackLink } from "@/components/admin/back-link";
import { DataTable } from "@/components/admin/data-table";
import { StatusToggle } from "@/components/admin/status-toggle";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { setWorkCenterStatus } from "@/features/admin/organization/actions";
import { requireAdminArea } from "@/lib/admin/context";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Centros de trabajo" };

export default async function CentrosPage() {
  const ctx = await requireAdminArea("centros");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("work_centers")
    .select("id, name, code, city, province, status")
    .eq("company_id", ctx.companyId)
    .order("status")
    .order("name");
  if (error) throw new Error("No se pudieron cargar los centros.");

  return (
    <>
      <BackLink href="/admin" label="Administración" />
      <PageHeader
        title="Centros de trabajo"
        description="Desactivar un centro no borra nada: deja de ofrecerse para nuevas fichas."
        actions={
          <Button asChild>
            <Link href="/admin/centros/nuevo">
              <Plus aria-hidden /> Nuevo centro
            </Link>
          </Button>
        }
      />
      <DataTable
        caption="Centros de trabajo"
        rows={data ?? []}
        rowKey={(r) => r.id}
        empty="Aún no hay centros. Crea el primero."
        columns={[
          {
            key: "name",
            header: "Centro",
            cell: (r) => (
              <Link href={`/admin/centros/${r.id}`} className="underline underline-offset-4">
                {r.name}
              </Link>
            ),
          },
          { key: "code", header: "Código", cell: (r) => <code>{r.code}</code> },
          {
            key: "city",
            header: "Localidad",
            cell: (r) => [r.city, r.province].filter(Boolean).join(", ") || "—",
          },
          {
            key: "status",
            header: "Estado",
            cell: (r) => (
              <StatusToggle
                id={r.id}
                status={r.status}
                action={setWorkCenterStatus}
                entityLabel={`el centro ${r.name}`}
              />
            ),
          },
        ]}
      />
    </>
  );
}
