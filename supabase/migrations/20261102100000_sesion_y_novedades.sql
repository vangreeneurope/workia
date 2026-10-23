-- =============================================================================
-- Duración máxima de la sesión por empresa y novedades vistas (ADR-067, ADR-068).
--
-- companies.session_max_minutes: la sesión se cierra siempre a los N minutos de
-- entrar, aunque se esté usando (60 por defecto, de 15 a 720). La cambia quien
-- gestiona la empresa (company.manage) en Administración › Configuración.
--
-- public.my_session_limit(): minutos que se aplican a la persona que llama: el
-- valor más corto de las empresas en las que tiene una membresía vigente (60 si
-- no tiene ninguna). Solo devuelve un número relativo al usuario actual.
--
-- profiles.last_seen_release: última versión (vAA.N) cuyas novedades ha visto la
-- persona; solo ella la actualiza (política profiles_update_own).
--
-- Reversión: supabase/rollbacks/20261102100000_sesion_y_novedades.down.sql
-- =============================================================================

alter table public.companies
  add column session_max_minutes smallint not null default 60
    constraint companies_session_max_minutes_check check (session_max_minutes between 15 and 720);

comment on column public.companies.session_max_minutes is
  'Minutos tras el acceso en que se cierra la sesión, aunque se esté usando (ADR-067).';

grant update (session_max_minutes) on public.companies to authenticated;

alter table public.profiles
  add column last_seen_release text
    constraint profiles_last_seen_release_check check (
      last_seen_release is null or last_seen_release ~ '^v[0-9]{2}\.[0-9]{1,6}$'
    );

comment on column public.profiles.last_seen_release is
  'Última versión (vAA.N) cuyas novedades ha visto la persona (ADR-068).';

grant update (last_seen_release) on public.profiles to authenticated;

create or replace function public.my_session_limit()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(min(c.session_max_minutes)::integer, 60)
  from public.company_memberships m
  join public.companies c on c.id = m.company_id
  join public.groups g on g.id = c.group_id
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and private.is_active_window(m.valid_from, m.valid_to)
    and c.status = 'active'
    and g.status = 'active';
$$;

revoke all on function public.my_session_limit() from public, anon, authenticated;
grant execute on function public.my_session_limit() to authenticated, service_role;
