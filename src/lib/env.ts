import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ message: "NEXT_PUBLIC_SUPABASE_URL debe ser una URL válida" }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string({ message: "Falta NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" })
    .min(20, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY no parece una clave válida"),
  NEXT_PUBLIC_SITE_URL: z.url().optional(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

let cached: PublicEnv | undefined;

/**
 * Variables públicas validadas. Se evalúa de forma perezosa para que el build
 * no dependa de ellas; un valor ausente falla en la primera petición con un
 * mensaje claro. Las referencias deben ser literales para que Next.js las
 * incruste en el bundle del navegador.
 */
export function getPublicEnv(): PublicEnv {
  if (cached) return cached;
  const result = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
  });
  if (!result.success) {
    const detail = result.error.issues.map((issue) => `- ${issue.message}`).join("\n");
    throw new Error(`Configuración incompleta. Revisa .env.local (ver .env.example):\n${detail}`);
  }
  cached = result.data;
  return cached;
}
