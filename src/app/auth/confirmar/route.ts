import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { safeRedirectPath } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_TYPES: readonly EmailOtpType[] = ["invite", "recovery", "email", "email_change"];

/**
 * Destino de los enlaces de correo de Supabase Auth (invitación, recuperación
 * de contraseña, cambio de email). Plantillas de correo: ver docs/ARQUITECTURA.md.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (tokenHash && type && ALLOWED_TYPES.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      const destination =
        type === "invite" || type === "recovery"
          ? "/perfil/contrasena"
          : safeRedirectPath(searchParams.get("siguiente"));
      return NextResponse.redirect(new URL(destination, request.url));
    }
  }

  return NextResponse.redirect(new URL("/acceder?error=enlace", request.url));
}
