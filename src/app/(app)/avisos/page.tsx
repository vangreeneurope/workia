import { Bell, ChevronRight, Settings } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/admin/action-button";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { markAllRead } from "@/features/notifications/actions";
import { isNotificationEvent } from "@/features/notifications/catalog";
import { renderNotification } from "@/features/notifications/templates";
import { getUserContext } from "@/lib/auth/dal";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Avisos" };

const MESSAGES: Record<string, string> = {
  "sin-acceso": "Ya no tienes acceso a ese elemento: puede que haya cambiado tu rol o tu equipo.",
  "no-encontrado": "No se ha encontrado ese aviso.",
};

export default async function AvisosPage({ searchParams }: PageProps<"/avisos">) {
  const ctx = await getUserContext();
  const params = await searchParams;
  const supabase = await createClient();
  const { data } = ctx.activeCompanyId
    ? await supabase
        .from("notifications")
        .select("id, event_type, template_version, params, read_at, created_at, mandatory")
        .eq("company_id", ctx.activeCompanyId)
        .order("created_at", { ascending: false })
        .limit(100)
    : { data: [] };
  const items = data ?? [];
  const unread = items.filter((n) => !n.read_at).length;
  const estado = typeof params.estado === "string" ? MESSAGES[params.estado] : undefined;

  return (
    <>
      <PageHeader
        title="Avisos"
        description="Solicitudes, aprobaciones, recordatorios y cambios que te afectan."
        actions={
          <div className="flex flex-wrap gap-2">
            {unread > 0 ? (
              <ActionButton action={markAllRead} label="Marcar todo como leído" />
            ) : null}
            <Link
              href="/avisos/preferencias"
              className="hover:bg-accent inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium"
            >
              <Settings className="size-4" aria-hidden /> Preferencias
            </Link>
          </div>
        }
      />
      {estado ? (
        <Alert className="mb-4">
          <AlertDescription>{estado}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {unread > 0 ? `${unread} sin leer` : "Todo leído"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Bell className="size-4" aria-hidden /> No tienes avisos.
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                if (!isNotificationEvent(n.event_type)) return null;
                const r = renderNotification(n.event_type, n.template_version, n.params);
                return (
                  <li key={n.id}>
                    {/* Ruta propia: comprueba el permiso actual antes de llevar al objeto. */}
                    <a
                      href={`/avisos/${n.id}`}
                      className="hover:bg-accent/60 -mx-2 flex min-h-16 items-start gap-3 rounded-lg px-2 py-3 text-sm"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "mt-1.5 size-2.5 shrink-0 rounded-full",
                          n.read_at ? "bg-transparent" : "bg-primary",
                        )}
                      />
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className={cn(n.read_at ? "font-normal" : "font-semibold")}>
                          {r.title}
                          {!n.read_at ? <span className="sr-only"> (sin leer)</span> : null}
                        </span>
                        <span className="text-muted-foreground">{r.body}</span>
                        <span className="text-muted-foreground text-xs">
                          {formatDate(n.created_at)}
                        </span>
                      </span>
                      <ChevronRight
                        className="text-muted-foreground mt-1 size-4 shrink-0"
                        aria-hidden
                      />
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
