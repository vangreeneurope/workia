import { Badge } from "@/components/ui/badge";

const LABELS: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  active: { label: "Activo", variant: "secondary" },
  inactive: { label: "Inactivo", variant: "outline" },
  revoked: { label: "Revocado", variant: "outline" },
  ended: { label: "Finalizado", variant: "outline" },
  invited: { label: "Invitado", variant: "outline" },
  suspended: { label: "Suspendido", variant: "destructive" },
  draft: { label: "Borrador", variant: "outline" },
  published: { label: "Publicado", variant: "secondary" },
  scheduled: { label: "Programado", variant: "outline" },
  terminated: { label: "Baja", variant: "destructive" },
  leaving: { label: "Baja programada", variant: "outline" },
  expired: { label: "Caducado", variant: "outline" },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const entry = LABELS[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={entry.variant}>{label ?? entry.label}</Badge>;
}
