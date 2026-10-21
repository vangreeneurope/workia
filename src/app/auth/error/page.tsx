import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Error de autenticación" };

export default function AuthErrorPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">No se pudo completar el acceso</h1>
      <p className="text-muted-foreground">
        El enlace no es válido o ha caducado. Vuelve a intentarlo desde la pantalla de acceso.
      </p>
      <Button asChild>
        <Link href="/acceder">Ir a acceder</Link>
      </Button>
    </main>
  );
}
