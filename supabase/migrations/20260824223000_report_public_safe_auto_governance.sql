-- Public-safe route reports and automatic policy-gated publication.
-- Financial data stays in protected internal operating tables, but it is never
-- copied into, returned by, or rendered from a customer report snapshot.

alter table public.profiles
  add column if not exists password_reset_required_at timestamptz,
  add column if not exists password_changed_at timestamptz;

update public.profiles
set password_reset_required_at = coalesce(password_reset_required_at, now())
where force_password_change = true;

alter table public.route_reports
  add column if not exists publication_mode text not null default 'manual_legacy',
  add column if not exists policy_version text,
  add column if not exists policy_decision jsonb not null default '{}'::jsonb;

alter table public.route_reports drop constraint if exists route_reports_publication_mode_check;
alter table public.route_reports
  add constraint route_reports_publication_mode_check
  check (publication_mode in ('automatic','manual_legacy'));

alter table public.route_reports drop constraint if exists route_reports_policy_decision_check;
alter table public.route_reports
  add constraint route_reports_policy_decision_check
  check (jsonb_typeof(policy_decision) = 'object');

alter table public.route_report_events drop constraint if exists route_report_events_event_type_check;
alter table public.route_report_events
  add constraint route_report_events_event_type_check
  check (event_type in (
    'create','submit_review','approve_publish','return_draft','auto_publish',
    'preview','share','revoke','renew','rotate','view','code_failed','migrated',
    'sensitive_data_sanitized'
  ));

create or replace function pg_temp.fonkon_strip_report_financials(p_value jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_type text;
  v_key text;
  v_item jsonb;
  v_safe jsonb;
  v_result jsonb;
  v_marker text;
begin
  if p_value is null then return null; end if;
  v_type := jsonb_typeof(p_value);
  if v_type = 'object' then
    v_marker := coalesce(p_value->>'key','') || ' ' || coalesce(p_value->>'label','');
    if v_marker ~* '(TCO|成本|价格|单价|报价|费用|金额|运费|利润|毛利|折扣|预算|账单|人民币|美元|元/柜|cost|price|pricing|tco|amount|fee|quote|quotation|revenue|profit|margin|discount|budget|invoice|freight.?rate|unit.?rate)' then
      return null;
    end if;
    v_result := '{}'::jsonb;
    for v_key, v_item in select key, value from jsonb_each(p_value)
    loop
      if v_key ~* '(show.?cost|cost|price|pricing|tco|amount|fee|quote|quotation|revenue|profit|margin|discount|budget|invoice|freight.?rate|unit.?rate)' then
        continue;
      end if;
      v_safe := pg_temp.fonkon_strip_report_financials(v_item);
      if v_safe is not null then
        v_result := v_result || jsonb_build_object(v_key, v_safe);
      end if;
    end loop;
    return v_result;
  elsif v_type = 'array' then
    v_result := '[]'::jsonb;
    for v_item in select value from jsonb_array_elements(p_value)
    loop
      v_safe := pg_temp.fonkon_strip_report_financials(v_item);
      if v_safe is not null then
        v_result := v_result || jsonb_build_array(v_safe);
      end if;
    end loop;
    return v_result;
  elsif v_type = 'string' then
    v_marker := p_value #>> '{}';
    if v_marker ~* '((TCO|成本|价格|单价|报价|费用|金额|运费|利润|毛利|折扣|预算|cost|price|quote|fee|amount|freight)[^。；,\n]{0,24}(¥|￥|\$|USD|CNY|RMB|[0-9][0-9,.]*))|((¥|￥|\$|USD|CNY|RMB)[[:space:]]*[0-9])|([0-9][0-9,.]*[[:space:]]*(元|万元|美元|人民币)(/柜|每柜)?)' then
      return to_jsonb('【敏感财务内容已移除】'::text);
    end if;
  end if;
  return p_value;
end;
$$;

with prepared as (
  select
    id,
    snapshot as original_snapshot,
    coalesce(pg_temp.fonkon_strip_report_financials(snapshot), '{}'::jsonb) as safe_snapshot,
    (coalesce((snapshot->>'show_cost')::boolean,false)
      or snapshot::text ~* '"(tco|cost_amount|total_cost_per_container|price|pricing|amount|fee|quote|quotation|revenue|profit|margin|freight_rate)"') as legacy_financial
  from public.route_reports
), governed as (
  select
    id,
    jsonb_set(
      case when legacy_financial then
        safe_snapshot || jsonb_build_object(
          'comparison', coalesce(safe_snapshot->'comparison','{}'::jsonb) || jsonb_build_object(
            'scores','[]'::jsonb,
            'leader_index',null,
            'summary','本历史快照原含财务维度，现已按敏感数据策略移除相关数值及其派生结论；请重新生成新版公开安全报告。',
            'recommendation','请使用当前公开安全模型重新生成报告后，再形成对外结论。'
          )
        )
      else safe_snapshot end,
      '{governance}',
      coalesce(safe_snapshot->'governance','{}'::jsonb) || jsonb_build_object(
        'policy_version','NO_FINANCIAL_DISCLOSURE_V1',
        'sensitive_financials_excluded',true,
        'financial_disclosure','prohibited',
        'legacy_financial_model_sanitized',
          legacy_financial,
        'sensitive_data_sanitized_at',now()
      ),
      true
    ) as safe_snapshot
  from prepared
)
update public.route_reports r
set
  snapshot = g.safe_snapshot,
  snapshot_hash = encode(extensions.digest(convert_to(g.safe_snapshot::text,'UTF8'),'sha256'),'hex'),
  publication_mode = coalesce(r.publication_mode,'manual_legacy'),
  policy_version = 'NO_FINANCIAL_DISCLOSURE_V1',
  policy_decision = coalesce(r.policy_decision,'{}'::jsonb) || jsonb_build_object(
    'public_safe',true,
    'sensitive_financials_excluded',true,
    'migration','20260824223000'
  ),
  updated_at = now()
from governed g
where r.id = g.id;

alter table public.route_reports drop constraint if exists route_reports_snapshot_no_financial_keys_check;
alter table public.route_reports
  add constraint route_reports_snapshot_no_financial_keys_check
  check (snapshot::text !~* '"[^\"]*(show.?cost|cost|price|pricing|tco|amount|fee|quote|quotation|revenue|profit|margin|discount|budget|invoice|freight.?rate|unit.?rate)[^\"]*"[[:space:]]*:');

insert into public.route_report_events(report_id,event_type,actor_id,metadata)
select id,'sensitive_data_sanitized',null,jsonb_build_object(
  'policy_version','NO_FINANCIAL_DISCLOSURE_V1',
  'migration','20260824223000'
)
from public.route_reports;

create index if not exists route_reports_publication_mode_created_idx
  on public.route_reports(publication_mode,created_at desc);

comment on column public.route_reports.publication_mode is
  'automatic = published immediately after fixed safety gates pass; manual_legacy = historical workflow only';
comment on column public.route_reports.policy_version is
  'Immutable public-report governance policy used at publication time';
comment on column public.route_reports.policy_decision is
  'Machine-readable publication gate result; never contains financial amounts';
