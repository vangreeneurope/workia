import "server-only";

import { cache } from "react";

import { getUserContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

import {
  resolvePlannedRange,
  resolvePlannedShift,
  type PlannedShift,
  type ScheduleSnapshot,
  type SnapshotTemplate,
} from "./resolver";
import type { SegmentKind, ShiftKind } from "./template-rules";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type ScheduleEmployee = {
  id: string;
  companyId: string;
  code: string;
  label: string;
  teamId: string | null;
  workCenterId: string | null;
  endDate: string | null;
  timeZone: string;
};

/**
 * Ficha mínima de una persona si el usuario actual puede verla (RLS decide:
 * ella misma, su manager vigente o quien tenga permiso en su ámbito).
 */
export const getScheduleEmployee = cache(
  async (employeeId: string): Promise<ScheduleEmployee | null> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("employees")
      .select(
        "id, company_id, employee_code, first_name, last_name, team_id, work_center_id, end_date, work_centers (timezone), companies (timezone)",
      )
      .eq("id", employeeId)
      .maybeSingle();
    if (!data) return null;
    return {
      id: data.id,
      companyId: data.company_id,
      code: data.employee_code,
      label: `${data.first_name} ${data.last_name}`,
      teamId: data.team_id,
      workCenterId: data.work_center_id,
      endDate: data.end_date,
      // La zona del centro manda; si no hay centro, la de la empresa.
      timeZone: data.work_centers?.timezone ?? data.companies?.timezone ?? "Europe/Madrid",
    };
  },
);

/** Ficha propia en la empresa activa (null si no es empleado en ella). */
export async function getOwnEmployeeId(): Promise<string | null> {
  const user = await getUserContext();
  const membershipId = user.memberships.find(
    (m) => m.company.id === user.activeCompanyId,
  )?.membershipId;
  if (!membershipId) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("employees")
    .select("id")
    .eq("membership_id", membershipId)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Foto de los datos que necesita el resolvedor para [from, to]. Se lee con el
 * cliente del usuario: si RLS oculta algo, simplemente no aparece (y el
 * resolvedor no inventa nada).
 */
export async function loadScheduleSnapshot(
  supabase: Supabase,
  employee: ScheduleEmployee,
  from: string,
  to: string,
): Promise<ScheduleSnapshot> {
  const overlaps = `valid_to.is.null,valid_to.gt.${from}`;
  const subject = employee.teamId
    ? `employee_id.eq.${employee.id},team_id.eq.${employee.teamId}`
    : `employee_id.eq.${employee.id}`;

  const [termsRes, assignmentsRes, leavesRes, linksRes, globalCalendarsRes] = await Promise.all([
    supabase
      .from("employment_terms")
      .select("id, valid_from, valid_to")
      .eq("employee_id", employee.id)
      .eq("status", "active")
      .lte("valid_from", to)
      .or(overlaps),
    supabase
      .from("shift_assignments")
      .select(
        "id, scope_type, employment_terms_id, valid_from, valid_to, cycle_days, anchor_date, shift_assignment_days (day_index, template_id)",
      )
      .eq("status", "published")
      .or(subject)
      .lte("valid_from", to),
    supabase
      .from("leave_periods")
      .select("starts_on, ends_on")
      .eq("employee_id", employee.id)
      .eq("status", "approved")
      .lte("starts_on", to)
      .gte("ends_on", from),
    employee.workCenterId
      ? supabase
          .from("work_center_holiday_calendars")
          .select("calendar_id, valid_from, valid_to")
          .eq("work_center_id", employee.workCenterId)
          .lte("valid_from", to)
          .or(overlaps)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("holiday_calendars")
      .select("id")
      .eq("company_id", employee.companyId)
      .eq("applies_to_all_centers", true)
      .eq("status", "active"),
  ]);
  for (const res of [termsRes, assignmentsRes, leavesRes, linksRes, globalCalendarsRes]) {
    if (res.error) throw new Error("No se pudo cargar el horario.");
  }

  const assignments = (assignmentsRes.data ?? [])
    .filter((a) => a.valid_to === null || a.valid_to > from)
    .map((a) => {
      const days: (string | null)[] = Array.from({ length: a.cycle_days }, () => null);
      for (const d of a.shift_assignment_days) days[d.day_index] = d.template_id;
      return {
        id: a.id,
        scope: a.scope_type,
        employmentTermsId: a.employment_terms_id,
        validFrom: a.valid_from,
        validTo: a.valid_to,
        cycleDays: a.cycle_days,
        anchorDate: a.anchor_date,
        days,
      };
    });

  const templateIds = [...new Set(assignments.flatMap((a) => a.days.filter((d) => d !== null)))];
  const templates: Record<string, SnapshotTemplate> = {};
  if (templateIds.length > 0) {
    const { data, error } = await supabase
      .from("shift_templates")
      .select(
        "id, code, name, shift_template_versions (id, version, kind, target_minutes, tolerance_early_minutes, tolerance_late_minutes, flex_window_start, flex_window_end, status, valid_from, valid_to, shift_template_segments (start_minute, end_minute, kind, paid))",
      )
      .in("id", templateIds);
    if (error) throw new Error("No se pudieron cargar las plantillas.");
    for (const t of data ?? []) {
      templates[t.id] = {
        id: t.id,
        code: t.code,
        name: t.name,
        versions: t.shift_template_versions
          .filter((v) => v.status === "published" && v.valid_from !== null)
          .map((v) => ({
            id: v.id,
            version: v.version,
            kind: v.kind as ShiftKind,
            targetMinutes: v.target_minutes,
            toleranceEarlyMinutes: v.tolerance_early_minutes,
            toleranceLateMinutes: v.tolerance_late_minutes,
            flexWindowStart: v.flex_window_start,
            flexWindowEnd: v.flex_window_end,
            validFrom: v.valid_from as string,
            validTo: v.valid_to,
            segments: v.shift_template_segments.map((s) => ({
              startMinute: s.start_minute,
              endMinute: s.end_minute,
              kind: s.kind as SegmentKind,
              paid: s.paid,
            })),
          })),
      };
    }
  }

  // Festivos: calendarios aplicados al centro (con su vigencia) y los de toda la empresa.
  const links = linksRes.data ?? [];
  const globalIds = (globalCalendarsRes.data ?? []).map((c) => c.id);
  const calendarIds = [...new Set([...links.map((l) => l.calendar_id), ...globalIds])];
  let holidays: ScheduleSnapshot["holidays"] = [];
  if (calendarIds.length > 0) {
    const { data, error } = await supabase
      .from("holidays")
      .select("calendar_id, holiday_date, name, holiday_calendars (status)")
      .in("calendar_id", calendarIds)
      .eq("status", "active")
      .gte("holiday_date", from)
      .lte("holiday_date", to)
      .order("holiday_date");
    if (error) throw new Error("No se pudieron cargar los festivos.");
    holidays = (data ?? [])
      .filter((h) => h.holiday_calendars?.status === "active")
      .filter(
        (h) =>
          globalIds.includes(h.calendar_id) ||
          links.some(
            (l) =>
              l.calendar_id === h.calendar_id &&
              l.valid_from <= h.holiday_date &&
              (l.valid_to === null || h.holiday_date < l.valid_to),
          ),
      )
      .map((h) => ({ date: h.holiday_date, name: h.name }));
  }

  return {
    employeeId: employee.id,
    timeZone: employee.timeZone,
    endDate: employee.endDate,
    terms: (termsRes.data ?? []).map((t) => ({
      id: t.id,
      validFrom: t.valid_from,
      validTo: t.valid_to,
    })),
    assignments,
    templates,
    holidays,
    leaves: (leavesRes.data ?? []).map((l) => ({ startsOn: l.starts_on, endsOn: l.ends_on })),
  };
}

/** Horario planificado de [from, to] para una persona visible por el usuario actual. */
export async function getPlannedSchedule(
  employeeId: string,
  from: string,
  to: string,
): Promise<{ employee: ScheduleEmployee; days: PlannedShift[] } | null> {
  const employee = await getScheduleEmployee(employeeId);
  if (!employee) return null;
  const supabase = await createClient();
  const snapshot = await loadScheduleSnapshot(supabase, employee, from, to);
  return { employee, days: resolvePlannedRange(employeeId, from, to, snapshot) };
}

/** resolvePlannedShift(employeeId, localDate) con los datos que el usuario puede ver. */
export async function getPlannedShift(
  employeeId: string,
  localDate: string,
): Promise<PlannedShift | null> {
  const employee = await getScheduleEmployee(employeeId);
  if (!employee) return null;
  const supabase = await createClient();
  const snapshot = await loadScheduleSnapshot(supabase, employee, localDate, localDate);
  return resolvePlannedShift(employeeId, localDate, snapshot);
}
