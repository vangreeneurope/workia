-- =============================================================================
-- SOLO PARA PRUEBAS LOCALES EN POSTGRESQL "PELADO" (no es una migración).
-- Emula lo mínimo de Supabase que usan las migraciones: roles, auth.users,
-- auth.uid(), esquema extensions y storage.buckets/objects.
-- En un proyecto Supabase real este archivo NO se ejecuta.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;

grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;

-- Privilegios por defecto equivalentes a los de un proyecto Supabase.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Subconjunto de columnas reales de auth.users e auth.identities que usan las
-- semillas (supabase/seeds). Los tokens deben ser '' y no NULL para GoTrue.
create table auth.users (
  id                     uuid primary key,
  instance_id            uuid,
  aud                    varchar(255),
  role                   varchar(255),
  email                  varchar(255),
  encrypted_password     varchar(255),
  email_confirmed_at     timestamptz,
  raw_app_meta_data      jsonb default '{}'::jsonb,
  raw_user_meta_data     jsonb not null default '{}'::jsonb,
  confirmation_token     varchar(255),
  recovery_token         varchar(255),
  email_change_token_new varchar(255),
  email_change           varchar(255),
  created_at             timestamptz default now(),
  updated_at             timestamptz default now()
);

create table auth.identities (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  provider_id     text not null,
  identity_data   jsonb not null,
  provider        text not null,
  last_sign_in_at timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique (provider_id, provider)
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;

create table storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name      text not null,
  owner     uuid
);

alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;
