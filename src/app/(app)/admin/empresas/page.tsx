import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { BackLink } from "@/components/admin/back-link";
import { DataTable } from "@/components/admin/data-table";
import { StatusToggle } from "@/components/admin/status-toggle";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { setCompanyStatus } from "@/features/admin/organization/actions";
import { requireAdminArea } from "@/lib/admin/context";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Empresas del grupo" };

export default async function EmpresasAdminPage() {
  const ctx = await requireAdminArea("empresas");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("companies")
    .select("id, name, legal_name, status, primary_color, groups (name)")
    .in("id", ctx.user.administeredCompanyIds)
    .order("name");
  if (error) throw new Error("No se pudieron cargar las empresas.");

  return (
    <>
      <BackLink href="/admin" label="Administración" />
      <PageHeader
        title="Empresas del grupo"
        description="Alta, identidad visual y desactivación. Una empresa desactivada conserva todo su historial."
        actions={
          <Button asChild>
            <Link href="/admin/empresas/nueva">
              <Plus aria-hidden /> Nueva empresa
            </Link>
          </Button>
        }
      />
      <DataTable
        caption="Empresas"
        rows={data ?? []}
        rowKey={(r) => r.id}
        empty="Tu grupo aún no tiene empresas."
        columns={[
          {
            key: "name",
            header: "Empresa",
            cell: (r) => (
              <Link
                href={`/admin/empresas/${r.id}`}
                className="inline-flex items-center gap-2 underline-offset-4 hover:underline"
              >
                <span
                  aria-hidden
                  className="size-3 rounded-full"
                  style={{ background: r.primary_color }}
                />
                {r.name}
              </Link>
            ),
          },
          {
            key: "legal",
            header: "Razón social",
            cell: (r) => r.legal_name ?? "—",
            desktopOnly: true,
          },
          { key: "group", header: "Grupo", cell: (r) => r.groups?.name ?? "—" },
          {
            key: "status",
            header: "Estado",
            cell: (r) => (
              <StatusToggle
                id={r.id}
                status={r.status}
                action={setCompanyStatus}
                entityLabel={`la empresa ${r.name}`}
              />
            ),
          },
        ]}
      />
    </>
  );
}
