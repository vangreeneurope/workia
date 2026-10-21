-- =============================================================================
-- Storage privado para logotipos de empresa.
-- Ruta obligatoria: <company_id>/<archivo>. Acceso mediante URL firmada temporal.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-logos',
  'company-logos',
  false,
  524288, -- 512 KB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- Devuelve la empresa a la que pertenece un objeto (primer segmento de la ruta)
-- o null si la ruta no es válida.
create or replace function private.object_company_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  first_segment text := split_part(object_name, '/', 1);
begin
  if first_segment ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return first_segment::uuid;
  end if;
  return null;
end;
$$;

revoke all on function private.object_company_id(text) from public;
grant execute on function private.object_company_id(text) to authenticated, service_role;

create policy "company_logos_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'company-logos'
    and (
      private.is_global_admin()
      or private.is_company_member(private.object_company_id(name))
      or private.manages_in_company(private.object_company_id(name))
    )
  );

create policy "company_logos_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'company-logos' and private.is_global_admin());

create policy "company_logos_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'company-logos' and private.is_global_admin())
  with check (bucket_id = 'company-logos' and private.is_global_admin());

create policy "company_logos_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'company-logos' and private.is_global_admin());
