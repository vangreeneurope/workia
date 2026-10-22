import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  quoteAbsence: vi.fn(),
  submitAbsence: vi.fn(),
  decideAbsence: vi.fn(),
  respondInfo: vi.fn(),
  attachToRequest: vi.fn(),
}));
vi.mock("@/features/absences/actions", () => actions);

import { canUseArea } from "@/lib/admin/access";
import { ATTACHMENT_MAX_BYTES, checkAttachment } from "@/features/absences/attachments";
import { AbsenceDecisionForm } from "@/features/absences/components/request-actions";
import { RequestForm, type TypeOption } from "@/features/absences/components/request-form";
import {
  decisionSchema,
  requestSchema,
  typeSchema,
  versionSchema,
} from "@/features/absences/schemas";
import { parseClockToMinute } from "@/features/absences/time";
import { formatAmount, parseDaysToHalfDays, parseHoursToMinutes } from "@/features/absences/units";

const KEY = "8b000000-0000-4000-8000-000000000001";
const TYPE = "7f000000-0000-4000-8000-0000000000a1";

describe("unidades enteras", () => {
  it("formatea medios días y minutos", () => {
    expect(formatAmount(9, "half_days")).toBe("4,5 días");
    expect(formatAmount(2, "half_days")).toBe("1 día");
    expect(formatAmount(-3, "half_days")).toBe("-1,5 días");
    expect(formatAmount(90, "minutes")).toBe("1 h 30 min");
    expect(formatAmount(600, "minutes")).toBe("10 h");
  });

  it("lee días con medio día y horas sin decimales", () => {
    expect(parseDaysToHalfDays("22")).toBe(44);
    expect(parseDaysToHalfDays("22,5")).toBe(45);
    expect(parseDaysToHalfDays("-1.5")).toBe(-3);
    expect(parseDaysToHalfDays("22,3")).toBeNull();
    expect(parseHoursToMinutes("10:30")).toBe(630);
    expect(parseHoursToMinutes("-0:15")).toBe(-15);
    expect(parseHoursToMinutes("10,5")).toBeNull();
    expect(parseClockToMinute("24:00")).toBe(1440);
    expect(parseClockToMinute("24:30")).toBeNull();
  });
});

describe("validaciones", () => {
  it("una solicitud por días toma el inicio como fin si no se indica", () => {
    const r = requestSchema.parse({
      type_id: TYPE,
      unit: "day",
      start_date: "2026-11-09",
      idempotency_key: KEY,
    });
    expect(r.end_date).toBe("2026-11-09");
  });

  it("medio día exige mañana o tarde; horas, inicio anterior al fin", () => {
    expect(
      requestSchema.safeParse({
        type_id: TYPE,
        unit: "half_day",
        start_date: "2026-11-09",
        idempotency_key: KEY,
      }).success,
    ).toBe(false);
    expect(
      requestSchema.safeParse({
        type_id: TYPE,
        unit: "hour",
        start_date: "2026-11-09",
        start_time: "11:00",
        end_time: "09:00",
        idempotency_key: KEY,
      }).success,
    ).toBe(false);
  });

  it("rechazar o pedir información exigen mensaje", () => {
    expect(decisionSchema.safeParse({ request_id: KEY, decision: "approve" }).success).toBe(true);
    expect(decisionSchema.safeParse({ request_id: KEY, decision: "reject" }).success).toBe(false);
    expect(
      decisionSchema.safeParse({ request_id: KEY, decision: "request_info", message: "¿Y?" })
        .success,
    ).toBe(false);
  });

  it("un tipo sin aprobación exige la referencia de la regla aprobada", () => {
    const base = {
      code: "AUTO",
      name: "Formación",
      unit_day: "on",
      count_basis: "working_days",
      max_past_days: "0",
    };
    expect(typeSchema.safeParse(base).success).toBe(false);
    expect(
      typeSchema.safeParse({ ...base, approval_exemption_ref: "Acuerdo 2026/1" }).success,
    ).toBe(true);
    expect(
      typeSchema.safeParse({ ...base, requires_approval: "on", unit_day: undefined }).success,
    ).toBe(false);
  });

  it("versión: días a medios días y negativo solo con límite y justificación", () => {
    const base = {
      policy_id: KEY,
      unit: "half_days",
      entitlement: "22",
      accrual_method: "upfront",
      proration: "by_employment",
      rounding_mode: "nearest",
      rounding_step: "0,5",
      carryover_max: "5",
    };
    const parsed = versionSchema.parse(base);
    expect(parsed).toMatchObject({
      entitlement: 44,
      rounding_step: 1,
      carryover_max: 10,
      allow_negative: false,
    });
    expect(
      versionSchema.safeParse({ ...base, allow_negative: "on", negative_limit: "2" }).success,
    ).toBe(false);
    expect(
      versionSchema.safeParse({
        ...base,
        allow_negative: "on",
        negative_limit: "2",
        negative_reason: "Anticipo aprobado por dirección",
      }).success,
    ).toBe(true);
    expect(
      versionSchema.parse({
        ...base,
        unit: "minutes",
        entitlement: "40:00",
        carryover_max: "0:00",
        rounding_step: "0:15",
      }),
    ).toMatchObject({
      entitlement: 2400,
      rounding_step: 15,
    });
  });
});

describe("justificantes", () => {
  it("reconoce el contenido real, no la extensión", () => {
    expect(checkAttachment(new TextEncoder().encode("%PDF-1.7 ..."))).toMatchObject({
      ok: true,
      mime: "application/pdf",
    });
    expect(checkAttachment(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toMatchObject({
      ok: true,
      mime: "image/png",
    });
    expect(checkAttachment(new TextEncoder().encode("<html>"))).toMatchObject({ ok: false });
    expect(checkAttachment(new Uint8Array(ATTACHMENT_MAX_BYTES + 1))).toMatchObject({ ok: false });
  });

  it("quita los metadatos de las fotos JPEG, también grandes", () => {
    const gps = [...new TextEncoder().encode("Exif GPS 40.4 -3.7")];
    const big = new Uint8Array(3 * 1024 * 1024).fill(0x11);
    const jpeg = Uint8Array.from([
      0xff,
      0xd8,
      0xff,
      0xe1,
      0x00,
      gps.length + 2,
      ...gps,
      0xff,
      0xda,
      0x00,
      0x02,
    ]);
    const joined = new Uint8Array(jpeg.length + big.length + 2);
    joined.set(jpeg);
    joined.set(big, jpeg.length);
    joined.set([0xff, 0xd9], jpeg.length + big.length);
    const result = checkAttachment(joined);
    expect(result.ok).toBe(true);
    if (result.ok) expect(new TextDecoder().decode(result.bytes.slice(0, 64))).not.toMatch(/GPS/);
  });
});

describe("áreas de administración", () => {
  it("vacaciones y ausencias requiere gestión de ausencias", () => {
    const perm = (permission: string) => ({
      permission,
      scope_type: "company",
      work_center_id: null,
      team_id: null,
    });
    expect(canUseArea("ausencias", [perm("absence.manage")], { groupAdmin: false })).toBe(true);
    expect(canUseArea("ausencias", [perm("absence.read")], { groupAdmin: false })).toBe(false);
  });
});

const types: TypeOption[] = [
  {
    id: TYPE,
    name: "Vacaciones",
    units: ["day", "half_day"],
    requiresAttachment: false,
    usesBalance: true,
    requiresApproval: true,
  },
  {
    id: "7f000000-0000-4000-8000-0000000000a3",
    name: "Ausencia médica",
    units: ["day"],
    requiresAttachment: true,
    usesBalance: false,
    requiresApproval: true,
  },
];

describe("formulario de solicitud", () => {
  beforeEach(() => {
    actions.quoteAbsence.mockReset();
    actions.submitAbsence.mockReset();
  });

  it("calcula días y saldo antes de enviar", async () => {
    actions.quoteAbsence.mockResolvedValue({
      status: "success",
      amount: 8,
      unit: "half_days",
      available: 36,
      warnings: [],
    });
    render(<RequestForm types={types} today="2026-11-09" />);
    await userEvent.click(screen.getByRole("button", { name: /Calcular/ }));
    expect(await screen.findByText(/Se descontará/)).toHaveTextContent("4 días");
    expect(screen.getByText(/disponible ahora: 18 días/)).toBeInTheDocument();
    const fd = actions.quoteAbsence.mock.calls[0]?.[0] as FormData;
    expect(fd.get("type_id")).toBe(TYPE);
    expect(fd.get("idempotency_key")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("muestra el justificante solo en los tipos que lo piden y avisa de no poner datos de salud", async () => {
    render(<RequestForm types={types} today="2026-11-09" />);
    expect(screen.queryByLabelText(/Justificante/)).toBeNull();
    expect(screen.getByText(/No incluyas diagnósticos/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Tipo de ausencia"), "Ausencia médica");
    expect(screen.getByLabelText(/Justificante/)).toBeInTheDocument();
  });

  it("al reintentar el mismo envío reutiliza la clave", async () => {
    actions.submitAbsence.mockResolvedValue({ status: "error", message: "Sin conexión" });
    render(<RequestForm types={types} today="2026-11-09" />);
    await userEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));
    await waitFor(() => expect(actions.submitAbsence).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));
    await waitFor(() => expect(actions.submitAbsence).toHaveBeenCalledTimes(2));
    const key = (n: number) =>
      (actions.submitAbsence.mock.calls[n]?.[1] as FormData).get("idempotency_key");
    expect(key(0)).toBe(key(1));
  });
});

describe("bandeja", () => {
  it("rechazar sin motivo no se envía", async () => {
    actions.decideAbsence.mockReset();
    render(<AbsenceDecisionForm requestId={KEY} />);
    await userEvent.click(screen.getByRole("button", { name: "Rechazar" }));
    expect(await screen.findByText("Indica el motivo del rechazo")).toBeInTheDocument();
    expect(actions.decideAbsence).not.toHaveBeenCalled();
  });

  it("aprobar envía la decisión", async () => {
    actions.decideAbsence.mockResolvedValue({ status: "success", message: "Aprobada" });
    render(<AbsenceDecisionForm requestId={KEY} />);
    await userEvent.click(screen.getByRole("button", { name: "Aprobar" }));
    await waitFor(() => expect(actions.decideAbsence).toHaveBeenCalledTimes(1));
    expect((actions.decideAbsence.mock.calls[0]?.[1] as FormData).get("decision")).toBe("approve");
  });
});

describe("uso mensual y anillo de saldo", () => {
  it("imputa usos menos reversiones a su mes y completa 12 meses", async () => {
    const { monthlyUsage, availableFraction } = await import("@/features/absences/usage");
    const rows = monthlyUsage(
      [
        { kind: "usage", amount: -10, effective_date: "2026-08-03" },
        { kind: "usage_reversal", amount: 4, effective_date: "2026-08-03" },
        { kind: "usage", amount: -6, effective_date: "2026-07-01" },
        { kind: "reservation", amount: -2, effective_date: "2026-11-09" },
      ],
      "2026-01-01",
      "half_days",
    );
    expect(rows).toHaveLength(12);
    expect(rows[6]).toMatchObject({ value: 6, display: "3 días" });
    expect(rows[7]).toMatchObject({ value: 6, label: "agosto de 2026" });
    expect(rows[10]?.value).toBe(0);
    expect(availableFraction({ available: 27, entitled: 44, carried: 4, adjusted: 6 })).toBe(0.5);
    expect(availableFraction({ available: 3, entitled: 0, carried: 0, adjusted: 0 })).toBe(0);
  });
});
