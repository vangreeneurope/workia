-- Aserciones compartidas para las pruebas SQL. Incluir con: \ir helpers/asserts.sql
-- Cualquier fallo lanza una excepción y detiene el archivo (ON_ERROR_STOP).

\set ON_ERROR_STOP on
\set QUIET on

create schema if not exists test;
grant usage on schema test to public;

create or replace function test.ok(condition boolean, description text)
returns void language plpgsql as $$
begin
  if condition is distinct from true then
    raise exception 'FALLO: %', description;
  end if;
  raise notice 'ok - %', description;
end $$;

-- Ejecuta SQL y exige que falle (RLS, privilegios o restricciones).
-- Si se indica expected, el mensaje de error debe contenerlo.
create or replace function test.fails(statement text, description text, expected text default null)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if expected is not null and position(expected in sqlerrm) = 0 then
      raise exception 'FALLO: % (error inesperado: %)', description, sqlerrm;
    end if;
    raise notice 'ok - % (%)', description, sqlerrm;
    return;
  end;
  raise exception 'FALLO: se esperaba error en: %', description;
end $$;

-- Ejecuta un UPDATE/DELETE y devuelve cuántas filas afectó (RLS filtra sin error).
create or replace function test.affected(statement text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute statement;
  get diagnostics n = row_count;
  return n;
end $$;

-- Actúa como un usuario autenticado (claims del JWT que usa auth.uid()).
create or replace function test.act_as(user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id, 'role', 'authenticated')::text, false);
end $$;

grant execute on all functions in schema test to public;
