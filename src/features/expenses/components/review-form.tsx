"use client";

import { AlertTriangle, Sparkles } from "lucide-react";
import { useActionState, useState, useTransition } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { SelectField } from "@/components/admin/select-field";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { initialFormState } from "@/lib/forms";
import { cn } from "@/lib/utils";

import { confirmExpense, saveExpense } from "../actions";
import { centsToInput, formatCents } from "../money";
import type { NormalizedOcrResult, OcrFieldKey } from "../ocr/types";
import { PAYMENT_LABELS, PAYMENT_METHODS } from "../schemas";

export type CategoryOption = {
  id: string;
  label: string;
  isMileage: boolean;
  maxAmountCents: number | null;
  requiresClient: boolean;
  requiresProject: boolean;
  requiresCostCenter: boolean;
  requiresNotes: boolean;
};

export type ReviewExpense = {
  id: string;
  source: "receipt" | "manual" | "mileage";
  category_id: string | null;
  expense_date: string | null;
  merchant_name: string | null;
  merchant_tax_id: string | null;
  document_number: string | null;
  currency: string | null;
  base_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  payment_method: string | null;
  client_name: string | null;
  project_code: string | null;
  cost_center: string | null;
  notes: string | null;
  distance_km_tenths: number | null;
};

const MONEY_FIELDS = new Set<OcrFieldKey>(["base_cents", "tax_cents", "total_cents"]);

/**
 * Revisión del gasto. Los datos del OCR solo rellenan los campos vacíos y se
 * marcan como propuestos; los de baja confianza se resaltan y exigen marcar
 * "Lo he comprobado" para confirmar (la base de datos vuelve a exigirlo).
 */
export function ReviewForm({
  expense,
  proposal,
  low,
  categories,
  currencies,
  defaultCurrency,
  mileageRateMilli,
  similarCount,
  today,
}: {
  expense: ReviewExpense;
  proposal: NormalizedOcrResult | null;
  low: string[];
  categories: CategoryOption[];
  currencies: string[];
  defaultCurrency: string;
  mileageRateMilli: number | null;
  similarCount: number;
  today: string;
}) {
  const [saveState, saveAction, saving] = useActionState(saveExpense, initialFormState);
  const [confirmState, confirmAction, confirming] = useActionState(
    confirmExpense,
    initialFormState,
  );
  const [, startTransition] = useTransition();
  const [lastIntent, setLastIntent] = useState<"save" | "confirm">("save");
  const state = lastIntent === "save" ? saveState : confirmState;
  const pending = saving || confirming;
  const mileage = expense.source === "mileage";
  const visibleCategories = categories.filter((c) => c.isMileage === mileage);
  const [categoryId, setCategoryId] = useState(expense.category_id ?? "");
  const category = visibleCategories.find((c) => c.id === categoryId);
  const [distance, setDistance] = useState(
    expense.distance_km_tenths ? String(expense.distance_km_tenths / 10).replace(".", ",") : "",
  );
  const errors = state.fieldErrors ?? {};

  /** Valor inicial: el del gasto o, si está vacío, la propuesta del OCR. */
  function initial(field: OcrFieldKey): { value: string; proposed: boolean } {
    const own = expense[field];
    if (own !== null && own !== undefined) {
      return {
        value: MONEY_FIELDS.has(field) ? centsToInput(own as number) : String(own),
        proposed: false,
      };
    }
    const p = proposal?.[field]?.value;
    if (!p) return { value: "", proposed: false };
    return { value: MONEY_FIELDS.has(field) ? centsToInput(Number(p)) : p, proposed: true };
  }

  // Función de render (no componente): así los campos no se vuelven a montar al
  // cambiar la categoría y no se pierde lo escrito.
  function ocrField({
    field,
    label,
    type = "text",
    inputMode,
    required,
  }: {
    field: OcrFieldKey;
    label: string;
    type?: string;
    inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
    required?: boolean;
  }) {
    const { value, proposed } = initial(field);
    const isLow = low.includes(field);
    const confidence = proposal?.[field]?.confidence;
    const hintId = `${field}-hint`;
    return (
      <div
        className={cn(
          "grid gap-2 rounded-xl",
          isLow && "bg-amber-50 p-3 ring-2 ring-amber-500 dark:bg-amber-950/40",
        )}
      >
        <FormField
          name={field}
          label={required ? `${label} *` : label}
          type={type}
          inputMode={inputMode}
          defaultValue={value}
          max={type === "date" ? today : undefined}
          aria-describedby={proposed || isLow ? hintId : undefined}
          errors={errors[field]}
        />
        {isLow ? (
          <div id={hintId} className="grid gap-1 text-sm">
            <p className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              Revisa este dato con el ticket
              {confidence !== undefined ? ` (confianza ${Math.round(confidence * 100)} %)` : ""}
            </p>
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" name={`reviewed_${field}`} className="size-5" />
              Lo he comprobado
            </label>
          </div>
        ) : proposed ? (
          <p id={hintId} className="text-muted-foreground flex items-center gap-1 text-xs">
            <Sparkles className="size-3" aria-hidden /> Propuesto por la lectura automática
          </p>
        ) : null}
      </div>
    );
  }

  const distanceTenths = (() => {
    const m = /^(\d{1,5})(?:[.,](\d))?$/.exec(distance.trim());
    return m ? Number(m[1]) * 10 + Number(m[2] ?? 0) : null;
  })();

  return (
    <form
      onSubmit={(event) => {
        // Envío manual: un error no vacía el formulario (React restablece los
        // formularios con `action`) y se sabe qué botón se pulsó.
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const intent = submitter?.value === "confirm" ? "confirm" : "save";
        setLastIntent(intent);
        const fd = new FormData(event.currentTarget);
        startTransition(() => (intent === "confirm" ? confirmAction(fd) : saveAction(fd)));
      }}
      className="grid gap-5"
      noValidate
    >
      <FormMessage state={state} />
      <input type="hidden" name="expense_id" value={expense.id} />

      {low.length > 0 ? (
        <p className="rounded-xl border border-amber-500 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
          La lectura automática no está segura de{" "}
          {low.length === 1 ? "un dato" : `${low.length} datos`}. Compáralos con el ticket y marca
          «Lo he comprobado» en cada uno antes de confirmar.
        </p>
      ) : null}

      <SelectField
        name="category_id"
        label="Categoría *"
        value={categoryId}
        onChange={(e) => setCategoryId(e.target.value)}
        placeholder="Elige una categoría"
        options={visibleCategories.map((c) => ({ value: c.id, label: c.label }))}
        errors={errors.category_id}
      />
      {category?.maxAmountCents ? (
        <p className="text-muted-foreground -mt-3 text-xs">
          Límite de la categoría: {formatCents(category.maxAmountCents)}. Por encima, explica el
          motivo en las notas.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {ocrField({ field: "expense_date", label: "Fecha", type: "date", required: true })}
        {mileage ? (
          <div className="grid gap-2">
            <FormField
              name="distance_km"
              label="Kilómetros *"
              inputMode="decimal"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              errors={errors.distance_km}
            />
            <p className="text-muted-foreground text-xs" aria-live="polite">
              {mileageRateMilli === null
                ? "Tu empresa no ha configurado el precio por kilómetro."
                : distanceTenths
                  ? `Importe: ${formatCents(Math.round((distanceTenths * mileageRateMilli) / 100))} (${(mileageRateMilli / 1000).toFixed(3).replace(".", ",")} €/km)`
                  : `Precio: ${(mileageRateMilli / 1000).toFixed(3).replace(".", ",")} €/km`}
            </p>
          </div>
        ) : (
          ocrField({
            field: "merchant_name",
            label: "Proveedor",
            required: expense.source === "receipt",
          })
        )}
      </div>

      {!mileage ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {ocrField({ field: "base_cents", label: "Base imponible", inputMode: "decimal" })}
            {ocrField({ field: "tax_cents", label: "Impuestos", inputMode: "decimal" })}
            {ocrField({
              field: "total_cents",
              label: "Total",
              inputMode: "decimal",
              required: true,
            })}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField
              name="currency"
              label="Moneda *"
              defaultValue={expense.currency ?? proposal?.currency?.value ?? defaultCurrency}
              options={currencies.map((c) => ({ value: c, label: c }))}
              errors={errors.currency}
            />
            {ocrField({ field: "merchant_tax_id", label: "NIF del proveedor" })}
            {ocrField({ field: "document_number", label: "Nº de ticket o factura" })}
          </div>
          {low.includes("currency") ? (
            <label className="-mt-2 flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="reviewed_currency" className="size-5" />
              He comprobado la moneda
            </label>
          ) : null}
          <SelectField
            name="payment_method"
            label="Forma de pago *"
            defaultValue={expense.payment_method ?? ""}
            placeholder="Elige cómo se pagó"
            options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_LABELS[m] }))}
            errors={errors.payment_method}
          />
        </>
      ) : (
        <input type="hidden" name="currency" value={expense.currency ?? defaultCurrency} />
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField
          name="client_name"
          label={category?.requiresClient ? "Cliente *" : "Cliente"}
          defaultValue={expense.client_name ?? ""}
          errors={errors.client_name}
        />
        <FormField
          name="project_code"
          label={category?.requiresProject ? "Proyecto *" : "Proyecto"}
          defaultValue={expense.project_code ?? ""}
          errors={errors.project_code}
        />
        <FormField
          name="cost_center"
          label={category?.requiresCostCenter ? "Centro de coste *" : "Centro de coste"}
          defaultValue={expense.cost_center ?? ""}
          errors={errors.cost_center}
        />
      </div>
      <FormField
        name="notes"
        label={category?.requiresNotes ? "Notas *" : "Notas"}
        defaultValue={expense.notes ?? ""}
        maxLength={1000}
        errors={errors.notes}
      />

      {similarCount > 0 ? (
        <div className="rounded-xl border border-amber-500 p-3 text-sm">
          <p className="font-medium">
            Tienes {similarCount === 1 ? "otro gasto" : `${similarCount} gastos`} con el mismo
            proveedor, fecha, total y moneda.
          </p>
          <label className="mt-1 flex min-h-11 items-center gap-2">
            <input type="checkbox" name="duplicate_ack" className="size-5" />
            Lo he revisado y no es un duplicado
          </label>
        </div>
      ) : null}

      <p className="text-muted-foreground text-xs">
        * Obligatorio para confirmar. Puedes guardar el borrador incompleto.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          name="intent"
          value="confirm"
          disabled={pending}
          className="min-h-11 flex-1 sm:flex-none"
        >
          Confirmar gasto
        </Button>
        <Button
          type="submit"
          name="intent"
          value="save"
          variant="outline"
          disabled={pending}
          className="min-h-11"
        >
          Guardar borrador
        </Button>
      </div>
    </form>
  );
}
