"use client";

import { Car, PenLine } from "lucide-react";
import { useActionState, useRef, useTransition } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { Button } from "@/components/ui/button";
import { initialFormState } from "@/lib/forms";
import { networkSafe } from "@/lib/network";

import { createExpenseWithoutReceipt } from "../actions";

/** Gastos sin ticket: kilometraje y, si la política lo permite, manuales. */
export function NoReceiptForm({ mileage, manual }: { mileage: boolean; manual: boolean }) {
  const [state, formAction, pending] = useActionState(
    networkSafe(createExpenseWithoutReceipt),
    initialFormState,
  );
  const [, startTransition] = useTransition();
  const keys = useRef<Record<string, string>>({});
  function submit(source: "mileage" | "manual") {
    keys.current[source] ??= crypto.randomUUID();
    const fd = new FormData();
    fd.set("source", source);
    fd.set("idempotency_key", keys.current[source]);
    startTransition(() => formAction(fd));
  }
  if (!mileage && !manual) {
    return (
      <p className="text-muted-foreground text-sm">
        Tu empresa exige ticket para todos los gastos y no tiene kilometraje configurado.
      </p>
    );
  }
  return (
    <div className="grid gap-3">
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        {mileage ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={pending}
            onClick={() => submit("mileage")}
          >
            <Car aria-hidden /> Kilometraje
          </Button>
        ) : null}
        {manual ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={pending}
            onClick={() => submit("manual")}
          >
            <PenLine aria-hidden /> Gasto sin ticket
          </Button>
        ) : null}
      </div>
    </div>
  );
}
