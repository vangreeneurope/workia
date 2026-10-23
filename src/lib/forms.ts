import { z } from "zod";

/** Estado devuelto por las Server Actions de formularios. */
export type FormState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
};

export const initialFormState: FormState = { status: "idle" };

/** FormData -> objeto plano de strings (los campos repetidos se quedan con el último valor). */
export function formToObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$ACTION")) out[key] = value;
  }
  return out;
}

/** Valida con el mismo esquema en cliente y en servidor. */
export function validate<T extends z.ZodType>(
  schema: T,
  data: unknown,
): { ok: true; data: z.infer<T> } | { ok: false; state: FormState } {
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    state: {
      status: "error",
      message: "Revisa los campos marcados.",
      fieldErrors: z.flattenError(result.error).fieldErrors as Record<string, string[]>,
    },
  };
}

// Piezas reutilizables para esquemas que reciben strings de formularios.
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .optional()
    .transform((v) => (v ? v : null));

export const requiredText = (min: number, max: number, label: string) =>
  z
    .string({ message: `${label} es obligatorio` })
    .trim()
    .min(min, min <= 1 ? `${label} es obligatorio` : `${label}: mínimo ${min} caracteres`)
    .max(max, `${label}: máximo ${max} caracteres`);

export const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.uuid({ message: "Selección no válida" }).nullable());

export const requiredUuid = (label: string) => z.uuid({ message: `Selecciona ${label}` });
