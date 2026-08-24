-- Cover V2 report governance foreign keys. Partial indexes keep the small null-heavy
-- review columns compact while supporting deletes, joins and audit lookups.
create index if not exists current_route_baselines_reviewed_by_idx
  on public.current_route_baselines(reviewed_by) where reviewed_by is not null;
create index if not exists jiangmen_routes_reviewed_by_idx
  on public.jiangmen_routes(reviewed_by) where reviewed_by is not null;
create index if not exists sea_port_stats_reviewed_by_idx
  on public.sea_port_stats(reviewed_by) where reviewed_by is not null;
create index if not exists land_port_stats_reviewed_by_idx
  on public.land_port_stats(reviewed_by) where reviewed_by is not null;
create index if not exists jiangmen_port_stats_reviewed_by_idx
  on public.jiangmen_port_stats(reviewed_by) where reviewed_by is not null;
create index if not exists route_chain_segments_updated_by_idx
  on public.route_chain_segments(updated_by) where updated_by is not null;
create index if not exists route_model_versions_created_by_idx
  on public.route_model_versions(created_by) where created_by is not null;
create index if not exists route_reports_approved_by_idx
  on public.route_reports(approved_by) where approved_by is not null;
