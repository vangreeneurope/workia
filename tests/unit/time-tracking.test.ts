import { describe, expect, it } from "vitest";

import { statusFromError, toReading } from "@/features/time-tracking/geolocation";
import {
  enqueue,
  flushQueue,
  loadQueue,
  saveQueue,
  type PendingPunch,
  type QueueStorage,
  type SendResult,
} from "@/features/time-tracking/offline-queue";
import {
  correctionRequestSchema,
  kioskPunchSchema,
  pinSchema,
  policySchema,
  punchSchema,
} from "@/features/time-tracking/schemas";
import { sanitizeJpeg, SELFIE_MAX_BYTES } from "@/features/time-tracking/selfie";
import { allowedPunches, replay, transition } from "@/features/time-tracking/state-machine";

const KEY = (n: number) => `4b000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("máquina de estados (igual que private.punch_transition)", () => {
  it("solo permite las transiciones posibles", () => {
    expect(transition(null, "start")).toBe("open");
    expect(transition("open", "break_start")).toBe("on_break");
    expect(transition("on_break", "break_end")).toBe("open");
    expect(transition("open", "end")).toBe("closed");
    expect(transition(null, "end")).toBeNull();
    expect(transition("open", "start")).toBeNull();
    expect(transition("on_break", "end")).toBeNull();
    expect(transition("open", "break_end")).toBeNull();
  });

  it("ofrece solo los botones válidos", () => {
    expect(allowedPunches(null)).toEqual(["start"]);
    expect(allowedPunches("open")).toEqual(["break_start", "end"]);
    expect(allowedPunches("on_break")).toEqual(["break_end"]);
  });

  it("valida secuencias completas", () => {
    expect(replay(["start", "break_start", "break_end", "end"])).toBe("closed");
    expect(replay(["start", "start"])).toBe("invalid");
    expect(replay(["start", "end", "end"])).toBe("invalid");
    expect(replay(["start", "break_start"])).toBe("on_break");
  });
});

function memoryStorage(initial: string | null = null): QueueStorage & { value: string | null } {
  return {
    value: initial,
    get() {
      return this.value;
    },
    set(v: string) {
      this.value = v;
    },
  };
}

const pending = (n: number, kind: PendingPunch["kind"]): PendingPunch => ({
  key: KEY(n),
  kind,
  deviceAt: "2026-10-21T07:00:00.000Z",
  source: "mobile",
  attempts: 0,
});

describe("cola sin conexión", () => {
  it("un doble toque con la misma clave no se encola dos veces", () => {
    const q = enqueue(enqueue([], pending(1, "start")), pending(1, "start"));
    expect(q).toHaveLength(1);
  });

  it("reintenta con la misma clave y conserva el orden", async () => {
    const queue = [pending(1, "start"), pending(2, "break_start")];
    const sentKeys: string[] = [];
    let online = false;
    const send = async (p: PendingPunch): Promise<SendResult> => {
      if (!online) return { type: "network" };
      sentKeys.push(p.key);
      return { type: "ok" };
    };
    const offline = await flushQueue(queue, send);
    expect(offline.remaining.map((p) => p.key)).toEqual([KEY(1), KEY(2)]);
    expect(offline.remaining[0]?.attempts).toBe(1);
    online = true;
    const back = await flushQueue(offline.remaining, send);
    expect(back.remaining).toEqual([]);
    expect(sentKeys).toEqual([KEY(1), KEY(2)]);
  });

  it("un rechazo del servidor se retira e informa; un corte de red detiene el envío", async () => {
    const queue = [pending(1, "start"), pending(2, "start"), pending(3, "end")];
    let calls = 0;
    const result = await flushQueue(queue, async () => {
      calls += 1;
      if (calls === 1) return { type: "ok" };
      if (calls === 2) return { type: "rejected", message: "Ya tienes una jornada abierta" };
      return { type: "network" };
    });
    expect(result.sent.map((p) => p.key)).toEqual([KEY(1)]);
    expect(result.rejected[0]?.message).toMatch(/jornada abierta/);
    expect(result.remaining.map((p) => p.key)).toEqual([KEY(3)]);
  });

  it("persiste sin ubicación ni foto e ignora datos corruptos", () => {
    const storage = memoryStorage();
    saveQueue(storage, [pending(1, "start")]);
    expect(storage.value).not.toMatch(/latitude|selfie/);
    expect(loadQueue(storage)).toHaveLength(1);
    expect(loadQueue(memoryStorage("no es json"))).toEqual([]);
    expect(loadQueue(memoryStorage('[{"key":"x","kind":"start"}]'))).toEqual([]);
  });
});

/** JPEG mínimo: SOI, APP0 (JFIF), APP1 (EXIF con "GPS"), COM, SOS + datos, EOI. */
function jpegWithExif(): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x07, 0x4a, 0x46, 0x49, 0x46, 0x00];
  const gps = [...new TextEncoder().encode("Exif GPS 40.4168 -3.7038")];
  const app1 = [0xff, 0xe1, 0x00, gps.length + 2, ...gps];
  const com = [0xff, 0xfe, 0x00, 0x05, 0x61, 0x62, 0x63];
  const sos = [0xff, 0xda, 0x00, 0x04, 0x01, 0x00, 0x12, 0x34, 0x56];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...app1, ...com, ...sos, 0xff, 0xd9]);
}

describe("selfie", () => {
  it("elimina metadatos (EXIF con GPS y comentarios) y conserva la imagen", () => {
    const result = sanitizeJpeg(jpegWithExif());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = new TextDecoder().decode(result.bytes);
    expect(text).not.toMatch(/GPS|Exif/);
    expect(text).toMatch(/JFIF/);
    expect(Array.from(result.bytes.slice(-2))).toEqual([0xff, 0xd9]);
  });

  it("rechaza lo que no es JPEG, lo vacío y lo demasiado grande", () => {
    expect(sanitizeJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toEqual({
      ok: false,
      error: "La foto debe ser JPEG.",
    });
    expect(sanitizeJpeg(new Uint8Array())).toMatchObject({ ok: false });
    expect(sanitizeJpeg(new Uint8Array(SELFIE_MAX_BYTES + 1))).toEqual({
      ok: false,
      error: "La foto supera 2 MB.",
    });
    expect(sanitizeJpeg(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0xff]))).toMatchObject({
      ok: false,
    });
  });
});

describe("ubicación puntual", () => {
  it("traduce los errores del navegador al estado del permiso", () => {
    expect(statusFromError(1)).toBe("denied");
    expect(statusFromError(2)).toBe("unavailable");
    expect(statusFromError(3)).toBe("timeout");
  });

  it("redondea coordenadas y precisión", () => {
    expect(toReading({ latitude: 40.41677512, longitude: -3.70379049, accuracy: 12.7 })).toEqual({
      status: "granted",
      latitude: 40.416775,
      longitude: -3.70379,
      accuracy: 13,
    });
  });
});

describe("validaciones", () => {
  it("fichaje: ubicación concedida exige coordenadas", () => {
    const base = { kind: "start", idempotency_key: KEY(1), source: "mobile" };
    expect(punchSchema.safeParse(base).success).toBe(true);
    expect(punchSchema.safeParse({ ...base, location_status: "granted" }).success).toBe(false);
    expect(
      punchSchema.safeParse({
        ...base,
        location_status: "granted",
        latitude: "40.4",
        longitude: "-3.7",
      }).success,
    ).toBe(true);
    expect(punchSchema.safeParse({ ...base, source: "kiosk" }).success).toBe(false);
  });

  it("terminal y PIN", () => {
    const ok = { kind: "start", employee_code: " a-007 ", pin: "482913", idempotency_key: KEY(1) };
    expect(kioskPunchSchema.parse(ok).employee_code).toBe("A-007");
    expect(kioskPunchSchema.safeParse({ ...ok, pin: "12345" }).success).toBe(false);
    expect(pinSchema.safeParse({ pin: "482913", pin_confirm: "482914" }).success).toBe(false);
  });

  it("corrección: cada acción pide lo suyo", () => {
    const base = { employee_id: KEY(9), reason: "Me olvidé de fichar" };
    expect(
      correctionRequestSchema.safeParse({
        ...base,
        action: "add",
        kind: "end",
        proposed_local: "2026-10-20T15:00",
      }).success,
    ).toBe(true);
    expect(
      correctionRequestSchema.safeParse({
        ...base,
        action: "add",
        proposed_local: "2026-10-20T15:00",
      }).success,
    ).toBe(false);
    expect(correctionRequestSchema.safeParse({ ...base, action: "void" }).success).toBe(false);
    expect(
      correctionRequestSchema.safeParse({ ...base, action: "void", punch_id: KEY(2) }).success,
    ).toBe(true);
  });

  it("política: si se usa la ubicación hay que explicar para qué", () => {
    expect(
      policySchema.safeParse({ location_mode: "required", location_notice: "corto" }).success,
    ).toBe(false);
    expect(
      policySchema.safeParse({
        location_mode: "optional",
        location_notice: "Guardamos una sola ubicación al fichar para comprobar el centro.",
      }).success,
    ).toBe(true);
  });
});
