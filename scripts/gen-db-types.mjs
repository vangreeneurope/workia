#!/usr/bin/env node
// Genera src/types/database.ts a partir del esquema real (catálogo de PostgreSQL)
// con el mismo formato que `supabase gen types typescript`.
//
// No se ejecuta directamente: lo invoca scripts/gen-db-types.sh, que levanta un
// PostgreSQL desechable con las migraciones aplicadas y exporta PGHOST/PGPORT/PGUSER.
//
//   node scripts/gen-db-types.mjs <base> [--check]
//
// Con --check no escribe: compara con el archivo actual y falla si difieren.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TARGET = fileURLToPath(new URL("../src/types/database.ts", import.meta.url));
const [database, flag] = process.argv.slice(2);
if (!database) {
  console.error("Uso: node scripts/gen-db-types.mjs <base> [--check]");
  process.exit(2);
}

const INTROSPECTION_SQL = `
with cols as (
  select c.oid as relid, a.attnum, a.attname, not a.attnotnull as nullable,
    (a.atthasdef or a.attidentity <> '') as has_default,
    a.attidentity = 'a' as identity_always,
    a.attgenerated <> '' as generated,
    coalesce(et.typname, t.typname) as base_type,
    coalesce(et.typtype, t.typtype) as base_kind,
    coalesce(etn.nspname, tn.nspname) as base_schema,
    et.oid is not null as is_array
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  join pg_type t on t.oid = a.atttypid
  join pg_namespace tn on tn.oid = t.typnamespace
  left join pg_type et on et.oid = t.typelem and t.typcategory = 'A'
  left join pg_namespace etn on etn.oid = et.typnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
)
select json_build_object(
  'tables', (
    select coalesce(json_agg(x order by x.name), '[]'::json) from (
      select c.relname as name,
        (select json_agg(json_build_object(
            'name', k.attname, 'nullable', k.nullable, 'hasDefault', k.has_default,
            'identityAlways', k.identity_always, 'generated', k.generated,
            'type', k.base_type, 'kind', k.base_kind, 'schema', k.base_schema, 'isArray', k.is_array
          ) order by k.attname)
         from cols k where k.relid = c.oid) as columns,
        (select coalesce(json_agg(json_build_object(
            'name', co.conname,
            'columns', (select json_agg(att.attname order by u.ord)
                        from unnest(co.conkey) with ordinality u(attnum, ord)
                        join pg_attribute att on att.attrelid = co.conrelid and att.attnum = u.attnum),
            'refTable', rc.relname,
            'refColumns', (select json_agg(att.attname order by u.ord)
                           from unnest(co.confkey) with ordinality u(attnum, ord)
                           join pg_attribute att on att.attrelid = co.confrelid and att.attnum = u.attnum),
            'oneToOne', exists (
              select 1 from pg_constraint uq
              where uq.conrelid = co.conrelid and uq.contype in ('p', 'u')
                and uq.conkey::int[] <@ co.conkey::int[] and co.conkey::int[] <@ uq.conkey::int[]
            )
          ) order by co.conname), '[]'::json)
         from pg_constraint co
         join pg_class rc on rc.oid = co.confrelid
         join pg_namespace rn on rn.oid = rc.relnamespace
         where co.conrelid = c.oid and co.contype = 'f' and rn.nspname = 'public') as relationships
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
    ) x
  ),
  'enums', (
    select coalesce(json_object_agg(t.typname,
      (select json_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid)
      order by t.typname), '{}'::json)
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype = 'e'
  )
)::text;
`;

const SCALARS = {
  uuid: "string",
  text: "string",
  varchar: "string",
  bpchar: "string",
  citext: "string",
  date: "string",
  time: "string",
  timetz: "string",
  timestamp: "string",
  timestamptz: "string",
  interval: "string",
  bytea: "string",
  int2: "number",
  int4: "number",
  int8: "number",
  float4: "number",
  float8: "number",
  numeric: "number",
  bool: "boolean",
  json: "Json",
  jsonb: "Json",
};

function tsType(column) {
  let base;
  if (column.kind === "e" && column.schema === "public") {
    base = `Database["public"]["Enums"][${JSON.stringify(column.type)}]`;
  } else {
    base = SCALARS[column.type] ?? "unknown";
  }
  return column.isArray ? `${base}[]` : base;
}

function render(schema) {
  const out = [];
  out.push(
    "// ARCHIVO GENERADO. No editar a mano.",
    "// Origen: supabase/migrations/ · Comando: npm run db:types",
    "// Equivalente con la CLI de Supabase (requiere Docker o proyecto enlazado):",
    "//   npx supabase gen types typescript --local --schema public > src/types/database.ts",
    "",
    "export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];",
    "",
    "export type Database = {",
    "  public: {",
    "    Tables: {",
  );
  for (const table of schema.tables) {
    const row = table.columns.map((c) => `${c.name}: ${tsType(c)}${c.nullable ? " | null" : ""};`);
    const insert = table.columns.map((c) => {
      if (c.identityAlways || c.generated) return `${c.name}?: never;`;
      const optional = c.nullable || c.hasDefault;
      return `${c.name}${optional ? "?" : ""}: ${tsType(c)}${c.nullable ? " | null" : ""};`;
    });
    const update = table.columns.map((c) => {
      if (c.identityAlways || c.generated) return `${c.name}?: never;`;
      return `${c.name}?: ${tsType(c)}${c.nullable ? " | null" : ""};`;
    });
    const relationships = table.relationships.map(
      (r) =>
        `{ foreignKeyName: ${JSON.stringify(r.name)}; columns: ${JSON.stringify(r.columns)}; ` +
        `isOneToOne: ${r.oneToOne}; referencedRelation: ${JSON.stringify(r.refTable)}; ` +
        `referencedColumns: ${JSON.stringify(r.refColumns)} },`,
    );
    out.push(
      `      ${table.name}: {`,
      `        Row: { ${row.join(" ")} };`,
      `        Insert: { ${insert.join(" ")} };`,
      `        Update: { ${update.join(" ")} };`,
      `        Relationships: [ ${relationships.join(" ")} ];`,
      "      };",
    );
  }
  out.push(
    "    };",
    "    Views: { [_ in never]: never };",
    "    Functions: { [_ in never]: never };",
  );
  out.push("    Enums: {");
  for (const [name, labels] of Object.entries(schema.enums)) {
    out.push(`      ${name}: ${labels.map((l) => JSON.stringify(l)).join(" | ")};`);
  }
  out.push(
    "    };",
    "    CompositeTypes: { [_ in never]: never };",
    "  };",
    "};",
    "",
    'type PublicSchema = Database["public"];',
    "",
    'export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];',
    'export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];',
    'export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];',
    'export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];',
    "",
  );
  return out.join("\n");
}

const json = execFileSync("psql", ["-d", database, "-At", "-X", "-c", INTROSPECTION_SQL], {
  encoding: "utf8",
});
const source = render(JSON.parse(json));
const formatted = execFileSync("npx", ["prettier", "--stdin-filepath", TARGET], {
  input: source,
  encoding: "utf8",
});

if (flag === "--check") {
  let current = "";
  try {
    current = readFileSync(TARGET, "utf8");
  } catch {
    // Sin archivo: se considera desactualizado.
  }
  if (current !== formatted) {
    console.error(
      "src/types/database.ts no coincide con las migraciones. Ejecuta: npm run db:types",
    );
    process.exit(1);
  }
  process.stdout.write("Tipos de base de datos al día.\n");
} else {
  writeFileSync(TARGET, formatted);
  process.stdout.write("Generado src/types/database.ts\n");
}
