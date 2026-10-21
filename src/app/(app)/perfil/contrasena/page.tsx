import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { NewPasswordForm } from "@/features/auth/components/new-password-form";
import { requireSection } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Cambiar contraseña" };

export default async function ContrasenaPage() {
  await requireSection("perfil");
  return (
    <>
      <PageHeader
        title="Cambiar contraseña"
        description="Si vienes de un enlace de invitación o recuperación, crea aquí tu contraseña."
      />
      <Card className="max-w-lg">
        <CardContent>
          <NewPasswordForm />
        </CardContent>
      </Card>
    </>
  );
}
