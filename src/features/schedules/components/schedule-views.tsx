import { AlertTriangle, CalendarOff, Moon, Plane, Sun } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { isoWeekday, longDayLabel, WEEKDAYS_SHORT } from "../calendar";
import type { PlannedShift, PlannedStatus } from "../resolver";
import { SHIFT_KIND_LABELS } from "../template-rules";
import { formatDuration, formatMinute } from "../zoned-time";

const STATUS_LABELS: Record<PlannedStatus, string> = {
  work: "Turno",
  rest: "Descanso",
  holiday: "Festivo",
  unassigned: "Sin horario",
  no_contract: "Sin contrato vigente",
};

const LEVEL_LABELS: Record<string, string> = {
  exception: "Excepción individual",
  holiday: "Calendario laboral",
  employee: "Asignación individual",
  team: "Asignación del equipo",
  contract: "Patrón del contrato",
};

const STATUS_STYLES: Record<PlannedStatus, string> = {
  work: "bg-primary/10 border-primary/30",
  rest: "bg-muted border-transparent",
  holiday: "bg-amber-100 border-amber-300 dark:bg-amber-950 dark:border-amber-800",
  unassigned: "border-dashed",
  no_contract: "bg-muted/50 border-dashed text-muted-foreground",
};

function timeRange(day: PlannedShift): string | null {
  const first = day.segments[0];
  const last = day.segments.at(-1);
  if (!first || !last) return null;
  return `${formatMinute(first.startMinute)}–${formatMinute(last.endMinute)}`;
}

/** Texto corto para la celda del mes. */
function shortLabel(day: PlannedShift): string {
  if (day.status === "work") return day.template?.code ?? "";
  if (day.status === "rest") return "Libre";
  if (day.status === "holiday") return "Fest.";
  return "—";
}

/** Descripción accesible completa de un día (lectores de pantalla y título). */
export function dayDescription(day: PlannedShift): string {
  const parts = [longDayLabel(day.date), STATUS_LABELS[day.status]];
  if (day.template) parts.push(`${day.template.name} ${timeRange(day) ?? ""}`.trim());
  if (day.holiday) parts.push(`Festivo: ${day.holiday}`);
  if (day.absence) parts.push("Ausencia aprobada");
  return parts.join(". ");
}

export function MonthView({
  days,
  month,
  today,
}: {
  days: PlannedShift[];
  /** "AAAA-MM" del mes mostrado. */
  month: string;
  today: string;
}) {
  const weeks: PlannedShift[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return (
    <table className="w-full table-fixed border-separate border-spacing-1 text-sm">
      <caption className="sr-only">Calendario mensual</caption>
      <thead>
        <tr>
          {WEEKDAYS_SHORT.map((d, i) => (
            <th key={d} scope="col" className="text-muted-foreground py-1 text-xs font-medium">
              <abbr
                title={
                  ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"][i]
                }
              >
                {d}
              </abbr>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week[0]?.date}>
            {week.map((day) => {
              const outside = !day.date.startsWith(month);
              return (
                <td key={day.date} className="align-top">
                  <div
                    title={dayDescription(day)}
                    className={cn(
                      "flex min-h-14 flex-col gap-0.5 rounded-md border p-1 sm:min-h-20 sm:p-2",
                      STATUS_STYLES[day.status],
                      outside && "opacity-50",
                      day.date === today && "ring-ring ring-2",
                    )}
                  >
                    <span className="sr-only">{dayDescription(day)}</span>
                    <span aria-hidden className="flex items-center justify-between text-xs">
                      <span className={cn(day.date === today && "font-bold")}>
                        {Number(day.date.slice(8))}
                      </span>
                      {day.absence ? <Plane className="size-3" /> : null}
                    </span>
                    <span aria-hidden className="truncate text-xs font-medium sm:text-sm">
                      {shortLabel(day)}
                    </span>
                    {day.status === "work" ? (
                      <span
                        aria-hidden
                        className="text-muted-foreground hidden truncate text-xs sm:block"
                      >
                        {timeRange(day)}
                      </span>
                    ) : null}
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DayCard({ day, today }: { day: PlannedShift; today: string }) {
  const kindIcon =
    day.template?.kind === "night" ? (
      <Moon className="size-4" aria-hidden />
    ) : (
      <Sun className="size-4" aria-hidden />
    );
  return (
    <article
      aria-labelledby={`dia-${day.date}`}
      className={cn(
        "grid gap-2 rounded-lg border p-3",
        STATUS_STYLES[day.status],
        day.date === today && "ring-ring ring-2",
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`dia-${day.date}`} className="font-medium first-letter:uppercase">
          {longDayLabel(day.date)}
          {day.date === today ? (
            <span className="text-muted-foreground font-normal"> · hoy</span>
          ) : null}
        </h3>
        <div className="flex flex-wrap gap-1">
          <Badge variant={day.status === "work" ? "default" : "secondary"}>
            {STATUS_LABELS[day.status]}
          </Badge>
          {day.absence ? (
            <Badge variant="outline">
              <Plane aria-hidden /> Ausencia aprobada
            </Badge>
          ) : null}
        </div>
      </header>

      {day.status === "work" && day.template ? (
        <div className="grid gap-1 text-sm">
          <p className="flex items-center gap-2 font-medium">
            {kindIcon}
            {day.template.name} ({day.template.code}) · {SHIFT_KIND_LABELS[day.template.kind]}
          </p>
          <ul className="grid gap-0.5">
            {day.segments.map((s) => (
              <li key={s.startMinute} className={cn(s.kind === "break" && "text-muted-foreground")}>
                {formatMinute(s.startMinute)}–{formatMinute(s.endMinute)}{" "}
                {s.kind === "break" ? `pausa${s.paid ? " retribuida" : ""}` : "trabajo"}
              </li>
            ))}
          </ul>
          {day.flexWindow ? (
            <p>
              Ventana flexible: {formatMinute(day.flexWindow.startMinute)}–
              {formatMinute(day.flexWindow.endMinute)}
            </p>
          ) : null}
          <p className="text-muted-foreground">
            Horas objetivo: {formatDuration(day.targetMinutes)}
            {day.toleranceEarlyMinutes || day.toleranceLateMinutes
              ? ` · tolerancia ${day.toleranceEarlyMinutes} min antes / ${day.toleranceLateMinutes} min después`
              : ""}
          </p>
        </div>
      ) : null}

      {day.holiday ? (
        <p className="flex items-center gap-2 text-sm">
          <CalendarOff className="size-4" aria-hidden /> Festivo: {day.holiday}
        </p>
      ) : null}

      {day.notes.map((note) => (
        <p key={note} className="flex items-start gap-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {note}
        </p>
      ))}

      {day.source ? (
        <p className="text-muted-foreground text-xs">
          Origen: {LEVEL_LABELS[day.source.level]}
          {day.template ? ` · versión ${day.template.version}` : ""} · zona {day.timeZone}
        </p>
      ) : null}
    </article>
  );
}

export function WeekView({ days, today }: { days: PlannedShift[]; today: string }) {
  return (
    <div className="grid gap-2 lg:grid-cols-7">
      {days.map((day) => (
        <div key={day.date} className={cn(isoWeekday(day.date) >= 6 && "lg:opacity-90")}>
          <DayCard day={day} today={today} />
        </div>
      ))}
    </div>
  );
}

/** Resumen de horas objetivo del periodo (sin clasificar diferencias como horas extra). */
export function PeriodSummary({ days }: { days: PlannedShift[] }) {
  const worked = days.filter((d) => d.status === "work");
  const target = worked.reduce((sum, d) => sum + d.targetMinutes, 0);
  const holidays = days.filter((d) => d.status === "holiday").length;
  const absences = days.filter((d) => d.absence).length;
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      <div>
        <dt className="text-muted-foreground">Días con turno</dt>
        <dd className="text-lg font-semibold">{worked.length}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Horas objetivo</dt>
        <dd className="text-lg font-semibold">{formatDuration(target)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Festivos</dt>
        <dd className="text-lg font-semibold">{holidays}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Días con ausencia</dt>
        <dd className="text-lg font-semibold">{absences}</dd>
      </div>
    </dl>
  );
}
