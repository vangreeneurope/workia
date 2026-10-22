import type { Metadata } from "next";
import Link from "next/link";

import { BackLink } from "@/components/admin/back-link";
import { DataTable } from "@/components/admin/data-table";
import { Pagination } from "@/components/admin/pagination";
import { StatusBadge } from "@/components/admin/status-badge";
import { SelectField } from "@/components/admin/select-field";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InviteForm } from "@/features/admin/members/components/invite-form";
import { hasPermission } from "@/lib/admin/access";
import { requireAdminArea } from "@/lib/admin/context";
import { pageRange, parsePage, pickParam } from "@/lib/admin/pagination";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { isCurrent } from "@/lib/auth/validity";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Cuentas y roles" };

const FILTERS = ["vigentes", "todas"] as const;

export default async function MembresiasPage({ searchParams }: PageProps<"/admin/membresias">) {
  const ctx = await requireAdminArea("membresias");
  const params = await searchParams;
  const filter = pickParam(params.estado, FILTERS) ?? "vigentes";
  const page = parsePage(params.pagina);
  const supabase = await createClient();
  const now = new Date();

  let query = supabase
    .from("company_memberships")
    .select(
      "id, status, valid_from, valid_to, profiles (full_name, email), role_assignments (role, status, valid_from, valid_to)",
      { count: "exact" },
    )
    .eq("company_id", ctx.companyId)
    .order("created_at", { ascending: false });
  if (filter === "vigentes") {
    query = query.eq("status", "active").or(`valid_to.is.null,valid_to.gt."${now.toISOString()}"`);
  }
  const [from, to] = pageRange(page);
  const { data, count, error } = await query.range(from, to);
  if (error) throw new Error("No se pudieron cargar las cuentas.");

  return (
    <>
      <BackLink href="/admin" label="Administración" />
      <PageHeader
        title="Cuentas y roles"
        description="Quién puede entrar en la plataforma para esta empresa y con qué roles."
      />
      {hasPermission(ctx.permissions, "members.manage", "company") ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">Añadir persona</CardTitle>
            <CardDescription>
              Si ya tiene cuenta en el grupo se añade a esta empresa; si no, recibe una invitación
              por correo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InviteForm />
          </CardContent>
        </Card>
      ) : null}
      <form className="mb-4 flex items-end gap-2" action="/admin/membresias">
        <SelectField
          name="estado"
          label="Mostrar"
          defaultValue={filter}
          options={[
            { value: "vigentes", label: "Cuentas vigentes" },
            { value: "todas", label: "Todas (incluye caducadas)" },
          ]}
        />
        <Button type="submit" variant="outline">
          Filtrar
        </Button>
      </form>
      <DataTable
        caption="Cuentas"
        rows={data ?? []}
        rowKey={(r) => r.id}
        empty="No hay cuentas con ese filtro."
        columns={[
          {
            key: "person",
            header: "Persona",
            cell: (r) => (
              <Link href={`/admin/membresias/${r.id}`} className="underline underline-offset-4">
                {r.profiles?.full_name || r.profiles?.email || "Sin nombre"}
              </Link>
            ),
          },
          {
            key: "roles",
            header: "Roles vigentes",
            cell: (r) => {
              const roles = [
                ...new Set(r.role_assignments.filter((x) => isCurrent(x, now)).map((x) => x.role)),
              ];
              return roles.length ? (
                <span className="flex flex-wrap gap-1">
                  {roles.map((role) => (
                    <Badge key={role} variant="outline">
                      {ROLE_LABELS[role]}
                    </Badge>
                  ))}
                </span>
              ) : (
                "—"
              );
            },
          },
          {
            key: "validity",
            header: "Vigencia",
            cell: (r) =>
              `${formatDate(r.valid_from)} – ${r.valid_to ? formatDate(r.valid_to) : "sin fin"}`,
            desktopOnly: true,
          },
          {
            key: "status",
            header: "Estado",
            cell: (r) => (
              <StatusBadge
                status={isCurrent(r, now) ? "active" : r.valid_to ? "expired" : r.status}
              />
            ),
          },
        ]}
      />
      <Pagination
        base="/admin/membresias"
        params={{ estado: filter === "vigentes" ? undefined : filter }}
        page={page}
        count={count ?? 0}
      />
    </>
  );
}
