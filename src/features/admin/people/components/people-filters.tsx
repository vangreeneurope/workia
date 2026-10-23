import { Search } from "lucide-react";

import { SelectField } from "@/components/admin/select-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { clearPeopleSearch, setPeopleSearch } from "../actions";

/**
 * Búsqueda y filtros. El texto se envía por POST (Server Action) y se guarda
 * en una cookie: nunca aparece en la URL. Los filtros sin datos personales sí.
 */
export function PeopleFilters({
  search,
  situation,
  workCenterId,
  teamId,
  workCenters,
  teams,
}: {
  search: string;
  situation: string;
  workCenterId?: string;
  teamId?: string;
  workCenters: { id: string; name: string }[];
  teams: { id: string; name: string }[];
}) {
  return (
    <form
      action={setPeopleSearch}
      className="bg-card mb-4 grid gap-3 rounded-lg border p-4 md:grid-cols-[2fr_1fr_1fr_1fr_auto] md:items-end"
    >
      <div className="grid gap-2">
        <Label htmlFor="q">Buscar por nombre, apellidos o código</Label>
        <Input id="q" name="q" type="search" defaultValue={search} autoComplete="off" />
      </div>
      <SelectField
        name="situacion"
        label="Situación"
        defaultValue={situation}
        options={[
          { value: "activas", label: "En activo" },
          { value: "baja", label: "De baja" },
          { value: "todas", label: "Todas" },
        ]}
      />
      <SelectField
        name="centro"
        label="Centro"
        defaultValue={workCenterId ?? ""}
        placeholder="Todos"
        options={workCenters.map((w) => ({ value: w.id, label: w.name }))}
      />
      <SelectField
        name="equipo"
        label="Equipo"
        defaultValue={teamId ?? ""}
        placeholder="Todos"
        options={teams.map((t) => ({ value: t.id, label: t.name }))}
      />
      <div className="flex gap-2">
        <Button type="submit" className="flex-1 md:flex-none">
          <Search aria-hidden /> Aplicar
        </Button>
        {search || workCenterId || teamId || situation !== "activas" ? (
          <Button type="submit" variant="ghost" formAction={clearPeopleSearch}>
            Limpiar
          </Button>
        ) : null}
      </div>
    </form>
  );
}
