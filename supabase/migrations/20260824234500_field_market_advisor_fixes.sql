-- Follow-up for the live field-market deployment: cover every foreign key and
-- remove the redundant authenticated admin policy. Mutations remain confined
-- to the authenticated Edge Function running with the service role.

create index if not exists field_markets_created_by_idx
  on public.field_markets(created_by) where created_by is not null;

create index if not exists field_touchpoints_synced_visit_idx
  on public.field_touchpoints(synced_visit_id) where synced_visit_id is not null;

drop policy if exists field_markets_admin_write on public.field_markets;
