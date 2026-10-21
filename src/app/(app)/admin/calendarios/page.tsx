import type { Metadata } from "next";
import Link from "next/link";

import { BackLink } from "@/components/admin/back-link";
import { DataTable } from "@/components/admin/data-table";
import { StatusToggle } from "@/components/admin/status-toggle";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { setCalendarStatus } from "@/features/schedules/actions";
import { CalendarForm } from "@/features/schedules/components/schedule-forms";
import { CALENDAR_SCOPE_LABELS } from "@/features/schedules/schemas";
import { requireAdminArea } from "@/lib/admin/context";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Calendarios laborales" };

export default async function CalendariosPage() {
  const ctx = await requireAdminArea("calendarios");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("holiday_calendars")
    .select(
      "id, name, scope, region_code, locality, applies_to_all_centers, source_reference, status",
    )
    .eq("company_id", ctx.companyId)
    .order("name");
  if (error) throw new Error("No se pudieron cargar los calendarios.");

  return (
    <>
      <BackLink href="/admin" label="Administración" />
      <PageHeader
        title="Calendarios laborales"
        description="Festivos nacionales, autonómicos, locales y propios. No se precarga ningún festivo: se registran o importan desde una fuente validada."
      />
      <div className="grid gap-4">
        <Card>
          <CardContent className="pt-6">
            <DataTable
              caption="Calendarios laborales"
              rows={data ?? []}
              rowKey={(c) => c.id}
              empty="Aún no hay calendarios."
              columns={[
                {
                  key: "name",
                  header: "Calendario",
                  cell: (c) => (
                    <Link href={`/admin/calendarios/${c.id}`} className="font-medium underline">
                      {c.name}
                    </Link>
                  ),
                },
                {
                  key: "scope",
                  header: "Ámbito",
                  cell: (c) =>
                    [CALENDAR_SCOPE_LABELS[c.scope], c.region_code, c.locality]
                      .filter(Boolean)
                      .join(" · "),
                },
                {
                  key: "applies",
                  header: "Centros",
                  cell: (c) => (c.applies_to_all_centers ? "Todos" : "Los asignados"),
                },
                {
                  key: "source",
                  header: "Fuente",
                  desktopOnly: true,
                  cell: (c) => c.source_reference,
                },
                {
                  key: "status",
                  header: "Estado",
                  cell: (c) => (
                    <StatusToggle
                      id={c.id}
                      status={c.status === "active" ? "active" : "inactive"}
                      action={setCalendarStatus}
                      entityLabel={`el calendario ${c.name}`}
                    />
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nuevo calendario</CardTitle>
            <CardDescription>
              La fuente es obligatoria: indica la publicación oficial o el acuerdo del que salen los
              festivos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CalendarForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
