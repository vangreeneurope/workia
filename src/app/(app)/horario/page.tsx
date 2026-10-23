import { Bell, ChevronLeft, ChevronRight, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SelectField } from "@/components/admin/select-field";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  monthLabel,
  navigation,
  parseViewDate,
  viewRange,
  weekLabel,
  type CalendarView,
} from "@/features/schedules/calendar";
import { MonthView, PeriodSummary, WeekView } from "@/features/schedules/components/schedule-views";
import { describeScheduleEvent } from "@/features/schedules/events";
import {
  getOwnEmployeeId,
  getPlannedSchedule,
  getScheduleEmployee,
} from "@/features/schedules/queries";
import { todayIn } from "@/features/schedules/zoned-time";
import { pickParam, uuidParam } from "@/lib/admin/pagination";
import { requireSection } from "@/lib/auth/dal";
import { businessDate, formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Horario" };

const VIEWS = ["mes", "semana"] as const;

function href(params: { vista: CalendarView; fecha: string; persona?: string | null }) {
  const query = new URLSearchParams({ vista: params.vista, fecha: params.fecha });
  if (params.persona) query.set("persona", params.persona);
  return `/horario?${query.toString()}`;
}

export default async function HorarioPage({ searchParams }: PageProps<"/horario">) {
  const ctx = await requireSection("horario");
  const params = await searchParams;
  const view: CalendarView = pickParam(params.vista, VIEWS) ?? "semana";
  const requested = uuidParam(params.persona) ?? null;
  const supabase = await createClient();

  const [ownId, accessRes] = await Promise.all([
    getOwnEmployeeId(),
    ctx.activeCompanyId
      ? supabase.rpc("my_schedule_access", { p_company: ctx.activeCompanyId })
      : Promise.resolve({ data: [] }),
  ]);
  const seesOthers = (accessRes.data ?? []).length > 0 || ctx.supervisedCount > 0;

  // Personas cuyo horario puede consultar: RLS devuelve solo las de su ámbito o supervisadas.
  const { data: people } = seesOthers
    ? await supabase
        .from("employees")
        .select("id, first_name, last_name, employee_code")
        .or(`end_date.is.null,end_date.gte.${businessDate()}`)
        .order("last_name")
        .limit(500)
    : { data: [] };
  const options = (people ?? []).map((p) => ({
    value: p.id,
    label: `${p.last_name}, ${p.first_name} (${p.employee_code})`,
  }));

  const targetId = requested ?? ownId;
  if (requested && requested !== ownId && !options.some((o) => o.value === requested)) notFound();

  const employee = targetId ? await getScheduleEmployee(targetId) : null;
  const today = todayIn(employee?.timeZone ?? "Europe/Madrid");
  const date = parseViewDate(typeof params.fecha === "string" ? params.fecha : undefined, today);
  const { from, to } = viewRange(view, date);
  const { prev, next } = navigation(view, date);
  const schedule = employee ? await getPlannedSchedule(employee.id, from, to) : null;
  const persona = requested && requested !== ownId ? requested : null;
  const month = date.slice(0, 7);
  const periodDays =
    view === "mes"
      ? (schedule?.days ?? []).filter((d) => d.date.startsWith(month))
      : (schedule?.days ?? []);

  const { data: events } =
    employee && employee.id === ownId
      ? await supabase
          .from("schedule_events")
          .select("id, event_type, payload, created_at")
          .eq("employee_id", employee.id)
          .order("created_at", { ascending: false })
          .limit(5)
      : { data: [] };

  return (
    <>
      <PageHeader
        title="Horario"
        description={
          employee && persona
            ? `Horario planificado de ${employee.label} (${employee.code}).`
            : "Tu horario planificado: turnos, descansos y festivos."
        }
      />

      <div className="grid gap-4">
        {seesOthers && options.length > 0 ? (
          <form action="/horario" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="vista" value={view} />
            <input type="hidden" name="fecha" value={date} />
            <div className="min-w-60 flex-1 sm:flex-none">
              <SelectField
                name="persona"
                label="Persona"
                defaultValue={targetId ?? ""}
                placeholder={ownId ? undefined : "Elige una persona"}
                options={options}
              />
            </div>
            <Button type="submit" variant="outline">
              Ver horario
            </Button>
          </form>
        ) : null}

        {!employee ? (
          <Alert>
            <Info />
            <AlertTitle>No hay horario que mostrar</AlertTitle>
            <AlertDescription>
              {seesOthers
                ? "Elige una persona para ver su horario."
                : "No tienes ficha de empleado en la empresa activa."}
            </AlertDescription>
          </Alert>
        ) : (
          <Card>
            <CardHeader className="gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-lg first-letter:uppercase">
                  {view === "mes" ? monthLabel(date) : weekLabel(date)}
                </CardTitle>
                <nav aria-label="Vista del calendario" className="flex gap-1">
                  {VIEWS.map((v) => (
                    <Link
                      key={v}
                      href={href({ vista: v, fecha: date, persona })}
                      aria-current={v === view ? "page" : undefined}
                      className={cn(
                        "inline-flex min-h-11 items-center rounded-md border px-3 text-sm",
                        v === view ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                      )}
                    >
                      {v === "mes" ? "Mes" : "Semana"}
                    </Link>
                  ))}
                </nav>
              </div>
              <nav aria-label="Cambiar de periodo" className="flex flex-wrap items-center gap-2">
                <Link
                  href={href({ vista: view, fecha: prev, persona })}
                  className="hover:bg-accent inline-flex min-h-11 items-center gap-1 rounded-md border px-3 text-sm"
                >
                  <ChevronLeft className="size-4" aria-hidden />
                  {view === "mes" ? "Mes anterior" : "Semana anterior"}
                </Link>
                <Link
                  href={href({ vista: view, fecha: today, persona })}
                  className="hover:bg-accent inline-flex min-h-11 items-center rounded-md border px-3 text-sm"
                >
                  Hoy
                </Link>
                <Link
                  href={href({ vista: view, fecha: next, persona })}
                  className="hover:bg-accent inline-flex min-h-11 items-center gap-1 rounded-md border px-3 text-sm"
                >
                  {view === "mes" ? "Mes siguiente" : "Semana siguiente"}
                  <ChevronRight className="size-4" aria-hidden />
                </Link>
              </nav>
              <CardDescription>
                Horas en la zona horaria del centro ({employee.timeZone}). Los cambios de horario se
                publican con fecha de efecto: los días pasados no se recalculan.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6">
              {schedule ? (
                <>
                  {view === "mes" ? (
                    <MonthView days={schedule.days} month={month} today={today} />
                  ) : (
                    <WeekView days={schedule.days} today={today} />
                  )}
                  <PeriodSummary days={periodDays} />
                </>
              ) : null}
            </CardContent>
          </Card>
        )}

        {events && events.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bell className="size-4" aria-hidden /> Cambios recientes en tu horario
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-2 text-sm">
                {events.map((e) => (
                  <li key={e.id} className="flex flex-col sm:flex-row sm:gap-2">
                    <span className="text-muted-foreground">{formatDate(e.created_at)}</span>
                    <span>{describeScheduleEvent(e.event_type, e.payload)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
