import { Download } from "lucide-react";
import type { Metadata } from "next";

import { BackLink } from "@/components/admin/back-link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CompleteRequestForm,
  LegalHoldForm,
  ReleaseHoldForm,
  ReviewRequestForm,
  RevokeSupportForm,
  SupportGrantForm,
} from "@/features/security/components/privacy-forms";
import {
  DATA_REQUEST_LABELS,
  DATA_REQUEST_STATUS_LABELS,
  LEGAL_HOLD_LABELS,
} from "@/features/security/schemas";
import { requireAdminArea } from "@/lib/admin/context";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Privacidad y soporte" };

/** Instante de la petición (fuera del render para no llamar a Date.now en él). */
function nowMs(): number {
  return Date.now();
}

type Blocker = { category?: string; basis?: string; until?: string | null };

/**
 * Consola de privacidad de la empresa activa: solicitudes de derechos con
 * revisión humana, retenciones legales, plazos de conservación y acceso de
 * soporte temporal. Todo lo decide y audita la base de datos.
 */
export default async function PrivacidadAdminPage() {
  const ctx = await requireAdminArea("privacidad");
  const supabase = await createClient();
  const [requestsRes, holdsRes, catalogRes, grantsRes, staffRes, employeesRes] = await Promise.all([
    supabase
      .from("data_subject_requests")
      .select(
        "id, kind, status, created_at, due_at, details, decision_note, blockers, employees (employee_code, first_name, last_name)",
      )
      .eq("company_id", ctx.companyId)
      .order("due_at")
      .limit(100),
    supabase
      .from("legal_holds")
      .select("id, category, reason, created_at, released_at, employees (employee_code)")
      .eq("company_id", ctx.companyId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.rpc("retention_catalog"),
    supabase
      .from("support_access_grants")
      .select("id, reason, starts_at, expires_at, revoked_at, support_user_id")
      .eq("company_id", ctx.companyId)
      .order("starts_at", { ascending: false })
      .limit(20),
    supabase.rpc("support_staff"),
    supabase
      .from("employees")
      .select("id, employee_code, first_name, last_name")
      .eq("company_id", ctx.companyId)
      .order("employee_code")
      .limit(500),
  ]);
  const requests = requestsRes.data ?? [];
  const open = requests.filter((r) => !["completed", "rejected"].includes(r.status));
  const closed = requests.filter((r) => ["completed", "rejected"].includes(r.status)).slice(0, 20);
  const staff = (staffRes.data ?? []).map((s) => ({
    value: s.user_id,
    label: s.full_name || "Soporte",
  }));
  const staffNames = new Map(staff.map((s) => [s.value, s.label]));
  const now = nowMs();

  return (
    <>
      <BackLink href="/admin" label="Administración" />
      <PageHeader
        title="Privacidad y soporte"
        description={`${ctx.companyName}: derechos de las personas, retenciones legales, conservación y acceso de soporte.`}
      />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Solicitudes de derechos ({open.length} abiertas)
            </CardTitle>
            <CardDescription>
              Plazo: un mes desde la recepción. Nadie resuelve sus propias solicitudes. Aprobar no
              borra nada: la supresión se ejecuta a mano tras revisar las obligaciones de
              conservación.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {open.length === 0 ? (
              <p className="text-muted-foreground text-sm">No hay solicitudes abiertas.</p>
            ) : (
              <ul className="grid gap-4">
                {open.map((r) => {
                  const blockers = (Array.isArray(r.blockers) ? r.blockers : []) as Blocker[];
                  const overdue = Date.parse(r.due_at) < now;
                  return (
                    <li key={r.id} className="grid gap-3 rounded-xl border p-3 text-sm">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {DATA_REQUEST_LABELS[r.kind as keyof typeof DATA_REQUEST_LABELS] ?? r.kind}{" "}
                        ·{" "}
                        {r.employees
                          ? `${r.employees.employee_code} · ${r.employees.last_name}, ${r.employees.first_name}`
                          : "Persona"}
                        <Badge variant={overdue ? "destructive" : "outline"}>
                          {DATA_REQUEST_STATUS_LABELS[r.status] ?? r.status} · plazo{" "}
                          {formatDate(r.due_at)}
                        </Badge>
                      </p>
                      {r.details ? (
                        <p className="text-muted-foreground whitespace-pre-line">{r.details}</p>
                      ) : null}
                      {blockers.length > 0 ? (
                        <ul className="list-disc pl-5">
                          {blockers.map((b, i) => (
                            <li key={i}>
                              {b.basis}
                              {b.until ? ` (hasta ${formatDate(b.until)})` : ""}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {["received", "in_review"].includes(r.status) ? (
                        <ReviewRequestForm
                          requestId={r.id}
                          erasure={["erasure", "restriction"].includes(r.kind)}
                        />
                      ) : (
                        <>
                          {r.decision_note ? <p>Decisión: {r.decision_note}</p> : null}
                          {["access", "portability"].includes(r.kind) ? (
                            <a
                              href={`/admin/privacidad/solicitudes/${r.id}/copia`}
                              className="hover:bg-accent inline-flex min-h-11 w-fit items-center gap-2 rounded-lg border px-3"
                            >
                              <Download className="size-4" aria-hidden /> Descargar copia de los
                              datos (JSON)
                            </a>
                          ) : null}
                          <CompleteRequestForm requestId={r.id} />
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {closed.length > 0 ? (
              <details>
                <summary className="cursor-pointer text-sm">
                  Resueltas recientemente ({closed.length})
                </summary>
                <ul className="mt-2 divide-y text-sm">
                  {closed.map((r) => (
                    <li key={r.id} className="py-2">
                      {DATA_REQUEST_LABELS[r.kind as keyof typeof DATA_REQUEST_LABELS] ?? r.kind} ·{" "}
                      {DATA_REQUEST_STATUS_LABELS[r.status] ?? r.status} ·{" "}
                      {formatDate(r.created_at)}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Retenciones legales</CardTitle>
            <CardDescription>
              Mientras estén activas, la retención automática no borra ni anonimiza esos datos y las
              solicitudes de supresión lo indican.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <LegalHoldForm
              employees={(employeesRes.data ?? []).map((e) => ({
                value: e.id,
                label: `${e.employee_code} · ${e.last_name}, ${e.first_name}`,
              }))}
            />
            <ul className="divide-y text-sm">
              {(holdsRes.data ?? []).map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {LEGAL_HOLD_LABELS[h.category as keyof typeof LEGAL_HOLD_LABELS] ?? h.category}{" "}
                    · {h.employees ? h.employees.employee_code : "toda la empresa"} · {h.reason} ·
                    desde {formatDate(h.created_at)}
                    {h.released_at ? ` · levantada el ${formatDate(h.released_at)}` : ""}
                  </span>
                  {h.released_at ? null : <ReleaseHoldForm holdId={h.id} />}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plazos de conservación</CardTitle>
            <CardDescription>
              Lo automático lo aplica la tarea programada (en simulación hasta que se active su
              ejecución). Lo marcado como pendiente necesita decisión de la organización
              (docs/PRIVACIDAD.md).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {(catalogRes.data ?? []).map((c) => (
                <li
                  key={c.category}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span>
                    <span className="font-medium">{c.data}</span> · {c.keep} · {c.action}
                  </span>
                  <Badge variant={c.automatic ? "secondary" : "outline"}>
                    {c.automatic ? "Automático" : "Pendiente de decisión"}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Acceso de soporte</CardTitle>
            <CardDescription>
              Soporte no ve datos de la empresa salvo que la administración se lo conceda: solo
              lectura de personas, cuentas, roles y auditoría, como mucho 24 horas, con motivo y
              registro. Puedes revocarlo en cualquier momento.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {staff.length > 0 ? (
              <SupportGrantForm staff={staff} />
            ) : (
              <p className="text-muted-foreground text-sm">
                Solo la administración de la empresa concede accesos.
              </p>
            )}
            <ul className="divide-y text-sm">
              {(grantsRes.data ?? []).map((g) => {
                const active = !g.revoked_at && Date.parse(g.expires_at) > now;
                return (
                  <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      {staffNames.get(g.support_user_id) ?? "Soporte"} · {g.reason} ·{" "}
                      {formatDate(g.starts_at)}
                      {g.revoked_at
                        ? " · revocado"
                        : active
                          ? ` · activo hasta ${new Date(g.expires_at).toISOString().slice(11, 16)} UTC`
                          : " · caducado"}
                    </span>
                    {active ? <RevokeSupportForm grantId={g.id} /> : null}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
