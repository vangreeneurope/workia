import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/admin/back-link";
import { DataTable } from "@/components/admin/data-table";
import { StatusToggle } from "@/components/admin/status-toggle";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { setHolidayStatus } from "@/features/schedules/actions";
import {
  CalendarLinkForm,
  EndLinkForm,
  HolidayForm,
  HolidayImportForm,
} from "@/features/schedules/components/schedule-forms";
import { CALENDAR_SCOPE_LABELS } from "@/features/schedules/schemas";
import { todayIn } from "@/features/schedules/zoned-time";
import { requireAdminArea } from "@/lib/admin/context";
import { uuidParam } from "@/lib/admin/pagination";
import { addDays, formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Calendario laboral" };

export default async function CalendarioPage({ params }: PageProps<"/admin/calendarios/[id]">) {
  const ctx = await requireAdminArea("calendarios");
  const id = uuidParam((await params).id);
  if (!id) notFound();
  const supabase = await createClient();
  const { data: calendar } = await supabase
    .from("holiday_calendars")
    .select("id, name, scope, region_code, locality, applies_to_all_centers, source_reference")
    .eq("id", id)
    .eq("company_id", ctx.companyId)
    .maybeSingle();
  if (!calendar) notFound();

  const [holidaysRes, linksRes, centersRes, companyRes] = await Promise.all([
    supabase
      .from("holidays")
      .select("id, holiday_date, name, status")
      .eq("calendar_id", calendar.id)
      .order("holiday_date"),
    supabase
      .from("work_center_holiday_calendars")
      .select("id, valid_from, valid_to, work_centers (name, code)")
      .eq("calendar_id", calendar.id)
      .order("valid_from", { ascending: false }),
    supabase
      .from("work_centers")
      .select("id, name, code")
      .eq("company_id", ctx.companyId)
      .eq("status", "active")
      .order("name"),
    supabase.from("companies").select("timezone").eq("id", ctx.companyId).single(),
  ]);
  const today = todayIn(companyRes.data?.timezone ?? "Europe/Madrid");

  return (
    <>
      <BackLink href="/admin/calendarios" label="Calendarios laborales" />
      <PageHeader
        title={calendar.name}
        description={`${[CALENDAR_SCOPE_LABELS[calendar.scope], calendar.region_code, calendar.locality].filter(Boolean).join(" · ")}. Fuente: ${calendar.source_reference}`}
      />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Festivos</CardTitle>
            <CardDescription>
              Los festivos pasados no se modifican. Un festivo anula el turno ordinario de ese día,
              salvo que haya una excepción individual.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <DataTable
              caption="Festivos del calendario"
              rows={holidaysRes.data ?? []}
              rowKey={(h) => h.id}
              empty="Sin festivos registrados."
              columns={[
                { key: "date", header: "Fecha", cell: (h) => formatDate(h.holiday_date) },
                { key: "name", header: "Nombre", cell: (h) => h.name },
                {
                  key: "status",
                  header: "Estado",
                  cell: (h) =>
                    h.holiday_date >= today ? (
                      <StatusToggle
                        id={h.id}
                        status={h.status === "active" ? "active" : "inactive"}
                        action={setHolidayStatus}
                        entityLabel={`el festivo del ${formatDate(h.holiday_date)}`}
                      />
                    ) : (
                      "Pasado"
                    ),
                },
              ]}
            />
            <HolidayForm calendarId={calendar.id} today={today} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Importar festivos</CardTitle>
            <CardDescription>
              Pega los festivos de la fuente validada. Se revisan todos antes de guardar y se
              importan todos o ninguno.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HolidayImportForm calendarId={calendar.id} today={today} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Centros a los que se aplica</CardTitle>
            <CardDescription>
              {calendar.applies_to_all_centers
                ? "Este calendario se aplica a todos los centros de la empresa."
                : "Se aplica desde una fecha (hoy o futura); no tiene efecto retroactivo."}
            </CardDescription>
          </CardHeader>
          {calendar.applies_to_all_centers ? null : (
            <CardContent className="grid gap-6">
              <DataTable
                caption="Centros con este calendario"
                rows={linksRes.data ?? []}
                rowKey={(l) => l.id}
                empty="Aún no se aplica a ningún centro."
                columns={[
                  {
                    key: "center",
                    header: "Centro",
                    cell: (l) => `${l.work_centers?.name ?? ""} (${l.work_centers?.code ?? ""})`,
                  },
                  {
                    key: "validity",
                    header: "Vigencia",
                    cell: (l) =>
                      `${formatDate(l.valid_from)} – ${l.valid_to ? formatDate(addDays(l.valid_to, -1)) : "sin fin"}`,
                  },
                  {
                    key: "actions",
                    header: "Acciones",
                    cell: (l) =>
                      !l.valid_to || l.valid_to > today ? (
                        <EndLinkForm id={l.id} today={today} />
                      ) : null,
                  },
                ]}
              />
              <CalendarLinkForm
                calendarId={calendar.id}
                today={today}
                centers={(centersRes.data ?? []).map((c) => ({
                  id: c.id,
                  label: `${c.name} (${c.code})`,
                }))}
              />
            </CardContent>
          )}
        </Card>
      </div>
    </>
  );
}
