import { AlertCircle, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AppVersion } from "@/components/app-version";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LoginForm } from "@/features/auth/components/login-form";

export const metadata: Metadata = { title: "Acceder" };

const ERROR_MESSAGES: Record<string, string> = {
  enlace: "El enlace no es válido o ha caducado. Solicita uno nuevo.",
};

const REASON_MESSAGES: Record<string, string> = {
  caducada:
    "Tu sesión se ha cerrado porque ha pasado el tiempo máximo de conexión. Vuelve a entrar: el texto que estabas escribiendo sigue guardado en este dispositivo.",
};

export default function AccederPage({ searchParams }: PageProps<"/acceder">) {
  return (
    <Card>
      <CardHeader className="text-center">
        {/* Logotipo (SVG estático en public/brand; no pasa por el optimizador de imágenes). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${process.env.APP_BASE_PATH ?? ""}/brand/workia-logo-vgreen.svg`}
          alt=""
          width={1480}
          height={330}
          className="mx-auto mb-2 h-auto w-56"
        />
        <CardTitle className="text-xl">
          <h1 className="sr-only">Workia</h1>
        </CardTitle>
        <CardDescription>Accede con tu cuenta corporativa</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Suspense fallback={<LoginSkeleton />}>
          <LoginWithParams searchParams={searchParams} />
        </Suspense>
        <Link
          href="/acceder/recuperar"
          className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center justify-center text-center text-sm underline underline-offset-4"
        >
          ¿Has olvidado tu contraseña?
        </Link>
        <p className="text-muted-foreground text-center text-xs">
          Las cuentas las crea el departamento de RR. HH. de tu empresa.
        </p>
        <AppVersion className="text-muted-foreground text-center" />
      </CardContent>
    </Card>
  );
}

async function LoginWithParams({
  searchParams,
}: {
  searchParams: PageProps<"/acceder">["searchParams"];
}) {
  const params = await searchParams;
  const siguiente = typeof params.siguiente === "string" ? params.siguiente : undefined;
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  const errorMessage = errorKey ? ERROR_MESSAGES[errorKey] : undefined;
  const reasonKey = typeof params.motivo === "string" ? params.motivo : undefined;
  const reasonMessage = reasonKey ? REASON_MESSAGES[reasonKey] : undefined;

  return (
    <>
      {reasonMessage ? (
        <Alert role="status">
          <Clock />
          <AlertDescription>{reasonMessage}</AlertDescription>
        </Alert>
      ) : null}
      {errorMessage ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
      <LoginForm siguiente={siguiente} />
    </>
  );
}

function LoginSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}
