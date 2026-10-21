import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordResetForm } from "@/features/auth/components/password-reset-form";

export const metadata: Metadata = { title: "Recuperar contraseña" };

export default function RecuperarPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          <h1>Recuperar contraseña</h1>
        </CardTitle>
        <CardDescription>
          Te enviaremos un enlace a tu correo corporativo para crear una nueva contraseña.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <PasswordResetForm />
        <Link
          href="/acceder"
          className="text-muted-foreground hover:text-foreground text-center text-sm underline-offset-4 hover:underline"
        >
          Volver a acceder
        </Link>
      </CardContent>
    </Card>
  );
}
