-- =============================================================================
-- Escáner de seguridad del catálogo (se ejecuta con todas las migraciones).
-- Falla si una migración futura deja una tabla sin RLS, concede algo a anon,
-- permite borrar, deja una función SECURITY DEFINER sin search_path, crea una
-- vista que eluda RLS, un bucket público o una política que lea metadatos del
-- JWT. Cada excepción está justificada en docs/SEGURIDAD.md (§ 4).
-- =============================================================================

\ir helpers/asserts.sql

select test.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
), 'Toda tabla de public tiene RLS activada');

select test.ok((select coalesce(array_agg(c.relname::text order by c.relname), '{}')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and not a.attisdropped
      and a.attname in ('company_id', 'group_id')))
  = array['groups', 'platform_admins', 'profiles'],
  'Toda tabla de public lleva company_id o group_id (salvo groups, platform_admins y profiles)');

select test.ok(not exists (
  select 1 from information_schema.role_table_grants
  where grantee = 'anon' and table_schema in ('public', 'private', 'storage')
) and not exists (
  select 1 from information_schema.column_privileges
  where grantee = 'anon' and table_schema in ('public', 'private')
), 'anon no tiene privilegios sobre ninguna tabla ni columna');

select test.ok(not exists (
  select 1 from information_schema.role_table_grants
  where grantee = 'authenticated' and table_schema in ('public', 'private')
    and privilege_type in ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
), 'authenticated no puede borrar, vaciar, referenciar ni crear triggers en ninguna tabla');

select test.ok(not exists (
  select 1 from information_schema.role_table_grants
  where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE')
), 'authenticated no tiene INSERT ni UPDATE a nivel de tabla (solo por columna)');

select test.ok(not exists (
  select 1 from information_schema.column_privileges
  where grantee = 'authenticated' and table_schema = 'public' and privilege_type = 'UPDATE'
    and column_name in ('id', 'company_id', 'group_id')
), 'Ninguna clave (id, company_id, group_id) es modificable por authenticated (al insertar, RLS la comprueba)');

select test.ok(not exists (
  select 1 from information_schema.role_table_grants
  where grantee in ('anon', 'authenticated') and table_schema = 'private'
), 'Las tablas de private no son accesibles desde la API');

select test.ok(not has_schema_privilege('anon', 'private', 'usage'),
  'anon no tiene acceso al esquema private');

select test.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'S' and n.nspname = 'public'
    and (has_sequence_privilege('anon', c.oid, 'usage') or has_sequence_privilege('authenticated', c.oid, 'select'))
), 'Las secuencias no son legibles desde la API (no revelan recuentos globales)');

select test.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
), 'Toda función de public y private fija search_path');

select test.ok((select coalesce(array_agg(p.proname::text order by p.proname), '{}')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute'))
  = array['kiosk_device_info', 'kiosk_punch'],
  'anon solo ejecuta las funciones del terminal (token de dispositivo y PIN, ADR-036)');

select test.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.proname in ('run_retention', 'expire_report_exports', 'process_notification_outbox',
      'claim_email_deliveries', 'complete_email_delivery', 'record_email_event', 'run_scheduled_reminders',
      'record_job_run', 'settle_vacation_balances', 'expired_punch_selfies', 'mark_punch_selfie_purged')
    and has_function_privilege('authenticated', p.oid, 'execute')
), 'Las funciones de tareas programadas solo las ejecuta service_role (el OCR corre con la sesión de la persona, ADR-043)');

select test.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('v', 'm') and n.nspname in ('public', 'private')
    and not coalesce('security_invoker=true' = any (c.reloptions), false)
), 'Ninguna vista elude RLS (no hay vistas o todas son security_invoker)');

select test.ok(not exists (select 1 from storage.buckets where public)
  and not exists (select 1 from storage.buckets where file_size_limit is null or allowed_mime_types is null),
  'Todos los buckets son privados, con tamaño máximo y tipos permitidos');

select test.ok(not exists (select 1 from storage.buckets where 'image/svg+xml' = any (allowed_mime_types)
  or 'text/html' = any (allowed_mime_types)), 'Ningún bucket admite SVG ni HTML (contenido activo)');

select test.ok(not exists (
  select 1 from pg_policies
  where coalesce(qual, '') ~* '(metadata|auth\.jwt|request\.jwt)' or coalesce(with_check, '') ~* '(metadata|auth\.jwt|request\.jwt)'
), 'Ninguna política lee metadatos o claims del JWT (los permisos viven en tablas)');

select test.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prosrc ~* '(user_metadata|app_metadata|raw_user_meta|raw_app_meta)'
    and p.proname not in ('handle_new_user')
), 'Ninguna función decide permisos con user_metadata/app_metadata (handle_new_user solo copia el nombre)');

select test.ok(not exists (
  select 1 from pg_policies where 'anon' = any (roles) or 'public' = any (roles)
), 'Ninguna política se aplica a anon o public');

select test.ok(not exists (
  select 1 from pg_policies where coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true'
), 'Ninguna política concede acceso incondicional');

select test.ok(not exists (
  select 1 from pg_policies where schemaname = 'storage' and cmd in ('DELETE', 'UPDATE')
    and policyname not like 'company_logos%'
), 'Solo los logotipos admiten reemplazo o borrado desde la API; tickets, justificantes, selfies y exportaciones no');

select test.ok(not exists (
  select 1 from information_schema.column_privileges
  where grantee = 'authenticated' and table_schema = 'public' and table_name = 'punches'
    and column_name in ('latitude', 'longitude', 'accuracy_m', 'selfie_path')
), 'Coordenadas y selfies de fichajes no son legibles por la API general');

select test.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('audit_events', 'audit_log', 'report_export_downloads',
    'support_access_grants', 'legal_holds', 'data_subject_requests', 'expense_receipts', 'email_delivery_events')
    and not exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      where t.tgrelid = c.oid and p.proname = 'prevent_mutation')
), 'Auditoría, descargas, accesos de soporte, retenciones, solicitudes y tickets no se borran (trigger)');

select test.ok(private.role_requires_mfa('company_admin') and private.role_requires_mfa('hr')
  and private.role_requires_mfa('accounting') and private.role_requires_mfa('auditor')
  and not private.role_requires_mfa('employee') and not private.role_requires_mfa('manager'),
  'MFA obligatorio para administración, RR. HH., contabilidad y auditoría');

select test.ok((select mfa_enforced from private.security_settings where id = 1),
  'MFA activado en la plataforma (degradación solo por procedimiento documentado)');

\echo 'Escáner de catálogo de seguridad sin hallazgos.'
