-- FONKON Market OS: operational hardening for the field-market workflow.
-- Geofence results are evidence, never a blocking attendance rule. Photo scene
-- observations are human-confirmed facts and contain no prices or amounts.

alter table public.field_sessions
  add column if not exists start_distance_m numeric(10,2),
  add column if not exists start_geofence_status text not null default 'unconfigured';

alter table public.field_sessions
  drop constraint if exists field_sessions_start_geofence_status_check;
alter table public.field_sessions
  add constraint field_sessions_start_geofence_status_check
  check (start_geofence_status in ('unconfigured','inside','outside','unavailable'));

alter table public.field_evidence
  add column if not exists touchpoint_id uuid,
  add column if not exists location_status text,
  add column if not exists location_exception text,
  add column if not exists distance_from_market_m numeric(10,2),
  add column if not exists geofence_status text not null default 'unconfigured',
  add column if not exists scene_observations jsonb not null default '{}'::jsonb;

update public.field_evidence
set location_status = case
  when latitude is not null and longitude is not null and coalesce(accuracy_m, 999999) <= 200 then 'verified'
  when latitude is not null and longitude is not null then 'low_accuracy'
  else 'unavailable'
end
where location_status is null;

alter table public.field_evidence
  alter column location_status set default 'unavailable',
  alter column location_status set not null;

alter table public.field_evidence
  drop constraint if exists field_evidence_touchpoint_id_fkey,
  add constraint field_evidence_touchpoint_id_fkey
    foreign key (touchpoint_id) references public.field_touchpoints(id) on delete set null,
  drop constraint if exists field_evidence_location_status_check,
  add constraint field_evidence_location_status_check
    check (location_status in ('verified','low_accuracy','unavailable')),
  drop constraint if exists field_evidence_geofence_status_check,
  add constraint field_evidence_geofence_status_check
    check (geofence_status in ('unconfigured','inside','outside','unavailable')),
  drop constraint if exists field_evidence_scene_observations_object_check,
  add constraint field_evidence_scene_observations_object_check
    check (jsonb_typeof(scene_observations) = 'object');

create index if not exists field_evidence_touchpoint_idx
  on public.field_evidence(touchpoint_id) where touchpoint_id is not null;
create index if not exists field_evidence_session_type_idx
  on public.field_evidence(session_id, evidence_type);

comment on column public.field_sessions.start_geofence_status is
  'Advisory market-boundary evidence only; outside never blocks field work';
comment on column public.field_evidence.scene_observations is
  'Human-confirmed, amount-free scene tags used for deterministic and AI analysis';
comment on column public.field_evidence.touchpoint_id is
  'Optional link from an office-door photo to the corresponding customer touchpoint';
