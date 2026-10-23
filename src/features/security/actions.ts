"use server";

import { refresh } from "next/cache";

import { FORBIDDEN, MFA_REQUIRED } from "@/features/admin/action-helpers";
import { getUserContext, requireUserId } from "@/lib/auth/dal";
import { mfaPending } from "@/lib/auth/permissions";
import { dbErrorState } from "@/lib/db-errors";
import { formToObject, validate, type FormState } from "@/lib/forms";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

import {
  completeRequestSchema,
  dataRequestSchema,
  factorSchema,
  grantIdSchema,
  holdIdSchema,
  legalHoldSchema,
  reviewRequestSchema,
  supportGrantSchema,
  totpCodeSchema,
} from "./schemas";

/*
 * Seguridad de la cuenta (segundo factor) y privacidad. La identidad sale de
 * la sesión; la empresa, de la empresa activa del servidor. La base de datos
 * decide quién puede qué (permisos con MFA, ADR-053) y lo audita.
 */

const TOO_MANY: FormState = {
  status: "error",
  message: "Demasiados intentos seguidos: espera unos minutos y vuelve a intentarlo.",
};

async function limit(supabase: Supabase, action: "mfa"): Promise<boolean> {
  const { error } = await supabase.rpc("check_rate_limit", { p_action: action });
  return !error;
}

export type EnrollState = FormState & { factorId?: string; qr?: string; secret?: string };

/** Alta de una aplicación de autenticación (TOTP). Devuelve el QR para escanearlo. */
export async function startTotpEnrollment(_prev: EnrollState, _fd: FormData): Promise<EnrollState> {
  await requireUserId();
  const supabase = await createClient();
  if (!(await limit(supabase, "mfa"))) return TOO_MANY;
  // Los altas sin terminar se descartan antes de crear otra.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Aplicación ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error || !data || data.type !== "totp") {
    log.warn("mfa.enroll_failed", { code: error?.code ?? "unknown" });
    return {
      status: "error",
      message:
        "No se pudo iniciar el alta. Si persiste, la verificación en dos pasos puede no estar activada en este entorno.",
    };
  }
  return { status: "success", factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/** Verifica un código (alta o paso adicional): la sesión pasa a aal2. */
export async function verifyTotp(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUserId();
  const parsed = validate(totpCodeSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const supabase = await createClient();
  if (!(await limit(supabase, "mfa"))) return TOO_MANY;
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factor_id,
    code: parsed.data.code,
  });
  if (error) {
    log.security("mfa.verify_failed", { code: error.code ?? "unknown" });
    return {
      status: "error",
      message: "El código no es correcto o ha caducado. Prueba con el siguiente.",
    };
  }
  refresh();
  return { status: "success", message: "Verificación en dos pasos completada." };
}

/** Elimina un factor. Exige la sesión ya verificada con segundo factor (step-up). */
export async function removeFactor(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUserId();
  const parsed = validate(factorSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const supabase = await createClient();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") return MFA_REQUIRED;
  const { error } = await supabase.auth.mfa.unenroll({ factorId: parsed.data.factor_id });
  if (error) return { status: "error", message: "No se pudo eliminar el factor." };
  log.security("mfa.factor_removed", {});
  refresh();
  return { status: "success", message: "Factor eliminado." };
}

// -----------------------------------------------------------------------------
// Derechos de las personas
// -----------------------------------------------------------------------------

export async function submitDataRequest(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getUserContext();
  if (!ctx.activeCompanyId) return FORBIDDEN;
  const parsed = validate(dataRequestSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_data_request", {
    p_company: ctx.activeCompanyId,
    p_kind: parsed.data.kind,
    p_details: parsed.data.details ?? "",
    p_idempotency_key: parsed.data.idempotency_key,
  });
  if (error) return dbErrorState(error);
  refresh();
  return {
    status: "success",
    message: "Solicitud registrada. Te responderemos en el plazo legal (un mes, ampliable).",
  };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;
type PrivacyScope =
  { ok: false; state: FormState } | { ok: true; companyId: string; supabase: Supabase };

/** Acciones de quien gestiona privacidad: exigen sesión con segundo factor. */
async function privacyContext(): Promise<PrivacyScope> {
  const ctx = await getUserContext();
  if (!ctx.activeCompanyId) return { ok: false, state: FORBIDDEN };
  if (mfaPending(ctx)) return { ok: false, state: MFA_REQUIRED };
  return { ok: true, companyId: ctx.activeCompanyId, supabase: await createClient() };
}

export async function reviewDataRequest(_prev: FormState, formData: FormData): Promise<FormState> {
  const c = await privacyContext();
  if (!c.ok) return c.state;
  const parsed = validate(reviewRequestSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const { error } = await c.supabase.rpc("review_data_request", {
    p_request: parsed.data.request_id,
    p_status: parsed.data.status,
    p_note: parsed.data.note ?? "",
  });
  if (error) return dbErrorState(error);
  refresh();
  return { status: "success", message: "Decisión registrada." };
}

export async function completeDataRequest(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const c = await privacyContext();
  if (!c.ok) return c.state;
  const parsed = validate(completeRequestSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const { error } = await c.supabase.rpc("complete_data_request", {
    p_request: parsed.data.request_id,
    p_note: parsed.data.note ?? "",
  });
  if (error) return dbErrorState(error);
  refresh();
  return { status: "success", message: "Solicitud completada." };
}

export async function placeLegalHold(_prev: FormState, formData: FormData): Promise<FormState> {
  const c = await privacyContext();
  if (!c.ok) return c.state;
  const parsed = validate(legalHoldSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const { error } = await c.supabase.rpc("place_legal_hold", {
    p_company: c.companyId,
    p_category: parsed.data.category,
    p_reason: parsed.data.reason,
    p_employee: parsed.data.employee_id ?? undefined,
  });
  if (error) return dbErrorState(error);
  refresh();
  return {
    status: "success",
    message: "Retención legal activada: la retención automática no tocará esos datos.",
  };
}

export async function releaseLegalHold(_prev: FormState, formData: FormData): Promise<FormState> {
  const c = await privacyContext();
  if (!c.ok) return c.state;
  const parsed = validate(holdIdSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const { error } = await c.supabase.rpc("release_legal_hold", { p_hold: parsed.data.hold_id });
  if (error) return dbErrorState(error);
  refresh();
  return { status: "success", message: "Retención legal levantada." };
}

export async function grantSupportAccess(_prev: FormState, formData: FormData): Promise<FormState> {
  const c = await privacyContext();
  if (!c.ok) return c.state;
  const parsed = validate(supportGrantSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const { error } = await c.supabase.rpc("grant_support_access", {
    p_company: c.companyId,
    p_support_user: parsed.data.support_user_id,
    p_reason: parsed.data.reason,
    p_hours: parsed.data.hours,
  });
  if (error) return dbErrorState(error);
  log.security("support.access_granted", { hours: parsed.data.hours });
  refresh();
  return {
    status: "success",
    message: "Acceso de soporte concedido. Caduca solo; puedes revocarlo antes.",
  };
}

export async function revokeSupportAccess(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const c = await privacyContext();
  if (!c.ok) return c.state;
  const parsed = validate(grantIdSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const { error } = await c.supabase.rpc("revoke_support_access", {
    p_grant: parsed.data.grant_id,
  });
  if (error) return dbErrorState(error);
  refresh();
  return { status: "success", message: "Acceso de soporte revocado." };
}
