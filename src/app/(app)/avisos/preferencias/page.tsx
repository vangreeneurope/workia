import type { Metadata } from "next";

import { BackLink } from "@/components/admin/back-link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NOTIFICATION_EVENTS, type NotificationEvent } from "@/features/notifications/catalog";
import { PreferencesForm } from "@/features/notifications/components/preferences-form";
import { getUserContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Preferencias de avisos" };

export default async function PreferenciasPage() {
  const ctx = await getUserContext();
  const supabase = await createClient();
  const { data } = ctx.activeCompanyId
    ? await supabase
        .from("notification_preferences")
        .select("event_type, enabled")
        .eq("company_id", ctx.activeCompanyId)
        .eq("channel", "email")
    : { data: [] };
  const prefs = new Map((data ?? []).map((p) => [p.event_type, p.enabled]));
  const events = Object.keys(NOTIFICATION_EVENTS) as NotificationEvent[];
  const optional = events.filter((e) => !NOTIFICATION_EVENTS[e].mandatory);
  const mandatory = events.filter((e) => NOTIFICATION_EVENTS[e].mandatory);

  return (
    <>
      <BackLink href="/avisos" label="Avisos" />
      <PageHeader
        title="Preferencias de avisos"
        description="Elige qué avisos quieres recibir también por correo."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Avisos opcionales</CardTitle>
            <CardDescription>
              Siempre aparecen en tu bandeja; aquí decides si además te llega un correo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PreferencesForm
              options={optional.map((e) => ({
                event: e,
                label: NOTIFICATION_EVENTS[e].label,
                enabled: prefs.get(e) ?? true,
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Avisos obligatorios</CardTitle>
            <CardDescription>
              Son necesarios para tu trabajo o por obligación legal (por ejemplo, el registro de
              jornada): llegan siempre a la bandeja y por correo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid list-disc gap-1 pl-5 text-sm">
              {mandatory.map((e) => (
                <li key={e}>{NOTIFICATION_EVENTS[e].label}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
      <p className="text-muted-foreground mt-4 text-xs">
        Los correos no incluyen motivos, importes, tickets ni ubicaciones: solo te avisan y enlazan
        al portal, donde tienes que iniciar sesión.
      </p>
    </>
  );
}
