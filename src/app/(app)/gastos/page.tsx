import type { Metadata } from "next";

import { ModulePending } from "@/components/module-pending";
import { requireSection } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Gastos" };

export default async function GastosPage() {
  await requireSection("gastos");
  return (
    <ModulePending
      title="Gastos comerciales"
      description="Tickets, notas de gasto y liquidaciones."
      phase="fase 3"
      scope={[
        "Fotografiar tickets con la cámara y extraer importe, fecha y proveedor por OCR.",
        "Revisión manual obligatoria de los datos extraídos antes de enviar.",
        "Aprobación por el responsable y validación por Contabilidad.",
        "Tickets guardados en almacenamiento privado, nunca públicos.",
      ]}
    />
  );
}
