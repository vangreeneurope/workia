"use client";

import { KeyRound, ShieldCheck, Smartphone } from "lucide-react";

import { FormMessage } from "@/components/admin/form-message";
import { SubmitButton } from "@/components/admin/submit-button";
import { FormField } from "@/components/form-field";

import { removeFactor, startTotpEnrollment, verifyTotp, type EnrollState } from "../actions";
import { useManualForm } from "./use-form";

export type FactorView = { id: string; name: string; verified: boolean; createdAt: string };

function CodeForm({ factorId, label }: { factorId: string; label: string }) {
  const { state, pending, onSubmit, errors } = useManualForm(verifyTotp);
  return (
    <form onSubmit={onSubmit} className="grid gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="factor_id" value={factorId} />
      <FormField
        id={`code-${factorId}`}
        name="code"
        label="Código de 6 dígitos de tu aplicación"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        errors={errors.code}
      />
      <SubmitButton pending={pending} className="min-h-11 w-full sm:w-auto">
        <ShieldCheck aria-hidden /> {label}
      </SubmitButton>
    </form>
  );
}

function EnrollForm() {
  const { state, pending, onSubmit } = useManualForm<EnrollState>(startTotpEnrollment);
  if (state.status === "success" && state.factorId && state.qr) {
    return (
      <div className="grid gap-4">
        <ol className="text-muted-foreground grid list-decimal gap-1 pl-5 text-sm">
          <li>Abre tu aplicación de autenticación (por ejemplo, la del móvil de empresa).</li>
          <li>Escanea el código QR o escribe la clave manualmente.</li>
          <li>Introduce el código de 6 dígitos que te muestre.</li>
        </ol>
        {/* QR en SVG generado por Supabase Auth (data: URI, sin scripts). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={state.qr}
          alt="Código QR para tu aplicación de autenticación"
          className="size-48 rounded-lg border bg-white p-2"
        />
        <p className="text-sm">
          Clave manual: <code className="bg-muted rounded px-1 break-all">{state.secret}</code>
        </p>
        <CodeForm factorId={state.factorId} label="Activar verificación en dos pasos" />
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <FormMessage state={state} />
      <SubmitButton pending={pending} className="min-h-11 w-full sm:w-auto">
        <Smartphone aria-hidden /> Configurar una aplicación de autenticación
      </SubmitButton>
    </form>
  );
}

function RemoveForm({ factorId }: { factorId: string }) {
  const { state, pending, onSubmit } = useManualForm(removeFactor);
  return (
    <form onSubmit={onSubmit} className="grid gap-1">
      <input type="hidden" name="factor_id" value={factorId} />
      <SubmitButton pending={pending} variant="outline" className="min-h-11">
        Eliminar
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

/**
 * Verificación en dos pasos (TOTP). Todo pasa por Server Actions: las cookies
 * de sesión son httpOnly y el navegador no habla directamente con Supabase.
 */
export function MfaPanel({
  factors,
  level,
  required,
}: {
  factors: FactorView[];
  level: "aal1" | "aal2";
  required: boolean;
}) {
  const verified = factors.filter((f) => f.verified);
  return (
    <div className="grid gap-4">
      {verified.length === 0 ? (
        <>
          <p className="text-sm">
            {required
              ? "Tu rol da acceso a datos de otras personas: necesitas la verificación en dos pasos para usar tus permisos."
              : "Añade un segundo factor para proteger tu cuenta aunque alguien conozca tu contraseña."}
          </p>
          <EnrollForm />
        </>
      ) : level !== "aal2" ? (
        <>
          <p className="flex items-center gap-2 text-sm">
            <KeyRound className="size-4" aria-hidden /> Confirma con tu aplicación para continuar.
          </p>
          <CodeForm factorId={verified[0]?.id ?? ""} label="Verificar" />
        </>
      ) : (
        <p className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="size-4 text-emerald-700" aria-hidden /> Sesión verificada con
          segundo factor.
        </p>
      )}
      {verified.length > 0 ? (
        <ul className="divide-y rounded-xl border">
          {verified.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
            >
              <span>
                {f.name} · alta el {f.createdAt}
              </span>
              {level === "aal2" ? <RemoveForm factorId={f.id} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
