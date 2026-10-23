import {
  DEFAULT_SESSION_MINUTES,
  isExpired,
  mayHaveExpired,
  sessionDeadline,
  sessionMinutes,
  sessionStartedAt,
} from "@/lib/auth/session-limit";

const MIN = 60 * 1000;

describe("duración máxima de la sesión", () => {
  it("la entrada es la marca más antigua de amr (el segundo factor no alarga la sesión)", () => {
    const claims = {
      amr: [
        { method: "totp", timestamp: 1_800_000_600 },
        { method: "password", timestamp: 1_800_000_000 },
      ],
      iat: 1_800_003_000,
    };
    expect(sessionStartedAt(claims)).toBe(1_800_000_000_000);
  });

  it("sin amr válido no se conoce la entrada (no se usa iat, que cambia al refrescar)", () => {
    expect(sessionStartedAt({ iat: 1_800_000_000 })).toBeNull();
    expect(sessionStartedAt({ amr: ["password"] })).toBeNull();
    expect(sessionStartedAt(null)).toBeNull();
  });

  it("acota los minutos y usa 60 si no llegan", () => {
    expect(sessionMinutes(30)).toBe(30);
    expect(sessionMinutes(5)).toBe(15);
    expect(sessionMinutes(10_000)).toBe(720);
    expect(sessionMinutes(null)).toBe(DEFAULT_SESSION_MINUTES);
    expect(sessionMinutes(45.5)).toBe(DEFAULT_SESSION_MINUTES);
  });

  it("vence a los N minutos de entrar, aunque se esté usando", () => {
    const start = Date.parse("2026-10-23T08:00:00Z");
    expect(sessionDeadline(start, 60)).toBe(start + 60 * MIN);
    expect(isExpired(start, 60, start + 59 * MIN)).toBe(false);
    expect(isExpired(start, 60, start + 60 * MIN)).toBe(true);
    // Pestaña abierta desde ayer: vencida.
    expect(isExpired(start, 60, start + 24 * 60 * MIN)).toBe(true);
  });

  it("antes del mínimo configurable no hace falta consultar la base de datos", () => {
    const start = Date.parse("2026-10-23T08:00:00Z");
    expect(mayHaveExpired(start, start + 14 * MIN)).toBe(false);
    expect(mayHaveExpired(start, start + 15 * MIN)).toBe(true);
  });
});
