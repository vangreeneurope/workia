import type { Metadata } from "next";

import { ModulePending } from "@/components/module-pending";
import { requireSection } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Empresas" };

export default async function EmpresasPage() {
  await requireSection("empresas");
  return (
    <ModulePending
      title="Empresas del grupo"
      description="Alta y configuración de empresas."
      phase="fase 1"
      scope={[
        "Alta de empresas con razón social, CIF y zona horaria.",
        "Identidad visual: logotipo (almacenamiento privado) y color corporativo.",
        "Calendarios laborales y políticas de jornada, vacaciones y gastos por empresa.",
      ]}
    />
  );
}
