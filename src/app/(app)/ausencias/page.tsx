import type { Metadata } from "next";

import { ModulePending } from "@/components/module-pending";
import { requireSection } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Ausencias" };

export default async function AusenciasPage() {
  await requireSection("ausencias");
  return (
    <ModulePending
      title="Vacaciones y ausencias"
      description="Solicitudes, aprobaciones y calendario."
      phase="fase 2"
      scope={[
        "Solicitud de vacaciones, permisos retribuidos y otras ausencias.",
        "Aprobación por tu responsable, aunque pertenezca a otra empresa del grupo.",
        "Saldo de días según la política y el calendario laboral de tu empresa.",
        "Justificantes en almacenamiento privado con acceso autorizado.",
      ]}
    />
  );
}
