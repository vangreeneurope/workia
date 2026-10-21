import type { Metadata } from "next";

import { ModulePending } from "@/components/module-pending";
import { requireSection } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Equipo" };

export default async function EquipoPage() {
  await requireSection("equipo");
  return (
    <ModulePending
      title="Equipo"
      description="Personas a tu cargo y plantilla de la empresa."
      phase="fase 1"
      scope={[
        "Responsables: personas que supervisas, también de otras empresas del grupo.",
        "RR. HH.: altas, bajas, roles y asignación de responsables.",
        "Revisión de fichajes y solicitudes pendientes de tu equipo.",
      ]}
    />
  );
}
