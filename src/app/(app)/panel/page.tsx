import { Building2, Info, ShieldCheck, Users } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSection } from "@/lib/auth/dal";
import {
  GLOBAL_ADMIN_LABEL,
  GROUP_ADMIN_LABEL,
  ROLE_LABELS,
  administersCompany,
  rolesInCompany,
} from "@/lib/auth/permissions";

export const metadata: Metadata = { title: "Inicio" };

export default async function PanelPage() {
  const ctx = await requireSection("panel");
  const activeCompany = ctx.companies.find((c) => c.id === ctx.activeCompanyId) ?? null;
  const activeRoles = rolesInCompany(ctx, ctx.activeCompanyId);
  const groupAdminHere = !ctx.isGlobalAdmin && administersCompany(ctx, ctx.activeCompanyId);
  const firstName = ctx.fullName.split(" ")[0] || ctx.email;

  return (
    <>
      <PageHeader
        title={`Hola, ${firstName}`}
        description="Este es tu espacio en el portal del grupo."
      />

      {ctx.companies.length === 0 ? (
        <Alert>
          <Info />
          <AlertTitle>Tu cuenta aún no está asociada a ninguna empresa</AlertTitle>
          <AlertDescription>
            Pide al departamento de RR. HH. que te dé de alta en tu empresa para empezar a usar el
            portal.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardDescription className="flex items-center gap-2">
                <Building2 className="size-4" aria-hidden /> Empresa activa
              </CardDescription>
              <CardTitle className="text-lg">{activeCompany?.name}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {ctx.isGlobalAdmin ? (
                <Badge>
                  <ShieldCheck aria-hidden /> {GLOBAL_ADMIN_LABEL}
                </Badge>
              ) : null}
              {groupAdminHere ? (
                <Badge>
                  <ShieldCheck aria-hidden /> {GROUP_ADMIN_LABEL}
                </Badge>
              ) : null}
              {activeRoles.map((role) => (
                <Badge key={role} variant="secondary">
                  {ROLE_LABELS[role]}
                </Badge>
              ))}
              {!ctx.isGlobalAdmin && !groupAdminHere && activeRoles.length === 0 ? (
                <span className="text-muted-foreground text-sm">Sin rol en esta empresa</span>
              ) : null}
            </CardContent>
          </Card>

          {ctx.supervisedCount > 0 ? (
            <Card>
              <CardHeader>
                <CardDescription className="flex items-center gap-2">
                  <Users className="size-4" aria-hidden /> Equipo a tu cargo
                </CardDescription>
                <CardTitle className="text-lg">
                  {ctx.supervisedCount === 1
                    ? "Supervisas a 1 persona"
                    : `Supervisas a ${ctx.supervisedCount} personas`}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground text-sm">
                Puede incluir personas de distintas empresas del grupo.
              </CardContent>
            </Card>
          ) : null}

          {ctx.memberships.length > 1 ? (
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Tus empresas</CardTitle>
                <CardDescription>
                  Empresas del grupo en las que tienes un rol asignado.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {ctx.memberships.map((m) => (
                    <li
                      key={m.membershipId}
                      className="flex flex-wrap items-center justify-between gap-2 py-3"
                    >
                      <span className="font-medium">{m.company.name}</span>
                      <span className="flex flex-wrap gap-1">
                        {m.roles.map((role) => (
                          <Badge key={role} variant="outline">
                            {ROLE_LABELS[role]}
                          </Badge>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
