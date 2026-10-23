-- =============================================================================
-- Observabilidad operativa (docs/OBSERVABILIDAD.md, ADR-064).
--
-- public.ops_metrics(): instantánea agregada de las colas y procesos en segundo
-- plano de TODA la plataforma (trabajos de OCR, outbox de avisos, correo,
-- exportaciones, tareas programadas y cierre contable). Solo recuentos,
-- antigüedades en segundos y tasas: ningún identificador de empresa o persona,
-- ningún contenido. Solo la ejecuta service_role (endpoint /api/salud/metricas
-- protegido con METRICS_TOKEN); ni anon ni authenticated.
--
-- Reversión: supabase/rollbacks/20261101100000_observabilidad.down.sql
-- =============================================================================

create or replace function public.ops_metrics(p_now timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'generated_at', p_now,
    'jobs', (
      select jsonb_build_object(
        'pending', count(*) filter (where j.status = 'pending'),
        'processing', count(*) filter (where j.status = 'processing'),
        -- Bloqueados más de 15 minutos: un trabajador murió a mitad.
        'stuck', count(*) filter (where j.status = 'processing' and j.locked_at < p_now - interval '15 minutes'),
        'failed_24h', count(*) filter (where j.status = 'failed' and j.updated_at >= p_now - interval '24 hours'),
        'oldest_pending_s', coalesce(extract(epoch from p_now - min(j.run_after) filter (
          where j.status = 'pending' and j.run_after <= p_now)), 0)::bigint
      ) from public.jobs j
    ),
    'ocr', (
      select jsonb_build_object(
        'runs_24h', count(*),
        'failed_24h', count(*) filter (where o.status = 'failed'),
        'needs_review_24h', count(*) filter (where o.status = 'needs_review'),
        'p95_duration_s', coalesce(round(percentile_cont(0.95) within group (
          order by extract(epoch from o.finished_at - o.started_at))
          filter (where o.finished_at is not null)::numeric, 1), 0)
      ) from public.ocr_runs o where o.started_at >= p_now - interval '24 hours'
    ),
    'outbox', (
      select jsonb_build_object(
        'pending', count(*) filter (where n.status = 'pending'),
        'failed', count(*) filter (where n.status = 'failed'),
        'oldest_pending_s', coalesce(extract(epoch from p_now - min(n.occurred_at) filter (
          where n.status = 'pending')), 0)::bigint
      ) from public.notification_outbox n
    ),
    -- "envios" (no "email"): el registro técnico redacta claves con "email".
    'envios', (
      select jsonb_build_object(
        'due', count(*) filter (where e.status in ('pending', 'sending') and e.next_attempt_at <= p_now),
        'sent_24h', count(*) filter (where e.status in ('sent', 'delivered') and e.updated_at >= p_now - interval '24 hours'),
        'failed_24h', count(*) filter (where e.status in ('failed', 'bounced', 'complained')
          and e.updated_at >= p_now - interval '24 hours'),
        'oldest_due_s', coalesce(extract(epoch from p_now - min(e.next_attempt_at) filter (
          where e.status in ('pending', 'sending') and e.next_attempt_at <= p_now)), 0)::bigint
      ) from public.email_deliveries e
    ),
    'report_exports', (
      select jsonb_build_object(
        'pending', count(*) filter (where r.status in ('pending', 'processing')),
        'failed_24h', count(*) filter (where r.status = 'failed' and r.created_at >= p_now - interval '24 hours'),
        'oldest_pending_s', coalesce(extract(epoch from p_now - min(r.created_at) filter (
          where r.status in ('pending', 'processing'))), 0)::bigint
      ) from public.report_exports r
    ),
    'scheduler', (
      select jsonb_build_object(
        'last_run_age_s', coalesce(extract(epoch from p_now - max(s.finished_at)), -1)::bigint,
        'runs_24h', count(*) filter (where s.finished_at >= p_now - interval '24 hours'),
        'failed_24h', count(*) filter (where not s.ok and s.finished_at >= p_now - interval '24 hours')
      ) from private.scheduled_job_runs s
    ),
    'settlement', jsonb_build_object(
      -- Lotes cerrados hace más de una hora sin ningún archivo generado.
      'batches_without_exports', (
        select count(*) from public.accounting_batches b
        where b.closed_at < p_now - interval '1 hour'
          and not exists (select 1 from public.accounting_exports x where x.batch_id = b.id)
      ),
      -- Informes de meses ya cerrados que siguen sin decidir.
      'reports_pending_past_months', (
        select count(*) from public.expense_reports r
        where r.status in ('submitted', 'in_review')
          and r.period_month < date_trunc('month', p_now at time zone 'Europe/Madrid')::date
      )
    )
  );
$$;

comment on function public.ops_metrics(timestamptz) is
  'Métricas operativas agregadas (sin datos de empresas ni personas). Solo service_role.';

revoke all on function public.ops_metrics(timestamptz) from public, anon, authenticated;
grant execute on function public.ops_metrics(timestamptz) to service_role;
