import type { Metadata } from "next";

import { BackLink } from "@/components/admin/back-link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataRequestForm } from "@/features/security/components/privacy-forms";
import { DATA_REQUEST_LABELS, DATA_REQUEST_STATUS_LABELS } from "@/features/security/schemas";
import { requireSection } from "@/lib/auth/dal";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Mis datos y privacidad" };

export default async function PrivacidadPage() {
  const ctx = await requireSection("perfil");
  const supabase = await createClient();
  const { data } = ctx.activeCompanyId
    ? await supabase
        .from("data_subject_requests")
        .select("id, kind, status, created_at, due_at, decided_at, completed_at")
        .eq("company_id", ctx.activeCompanyId)
        .eq("requested_by", ctx.userId)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [] };
  const requests = data ?? [];

  return (
    <>
      <BackLink href="/perfil" label="Mi perfil" />
      <PageHeader
        title="Mis datos y privacidad"
        description="Puedes pedir acceso, rectificación, supresión, limitación, portabilidad u oposición. Una persona de RR. HH. revisa cada solicitud."
      />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nueva solicitud</CardTitle>
            <CardDescription>
              Respuesta en un mes (ampliable dos meses si es compleja). Algunos datos deben
              conservarse por ley aunque pidas suprimirlos (por ejemplo, el registro de jornada
              durante 4 años); te lo indicaremos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {ctx.activeCompanyId ? (
              <DataRequestForm />
            ) : (
              <p className="text-muted-foreground text-sm">No tienes una empresa activa.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mis solicitudes</CardTitle>
          </CardHeader>
          <CardContent>
            {requests.length === 0 ? (
              <p className="text-muted-foreground text-sm">No has presentado solicitudes.</p>
            ) : (
              <ul className="divide-y">
                {requests.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                  >
                    <span>
                      {DATA_REQUEST_LABELS[r.kind as keyof typeof DATA_REQUEST_LABELS] ?? r.kind} ·{" "}
                      presentada el {formatDate(r.created_at)} · plazo {formatDate(r.due_at)}
                    </span>
                    <Badge variant="outline">
                      {DATA_REQUEST_STATUS_LABELS[r.status] ?? r.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
