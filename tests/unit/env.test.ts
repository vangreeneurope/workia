import { afterEach, describe, expect, it, vi } from "vitest";

describe("getPublicEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("falla con un mensaje claro si faltan variables", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const { getPublicEnv } = await import("@/lib/env");
    expect(() => getPublicEnv()).toThrow(/Configuración incompleta/);
  });

  it("acepta una configuración válida", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proyecto.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_abcdefghijklmnopqrstuvwxyz");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const { getPublicEnv } = await import("@/lib/env");
    expect(getPublicEnv()).toMatchObject({
      NEXT_PUBLIC_SUPABASE_URL: "https://proyecto.supabase.co",
      NEXT_PUBLIC_SITE_URL: undefined,
    });
  });
});
