"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/forms";
import { safeCall } from "@/lib/network";

/**
 * Botón para una acción puntual del servidor (revocar, reactivar…). No es
 * optimista: espera la respuesta y muestra el resultado o el error.
 */
export function ActionButton({
  action,
  label,
  ariaLabel,
  variant = "outline",
  confirmMessage,
}: {
  action: () => Promise<FormState>;
  label: string;
  ariaLabel?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  confirmMessage?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<FormState>();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        size="sm"
        variant={variant}
        disabled={pending}
        aria-label={ariaLabel}
        onClick={() => {
          if (confirmMessage && !window.confirm(confirmMessage)) return;
          startTransition(async () => setResult(await safeCall(action)));
        }}
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {label}
      </Button>
      {result?.status === "error" ? (
        <span role="alert" className="text-destructive text-xs">
          {result.message}
        </span>
      ) : null}
    </span>
  );
}
