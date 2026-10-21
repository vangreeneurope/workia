import { describe, expect, it } from "vitest";

import { csvCell, parseCsv, toCsv } from "@/lib/csv";

describe("parseCsv", () => {
  it("lee comas, comillas, saltos de línea internos y BOM", () => {
    const parsed = parseCsv('﻿codigo,nombre\r\nA-1,"Pérez, Ana"\nA-2,"Línea\nnueva"\n');
    expect(parsed.headers).toEqual(["codigo", "nombre"]);
    expect(parsed.rows).toEqual([
      ["A-1", "Pérez, Ana"],
      ["A-2", "Línea\nnueva"],
    ]);
  });

  it("detecta punto y coma (Excel en español) e ignora líneas vacías", () => {
    const parsed = parseCsv('codigo;nombre\n\nA-1;"Con ""comillas"""\n');
    expect(parsed.rows).toEqual([["A-1", 'Con "comillas"']]);
  });

  it("rechaza comillas sin cerrar", () => {
    expect(() => parseCsv('a,b\n"sin cerrar,1')).toThrow(/comillas/);
  });
});

describe("exportación CSV", () => {
  it("neutraliza fórmulas (inyección en hojas de cálculo)", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("+34600")).toBe("'+34600");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@SUM")).toBe("'@SUM");
  });

  it("genera una tabla con BOM y separador ;", () => {
    expect(toCsv(["a", "b"], [["1", "x;y"]])).toBe('﻿a;b\r\n1;"x;y"\r\n');
  });
});
