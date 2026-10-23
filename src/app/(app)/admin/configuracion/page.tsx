import type { Metadata } from "next";

import { BackLink } from "@/components/admin/back-link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SessionSettingsForm } from "@/features/admin/settings/components/session-settings-form";
import { requireAdminArea } from "@/lib/admin/context";
import { DEFAULT_SESSION_MINUTES, sessionMinutes } from "@/lib/auth/session-limit";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Configuración" };

export default async function AdminConfiguracionPage() {
  const ctx = await requireAdminArea("configuracion");
  const supabase = await createClient();
  const { data } = await supabase
    .from("companies")
    .select("session_max_minutes")
    .eq("id", ctx.companyId)
    .maybeSingle();
  const minutes = data ? sessionMinutes(data.session_max_minutes) : DEFAULT_SESSION_MINUTES;

  return (
    <>
      <BackLink href="/admin" label="Administración" />
      <PageHeader
        title="Configuración"
        description={`Ajustes de ${ctx.companyName}. Los cambios se aplican a todas las personas de la empresa.`}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cierre automático de la sesión</CardTitle>
          <CardDescription>
            La sesión se cierra siempre a los minutos indicados desde que la persona entra, aunque
            la esté usando, con un aviso 5 minutos antes. Si alguien vuelve a una pestaña abierta
            hace más tiempo, se cierra en el momento. A quien trabaja en varias empresas se le
            aplica el valor más corto. El nuevo valor cuenta desde la siguiente página que se abra.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SessionSettingsForm minutes={minutes} />
        </CardContent>
      </Card>
    </>
  );
}
