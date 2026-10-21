import type { Metadata } from "next";

import { ModulePending } from "@/components/module-pending";
import { requireSection } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Auditoría" };

export default async function AuditoriaPage() {
  await requireSection("auditoria");
  return (
    <ModulePending
      title="Auditoría"
      description="Historial de cambios relevantes."
      phase="fase 1"
      scope={[
        "Consulta de cambios en empresas, membresías, roles y asignaciones (ya se registran).",
        "Filtros por fecha, persona y tipo de cambio.",
        "Exportación para requerimientos de la Inspección de Trabajo o de protección de datos.",
      ]}
    />
  );
}
