-- FONKON Market OS: mobile field-market development workflow.
-- Evidence is private, operational records are owner-scoped, and AI output is advisory only.

create table if not exists public.field_markets (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  city text not null,
  address text,
  market_type text not null default 'fruit_wholesale'
    check (market_type in ('fruit_wholesale','office_cluster','other')),
  zones text[] not null default array[]::text[],
  reference_lat numeric(9,6),
  reference_lng numeric(9,6),
  geofence_radius_m integer check (geofence_radius_m is null or geofence_radius_m between 50 and 5000),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reference_lat is null or reference_lat between -90 and 90),
  check (reference_lng is null or reference_lng between -180 and 180)
);

create table if not exists public.field_sessions (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  market_id uuid references public.field_markets(id) on delete set null,
  market_name text not null,
  work_mode text not null default 'market_shed'
    check (work_mode in ('market_shed','office_cluster')),
  focus_fruits text[] not null default array[]::text[],
  planned_zones text[] not null default array[]::text[],
  zones_visited text[] not null default array[]::text[],
  target_contacts integer check (target_contacts is null or target_contacts between 1 and 200),
  status text not null default 'active'
    check (status in ('active','completed','cancelled')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  start_lat numeric(9,6),
  start_lng numeric(9,6),
  start_accuracy_m numeric(10,2),
  start_location_status text not null default 'verified'
    check (start_location_status in ('verified','low_accuracy','unavailable')),
  start_location_exception text,
  end_lat numeric(9,6),
  end_lng numeric(9,6),
  end_accuracy_m numeric(10,2),
  entry_photo_path text not null,
  overview_photo_path text,
  deterministic_metrics jsonb not null default '{}'::jsonb,
  ai_status text not null default 'not_requested'
    check (ai_status in ('not_requested','pending','completed','fallback','failed')),
  ai_summary jsonb not null default '{}'::jsonb,
  close_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_lat is null or start_lat between -90 and 90),
  check (start_lng is null or start_lng between -180 and 180),
  check (end_lat is null or end_lat between -90 and 90),
  check (end_lng is null or end_lng between -180 and 180),
  check (ended_at is null or ended_at >= started_at),
  check (start_location_status <> 'unavailable' or nullif(btrim(start_location_exception),'') is not null)
);

create table if not exists public.field_evidence (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.field_sessions(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  evidence_type text not null
    check (evidence_type in ('entry_photo','overview_photo','office_door_photo')),
  market_zone text,
  storage_path text not null unique,
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  latitude numeric(9,6),
  longitude numeric(9,6),
  accuracy_m numeric(10,2),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  file_size_bytes integer check (file_size_bytes is null or file_size_bytes between 1 and 8388608),
  note text,
  created_at timestamptz not null default now(),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180)
);

create table if not exists public.field_touchpoints (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.field_sessions(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  record_level text not null
    check (record_level in ('quick','effective','priority','office_visit')),
  market_zone text,
  company_name text,
  contact_name text,
  phone_wechat text,
  contact_role text,
  customer_type text,
  fruits text[] not null default array[]::text[],
  origin_countries text[] not null default array[]::text[],
  volume_range text,
  current_ports text[] not null default array[]::text[],
  pain_points text[] not null default array[]::text[],
  customer_quote text,
  decision_role text,
  interest_level text not null default 'unknown'
    check (interest_level in ('unknown','brief','effective','follow_up','priority','rejected')),
  outcome text,
  next_action text,
  next_followup_at timestamptz,
  raw_note text,
  source_method text not null default 'manual'
    check (source_method in ('manual','voice_transcript','ai_assisted')),
  ai_extraction jsonb not null default '{}'::jsonb,
  ai_confirmed boolean not null default false,
  ai_confirmed_at timestamptz,
  synced_visit_id uuid references public.visits(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (record_level <> 'office_visit' or nullif(btrim(company_name),'') is not null),
  check (ai_confirmed = false or ai_confirmed_at is not null)
);

create table if not exists public.field_ai_analyses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.field_sessions(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  subject_user_id uuid references public.profiles(id) on delete set null,
  analysis_scope text not null
    check (analysis_scope in ('session_coach','salesperson_period','company_period')),
  period_start date,
  period_end date,
  status text not null
    check (status in ('completed','fallback','failed')),
  model_provider text not null default 'deterministic',
  model_name text,
  prompt_version text not null default 'FIELD_AI_V1',
  deterministic_metrics jsonb not null default '{}'::jsonb,
  ai_output jsonb not null default '{}'::jsonb,
  usage jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  unique (session_id, analysis_scope)
);

create table if not exists public.field_events (
  id bigint generated always as identity primary key,
  session_id uuid references public.field_sessions(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  event_type text not null,
  target_type text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists field_sessions_one_active_per_user_idx
  on public.field_sessions(created_by) where status = 'active';
create index if not exists field_markets_created_by_idx
  on public.field_markets(created_by) where created_by is not null;
create index if not exists field_sessions_owner_started_idx
  on public.field_sessions(created_by, started_at desc);
create index if not exists field_sessions_market_started_idx
  on public.field_sessions(market_id, started_at desc);
create index if not exists field_sessions_status_started_idx
  on public.field_sessions(status, started_at desc);
create index if not exists field_evidence_session_created_idx
  on public.field_evidence(session_id, created_at);
create index if not exists field_evidence_owner_created_idx
  on public.field_evidence(created_by, created_at desc);
create index if not exists field_touchpoints_session_created_idx
  on public.field_touchpoints(session_id, created_at);
create index if not exists field_touchpoints_owner_created_idx
  on public.field_touchpoints(created_by, created_at desc);
create index if not exists field_touchpoints_customer_idx
  on public.field_touchpoints(customer_id) where customer_id is not null;
create index if not exists field_touchpoints_synced_visit_idx
  on public.field_touchpoints(synced_visit_id) where synced_visit_id is not null;
create index if not exists field_touchpoints_followup_idx
  on public.field_touchpoints(created_by, next_followup_at)
  where next_followup_at is not null;
create index if not exists field_ai_analyses_requester_created_idx
  on public.field_ai_analyses(requested_by, created_at desc);
create index if not exists field_ai_analyses_subject_created_idx
  on public.field_ai_analyses(subject_user_id, created_at desc)
  where subject_user_id is not null;
create index if not exists field_events_session_created_idx
  on public.field_events(session_id, created_at);
create index if not exists field_events_actor_created_idx
  on public.field_events(actor_id, created_at desc);

drop trigger if exists field_markets_touch_updated_at on public.field_markets;
create trigger field_markets_touch_updated_at before update on public.field_markets
for each row execute function private.fonkon_touch_updated_at();
drop trigger if exists field_sessions_touch_updated_at on public.field_sessions;
create trigger field_sessions_touch_updated_at before update on public.field_sessions
for each row execute function private.fonkon_touch_updated_at();
drop trigger if exists field_touchpoints_touch_updated_at on public.field_touchpoints;
create trigger field_touchpoints_touch_updated_at before update on public.field_touchpoints
for each row execute function private.fonkon_touch_updated_at();

alter table public.field_markets enable row level security;
alter table public.field_sessions enable row level security;
alter table public.field_evidence enable row level security;
alter table public.field_touchpoints enable row level security;
alter table public.field_ai_analyses enable row level security;
alter table public.field_events enable row level security;

drop policy if exists field_markets_select_staff on public.field_markets;
create policy field_markets_select_staff on public.field_markets for select to authenticated
using ((select has_fonkon_access()) and (active or (select fonkon_is_admin((select auth.uid())))));
drop policy if exists field_markets_admin_write on public.field_markets;

drop policy if exists field_sessions_select_owner_admin on public.field_sessions;
create policy field_sessions_select_owner_admin on public.field_sessions for select to authenticated
using (((created_by = (select auth.uid())) and (select has_fonkon_access())) or (select fonkon_is_admin((select auth.uid()))));
drop policy if exists field_sessions_insert_owner on public.field_sessions;
create policy field_sessions_insert_owner on public.field_sessions for insert to authenticated
with check ((created_by = (select auth.uid())) and (select has_fonkon_access()));
drop policy if exists field_sessions_update_owner_admin on public.field_sessions;
create policy field_sessions_update_owner_admin on public.field_sessions for update to authenticated
using (((created_by = (select auth.uid())) and (select has_fonkon_access())) or (select fonkon_is_admin((select auth.uid()))))
with check (((created_by = (select auth.uid())) and (select has_fonkon_access())) or (select fonkon_is_admin((select auth.uid()))));

drop policy if exists field_evidence_select_owner_admin on public.field_evidence;
create policy field_evidence_select_owner_admin on public.field_evidence for select to authenticated
using (((created_by = (select auth.uid())) and (select has_fonkon_access())) or (select fonkon_is_admin((select auth.uid()))));
drop policy if exists field_touchpoints_select_owner_admin on public.field_touchpoints;
create policy field_touchpoints_select_owner_admin on public.field_touchpoints for select to authenticated
using (((created_by = (select auth.uid())) and (select has_fonkon_access())) or (select fonkon_is_admin((select auth.uid()))));
drop policy if exists field_ai_analyses_select_owner_admin on public.field_ai_analyses;
create policy field_ai_analyses_select_owner_admin on public.field_ai_analyses for select to authenticated
using (((coalesce(subject_user_id, requested_by) = (select auth.uid())) and (select has_fonkon_access())) or (select fonkon_is_admin((select auth.uid()))));
drop policy if exists field_events_select_owner_admin on public.field_events;
create policy field_events_select_owner_admin on public.field_events for select to authenticated
using (((actor_id = (select auth.uid())) and (select has_fonkon_access())) or (select fonkon_is_admin((select auth.uid()))));

-- Field records are intentionally only mutated through the authenticated Edge Function.
revoke all on public.field_markets, public.field_sessions, public.field_evidence,
  public.field_touchpoints, public.field_ai_analyses, public.field_events from anon;
revoke all on public.field_markets, public.field_sessions, public.field_evidence,
  public.field_touchpoints, public.field_ai_analyses, public.field_events from authenticated;
grant select on public.field_markets, public.field_sessions, public.field_evidence,
  public.field_touchpoints, public.field_ai_analyses, public.field_events to authenticated;
grant all on public.field_markets, public.field_sessions, public.field_evidence,
  public.field_touchpoints, public.field_ai_analyses, public.field_events to service_role;
grant usage, select on sequence public.field_events_id_seq to service_role;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('field-evidence','field-evidence',false,8388608,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists field_evidence_storage_insert_owner on storage.objects;
create policy field_evidence_storage_insert_owner on storage.objects for insert to authenticated
with check (
  bucket_id = 'field-evidence'
  and (select has_fonkon_access())
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
drop policy if exists field_evidence_storage_select_owner_admin on storage.objects;
create policy field_evidence_storage_select_owner_admin on storage.objects for select to authenticated
using (
  bucket_id = 'field-evidence'
  and (select has_fonkon_access())
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select fonkon_is_admin((select auth.uid())))
  )
);
drop policy if exists field_evidence_storage_delete_admin on storage.objects;
create policy field_evidence_storage_delete_admin on storage.objects for delete to authenticated
using (bucket_id = 'field-evidence' and (select fonkon_is_admin((select auth.uid()))));

insert into public.field_markets (name,city,address,market_type,zones,active)
values (
  '广州江秾汇进口水果批发市场',
  '广州',
  null,
  'fruit_wholesale',
  array['A区','B区','C区','D区','办公室区'],
  true
)
on conflict (name) do update set
  city = excluded.city,
  market_type = excluded.market_type,
  zones = excluded.zones,
  active = true,
  updated_at = now();
