"use client";

import { useOptimistic, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/forms";
import { safeCall } from "@/lib/network";

import { StatusBadge } from "./status-badge";

/**
 * Activar / desactivar con interfaz optimista. Es seguro porque la operación
 * es reversible: si el servidor la rechaza, el estado vuelve atrás solo y se
 * muestra el motivo.
 */
export function StatusToggle({
  id,
  status,
  action,
  entityLabel,
}: {
  id: string;
  status: "active" | "inactive";
  action: (input: { id: string; status: "active" | "inactive" }) => Promise<FormState>;
  entityLabel: string;
}) {
  const [optimistic, setOptimistic] = useOptimistic(status);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const next = optimistic === "active" ? "inactive" : "active";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status={optimistic} />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label={`${next === "active" ? "Reactivar" : "Desactivar"} ${entityLabel}`}
        onClick={() =>
          startTransition(async () => {
            setError(undefined);
            setOptimistic(next);
            const result = await safeCall(() => action({ id, status: next }));
            if (result.status === "error") setError(result.message);
          })
        }
      >
        {next === "active" ? "Reactivar" : "Desactivar"}
      </Button>
      {error ? (
        <p role="alert" className="text-destructive w-full text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
