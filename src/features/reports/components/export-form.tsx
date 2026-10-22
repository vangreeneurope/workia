"use client";

import { Download } from "lucide-react";
import { useActionState, useEffect, useRef, useTransition } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { SelectField } from "@/components/admin/select-field";
import { SubmitButton } from "@/components/admin/submit-button";
import { initialFormState } from "@/lib/forms";

import { requestReportExport } from "../actions";
import type { ReportKey } from "../catalog";

/**
 * Pide la exportación de la vista actual (mismos filtros que la URL). La clave de
 * idempotencia se conserva en los reintentos y se renueva tras un envío correcto.
 */
export function ExportForm({ report, query }: { report: ReportKey; query: string }) {
  const [state, formAction, pending] = useActionState(requestReportExport, initialFormState);
  const [, startTransition] = useTransition();
  const key = useRef("");
  // Tras una solicitud correcta, la siguiente es otra exportación (otra clave).
  useEffect(() => {
    if (state.status === "success") key.current = "";
  }, [state]);
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    if (!key.current) key.current = crypto.randomUUID();
    fd.set("idempotency_key", key.current);
    startTransition(() => formAction(fd));
  }
  return (
    <form onSubmit={onSubmit} className="grid gap-3" aria-label="Exportar">
      <input type="hidden" name="report" value={report} />
      <input type="hidden" name="query" value={query} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40">
          <SelectField
            name="format"
            id={`format-${report}`}
            label="Formato"
            defaultValue="xlsx"
            options={[
              { value: "xlsx", label: "Excel (XLSX)" },
              { value: "csv", label: "CSV" },
              { value: "pdf", label: "PDF" },
            ]}
          />
        </div>
        <SubmitButton pending={pending} variant="outline" className="min-h-11">
          <Download aria-hidden /> Exportar
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
