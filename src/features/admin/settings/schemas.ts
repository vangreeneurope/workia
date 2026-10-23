import { z } from "zod";

import { MAX_SESSION_MINUTES, MIN_SESSION_MINUTES } from "@/lib/auth/session-limit";

/** Administración › Configuración (ADR-067). */
export const sessionSettingsSchema = z.object({
  session_max_minutes: z.coerce
    .number({ message: "Indica los minutos" })
    .int("Indica un número entero de minutos")
    .min(MIN_SESSION_MINUTES, `Mínimo ${MIN_SESSION_MINUTES} minutos`)
    .max(MAX_SESSION_MINUTES, `Máximo ${MAX_SESSION_MINUTES} minutos (12 horas)`),
});
