-- =============================================================================
-- Reversión de 20261102100000_sesion_y_novedades.sql
--
-- Deja el esquema exactamente como tras 20261101100000_observabilidad.sql.
-- Pérdida de datos: la duración de sesión configurada en cada empresa y la
-- última versión de novedades vista por cada persona. Aborta si hay valores
-- distintos de los de por defecto, salvo: set app.allow_lossy_rollback = 'on';
-- =============================================================================

do $$
begin
  if coalesce(current_setting('app.allow_lossy_rollback', true), 'off') <> 'on' and (
    exists (select 1 from public.companies where session_max_minutes <> 60)
    or exists (select 1 from public.profiles where last_seen_release is not null)
  ) then
    raise exception 'La reversión perdería la duración de sesión de alguna empresa o las novedades vistas. Usa app.allow_lossy_rollback si es intencionado.';
  end if;
end;
$$;

drop function if exists public.my_session_limit();

revoke update (last_seen_release) on public.profiles from authenticated;
alter table public.profiles drop column if exists last_seen_release;

revoke update (session_max_minutes) on public.companies from authenticated;
alter table public.companies drop column if exists session_max_minutes;
