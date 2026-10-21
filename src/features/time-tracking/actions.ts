"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";

import { adminAction, FORBIDDEN } from "@/features/admin/action-helpers";
import { getScheduleEmployee } from "@/features/schedules/queries";
import { zonedWallTimeToUtc } from "@/features/schedules/zoned-time";
import { getUserContext } from "@/lib/auth/dal";
import { canAccessSection } from "@/lib/auth/permissions";
import { dbErrorMessage, dbErrorState } from "@/lib/db-errors";
import { formToObject, validate, type FormState } from "@/lib/forms";
import { createAnonClient } from "@/lib/supabase/anon";
import { createClient } from "@/lib/supabase/server";

import {
  correctionRequestSchema,
  decisionSchema,
  incidentResolutionSchema,
  kioskActivationSchema,
  kioskDeviceSchema,
  kioskPunchSchema,
  pinSchema,
  policySchema,
  punchSchema,
} from "./schemas";
import { KIOSK_COOKIE } from "./constants";
import { sanitizeJpeg } from "./selfie";
import { PUNCH_LABELS, type PunchKind } from "./state-machine";

/*
 * Reglas comunes: la identidad sale siempre de la sesión (getUserContext) y la
 * empresa de la empresa activa; las funciones de la base de datos vuelven a
 * comprobar permisos, estados y política. Ningún mensaje ni registro incluye
 * PIN, coordenadas, fotos ni nombres.
 */

export type PunchResult = FormState & {
  punch?: { kind: PunchKind; serverAt: string; status: string; duplicate: boolean };
};

type PunchPayload = {
  punch_id: string;
  kind: PunchKind;
  server_at: string;
  status: string;
  duplicate: boolean;
};

function isPunchPayload(value: unknown): value is PunchPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).server_at === "string" &&
    typeof (value as Record<string, unknown>).kind === "string"
  );
}

/** Fichaje de la propia persona desde la aplicación (móvil o web). */
export async function punchAction(formData: FormData): Promise<PunchResult> {
  const ctx = await getUserContext();
  const companyId = ctx.activeCompanyId;
  if (!companyId || !canAccessSection(ctx, "fichajes")) return FORBIDDEN;
  const parsed = validate(punchSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const data = parsed.data;
  const supabase = await createClient();

  let selfiePath: string | undefined;
  const selfie = formData.get("selfie");
  if (selfie instanceof File && selfie.size > 0) {
    const sanitized = sanitizeJpeg(new Uint8Array(await selfie.arrayBuffer()));
    if (!sanitized.ok) return { status: "error", message: sanitized.error };
    const { data: me } = await supabase.rpc("my_time_status", { p_company: companyId });
    const employeeId = me?.[0]?.employee_id;
    if (!employeeId)
      return { status: "error", message: "No tienes ficha de empleado en esta empresa." };
    if (!me?.[0]?.selfie_enabled) {
      return { status: "error", message: "La selfie no está activada en tu empresa." };
    }
    selfiePath = `${companyId}/${employeeId}/${data.idempotency_key}.jpg`;
    const { error } = await supabase.storage
      .from("punch-selfies")
      .upload(selfiePath, sanitized.bytes, { contentType: "image/jpeg", upsert: false });
    // En un reintento con la misma clave la foto ya existe: es el mismo fichaje.
    if (error && !/exists|duplicate/i.test(error.message)) {
      return {
        status: "error",
        message: "No se pudo guardar la foto. Ficha sin ella o inténtalo de nuevo.",
      };
    }
  }

  const { data: result, error } = await supabase.rpc("record_punch", {
    p_company: companyId,
    p_kind: data.kind,
    p_idempotency_key: data.idempotency_key,
    p_source: data.source,
    p_device_at: data.device_at ?? undefined,
    p_device_id: data.device_id ?? undefined,
    p_location_status: data.location_status,
    p_latitude: data.latitude ?? undefined,
    p_longitude: data.longitude ?? undefined,
    p_accuracy_m: data.accuracy === null ? undefined : Math.round(data.accuracy),
    p_selfie_path: selfiePath,
  });
  if (error) return { status: "error", message: dbErrorMessage(error) };
  if (!isPunchPayload(result))
    return { status: "error", message: "Respuesta inesperada del servidor." };
  refresh();
  return {
    status: "success",
    message: result.duplicate
      ? `${PUNCH_LABELS[result.kind]} ya estaba registrada.`
      : `${PUNCH_LABELS[result.kind]} registrada.`,
    punch: {
      kind: result.kind,
      serverAt: result.server_at,
      status: result.status,
      duplicate: result.duplicate,
    },
  };
}

// ---------------------------------------------------------------------------
// Terminal compartido (identidad = token del dispositivo, ADR-036)
// ---------------------------------------------------------------------------

export async function activateKiosk(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = validate(kioskActivationSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const { data } = await createAnonClient().rpc("kiosk_device_info", {
    p_token: parsed.data.token,
  });
  if (!data?.length)
    return { status: "error", message: "El código no corresponde a ningún terminal activo." };
  const cookieStore = await cookies();
  cookieStore.set(KIOSK_COOKIE, parsed.data.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/terminal",
    maxAge: 60 * 60 * 24 * 365,
  });
  return { status: "success", message: "Terminal activado." };
}

export async function deactivateKiosk(): Promise<FormState> {
  const cookieStore = await cookies();
  cookieStore.delete({ name: KIOSK_COOKIE, path: "/terminal" });
  return { status: "success", message: "Terminal desactivado en este dispositivo." };
}

export type KioskResult = FormState & { kind?: PunchKind; serverAt?: string; timeZone?: string };

const KIOSK_MESSAGES: Record<string, string> = {
  invalid: "Código o PIN incorrectos.",
  locked: "Demasiados intentos. Espera 15 minutos o pide a RR. HH. que revise tu PIN.",
  device_blocked: "Terminal bloqueado temporalmente por demasiados intentos fallidos.",
  device_invalid: "Este terminal ya no está activo. Avisa a RR. HH.",
};

export async function kioskPunchAction(
  _prev: KioskResult,
  formData: FormData,
): Promise<KioskResult> {
  const token = (await cookies()).get(KIOSK_COOKIE)?.value;
  if (!token) return { status: "error", message: KIOSK_MESSAGES.device_invalid };
  const parsed = validate(kioskPunchSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const { data, error } = await createAnonClient().rpc("kiosk_punch", {
    p_token: token,
    p_employee_code: parsed.data.employee_code,
    p_pin: parsed.data.pin,
    p_kind: parsed.data.kind,
    p_idempotency_key: parsed.data.idempotency_key,
    p_device_at: parsed.data.device_at ?? undefined,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return { status: "error", message: "No se pudo fichar. Inténtalo de nuevo." };
  }
  const result = data as Record<string, unknown>;
  const status = String(result.status);
  if (status === "ok") {
    const kind = result.kind as PunchKind;
    return {
      status: "success",
      message: result.duplicate
        ? `${PUNCH_LABELS[kind]} ya estaba registrada.`
        : `${PUNCH_LABELS[kind]} registrada.`,
      kind,
      serverAt: String(result.server_at),
      timeZone: String(result.time_zone),
    };
  }
  if (status === "rejected") {
    // Mensajes redactados en la base de datos (transiciones): sin datos personales.
    const message = String(result.message ?? "");
    return {
      status: "error",
      message: /^[A-ZÁÉÍÓÚ]/.test(message) ? message : "Acción no permitida ahora.",
    };
  }
  return { status: "error", message: KIOSK_MESSAGES[status] ?? "No se pudo fichar." };
}

// ---------------------------------------------------------------------------
// PIN propio
// ---------------------------------------------------------------------------

export async function setMyPin(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getUserContext();
  if (!ctx.activeCompanyId) return FORBIDDEN;
  const parsed = validate(pinSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_my_kiosk_pin", {
    p_company: ctx.activeCompanyId,
    p_pin: parsed.data.pin,
  });
  if (error) return dbErrorState(error);
  return { status: "success", message: "PIN del terminal guardado." };
}

// ---------------------------------------------------------------------------
// Correcciones e incidencias
// ---------------------------------------------------------------------------

export async function requestCorrection(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getUserContext();
  if (!ctx.activeCompanyId) return FORBIDDEN;
  const parsed = validate(correctionRequestSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const data = parsed.data;
  // La zona sale de la ficha (visible solo si el usuario puede verla).
  const employee = await getScheduleEmployee(data.employee_id);
  if (!employee || employee.companyId !== ctx.activeCompanyId) return FORBIDDEN;
  let proposedAt: string | undefined;
  if (data.proposed_local) {
    const [date, clock] = data.proposed_local.split("T") as [string, string];
    const [hh, mm] = clock.split(":").map(Number) as [number, number];
    proposedAt = new Date(
      zonedWallTimeToUtc(employee.timeZone, date, hh * 60 + mm).epochMs,
    ).toISOString();
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_time_correction", {
    p_employee: data.employee_id,
    p_action: data.action,
    p_reason: data.reason,
    p_entry: data.entry_id ?? undefined,
    p_punch: data.punch_id ?? undefined,
    p_kind: data.action === "add" ? (data.kind ?? undefined) : undefined,
    p_proposed_at: data.action === "void" ? undefined : proposedAt,
  });
  if (error) return dbErrorState(error);
  refresh();
  return { status: "success", message: "Solicitud enviada. Tu aprobador la revisará." };
}

export async function cancelCorrection(id: string): Promise<FormState> {
  await getUserContext();
  const parsed = validate(z.object({ id: z.uuid() }), { id });
  if (!parsed.ok) return parsed.state;
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_time_correction", { p_request: parsed.data.id });
  if (error) return dbErrorState(error);
  refresh();
  return { status: "success", message: "Solicitud cancelada." };
}

export async function decideCorrection(_prev: FormState, formData: FormData): Promise<FormState> {
  await getUserContext();
  const parsed = validate(decisionSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_time_correction", {
    p_request: parsed.data.request_id,
    p_approve: parsed.data.decision === "approve",
    p_note: parsed.data.note ?? undefined,
  });
  if (error) return dbErrorState(error);
  refresh();
  return {
    status: "success",
    message:
      parsed.data.decision === "approve"
        ? "Corrección aprobada y jornada recalculada."
        : "Corrección rechazada.",
  };
}

export async function resolveIncident(_prev: FormState, formData: FormData): Promise<FormState> {
  await getUserContext();
  const parsed = validate(incidentResolutionSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_time_incident", {
    p_incident: parsed.data.incident_id,
    p_status: parsed.data.status,
    p_note: parsed.data.note,
  });
  if (error) return dbErrorState(error);
  refresh();
  return { status: "success", message: "Incidencia cerrada." };
}

// ---------------------------------------------------------------------------
// Administración: políticas, terminales y PIN
// ---------------------------------------------------------------------------

export async function savePolicy(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction("fichajes", policySchema, formData, async ({ ctx, data, supabase }) => {
    const values = {
      location_mode: data.location_mode,
      location_notice: data.location_notice,
      selfie_enabled: data.selfie_enabled,
    };
    let query = supabase
      .from("time_tracking_policies")
      .update(values)
      .eq("company_id", ctx.companyId);
    query = data.work_center_id
      ? query.eq("work_center_id", data.work_center_id)
      : query.is("work_center_id", null);
    const { data: rows, error } = await query.select("id");
    if (error) return dbErrorState(error);
    if (!rows?.length) {
      const { error: insertError } = await supabase.from("time_tracking_policies").insert({
        company_id: ctx.companyId,
        work_center_id: data.work_center_id,
        ...values,
      });
      if (insertError) return dbErrorState(insertError);
    }
    refresh();
    return { status: "success", message: "Política guardada. Se aplica a los próximos fichajes." };
  });
}

export type KioskRegistration = FormState & { token?: string };

export async function registerKiosk(
  _prev: KioskRegistration,
  formData: FormData,
): Promise<KioskRegistration> {
  return adminAction("fichajes", kioskDeviceSchema, formData, async ({ ctx, data, supabase }) => {
    const { data: center } = await supabase
      .from("work_centers")
      .select("id")
      .eq("id", data.work_center_id)
      .eq("company_id", ctx.companyId)
      .maybeSingle();
    if (!center) return FORBIDDEN;
    const { data: token, error } = await supabase.rpc("register_kiosk_device", {
      p_work_center: data.work_center_id,
      p_name: data.name,
    });
    if (error?.code === "23505")
      return { status: "error", message: "Ya hay un terminal con ese nombre." };
    if (error || !token) return dbErrorState(error ?? {});
    refresh();
    return {
      status: "success",
      message: "Terminal dado de alta. Copia el código ahora: no se volverá a mostrar.",
      token,
    };
  });
}

export async function setKioskStatus(input: {
  id: string;
  status: "active" | "inactive";
}): Promise<FormState> {
  return adminAction(
    "fichajes",
    z.object({ id: z.uuid(), status: z.enum(["active", "inactive"]) }),
    input,
    async ({ ctx, data, supabase }) => {
      const { data: rows, error } = await supabase
        .from("kiosk_devices")
        .update({ status: data.status, blocked_until: null })
        .eq("id", data.id)
        .eq("company_id", ctx.companyId)
        .select("id");
      if (error) return dbErrorState(error);
      if (!rows?.length) return FORBIDDEN;
      refresh();
      return { status: "success" };
    },
  );
}

export async function resetPin(employeeId: string): Promise<FormState> {
  return adminAction(
    "fichajes",
    z.object({ id: z.uuid() }),
    { id: employeeId },
    async ({ ctx, data, supabase }) => {
      const { data: employee } = await supabase
        .from("employees")
        .select("id")
        .eq("id", data.id)
        .eq("company_id", ctx.companyId)
        .maybeSingle();
      if (!employee) return FORBIDDEN;
      const { error } = await supabase.rpc("reset_kiosk_pin", { p_employee: data.id });
      if (error) return dbErrorState(error);
      return {
        status: "success",
        message: "PIN anulado. La persona debe definir uno nuevo en su perfil.",
      };
    },
  );
}

export async function resetPinForm(_prev: FormState, formData: FormData): Promise<FormState> {
  const employeeId = formData.get("employee_id");
  if (typeof employeeId !== "string" || !employeeId) {
    return {
      status: "error",
      message: "Elige una persona.",
      fieldErrors: { employee_id: ["Elige una persona"] },
    };
  }
  return resetPin(employeeId);
}
