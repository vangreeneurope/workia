-- =============================================================================
-- Reversión de 20261025100000_control_horario.sql
--
-- Deja el esquema exactamente como tras 20261024100000_calendarios_turnos.sql
-- (verificado por scripts/test-db.sh). La extensión pgcrypto se conserva.
--
-- Pérdida de datos: fichajes, jornadas, correcciones, ajustes, incidencias,
-- políticas, terminales, PIN y eventos de trabajo. El registro de jornada debe
-- conservarse 4 años (docs/NORMATIVA.md): exporta antes de revertir. Aborta si
-- existen datos, salvo que se ejecute antes:  set app.allow_lossy_rollback = 'on';
-- Los archivos del bucket punch-selfies deben borrarse antes con la API de Storage.
-- =============================================================================

do $$
begin
  if coalesce(current_setting('app.allow_lossy_rollback', true), 'off') <> 'on' and (
    exists (select 1 from public.time_entries)
    or exists (select 1 from public.time_correction_requests)
    or exists (select 1 from public.time_tracking_policies)
    or exists (select 1 from public.kiosk_devices)
    or exists (select 1 from public.kiosk_pins)
    or exists (select 1 from public.work_events)
  ) then
    raise exception 'La reversión perdería registros de jornada. Expórtalos, revisa docs/CONTROL_HORARIO.md y usa app.allow_lossy_rollback si es intencionado.';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'punch-selfies') then
    raise exception 'Quedan selfies en el bucket punch-selfies: bórralas con la API de Storage antes de revertir.';
  end if;
end;
$$;

drop policy "punch_selfies_select" on storage.objects;
drop policy "punch_selfies_insert" on storage.objects;
delete from storage.buckets where id = 'punch-selfies';

drop function private.upsert_incident(public.time_entries, public.time_incident_kind, text, jsonb, uuid);
drop table public.work_events;
drop table public.kiosk_attempts;
drop table public.kiosk_pins;
drop table public.time_incidents;
drop table public.time_adjustments;
drop table public.time_correction_requests;
drop table public.punches;
drop table public.kiosk_devices;
drop table public.time_entries;
drop table public.time_tracking_policies;

drop function public.mark_punch_selfie_purged(uuid);
drop function public.expired_punch_selfies(integer);
drop function public.generate_time_reminders(timestamptz);
drop function public.resolve_time_incident(uuid, public.time_incident_status, text);
drop function public.decide_time_correction(uuid, boolean, text);
drop function public.cancel_time_correction(uuid);
drop function public.request_time_correction(uuid, public.correction_action, text, uuid, uuid, public.punch_kind, timestamptz);
drop function public.kiosk_punch(text, text, text, public.punch_kind, uuid, timestamptz);
drop function public.reset_kiosk_pin(uuid);
drop function public.set_my_kiosk_pin(uuid, text);
drop function public.kiosk_device_info(text);
drop function public.register_kiosk_device(uuid, text);
drop function public.my_time_access(uuid);
drop function public.my_time_status(uuid);
drop function public.record_punch(uuid, public.punch_kind, uuid, public.punch_source, timestamptz, uuid,
  public.location_status, numeric, numeric, integer, text);
drop function private.guard_incident();
drop function private.guard_adjustment();
drop function private.guard_correction_request();
drop function private.guard_punch();
drop function private.object_employee_id(text);
drop function private.token_hash(text);
drop function private.insert_punch(uuid, public.punch_kind, uuid, public.punch_source, timestamptz, uuid, uuid,
  public.location_status, numeric, numeric, integer, text, timestamptz);
drop function private.recalculate_time_entry(uuid);
drop function private.time_entry_snapshot(uuid);
drop function private.effective_punches(uuid);
drop function private.punch_transition(public.time_entry_status, public.punch_kind);
drop function private.effective_time_policy(uuid);
drop function private.planned_shift(uuid, date);
drop function private.local_to_utc(text, date, integer);
drop function private.employee_time_zone(uuid);
drop function private.can_decide_time_corrections(uuid);
drop function private.can_read_employee_time(uuid);
drop function private.employee_time_permission(uuid, text);
drop function private.has_time_permission(uuid, text, uuid, uuid);
drop function private.role_has_time_permission(public.app_role, text);

drop type public.correction_status;
drop type public.correction_action;
drop type public.time_incident_status;
drop type public.time_incident_kind;
drop type public.time_entry_status;
drop type public.location_mode;
drop type public.location_status;
drop type public.punch_source;
drop type public.punch_kind;
