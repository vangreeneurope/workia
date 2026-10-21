import type { Metadata } from "next";

import { ModulePending } from "@/components/module-pending";
import { requireSection } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Fichajes" };

export default async function FichajesPage() {
  await requireSection("fichajes");
  return (
    <ModulePending
      title="Fichajes"
      description="Registro diario de jornada."
      phase="fase 1"
      scope={[
        "Fichar entrada, pausas y salida desde el móvil o el ordenador.",
        "Registros originales inmutables; las correcciones quedan como solicitudes auditadas.",
        "Consulta de tu historial y resumen de horas.",
        "Exportación para la Inspección de Trabajo y conservación durante 4 años.",
      ]}
    />
  );
}
