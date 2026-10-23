import { dbErrorMessage } from "@/lib/db-errors";
import type { FormState } from "@/lib/forms";

type DbError = { code?: string; message?: string; hint?: string | null };

export type InviteDeps = {
  /** Cuenta existente con ese correo (cliente con clave secreta, solo lectura de profiles). */
  findUserIdByEmail: (email: string) => Promise<string | null>;
  /** Invitación por correo de Supabase Auth; devuelve el id de la nueva cuenta. */
  inviteUser: (
    email: string,
    fullName: string | null,
  ) => Promise<{ userId?: string; failed?: boolean }>;
  /** Alta de la membresía con la sesión del usuario (RLS decide si puede). */
  createMembership: (userId: string) => Promise<{ error?: DbError | null }>;
};

/**
 * Añade una persona a la empresa activa: reutiliza su cuenta si ya existe o la
 * invita por correo. Los mensajes no incluyen el correo (sin datos personales
 * en avisos ni registros).
 */
export async function addMemberFlow(
  deps: InviteDeps,
  input: { email: string; fullName: string | null },
): Promise<FormState> {
  let userId = await deps.findUserIdByEmail(input.email);
  let invited = false;
  if (!userId) {
    const result = await deps.inviteUser(input.email, input.fullName);
    if (result.failed || !result.userId) {
      return {
        status: "error",
        message: "No se pudo enviar la invitación. Revisa el correo e inténtalo de nuevo.",
      };
    }
    userId = result.userId;
    invited = true;
  }

  const { error } = await deps.createMembership(userId);
  if (error) {
    if (error.code === "23505") {
      return { status: "error", message: "Esa persona ya tiene una cuenta en esta empresa." };
    }
    return { status: "error", message: dbErrorMessage(error) };
  }
  return {
    status: "success",
    message: invited
      ? "Invitación enviada. La cuenta estará operativa cuando la persona cree su contraseña."
      : "La persona ya tenía cuenta en el grupo: se ha añadido a esta empresa.",
  };
}
