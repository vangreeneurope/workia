import type { Metadata } from "next";

import { BackLink } from "@/components/admin/back-link";
import { DataTable } from "@/components/admin/data-table";
import { StatusToggle } from "@/components/admin/status-toggle";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { setKioskStatus } from "@/features/time-tracking/actions";
import {
  KioskRegistrationForm,
  PinResetForm,
  PolicyForm,
} from "@/features/time-tracking/components/admin-forms";
import { LOCATION_MODE_LABELS } from "@/features/time-tracking/schemas";
import { requireAdminArea } from "@/lib/admin/context";
import { businessDate, formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Control horario" };

export default async function AdminFichajesPage() {
  const ctx = await requireAdminArea("fichajes");
  const supabase = await createClient();
  const [policiesRes, devicesRes, centersRes, employeesRes] = await Promise.all([
    supabase
      .from("time_tracking_policies")
      .select(
        "id, work_center_id, location_mode, selfie_enabled, location_notice, work_centers (name)",
      )
      .eq("company_id", ctx.companyId),
    supabase
      .from("kiosk_devices")
      .select("id, name, status, last_used_at, blocked_until, work_centers (name)")
      .eq("company_id", ctx.companyId)
      .order("name"),
    supabase
      .from("work_centers")
      .select("id, name, code")
      .eq("company_id", ctx.companyId)
      .eq("status", "active")
      .order("name"),
    supabase
      .from("employees")
      .select("id, first_name, last_name, employee_code")
      .eq("company_id", ctx.companyId)
      .or(`end_date.is.null,end_date.gte.${businessDate()}`)
      .order("last_name")
      .limit(1000),
  ]);
  const centers = (centersRes.data ?? []).map((c) => ({
    id: c.id,
    label: `${c.name} (${c.code})`,
  }));
  const now = new Date().toISOString();

  return (
    <>
      <BackLink href="/admin" label="Administración" />
      <PageHeader
        title="Control horario"
        description="Qué se registra al fichar, terminales compartidos y PIN. Los fichajes no se editan desde aquí: se corrigen con solicitudes aprobadas."
      />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Políticas de fichaje</CardTitle>
            <CardDescription>
              La de un centro sustituye a la de la empresa. Sin política: ni ubicación ni selfie.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <DataTable
              caption="Políticas"
              rows={policiesRes.data ?? []}
              rowKey={(p) => p.id}
              empty="Sin políticas: no se registra ubicación ni selfie."
              columns={[
                {
                  key: "scope",
                  header: "Ámbito",
                  cell: (p) =>
                    p.work_center_id ? `Centro ${p.work_centers?.name ?? ""}` : "Toda la empresa",
                },
                {
                  key: "location",
                  header: "Ubicación",
                  cell: (p) => LOCATION_MODE_LABELS[p.location_mode],
                },
                {
                  key: "selfie",
                  header: "Selfie",
                  cell: (p) => (p.selfie_enabled ? "Permitida (opcional)" : "No"),
                },
                {
                  key: "notice",
                  header: "Aviso",
                  desktopOnly: true,
                  cell: (p) => p.location_notice ?? "—",
                },
              ]}
            />
            <PolicyForm centers={centers} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Terminales compartidos</CardTitle>
            <CardDescription>
              Cada persona ficha con su código y su PIN. Tras 5 fallos seguidos su PIN se bloquea 15
              minutos y, con 20 fallos en 10 minutos, el terminal se bloquea 10 minutos.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <DataTable
              caption="Terminales"
              rows={devicesRes.data ?? []}
              rowKey={(d) => d.id}
              empty="No hay terminales."
              columns={[
                { key: "name", header: "Terminal", cell: (d) => d.name },
                { key: "center", header: "Centro", cell: (d) => d.work_centers?.name ?? "" },
                {
                  key: "used",
                  header: "Último uso",
                  cell: (d) =>
                    `${d.last_used_at ? formatDate(d.last_used_at) : "Nunca"}${d.blocked_until && d.blocked_until > now ? " · bloqueado" : ""}`,
                },
                {
                  key: "status",
                  header: "Estado",
                  cell: (d) => (
                    <StatusToggle
                      id={d.id}
                      status={d.status === "active" ? "active" : "inactive"}
                      action={setKioskStatus}
                      entityLabel={`el terminal ${d.name}`}
                    />
                  ),
                },
              ]}
            />
            <KioskRegistrationForm centers={centers} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">PIN del terminal</CardTitle>
            <CardDescription>
              Cada persona define su PIN en su perfil; nadie más lo conoce. Si lo olvida o se
              sospecha que otra persona lo sabe, anúlalo y pídele que cree uno nuevo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PinResetForm
              employees={(employeesRes.data ?? []).map((e) => ({
                id: e.id,
                label: `${e.last_name}, ${e.first_name} (${e.employee_code})`,
              }))}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
