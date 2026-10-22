import { SelectField } from "@/components/admin/select-field";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";

import type { ReportDef } from "../catalog";
import {
  AUDIT_ACTIONS,
  EXPENSE_GROUPS,
  EXPENSE_GROUP_LABELS,
  URL_PARAMS,
  type ReportFilters,
} from "../filters";
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS } from "../rows";

type Option = { value: string; label: string };

export type FilterOptions = {
  employees: Option[];
  teams: Option[];
  centers: Option[];
  actors: Option[];
};

/**
 * Filtros como formulario GET: se guardan en la URL (solo fechas, ids y
 * códigos) y funcionan sin JavaScript. El servidor los vuelve a validar.
 */
export function ReportFiltersForm({
  def,
  filters,
  options,
  action,
}: {
  def: ReportDef;
  filters: ReportFilters;
  options: FilterOptions;
  action: string;
}) {
  const has = (k: ReportDef["filters"][number]) => def.filters.includes(k);
  const any = (label: string, list: Option[]) => [{ value: "", label }, ...list];
  return (
    <form method="get" action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {has("period") ? (
        <>
          <FormField
            name={URL_PARAMS.from}
            id="f-desde"
            label="Desde"
            type="date"
            defaultValue={filters.from}
            required
          />
          <FormField
            name={URL_PARAMS.to}
            id="f-hasta"
            label="Hasta"
            type="date"
            defaultValue={filters.to}
            required
          />
        </>
      ) : null}
      {has("day") ? (
        <FormField
          name={URL_PARAMS.day}
          id="f-dia"
          label="Día"
          type="date"
          defaultValue={filters.day}
          required
        />
      ) : null}
      {has("group") ? (
        <SelectField
          name={URL_PARAMS.group}
          id="f-agrupar"
          label="Agrupar por"
          defaultValue={filters.group}
          options={EXPENSE_GROUPS.map((g) => ({ value: g, label: EXPENSE_GROUP_LABELS[g] }))}
        />
      ) : null}
      {has("employee") && options.employees.length > 0 ? (
        <SelectField
          name={URL_PARAMS.employee}
          id="f-persona"
          label="Persona"
          defaultValue={filters.employee ?? ""}
          options={any("Todas", options.employees)}
        />
      ) : null}
      {has("team") && options.teams.length > 0 ? (
        <SelectField
          name={URL_PARAMS.team}
          id="f-equipo"
          label="Equipo"
          defaultValue={filters.team ?? ""}
          options={any("Todos", options.teams)}
        />
      ) : null}
      {has("center") && options.centers.length > 0 ? (
        <SelectField
          name={URL_PARAMS.center}
          id="f-centro"
          label="Centro"
          defaultValue={filters.center ?? ""}
          options={any("Todos", options.centers)}
        />
      ) : null}
      {has("client") ? (
        <FormField
          name={URL_PARAMS.client}
          id="f-cliente"
          label="Cliente contiene"
          maxLength={60}
          defaultValue={filters.client ?? ""}
        />
      ) : null}
      {has("project") ? (
        <FormField
          name={URL_PARAMS.project}
          id="f-proyecto"
          label="Proyecto (código)"
          maxLength={60}
          defaultValue={filters.project ?? ""}
        />
      ) : null}
      {has("actor") ? (
        <SelectField
          name={URL_PARAMS.actor}
          id="f-actor"
          label="Actor"
          defaultValue={filters.actor ?? ""}
          options={any("Cualquiera", options.actors)}
        />
      ) : null}
      {has("entity") ? (
        <SelectField
          name={URL_PARAMS.entity}
          id="f-objeto"
          label="Objeto"
          defaultValue={filters.entity ?? ""}
          options={any(
            "Cualquiera",
            Object.entries(AUDIT_ENTITY_LABELS).map(([value, label]) => ({ value, label })),
          )}
        />
      ) : null}
      {has("action") ? (
        <SelectField
          name={URL_PARAMS.action}
          id="f-accion"
          label="Acción"
          defaultValue={filters.action ?? ""}
          options={any(
            "Cualquiera",
            AUDIT_ACTIONS.map((a) => ({ value: a, label: AUDIT_ACTION_LABELS[a] ?? a })),
          )}
        />
      ) : null}
      {has("object") ? (
        <FormField
          name={URL_PARAMS.object}
          id="f-id"
          label="Identificador del objeto"
          maxLength={64}
          pattern="[A-Za-z0-9-]{1,64}"
          defaultValue={filters.object ?? ""}
        />
      ) : null}
      <div className="flex items-end">
        <Button type="submit" className="min-h-11 w-full sm:w-auto">
          Aplicar filtros
        </Button>
      </div>
    </form>
  );
}
