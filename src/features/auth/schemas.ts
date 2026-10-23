import { z } from "zod";

export const signInSchema = z.object({
  email: z.email("Introduce un correo electrónico válido").trim().toLowerCase(),
  password: z.string().min(1, "Introduce tu contraseña").max(200),
  siguiente: z.string().max(500).optional(),
});

export const passwordResetRequestSchema = z.object({
  email: z.email("Introduce un correo electrónico válido").trim().toLowerCase(),
});

/** Política mínima de contraseñas (alineada con la configuración de Supabase Auth). */
export const newPasswordSchema = z
  .object({
    password: z
      .string()
      .min(12, "La contraseña debe tener al menos 12 caracteres")
      .max(128, "La contraseña es demasiado larga")
      .regex(/[a-z]/, "Incluye al menos una minúscula")
      .regex(/[A-Z]/, "Incluye al menos una mayúscula")
      .regex(/[0-9]/, "Incluye al menos un número"),
    confirmacion: z.string(),
  })
  .refine((data) => data.password === data.confirmacion, {
    message: "Las contraseñas no coinciden",
    path: ["confirmacion"],
  });

export { initialFormState, type FormState } from "@/lib/forms";
