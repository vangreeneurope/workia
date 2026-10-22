import { Download, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { BackLink } from "@/components/admin/back-link";
import { DataTable } from "@/components/admin/data-table";
import { Pagination } from "@/components/admin/pagination";
import { StatusBadge } from "@/components/admin/status-badge";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { PeopleFilters } from "@/features/admin/people/components/people-filters";
import { getPeopleSearch, organizationOptions, queryPeople } from "@/features/admin/people/queries";
import { employeeSituation, SITUATION_FILTERS } from "@/features/admin/people/situation";
import { hasPermission } from "@/lib/admin/access";
import { requireAdminArea } from "@/lib/admin/context";
import { pageHref, parsePage, pickParam, uuidParam } from "@/lib/admin/pagination";
import { businessDate, formatDate } from "@/lib/dates";

export const metadata: Metadata = { title: "Personas" };

export default async function PersonasPage({ searchParams }: PageProps<"/admin/personas">) {
  const ctx = await requireAdminArea("personas");
  const params = await searchParams;
  const situation = pickParam(params.situacion, SITUATION_FILTERS) ?? "activas";
  const workCenterId = uuidParam(params.centro);
  const teamId = uuidParam(params.equipo);
  const page = parsePage(params.pagina);
  const search = await getPeopleSearch();

  const [{ data, count, error }, options] = await Promise.all([
    queryPeople(ctx, { situation, workCenterId, teamId, search }, { page }),
    organizationOptions(ctx),
  ]);
  if (error) throw new Error("No se pudieron cargar las personas.");

  const today = businessDate();
  const filterParams = {
    situacion: situation === "activas" ? undefined : situation,
    centro: workCenterId,
    equipo: teamId,
  };
  const canManage = hasPermission(ctx.permissions, "employees.manage");

  return (
    <>
      <BackLink href="/admin" label="Administración" />
      <PageHeader
        title="Personas"
        description="Fichas laborales de la empresa activa dentro de tu ámbito."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a href={pageHref("/admin/personas/exportar", filterParams, 1)} download>
                <Download aria-hidden /> Exportar CSV
              </a>
            </Button>
            {canManage ? (
              <Button asChild>
                <Link href="/admin/personas/nueva">
                  <Plus aria-hidden /> Nueva persona
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />
      <PeopleFilters
        search={search}
        situation={situation}
        workCenterId={workCenterId}
        teamId={teamId}
        workCenters={options.workCenters}
        teams={options.teams}
      />
      <DataTable
        caption="Personas"
        rows={data ?? []}
        rowKey={(r) => r.id}
        empty="No hay personas con esos filtros."
        columns={[
          {
            key: "name",
            header: "Persona",
            cell: (r) => (
              <Link href={`/admin/personas/${r.id}`} className="underline underline-offset-4">
                {r.last_name}, {r.first_name}
              </Link>
            ),
          },
          { key: "code", header: "Código", cell: (r) => <code>{r.employee_code}</code> },
          { key: "center", header: "Centro", cell: (r) => r.work_centers?.name ?? "—" },
          { key: "team", header: "Equipo", cell: (r) => r.teams?.name ?? "—", desktopOnly: true },
          {
            key: "situation",
            header: "Situación",
            cell: (r) => {
              const s = employeeSituation(r.end_date, today);
              return s === "active" ? (
                <StatusBadge status="active" label="En activo" />
              ) : (
                <StatusBadge
                  status={s === "leaving" ? "leaving" : "terminated"}
                  label={`${s === "leaving" ? "Baja el" : "Baja desde"} ${formatDate(r.end_date)}`}
                />
              );
            },
          },
        ]}
      />
      <Pagination base="/admin/personas" params={filterParams} page={page} count={count ?? 0} />
    </>
  );
}
