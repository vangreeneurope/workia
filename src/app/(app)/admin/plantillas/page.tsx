import type { Metadata } from "next";
import Link from "next/link";

import { BackLink } from "@/components/admin/back-link";
import { DataTable } from "@/components/admin/data-table";
import { StatusToggle } from "@/components/admin/status-toggle";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { setTemplateStatus } from "@/features/schedules/actions";
import { TemplateCreateForm } from "@/features/schedules/components/schedule-forms";
import { SHIFT_KIND_LABELS, type ShiftKind } from "@/features/schedules/template-rules";
import { formatDuration, todayIn } from "@/features/schedules/zoned-time";
import { requireAdminArea } from "@/lib/admin/context";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Plantillas de turno" };

export default async function PlantillasPage() {
  const ctx = await requireAdminArea("plantillas");
  const supabase = await createClient();
  const [{ data: templates, error }, { data: company }] = await Promise.all([
    supabase
      .from("shift_templates")
      .select(
        "id, code, name, status, shift_template_versions (version, kind, target_minutes, status, valid_from, valid_to)",
      )
      .eq("company_id", ctx.companyId)
      .order("code"),
    supabase.from("companies").select("timezone").eq("id", ctx.companyId).single(),
  ]);
  if (error) throw new Error("No se pudieron cargar las plantillas.");
  const today = todayIn(company?.timezone ?? "Europe/Madrid");

  const rows = (templates ?? []).map((t) => {
    const published = t.shift_template_versions.filter((v) => v.status === "published");
    const current = published.find(
      (v) => v.valid_from !== null && v.valid_from <= today && (!v.valid_to || v.valid_to > today),
    );
    const upcoming = published
      .filter((v) => v.valid_from !== null && v.valid_from > today)
      .sort((a, b) => (a.valid_from ?? "").localeCompare(b.valid_from ?? ""))[0];
    const draft = t.shift_template_versions.some((v) => v.status === "draft");
    return { ...t, current, upcoming, draft };
  });

  return (
    <>
      <BackLink href="/admin" label="Administración" />
      <PageHeader
        title="Plantillas de turno"
        description="Cada cambio es una versión nueva con fecha de efecto: los días ya pasados conservan la versión que tenían."
      />
      <div className="grid gap-4">
        <Card>
          <CardContent className="pt-6">
            <DataTable
              caption="Plantillas de turno"
              rows={rows}
              rowKey={(t) => t.id}
              empty="Aún no hay plantillas. Crea la primera abajo."
              columns={[
                {
                  key: "name",
                  header: "Plantilla",
                  cell: (t) => (
                    <Link href={`/admin/plantillas/${t.id}`} className="font-medium underline">
                      {t.code} · {t.name}
                    </Link>
                  ),
                },
                {
                  key: "current",
                  header: "Vigente hoy",
                  cell: (t) =>
                    t.current
                      ? `v${t.current.version} · ${SHIFT_KIND_LABELS[t.current.kind as ShiftKind]} · ${formatDuration(t.current.target_minutes)}`
                      : "Sin versión vigente",
                },
                {
                  key: "next",
                  header: "Próximo cambio",
                  cell: (t) =>
                    t.upcoming
                      ? `v${t.upcoming.version} desde ${formatDate(t.upcoming.valid_from)}`
                      : t.draft
                        ? "Borrador sin publicar"
                        : "—",
                },
                {
                  key: "status",
                  header: "Estado",
                  cell: (t) => (
                    <StatusToggle
                      id={t.id}
                      status={t.status === "active" ? "active" : "inactive"}
                      action={setTemplateStatus}
                      entityLabel={`la plantilla ${t.code}`}
                    />
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nueva plantilla</CardTitle>
            <CardDescription>
              Después podrás definir sus tramos, pausas y horas objetivo y publicarla.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TemplateCreateForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
