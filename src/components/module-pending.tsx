import { Construction } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Estado honesto para módulos aún no construidos: explica qué llegará y en
 * qué fase, sin mostrar datos de ejemplo (regla: no datos simulados).
 */
export function ModulePending({
  title,
  description,
  phase,
  scope,
}: {
  title: string;
  description: string;
  phase: string;
  scope: string[];
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Construction className="size-5" aria-hidden />
            Módulo en preparación
          </CardTitle>
          <CardDescription>
            Esta sección se activará en la {phase}. Tu acceso ya está configurado según tu rol.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="mb-2 text-sm font-medium">Qué incluirá:</p>
          <ul className="text-muted-foreground grid list-disc gap-1 pl-5 text-sm">
            {scope.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
