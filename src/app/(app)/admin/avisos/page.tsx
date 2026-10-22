import type { Metadata } from "next";

import { ActionButton } from "@/components/admin/action-button";
import { BackLink } from "@/components/admin/back-link";
import { DataTable } from "@/components/admin/data-table";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { retryDelivery } from "@/features/notifications/actions";
import { isNotificationEvent, NOTIFICATION_EVENTS } from "@/features/notifications/catalog";
import { requireAdminArea } from "@/lib/admin/context";
import { hasPermission } from "@/lib/admin/access";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Avisos y correo" };

const STATUS_LABELS: Record<string, string> = {
  pending: "En cola",
  sending: "Enviando",
  sent: "Enviado",
  delivered: "Entregado",
  bounced: "Rebotado",
  complained: "Marcado como spam",
  failed: "Fallido",
  suppressed: "Suprimido (rebote reciente)",
  skipped: "No enviado",
  processed: "Procesado",
};

const ERROR_LABELS: Record<string, string> = {
  provider_unavailable: "Proveedor no disponible",
  rate_limited: "Límite del proveedor",
  timeout: "Tiempo agotado",
  invalid_recipient: "Destinatario no válido",
  rejected: "Rechazado por el proveedor",
  no_provider: "Sin proveedor de correo configurado",
  frequency_limit: "Límite de recordatorios diarios",
  recent_bounce: "Rebote reciente",
  no_address: "Sin dirección de correo",
  processing_error: "Error al procesar",
};

export default async function AdminAvisosPage() {
  const ctx = await requireAdminArea("avisos");
  const supabase = await createClient();
  const [summaryRes, deliveriesRes] = await Promise.all([
    supabase.rpc("notification_support_summary", { p_company: ctx.companyId }),
    supabase
      .from("email_deliveries")
      .select(
        "id, event_type, status, attempts, max_attempts, manual_retries, last_error_code, created_at, sent_at, next_attempt_at",
      )
      .eq("company_id", ctx.companyId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const summary = summaryRes.data ?? [];
  const canRetry = hasPermission(ctx.permissions, "org.manage", "company");

  return (
    <>
      <BackLink href="/admin" label="Administración" />
      <PageHeader
        title="Avisos y correo"
        description="Estado de la cola y de las entregas para dar soporte. No se muestra el contenido de los avisos ni direcciones de correo."
      />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resumen</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {summary.length === 0 ? (
              <p className="text-muted-foreground text-sm">Aún no hay avisos.</p>
            ) : (
              summary.map((s) => (
                <Badge
                  key={`${s.kind}-${s.status}`}
                  variant={s.status === "failed" ? "destructive" : "outline"}
                >
                  {s.kind === "outbox" ? "Eventos" : "Correos"} ·{" "}
                  {STATUS_LABELS[s.status] ?? s.status}: {s.total}
                </Badge>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Últimas entregas de correo</CardTitle>
            <CardDescription>
              Un fallo temporal se reintenta solo con espera creciente (hasta 5 intentos); después
              queda «Fallido» y puede reintentarse a mano hasta 3 veces.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              caption="Entregas de correo"
              rows={deliveriesRes.data ?? []}
              rowKey={(d) => d.id}
              empty="No hay entregas."
              columns={[
                {
                  key: "event",
                  header: "Aviso",
                  cell: (d) =>
                    isNotificationEvent(d.event_type)
                      ? NOTIFICATION_EVENTS[d.event_type].label
                      : d.event_type,
                },
                {
                  key: "status",
                  header: "Estado",
                  cell: (d) => STATUS_LABELS[d.status] ?? d.status,
                },
                {
                  key: "attempts",
                  header: "Intentos",
                  cell: (d) => `${d.attempts}/${d.max_attempts}`,
                },
                {
                  key: "error",
                  header: "Último error",
                  cell: (d) =>
                    d.last_error_code
                      ? (ERROR_LABELS[d.last_error_code] ?? d.last_error_code)
                      : "—",
                },
                {
                  key: "date",
                  header: "Creado",
                  desktopOnly: true,
                  cell: (d) => formatDate(d.created_at),
                },
                {
                  key: "actions",
                  header: "Acciones",
                  cell: (d) =>
                    canRetry && d.status === "failed" && d.manual_retries < 3 ? (
                      <ActionButton action={retryDelivery.bind(null, d.id)} label="Reintentar" />
                    ) : null,
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
