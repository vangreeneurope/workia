import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionButton } from "@/components/admin/action-button";
import { BackLink } from "@/components/admin/back-link";
import { DataTable } from "@/components/admin/data-table";
import { StatusBadge } from "@/components/admin/status-badge";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { reactivateMembership, revokeRole } from "@/features/admin/members/actions";
import { EndMembershipForm } from "@/features/admin/members/components/end-membership-form";
import { RoleGrantForm } from "@/features/admin/members/components/role-grant-form";
import { organizationOptions } from "@/features/admin/people/queries";
import { hasPermission } from "@/lib/admin/access";
import { requireAdminArea } from "@/lib/admin/context";
import { uuidParam } from "@/lib/admin/pagination";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { isCurrent } from "@/lib/auth/validity";
import { businessDate, formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Cuenta" };

const SCOPE_LABELS = { company: "Toda la empresa", work_center: "Centro", team: "Equipo" } as const;

export default async function MembresiaPage({ params }: PageProps<"/admin/membresias/[id]">) {
  const ctx = await requireAdminArea("membresias");
  const id = uuidParam((await params).id);
  if (!id) notFound();
  const supabase = await createClient();
  const [membershipRes, rolesRes, options] = await Promise.all([
    supabase
      .from("company_memberships")
      .select("id, user_id, status, valid_from, valid_to, profiles (full_name, email)")
      .eq("id", id)
      .eq("company_id", ctx.companyId)
      .maybeSingle(),
    supabase
      .from("role_assignments")
      .select(
        "id, role, scope_type, status, valid_from, valid_to, work_centers (name), teams (name)",
      )
      .eq("membership_id", id)
      .order("created_at", { ascending: false }),
    organizationOptions(ctx),
  ]);
  const membership = membershipRes.data;
  if (!membership) notFound();

  const now = new Date();
  const today = businessDate();
  const current = isCurrent(membership, now);
  const isSelf = membership.user_id === ctx.user.userId;
  const canManage = hasPermission(ctx.permissions, "members.manage", "company") && !isSelf;
  const name = membership.profiles?.full_name || membership.profiles?.email || "Cuenta";

  return (
    <>
      <BackLink href="/admin/membresias" label="Cuentas y roles" />
      <PageHeader
        title={name}
        description={`Vigencia: ${formatDate(membership.valid_from)} – ${membership.valid_to ? formatDate(membership.valid_to) : "sin fin"}`}
        actions={<StatusBadge status={current ? "active" : "expired"} />}
      />
      {isSelf ? (
        <p className="text-muted-foreground mb-4 text-sm">
          Es tu propia cuenta: nadie puede modificar sus propios roles ni su acceso.
        </p>
      ) : null}
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Roles</CardTitle>
            <CardDescription>
              Revocar un rol no lo borra: queda en el historial y en la auditoría.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              caption="Roles"
              rows={rolesRes.data ?? []}
              rowKey={(r) => r.id}
              empty="Sin roles."
              columns={[
                { key: "role", header: "Rol", cell: (r) => ROLE_LABELS[r.role] },
                {
                  key: "scope",
                  header: "Ámbito",
                  cell: (r) =>
                    r.scope_type === "company"
                      ? SCOPE_LABELS.company
                      : `${SCOPE_LABELS[r.scope_type]}: ${r.work_centers?.name ?? r.teams?.name ?? "—"}`,
                },
                {
                  key: "validity",
                  header: "Vigencia",
                  cell: (r) =>
                    `${formatDate(r.valid_from)} – ${r.valid_to ? formatDate(r.valid_to) : "sin fin"}`,
                },
                {
                  key: "status",
                  header: "Estado",
                  cell: (r) => (
                    <StatusBadge
                      status={
                        isCurrent(r, now)
                          ? "active"
                          : r.status === "revoked"
                            ? "revoked"
                            : "expired"
                      }
                    />
                  ),
                },
                {
                  key: "actions",
                  header: "Acciones",
                  cell: (r) =>
                    canManage && r.status === "active" ? (
                      <ActionButton
                        action={revokeRole.bind(null, r.id)}
                        label="Revocar"
                        ariaLabel={`Revocar el rol ${ROLE_LABELS[r.role]}`}
                        confirmMessage="¿Revocar este rol desde ahora?"
                      />
                    ) : null,
                },
              ]}
            />
          </CardContent>
        </Card>

        {canManage && current ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Conceder rol</CardTitle>
              <CardDescription>
                RR. HH. solo puede conceder los roles de empleado y responsable; el resto, la
                administración de la empresa o del grupo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RoleGrantForm
                membershipId={id}
                workCenters={options.workCenters.filter((w) => w.status === "active")}
                teams={options.teams.filter((t) => t.status === "active")}
                today={today}
              />
            </CardContent>
          </Card>
        ) : null}

        {canManage ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Acceso</CardTitle>
              <CardDescription>
                Si la persona deja la empresa, usa la baja en su ficha de Personas: cierra también
                sus condiciones y asignaciones.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {current ? (
                <EndMembershipForm membershipId={id} today={today} />
              ) : (
                <ActionButton
                  action={reactivateMembership.bind(null, id)}
                  label="Reactivar cuenta"
                />
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
