import { Calculator, Camera, ChevronRight, FileStack, Inbox, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { StatusBadge } from "@/components/admin/status-badge";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  EXPENSE_STATUS_BADGE,
  EXPENSE_STATUS_LABELS,
  SOURCE_LABELS,
  type ExpenseStatus,
} from "@/features/expenses/labels";
import { formatCents } from "@/features/expenses/money";
import { getExpenseAccess } from "@/features/expenses/queries";
import { getOwnEmployeeId } from "@/features/schedules/queries";
import { requireSection } from "@/lib/auth/dal";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Gastos" };

type Row = {
  id: string;
  source: string;
  status: ExpenseStatus;
  expense_date: string | null;
  merchant_name: string | null;
  total_cents: number | null;
  currency: string | null;
  created_at: string;
};

function ExpenseList({ rows, owner }: { rows: (Row & { who?: string })[]; owner: boolean }) {
  return (
    <ul className="divide-y">
      {rows.map((r) => (
        <li key={r.id}>
          <Link
            href={`/gastos/${r.id}`}
            className="hover:bg-accent/60 -mx-2 flex min-h-14 items-center gap-3 rounded-lg px-2 py-3 text-sm"
          >
            <div className="grid min-w-0 flex-1 gap-0.5">
              <span className="truncate font-medium">
                {r.who ? `${r.who} · ` : ""}
                {r.source === "mileage"
                  ? "Kilometraje"
                  : (r.merchant_name ??
                    (owner && r.status === "draft"
                      ? "Pendiente de revisar"
                      : SOURCE_LABELS[r.source]))}
              </span>
              <span className="text-muted-foreground">
                {r.expense_date
                  ? formatDate(r.expense_date)
                  : `Creado el ${formatDate(r.created_at)}`}
              </span>
            </div>
            <span className="text-right font-semibold tabular-nums">
              {r.total_cents !== null ? formatCents(r.total_cents, r.currency ?? "EUR") : "—"}
            </span>
            <StatusBadge
              status={EXPENSE_STATUS_BADGE[r.status]}
              label={EXPENSE_STATUS_LABELS[r.status]}
            />
            <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function GastosPage() {
  await requireSection("gastos");
  const [employeeId, access] = await Promise.all([getOwnEmployeeId(), getExpenseAccess()]);
  const supabase = await createClient();
  const columns =
    "id, source, status, expense_date, merchant_name, total_cents, currency, created_at";
  const [ownRes, othersRes] = await Promise.all([
    employeeId
      ? supabase
          .from("expenses")
          .select(columns)
          .eq("employee_id", employeeId)
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] as Row[] }),
    access.read
      ? supabase
          .from("expenses")
          .select(`${columns}, employees (first_name, last_name, employee_code)`)
          .neq("employee_id", employeeId ?? "00000000-0000-0000-0000-000000000000")
          .neq("status", "discarded")
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] }),
  ]);
  const own = (ownRes.data ?? []) as Row[];
  const drafts = own.filter((r) => r.status === "draft").length;
  const others = (othersRes.data ?? []).map((r) => ({
    ...(r as Row),
    who: r.employees ? `${r.employees.last_name}, ${r.employees.first_name}` : "",
  }));

  return (
    <>
      <PageHeader
        title="Gastos"
        description="Fotografía tus tickets, revisa los datos y marca cada gasto como listo."
        actions={
          <div className="flex flex-wrap gap-2">
            {employeeId ? (
              <>
                <Link
                  href="/gastos/nuevo"
                  className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium"
                >
                  <Camera className="size-4" aria-hidden /> Nuevo gasto
                </Link>
                <Link
                  href="/gastos/informes"
                  className="hover:bg-accent inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium"
                >
                  <FileStack className="size-4" aria-hidden /> Informes
                </Link>
              </>
            ) : null}
            {access.approve ? (
              <Link
                href="/gastos/bandeja"
                className="hover:bg-accent inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium"
              >
                <Inbox className="size-4" aria-hidden /> Bandeja
                {access.pendingApprovals > 0 ? (
                  <span className="bg-primary text-primary-foreground rounded-full px-2 text-xs">
                    {access.pendingApprovals}
                  </span>
                ) : null}
              </Link>
            ) : null}
            {access.accounting ? (
              <Link
                href="/gastos/contabilidad"
                className="hover:bg-accent inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium"
              >
                <Calculator className="size-4" aria-hidden /> Contabilidad
              </Link>
            ) : null}
          </div>
        }
      />
      {!employeeId ? (
        <Alert>
          <Info />
          <AlertTitle>No tienes ficha de empleado en la empresa activa</AlertTitle>
          <AlertDescription>
            Pide a RR. HH. que complete tu ficha para registrar gastos.
          </AlertDescription>
        </Alert>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mis gastos</CardTitle>
            <CardDescription>
              {drafts > 0
                ? `${drafts === 1 ? "Tienes 1 borrador" : `Tienes ${drafts} borradores`} por revisar y confirmar.`
                : "Todo revisado."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {own.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Aún no tienes gastos. Pulsa «Nuevo gasto» y haz una foto del ticket.
              </p>
            ) : (
              <ExpenseList rows={own} owner />
            )}
          </CardContent>
        </Card>
      )}
      {access.read ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">Gastos de tu equipo o ámbito</CardTitle>
            <CardDescription>
              Solo consulta. Cada persona revisa y confirma los suyos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {others.length === 0 ? (
              <p className="text-muted-foreground text-sm">No hay gastos para mostrar.</p>
            ) : (
              <ExpenseList rows={others} owner={false} />
            )}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
