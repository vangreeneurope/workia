-- =============================================================================
-- Reversión de 20261101100000_observabilidad.sql
--
-- Deja el esquema exactamente como tras 20261031100000_seguridad.sql.
-- Pérdida de datos: ninguna (solo elimina una función de lectura).
-- =============================================================================

drop function if exists public.ops_metrics(timestamptz);
