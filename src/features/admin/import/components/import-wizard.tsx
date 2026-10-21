"use client";

import { AlertCircle, CheckCircle2, FileUp, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import {
  confirmImport,
  previewImport,
  validateImportAction,
  type PreviewResult,
  type ValidationResult,
} from "../actions";
import {
  IMPORT_FIELDS,
  MAX_IMPORT_BYTES,
  type ColumnMapping,
  type ImportField,
} from "../employees-import";

type Preview = Extract<PreviewResult, { ok: true }>;
type Validation = Extract<ValidationResult, { ok: true }>;

export function ImportWizard() {
  const [csvText, setCsvText] = useState<string>();
  const [preview, setPreview] = useState<Preview>();
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [validation, setValidation] = useState<Validation>();
  const [imported, setImported] = useState<number>();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function reset() {
    setPreview(undefined);
    setValidation(undefined);
    setImported(undefined);
    setError(undefined);
  }

  async function onFile(file: File | undefined) {
    reset();
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setError("El archivo supera 900 KB. Divídelo en varios.");
      return;
    }
    const text = await file.text();
    setCsvText(text);
    startTransition(async () => {
      const result = await previewImport(text);
      if (result.ok) {
        setPreview(result);
        setMapping(result.mapping);
      } else {
        setError(result.message);
      }
    });
  }

  function onValidate() {
    if (!csvText) return;
    setError(undefined);
    startTransition(async () => {
      const result = await validateImportAction(csvText, mapping);
      if (result.ok) setValidation(result);
      else setError(result.message);
    });
  }

  function onConfirm() {
    if (!csvText) return;
    setError(undefined);
    startTransition(async () => {
      const result = await confirmImport(csvText, mapping);
      if (result.ok) {
        setImported(result.imported);
      } else {
        setError(result.message);
        if (result.validation?.ok) setValidation(result.validation);
      }
    });
  }

  if (imported !== undefined) {
    return (
      <Alert>
        <CheckCircle2 />
        <AlertTitle>Importación completada</AlertTitle>
        <AlertDescription>
          <p>Se han dado de alta {imported} personas en una única operación.</p>
          <Link href="/admin/personas" className="underline underline-offset-4">
            Ver personas
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  const canConfirm =
    validation &&
    validation.errorCount === 0 &&
    validation.problems.length === 0 &&
    validation.validCount > 0;

  return (
    <div className="grid gap-6">
      <section aria-labelledby="paso-1" className="grid gap-3">
        <h2 id="paso-1" className="font-semibold">
          1. Archivo CSV
        </h2>
        <p className="text-muted-foreground text-sm">
          Separado por comas o punto y coma, con cabecera. Máximo 1000 filas. Columnas reconocidas:
          código, nombre, apellidos, correo, centro (código), equipo, contrato, jornada, horas,
          puesto y fecha de inicio. El CIF, el teléfono y el correo personal no se importan.
        </p>
        <Label htmlFor="csv" className="sr-only">
          Archivo CSV
        </Label>
        <input
          id="csv"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => onFile(e.target.files?.[0])}
          className="file:bg-secondary file:text-secondary-foreground min-h-11 text-sm file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-2"
        />
      </section>

      {error ? (
        <Alert variant="destructive" aria-live="assertive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {preview ? (
        <section aria-labelledby="paso-2" className="grid gap-3">
          <h2 id="paso-2" className="font-semibold">
            2. Columnas ({preview.totalRows} filas)
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {IMPORT_FIELDS.map((field) => (
              <div key={field.key} className="grid gap-1">
                <Label htmlFor={`map-${field.key}`}>
                  {field.label}
                  {field.required ? " *" : ""}
                </Label>
                <select
                  id={`map-${field.key}`}
                  className="border-input h-11 rounded-md border bg-transparent px-3 text-base md:h-10 md:text-sm"
                  value={mapping[field.key] ?? ""}
                  onChange={(e) => {
                    setValidation(undefined);
                    setMapping({
                      ...mapping,
                      [field.key as ImportField]:
                        e.target.value === "" ? null : Number(e.target.value),
                    });
                  }}
                >
                  <option value="">No importar</option>
                  {preview.headers.map((header, index) => (
                    <option key={`${header}-${index}`} value={index}>
                      {header || `Columna ${index + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={onValidate}
            disabled={pending}
            className="w-full sm:w-auto"
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Validar todas las filas
          </Button>
        </section>
      ) : null}

      {validation ? (
        <section aria-labelledby="paso-3" className="grid gap-3" aria-live="polite">
          <h2 id="paso-3" className="font-semibold">
            3. Resultado de la validación
          </h2>
          {validation.problems.map((p) => (
            <p key={p} className="text-destructive text-sm">
              {p}
            </p>
          ))}
          <p className="text-sm">
            <strong>{validation.validCount}</strong> filas válidas ·{" "}
            <strong className={validation.errorCount ? "text-destructive" : undefined}>
              {validation.errorCount}
            </strong>{" "}
            con errores. Todavía no se ha guardado nada.
          </p>
          {validation.errors.length > 0 ? (
            <div className="max-h-80 overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <caption className="sr-only">Filas con errores</caption>
                <thead className="bg-muted/50 sticky top-0 text-left">
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Línea
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Código
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Errores
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {validation.errors.map((row) => (
                    <tr key={row.line}>
                      <td className="px-3 py-2 align-top">{row.line}</td>
                      <td className="px-3 py-2 align-top">
                        <code>{row.code || "—"}</code>
                      </td>
                      <td className="px-3 py-2">{row.errors.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {canConfirm ? (
            <Button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              className="w-full sm:w-auto"
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <FileUp aria-hidden />}
              Importar {validation.validCount} personas
            </Button>
          ) : (
            <p className="text-muted-foreground text-sm">
              La importación es de todo o nada: corrige las filas con errores en el archivo y vuelve
              a cargarlo.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
