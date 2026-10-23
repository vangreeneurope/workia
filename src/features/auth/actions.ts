"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUserId } from "@/lib/auth/dal";
import { LOGIN_PATH, safeRedirectPath } from "@/lib/auth/routes";
import { getPublicEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

import {
  newPasswordSchema,
  passwordResetRequestSchema,
  signInSchema,
  type FormState,
} from "./schemas";

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    siguiente: formData.get("siguiente") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Mensaje genérico: no revelar si el correo existe. Sin el correo en el registro.
    if (error.status === 429) log.security("auth.signin_rate_limited", {});
    const message =
      error.status === 429
        ? "Demasiados intentos. Espera unos minutos y vuelve a probar."
        : "Correo o contraseña incorrectos.";
    return { status: "error", message };
  }

  // Con segundo factor configurado, la sesión no está completa hasta verificarlo.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    redirect(`/perfil/seguridad?motivo=verificar`);
  }

  redirect(safeRedirectPath(parsed.data.siguiente));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(LOGIN_PATH);
}

export async function requestPasswordReset(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = passwordResetRequestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { status: "error", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const env = getPublicEnv();
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: env.NEXT_PUBLIC_SITE_URL ? `${env.NEXT_PUBLIC_SITE_URL}/auth/confirmar` : undefined,
  });

  if (error?.status === 429) {
    return { status: "error", message: "Demasiadas solicitudes. Espera unos minutos." };
  }
  // Misma respuesta exista o no la cuenta.
  return {
    status: "success",
    message:
      "Si el correo pertenece a una cuenta, recibirás un enlace para crear una nueva contraseña.",
  };
}

export async function updatePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUserId();
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmacion: formData.get("confirmacion"),
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const supabase = await createClient();
  // Step-up: con segundo factor configurado, cambiar la contraseña exige haberlo verificado.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    return {
      status: "error",
      message: "Verifica antes tu segundo factor (Mi perfil › Seguridad de la cuenta).",
    };
  }
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    log.warn("auth.password_update_failed", { code: error.code ?? "unknown" });
    return {
      status: "error",
      message:
        error.code === "same_password"
          ? "La nueva contraseña debe ser distinta de la anterior."
          : "No se pudo actualizar la contraseña. Inténtalo de nuevo.",
    };
  }
  return { status: "success", message: "Contraseña actualizada correctamente." };
}
