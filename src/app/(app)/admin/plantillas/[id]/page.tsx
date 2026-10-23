import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/admin/back-link";
import { DataTable } from "@/components/admin/data-table";
import { StatusBadge } from "@/components/admin/status-badge";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PublishVersionForm } from "@/features/schedules/components/schedule-forms";
import {
  TemplateEditor,
  type TemplateEditorValue,
} from "@/features/schedules/components/template-editor";
import {
  SHIFT_KIND_LABELS,
  templateProblems,
  type SegmentKind,
  type ShiftKind,
} from "@/features/schedules/template-rules";
import { formatDuration, formatMinute, todayIn } from "@/features/schedules/zoned-time";
import { uuidParam } from "@/lib/admin/pagination";
import { requireAdminArea } from "@/lib/admin/context";
import { addDays, formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Plantilla de turno" };

export default async function PlantillaPage({ params }: PageProps<"/admin/plantillas/[id]">) {
  const ctx = await requireAdminArea("plantillas");
  const id = uuidParam((await params).id);
  if (!id) notFound();
  const supabase = await createClient();
  const [{ data: template }, { data: company }] = await Promise.all([
    supabase
      .from("shift_templates")
      .select(
        "id, code, name, shift_template_versions (id, version, kind, target_minutes, tolerance_early_minutes, tolerance_late_minutes, flex_window_start, flex_window_end, status, valid_from, valid_to, published_at, shift_template_segments (position, start_minute, end_minute, kind, paid))",
      )
      .eq("id", id)
      .eq("company_id", ctx.companyId)
      .maybeSingle(),
    supabase.from("companies").select("timezone").eq("id", ctx.companyId).single(),
  ]);
  if (!template) notFound();
  const today = todayIn(company?.timezone ?? "Europe/Madrid");

  const versions = [...template.shift_template_versions].sort((a, b) => b.version - a.version);
  const toValue = (v: (typeof versions)[number]): TemplateEditorValue => ({
    kind: v.kind as ShiftKind,
    targetMinutes: v.target_minutes,
    toleranceEarlyMinutes: v.tolerance_early_minutes,
    toleranceLateMinutes: v.tolerance_late_minutes,
    flexWindowStart: v.flex_window_start,
    flexWindowEnd: v.flex_window_end,
    segments: [...v.shift_template_segments]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        startMinute: s.start_minute,
        endMinute: s.end_minute,
        kind: s.kind as SegmentKind,
        paid: s.paid,
      })),
  });
  const draft = versions.find((v) => v.status === "draft");
  const latestPublished = versions.find((v) => v.status === "published");
  // El borrador parte de la última versión publicada (o de una jornada de ejemplo vacía).
  const editorValue: TemplateEditorValue = draft
    ? toValue(draft)
    : latestPublished
      ? toValue(latestPublished)
      : {
          kind: "continuous",
          targetMinutes: 0,
          toleranceEarlyMinutes: 0,
          toleranceLateMinutes: 0,
          flexWindowStart: null,
          flexWindowEnd: null,
          segments: [{ startMinute: 480, endMinute: 900, kind: "work", paid: true }],
        };
  const draftProblems = draft ? templateProblems(toValue(draft)) : [];

  return (
    <>
      <BackLink href="/admin/plantillas" label="Plantillas de turno" />
      <PageHeader title={`${template.code} · ${template.name}`} />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Versiones</CardTitle>
            <CardDescription>
              Las versiones publicadas no se modifican. Su vigencia se cierra automáticamente al
              publicar la siguiente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              caption="Versiones de la plantilla"
              rows={versions}
              rowKey={(v) => v.id}
              empty="Sin versiones todavía."
              columns={[
                { key: "version", header: "Versión", cell: (v) => `v${v.version}` },
                {
                  key: "kind",
                  header: "Jornada",
                  cell: (v) =>
                    `${SHIFT_KIND_LABELS[v.kind as ShiftKind]} · ${formatDuration(v.target_minutes)}`,
                },
                {
                  key: "segments",
                  header: "Tramos",
                  cell: (v) =>
                    [...v.shift_template_segments]
                      .sort((a, b) => a.position - b.position)
                      .map(
                        (s) =>
                          `${formatMinute(s.start_minute)}–${formatMinute(s.end_minute)}${s.kind === "break" ? (s.paid ? " pausa retrib." : " pausa") : ""}`,
                      )
                      .join(", ") || "—",
                },
                {
                  key: "validity",
                  header: "Vigencia",
                  cell: (v) =>
                    v.status === "published"
                      ? `${formatDate(v.valid_from)} – ${v.valid_to ? formatDate(addDays(v.valid_to, -1)) : "sin fin"}`
                      : "—",
                },
                { key: "status", header: "Estado", cell: (v) => <StatusBadge status={v.status} /> },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {draft ? `Borrador v${draft.version}` : "Nueva versión"}
            </CardTitle>
            <CardDescription>
              Minutos enteros desde la medianoche del día del turno; marca &quot;día siguiente&quot;
              para turnos que cruzan la medianoche. La zona horaria es la del centro de cada
              persona.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TemplateEditor templateId={template.id} initial={editorValue} />
          </CardContent>
        </Card>

        {draft ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Publicar el borrador</CardTitle>
              <CardDescription>
                Se avisará a las personas con asignaciones vigentes que usan esta plantilla.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {draftProblems.length > 0 ? (
                <ul className="text-destructive grid gap-1 text-sm">
                  {draftProblems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : null}
              <PublishVersionForm versionId={draft.id} today={today} />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
