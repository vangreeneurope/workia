import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">Página no disponible</h1>
      <p className="text-muted-foreground">
        La página no existe o no tienes permiso para verla con tu rol en la empresa activa.
      </p>
      <Button asChild>
        <Link href="/panel">Volver al inicio</Link>
      </Button>
    </main>
  );
}
