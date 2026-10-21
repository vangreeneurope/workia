import { describe, expect, it } from "vitest";

import {
  mappingProblems,
  suggestMapping,
  toImportPayload,
  validateImport,
  type ImportReference,
} from "@/features/admin/import/employees-import";

const reference: ImportReference = {
  workCenterCodes: new Set(["MAD", "BCN"]),
  teamNames: new Set(["Ventas"]),
  existingCodes: new Set(["A-001"]),
};

const header =
  "Código;Nombre;Apellidos;Correo;Centro;Equipo;Contrato;Jornada;Horas;Puesto;Fecha inicio";

describe("mapeo de columnas", () => {
  it("propone el mapeo a partir de cabeceras en español con acentos", () => {
    const mapping = suggestMapping(header.split(";"));
    expect(mapping.employee_code).toBe(0);
    expect(mapping.last_name).toBe(2);
    expect(mapping.valid_from).toBe(10);
  });

  it("exige los campos obligatorios y no repetir columnas", () => {
    expect(mappingProblems({ employee_code: 0, first_name: 0 }, 3)).toEqual([
      "Asigna una columna a «Apellidos».",
      "Una misma columna está asignada a dos campos.",
    ]);
  });
});

describe("validación por fila", () => {
  const csv = [
    header,
    "A-100;Ana;Ejemplo;ana@empresa.example;mad;Ventas;indefinido;completa;40;Comercial;01/11/2026",
    "A-101;Luis;Ejemplo;;;;;;;;",
    "A-100;Repetido;Ejemplo;ana@empresa.example;;;;;;;",
    "A-001;Existe;Ya;;;;;;;;",
    "A-102;Sin;Centro;;ZZ;Marketing;temporal;;;;",
    "A-103;Mal;Horas;;;;indefinido;;45,5;;2026-13-01",
  ].join("\n");

  const result = validateImport(csv, suggestMapping(header.split(";")), reference);

  it("normaliza y acepta las filas válidas", () => {
    expect(result.validRows).toHaveLength(2);
    expect(result.validRows[0]).toMatchObject({
      work_center_code: "MAD",
      contract_type: "permanent",
      working_time: "full_time",
      weekly_hours: 40,
      valid_from: "2026-11-01",
    });
  });

  it("informa de duplicados en el archivo y con la base de datos", () => {
    expect(result.results[2]?.errors).toEqual(
      expect.arrayContaining(["código repetido en la línea 2", "correo repetido en la línea 2"]),
    );
    expect(result.results[3]?.errors).toContain("ya existe una persona con este código");
  });

  it("informa de referencias inexistentes y de condiciones incompletas", () => {
    expect(result.results[4]?.errors).toEqual(
      expect.arrayContaining([
        "el centro ZZ no existe",
        "el equipo «Marketing» no existe",
        "con tipo de contrato son obligatorias las horas semanales y la fecha de inicio",
      ]),
    );
    expect(result.results[5]?.errors).toEqual(
      expect.arrayContaining([
        "más de 40 h semanales",
        expect.stringContaining("fecha de inicio no válida"),
      ]),
    );
    expect(result.errorCount).toBe(4);
  });

  it("indica la línea real del archivo", () => {
    expect(result.results.map((r) => r.line)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("prepara las filas para la importación atómica", () => {
    expect(toImportPayload(result.validRows)[1]).toEqual({
      employee_code: "A-101",
      first_name: "Luis",
      last_name: "Ejemplo",
      work_email: "",
      work_center_code: "",
      team_name: "",
      contract_type: "",
      working_time: "",
      weekly_hours: "",
      job_title: "",
      valid_from: "",
    });
  });

  it("rechaza archivos vacíos o mal formados antes de validar filas", () => {
    expect(validateImport(header, suggestMapping(header.split(";")), reference).problems).toContain(
      "El archivo no tiene filas de datos.",
    );
    expect(validateImport('a;b\n"x', {}, reference).problems[0]).toMatch(/comillas/);
  });
});
