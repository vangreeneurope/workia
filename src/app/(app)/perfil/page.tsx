import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSection } from "@/lib/auth/dal";
import { GLOBAL_ADMIN_LABEL, ROLE_LABELS } from "@/lib/auth/permissions";

export const metadata: Metadata = { title: "Mi perfil" };

export default async function PerfilPage() {
  const ctx = await requireSection("perfil");

  return (
    <>
      <PageHeader title="Mi perfil" description="Tus datos de acceso y tus empresas." />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Datos personales</CardTitle>
            <CardDescription>
              Para corregir tu nombre o datos laborales, contacta con RR. HH.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground text-sm">Nombre</dt>
                <dd className="font-medium">{ctx.fullName || "Sin indicar"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-sm">Correo electrónico</dt>
                <dd className="font-medium break-all">{ctx.email}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Empresas y roles</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {ctx.isGlobalAdmin ? <Badge className="w-fit">{GLOBAL_ADMIN_LABEL}</Badge> : null}
            {ctx.memberships.length === 0 ? (
              <p className="text-muted-foreground text-sm">No tienes empresas asignadas.</p>
            ) : (
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
            )}
          </CardContent>
        </Card>

        <div>
          <Button asChild variant="outline">
            <Link href="/perfil/contrasena">
              <KeyRound aria-hidden /> Cambiar contraseña
            </Link>
          </Button>
        </div>
      </div>
    </>
  );
}
