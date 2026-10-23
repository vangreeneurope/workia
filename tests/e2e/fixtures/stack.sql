-- Entorno E2E (SOLO PRUEBAS): rol con el que PostgREST se conecta y cambia al
-- rol de cada petición (anon, authenticated, service_role), como en Supabase.
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;
-- Storage simulado: la pasarela registra los objetos con la sesión de la persona
-- (las políticas de storage.objects se aplican igual que en Supabase).
grant usage on schema storage to anon, authenticated, service_role;
