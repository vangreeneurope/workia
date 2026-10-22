import type { Metadata } from "next";

import { BackLink } from "@/components/admin/back-link";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MfaPanel, type FactorView } from "@/features/security/components/mfa-panel";
import { requireSection } from "@/lib/auth/dal";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Seguridad de la cuenta" };

export default async function SeguridadPage({ searchParams }: PageProps<"/perfil/seguridad">) {
  const ctx = await requireSection("perfil");
  const { motivo } = await searchParams;
  const supabase = await createClient();
  const [factorsRes, aalRes] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  const factors: FactorView[] = (factorsRes.data?.all ?? [])
    .filter((f) => f.factor_type === "totp")
    .map((f) => ({
      id: f.id,
      name: f.friendly_name || "Aplicación de autenticación",
      verified: f.status === "verified",
      createdAt: formatDate(f.created_at),
    }));
  const level = aalRes.data?.currentLevel === "aal2" ? "aal2" : "aal1";
  const pending = ctx.mfa.required && !ctx.mfa.satisfied;

  return (
    <>
      <BackLink href="/perfil" label="Mi perfil" />
      <PageHeader
        title="Seguridad de la cuenta"
        description="Verificación en dos pasos con una aplicación de autenticación (TOTP)."
      />
      {pending && motivo === "verificar" ? (
        <Alert className="mb-4">
          <AlertDescription>
            Para entrar en esa sección necesitas confirmar tu identidad con el segundo factor.
          </AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Verificación en dos pasos</CardTitle>
          <CardDescription>
            {ctx.mfa.required
              ? "Obligatoria para tu rol (administración, RR. HH., contabilidad o auditoría)."
              : "Recomendada para todas las cuentas."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MfaPanel factors={factors} level={level} required={ctx.mfa.required} />
        </CardContent>
      </Card>
    </>
  );
}
