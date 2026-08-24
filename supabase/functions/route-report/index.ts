import QRCode from 'npm:qrcode@1.5.4';

const U = Deno.env.get('SUPABASE_URL')!;
const S = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-report-code, x-report-visitor',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store, private, max-age=0'
};
const ADMIN_HEADERS = {apikey:S, authorization:'Bearer '+S, 'content-type':'application/json'};
const SEGMENT_CODES = ['origin_harvest','precool_pack','origin_inland','export_clearance','main_transport','transshipment','import_port_ops','inspection_clearance','coldstorage_lastmile'];
const SEGMENT_LABELS:Record<string,string> = {
  origin_harvest:'果园采收与集货',precool_pack:'预冷、分级与装柜',origin_inland:'产地内陆运输',
  export_clearance:'出口报关与装船',main_transport:'国际干线运输',transshipment:'中转/驳船',
  import_port_ops:'进口港卸船与提柜',inspection_clearance:'查验、送检与通关',coldstorage_lastmile:'冷库周转与末端配送'
};
type AnyRow = Record<string,any>;

function json(data:any,status=200){return new Response(JSON.stringify(data),{status,headers:CORS})}
function text(v:any,max=160){return String(v??'').trim().slice(0,max)}
function finite(v:any){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null}
function isoNow(){return new Date().toISOString()}
function queryValue(v:any){return encodeURIComponent(String(v??''))}
function randomToken(bytes=32){const a=new Uint8Array(bytes);crypto.getRandomValues(a);let s='';for(const x of a)s+=String.fromCharCode(x);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
async function hashText(v:string){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function canonical(v:any):string{if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}'}
function safeUrl(v:any){const x=text(v,500);if(!x)return null;try{const u=new URL(x);return ['http:','https:'].includes(u.protocol)?u.toString():null}catch{return null}}
function unique<T>(xs:T[]){return Array.from(new Set(xs))}
function normalize(v:any){return text(v,160).toLowerCase().replace(/\s+/g,'')}
function normalizePort(v:any){return normalize(v).replace(/广州市?|港区|港口|口岸|港/g,'')}
function latestDate(...values:any[]){const xs=values.filter(Boolean).map(x=>new Date(x).getTime()).filter(Number.isFinite);return xs.length?new Date(Math.max(...xs)).toISOString():null}
function daysOld(v:any){const t=v?new Date(v).getTime():NaN;return Number.isFinite(t)?Math.max(0,(Date.now()-t)/86400000):null}
function evidenceScore(v:any,config:AnyRow){return finite(config?.evidence_scores?.[text(v,1)])??({A:100,B:85,C:65,D:40} as AnyRow)[text(v,1)]??25}
function evidenceLabel(v:any){return ({A:'官方/最高权威',B:'政府、海关或船公司正式来源',C:'交叉验证基准',D:'公司业务样本/模拟样本'} as AnyRow)[text(v,1)]||'证据待补'}
function freshnessScore(v:any){const d=daysOld(v);if(d===null)return 25;if(d<=90)return 100;if(d<=180)return 75;if(d<=365)return 50;return 25}
function sampleScore(v:any){const n=finite(v);return n===null?25:Math.round(Math.min(100,Math.sqrt(Math.max(0,n)/20)*100))}
function isAdmin(member:any){return member?.profile?.role==='admin'}

async function requestJson(path:string,init:RequestInit={}){
  const r=await fetch(U+path,{...init,headers:{...ADMIN_HEADERS,...((init.headers||{}) as AnyRow)}});
  const raw=await r.text();let body:any=null;try{body=raw?JSON.parse(raw):null}catch{body={raw}}
  if(!r.ok)throw Object.assign(new Error(body?.message||body?.msg||body?.error_description||body?.error||('HTTP '+r.status)),{status:r.status});
  return body;
}
async function currentMember(req:Request){
  const authorization=req.headers.get('authorization')||'';
  if(!authorization.startsWith('Bearer '))throw Object.assign(new Error('请先登录'),{status:401});
  const r=await fetch(U+'/auth/v1/user',{headers:{apikey:S,authorization}});
  if(!r.ok)throw Object.assign(new Error('登录状态已失效'),{status:401});
  const user=await r.json();
  const rows=await requestJson('/rest/v1/profiles?id=eq.'+queryValue(user.id)+'&select=id,name,email,role,active,approval_status');
  const profile=rows?.[0];
  if(!profile||!profile.active||profile.approval_status!=='approved')throw Object.assign(new Error('账号尚未获准使用'),{status:403});
  return {user,profile};
}
async function activeModel(){
  const rows=await requestJson('/rest/v1/route_model_versions?active=eq.true&status=eq.active&select=code,label,config&limit=1');
  if(!rows?.[0])throw Object.assign(new Error('路线模型尚未启用'),{status:503});
  return rows[0];
}
async function event(reportId:string,eventType:string,actorId:string|null,metadata:AnyRow={}){
  await requestJson('/rest/v1/route_report_events',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({report_id:reportId,event_type:eventType,actor_id:actorId,metadata})});
}

function pickPortStat(rows:AnyRow[],route:AnyRow,portName:string,jiangmen=false){
  const target=normalizePort(portName);let candidates=rows.filter(x=>jiangmen||normalizePort(x.port_name)===target);
  candidates=candidates.filter(x=>(!x.fruit||!route.fruit||normalize(x.fruit)===normalize(route.fruit))&&(!x.month||!route.month||Number(x.month)===Number(route.month)));
  candidates.sort((a,b)=>((b.fruit?4:0)+(b.month?2:0))-((a.fruit?4:0)+(a.month?2:0)));
  return candidates[0]||null;
}
function publicSource(row:AnyRow|null,type:string){if(!row)return null;return {type,text:text(row.public_source_text,300)||null,url:safeUrl(row.public_source_url),updated_at:latestDate(row.source_updated_at,row.updated_at),evidence_level:text(row.evidence_level,1)||null,sample_size:finite(row.sample_size)}}
function safeSegment(s:AnyRow,showCost:boolean){return {order:Number(s.segment_order),code:text(s.segment_code,40),name:text(s.segment_name,100)||SEGMENT_LABELS[s.segment_code]||'链路环节',origin:text(s.origin_node,100),destination:text(s.destination_node,100),p50_days:finite(s.p50_days),p90_days:finite(s.p90_days),cost_amount:showCost?finite(s.cost_amount):null,currency:text(s.currency,3)||'CNY',container_type:text(s.container_type,20)||'40RF',coldchain_risk_index:finite(s.coldchain_risk_index),evidence_level:text(s.evidence_level,1)||null,sample_size:finite(s.sample_size),source:{text:text(s.public_source_text,300)||null,url:safeUrl(s.public_source_url),updated_at:s.source_updated_at||null},is_demo:!!s.is_demo}}
function routeFromCurrent(r:AnyRow,port:AnyRow,segments:AnyRow[],showCost:boolean){
  const origin=text(r.origin_region||r.country||'产地'),destination=text(r.destination_market||'最终市场'),portName=text(r.current_port||'当前口岸');
  const safeSegments=segments.sort((a,b)=>Number(a.segment_order)-Number(b.segment_order)).map(s=>safeSegment(s,showCost));
  return {id:r.id,kind:'current',name:portName+'方案',port:portName,transport:text(r.transport_mode||'海运'),path:[origin,portName,destination].filter(Boolean),cargo_group:text(r.cargo_group),fruit:text(r.fruit),country:text(r.country),origin_region:text(r.origin_region),month:finite(r.month),destination,data_scope:text(r.data_scope),currency:text(r.currency,3)||'CNY',container_type:text(r.container_type,20)||'40RF',cost_basis_date:r.cost_basis_date||null,is_demo:!!r.is_demo||!!port?.is_demo||safeSegments.some(s=>s.is_demo),metrics:{p50_days:finite(r.p50_days??r.total_days),p90_days:finite(r.p90_days??r.total_days),tco:showCost?finite(r.total_cost_per_container):null,stability:finite(r.stability_index),rci:finite(r.route_congestion_index),pci:finite(port?.congestion_index),inspection_rate:finite(port?.inspection_rate),testing_rate:finite(port?.testing_rate),inspection_days:finite(port?.inspection_days),testing_days:finite(port?.testing_days),coldchain:finite(r.coldchain_risk_index),capacity:finite(r.capacity_score),schedule:finite(r.schedule_frequency_per_week),abnormal:finite(r.abnormal_handling_score)},evidence:{route:text(r.evidence_level,1)||null,port:text(port?.evidence_level,1)||null,label:evidenceLabel(r.evidence_level),sample_size:finite(r.sample_size),port_sample_size:finite(port?.sample_size),updated_at:latestDate(r.source_updated_at,r.updated_at,port?.source_updated_at,port?.updated_at)},sources:{route:publicSource(r,'route'),port:publicSource(port,'port')},segments:safeSegments};
}
function routeFromJiangmen(r:AnyRow,port:AnyRow,segments:AnyRow[],showCost:boolean){
  const origin=text(r.origin_region||r.country||'产地'),destination=text(r.destination_market||'最终市场');
  const path=[origin,text(r.origin_port||'起运港')];if(r.via_hong_kong)path.push('香港中转');path.push('江门口岸',destination);
  const safeSegments=segments.sort((a,b)=>Number(a.segment_order)-Number(b.segment_order)).map(s=>safeSegment(s,showCost));
  return {id:r.id,kind:'jiangmen',name:'FONKON江门方案',port:'江门',transport:r.via_hong_kong?'海运＋香港驳船':'海运',path:path.filter(Boolean),cargo_group:text(r.cargo_group),fruit:text(r.fruit),country:text(r.country),origin_region:text(r.origin_region),month:finite(r.month),destination,data_scope:text(r.data_scope),currency:text(r.currency,3)||'CNY',container_type:text(r.container_type,20)||'40RF',cost_basis_date:r.cost_basis_date||null,is_demo:!!r.is_demo||!!port?.is_demo||safeSegments.some(s=>s.is_demo),metrics:{p50_days:finite(r.p50_days??r.total_days),p90_days:finite(r.p90_days??r.total_days),tco:showCost?finite(r.total_cost_per_container):null,stability:finite(r.stability_index),rci:finite(r.route_congestion_index),pci:finite(port?.congestion_index),inspection_rate:finite(port?.inspection_rate),testing_rate:finite(port?.testing_rate),inspection_days:finite(port?.inspection_days),testing_days:finite(port?.testing_days),coldchain:finite(r.coldchain_risk_index),capacity:finite(r.capacity_score),schedule:finite(r.schedule_frequency_per_week),abnormal:finite(r.abnormal_handling_score)},evidence:{route:text(r.evidence_level,1)||null,port:text(port?.evidence_level,1)||null,label:evidenceLabel(r.evidence_level),sample_size:finite(r.sample_size),port_sample_size:finite(port?.sample_size),updated_at:latestDate(r.source_updated_at,r.updated_at,port?.source_updated_at,port?.updated_at)},sources:{route:publicSource(r,'route'),port:publicSource(port,'port')},segments:safeSegments};
}

const GROUPS:any[]=[
  {key:'time',label:'端到端时效',metrics:[['p50_days','P50常态','天',true],['p90_days','P90旺季/尾部','天',true]]},
  {key:'cost',label:'全链路TCO',metrics:[['tco','TCO总成本','元/柜',true]]},
  {key:'stability',label:'时效稳定性',metrics:[['stability','稳定性','/100',false]]},
  {key:'route_congestion',label:'路线拥堵',metrics:[['rci','路线RCI','/10',true]]},
  {key:'port_congestion',label:'口岸拥堵',metrics:[['pci','口岸PCI','/10',true]]},
  {key:'regulatory',label:'监管与查验送检',metrics:[['inspection_rate','查验率','%',true],['testing_rate','送检率','%',true],['inspection_days','查验时长','天',true],['testing_days','送检时长','天',true]]},
  {key:'coldchain',label:'冷链风险',metrics:[['coldchain','冷链风险','/10',true]]},
  {key:'capacity',label:'运力保障',metrics:[['capacity','运力能力','/10',false]]},
  {key:'schedule',label:'班期频率',metrics:[['schedule','班期','次/周',false]]},
  {key:'abnormal',label:'异常处置',metrics:[['abnormal','异常处置','/10',false]]}
];
function routeReadiness(route:AnyRow,config:AnyRow){
  const keys=GROUPS.flatMap(g=>g.metrics.map((m:any)=>m[0]));
  const coverage=Math.round(keys.filter(k=>finite(route.metrics[k])!==null).length/keys.length*100);
  const evidenceValues=[evidenceScore(route.evidence.route,config),evidenceScore(route.evidence.port,config),...(route.segments||[]).map((s:any)=>evidenceScore(s.evidence_level,config))];
  const evidence=Math.round(evidenceValues.reduce((a:number,b:number)=>a+b,0)/Math.max(1,evidenceValues.length));
  const dateValues=[route.sources?.route?.updated_at,route.sources?.port?.updated_at,...(route.segments||[]).map((s:any)=>s.source?.updated_at)].filter(Boolean);
  const freshness=Math.round(dateValues.reduce((a:number,b:any)=>a+freshnessScore(b),0)/Math.max(1,dateValues.length));
  const sampleValues=[route.evidence.sample_size,route.evidence.port_sample_size,...(route.segments||[]).map((s:any)=>s.sample_size)];
  const sample=Math.round(sampleValues.reduce((a:number,b:any)=>a+sampleScore(b),0)/Math.max(1,sampleValues.length));
  const index=Math.round(coverage*.45+evidence*.25+freshness*.15+sample*.15);
  return {route_id:route.id,route_name:route.name,index,coverage_score:coverage,evidence_score:evidence,freshness_score:freshness,sample_score:sample,segment_coverage:(route.segments||[]).length+'/9'};
}
function compareRoutes(routes:AnyRow[],model:AnyRow){
  const cfg=model.config||{},weights=cfg.weights||{},thresholds=cfg.materiality_thresholds||{};
  const routeScores=routes.map((r,i)=>({index:i,name:r.name,points:0,weight:0,coverage:0,wins:[] as string[]}));
  const rows:any[]=[];let comparableDimensions=0,materialDimensions=0;
  for(const group of GROUPS){let groupComparable=false,groupMaterial=false;const metricRows:any[]=[];
    for(const [key,label,unit,lower] of group.metrics){
      const weight=Number(weights[key]||0),threshold=Number(thresholds[key]||0);
      const values=routes.map((r,i)=>({i,value:finite(r.metrics[key])})).filter(x=>x.value!==null) as {i:number,value:number}[];
      const comparable=values.length>=2;groupComparable ||= comparable;let material=false,winners:number[]=[];
      if(comparable){
        const nums=values.map(x=>x.value),best=lower?Math.min(...nums):Math.max(...nums),worst=lower?Math.max(...nums):Math.min(...nums),span=Math.abs(worst-best);
        material=span>threshold;groupMaterial ||= material;
        if(material)winners=values.filter(x=>Math.abs(x.value-best)<=Math.max(0.0001,Math.abs(best)*0.002)).map(x=>x.i);
        for(const x of values){const normalized=material?(lower?(worst-x.value)/span*100:(x.value-worst)/span*100):50;routeScores[x.i].points+=normalized*weight;routeScores[x.i].weight+=weight;routeScores[x.i].coverage++;if(winners.includes(x.i))routeScores[x.i].wins.push(label)}
      }
      metricRows.push({key,label,unit,lower,weight,materiality_threshold:threshold,values:routes.map(r=>finite(r.metrics[key])),comparable,material,winners});
    }
    if(groupComparable)comparableDimensions++;if(groupMaterial)materialDimensions++;
    rows.push({key:group.key,label:group.label,metrics:metricRows,comparable:groupComparable,material:groupMaterial});
  }
  const scored=routeScores.map(x=>({...x,score:x.weight?Math.round(x.points/x.weight):null}));
  const ranked=scored.filter(x=>x.score!==null).sort((a,b)=>(b.score??0)-(a.score??0));
  const readinessRoutes=routes.map(r=>routeReadiness(r,cfg));
  const readinessIndex=Math.round(readinessRoutes.reduce((a,r)=>a+r.index,0)/Math.max(1,readinessRoutes.length));
  const leader=ranked.length&&readinessIndex>=65&&((ranked[0].score??0)-(ranked[1]?.score??-999)>=2)?ranked[0]:null;
  const jmIndex=routes.findIndex(r=>r.kind==='jiangmen'),jm=scored[jmIndex],jmAdvantages=jm?unique(jm.wins):[];const jmGaps:string[]=[];
  for(const row of rows)for(const m of row.metrics)if(m.material&&m.winners.length&&!m.winners.includes(jmIndex))jmGaps.push(m.label);
  let summary='当前数据就绪度不足，系统暂不作路线优劣结论。';
  if(!leader&&readinessIndex>=65)summary='当前已知差异未达到模型设定的实质性阈值，各方案应结合试柜和业务约束进一步验证。';
  if(leader)summary='在当前同口径、达到实质性差异阈值的指标中，'+leader.name+'综合表现暂时领先；结论仅适用于本报告约定的水果、月份、起点、终点、币种和柜型。';
  let recommendation='建议先补齐发布阻断项，再决定是否安排试柜。';
  if(readinessIndex>=65)recommendation=leader?(leader.index===jmIndex?'建议先安排1柜江门试运行，用实测分段时效、成本、温控和通关结果校准模型。':'当前不建议整体切换江门；可针对江门短板补强后，以1柜进行同口径对照试运行。'):'建议保持现有方案，同时用1柜对照试运行验证差异是否具有业务意义。';
  const scenarios=routes.map(r=>({route_id:r.id,route_name:r.name,normal_p50_days:finite(r.metrics.p50_days),peak_p90_days:finite(r.metrics.p90_days),regulatory_expected_days:[r.metrics.p50_days,r.metrics.inspection_rate,r.metrics.inspection_days,r.metrics.testing_rate,r.metrics.testing_days].every(v=>finite(v)!==null)?Number((Number(r.metrics.p50_days)+Number(r.metrics.inspection_rate)/100*Number(r.metrics.inspection_days)+Number(r.metrics.testing_rate)/100*Number(r.metrics.testing_days)).toFixed(2)):null}));
  return {method:'deterministic_materiality_aware_relative_scoring',dimension_count:comparableDimensions,material_dimension_count:materialDimensions,rows,scores:scored,leader_index:leader?.index??null,summary,jiangmen_advantages:jmAdvantages,jiangmen_gaps:unique(jmGaps),recommendation,data_readiness:{index:readinessIndex,label:readinessIndex>=85?'高':readinessIndex>=65?'中':'待补',routes:readinessRoutes},scenarios};
}

function validateRoutes(routes:AnyRow[],showCost:boolean){
  const blockers:string[]=[],warnings:string[]=[],reconciliation:any[]=[];
  const required=[['cargo_group','货类'],['fruit','水果'],['country','原产国'],['origin_region','产区'],['month','业务月份'],['destination','最终市场'],['data_scope','数据范围'],['currency','币种'],['container_type','柜型']];
  for(const r of routes){
    for(const [k,label] of required)if(r[k]===null||r[k]===undefined||text(r[k])==='')blockers.push(r.name+'缺少'+label);
    if(r.data_scope!=='end_to_end')blockers.push(r.name+'不是端到端完整口径');
    if(finite(r.metrics.p50_days)===null||finite(r.metrics.p90_days)===null)blockers.push(r.name+'缺少P50/P90端到端时效');
    if(finite(r.metrics.p50_days)!==null&&finite(r.metrics.p90_days)!==null&&Number(r.metrics.p90_days)<Number(r.metrics.p50_days))blockers.push(r.name+'的P90小于P50');
    if(showCost&&finite(r.metrics.tco)===null)blockers.push(r.name+'缺少全链路TCO');
    const codes=unique((r.segments||[]).map((s:any)=>s.code));
    if((r.segments||[]).length!==9||SEGMENT_CODES.some(x=>!codes.includes(x)))blockers.push(r.name+'未完成9段全链路数据');
    if((r.segments||[]).some((s:any)=>!s.source?.text))blockers.push(r.name+'存在未填写公开来源的链路环节');
    if(!r.sources?.route?.text)warnings.push(r.name+'路线级公开来源待补');
    const p50=(r.segments||[]).reduce((a:number,s:any)=>a+(finite(s.p50_days)??0),0),p90=(r.segments||[]).reduce((a:number,s:any)=>a+(finite(s.p90_days)??0),0),cost=(r.segments||[]).reduce((a:number,s:any)=>a+(finite(s.cost_amount)??0),0);
    const p50Delta=finite(r.metrics.p50_days)===null?null:Number((p50-Number(r.metrics.p50_days)).toFixed(2)),p90Delta=finite(r.metrics.p90_days)===null?null:Number((p90-Number(r.metrics.p90_days)).toFixed(2)),costDelta=!showCost||finite(r.metrics.tco)===null?null:Number((cost-Number(r.metrics.tco)).toFixed(2));
    reconciliation.push({route_id:r.id,route_name:r.name,segment_count:(r.segments||[]).length,p50_sum:Number(p50.toFixed(2)),p90_sum:Number(p90.toFixed(2)),cost_sum:showCost?Number(cost.toFixed(2)):null,p50_delta:p50Delta,p90_delta:p90Delta,cost_delta:costDelta});
    if(p50Delta!==null&&Math.abs(p50Delta)>0.05)blockers.push(r.name+'分段P50合计与路线总值不一致');
    if(p90Delta!==null&&Math.abs(p90Delta)>0.05)blockers.push(r.name+'分段P90合计与路线总值不一致');
    if(costDelta!==null&&Math.abs(costDelta)>1)blockers.push(r.name+'分段成本合计与TCO不一致');
  }
  const base=routes[0];
  for(const r of routes.slice(1))for(const [k,label] of required)if(normalize(r[k])!==normalize(base[k]))blockers.push('所选路线的'+label+'不一致');
  const demoCount=routes.filter(r=>r.is_demo).length;if(demoCount>0&&demoCount<routes.length)blockers.push('不能混用演示数据与正式数据');
  return {publish_blockers:unique(blockers),warnings:unique(warnings),segment_reconciliation:reconciliation};
}
function sourceManifest(routes:AnyRow[]){
  const out:any[]=[];
  for(const r of routes){
    for(const [level,s] of Object.entries(r.sources||{}))if(s&&(s as any).text)out.push({route_name:r.name,level,segment:null,...s});
    for(const s of r.segments||[])if(s.source?.text)out.push({route_name:r.name,level:'segment',segment:s.name,text:s.source.text,url:s.source.url,updated_at:s.source.updated_at,evidence_level:s.evidence_level,sample_size:s.sample_size});
  }
  return out;
}

async function loadReportRoutes(currentIds:string[],jiangmenId:string,showCost:boolean){
  const currentRows=await requestJson('/rest/v1/current_route_baselines?id=in.'+queryValue('('+currentIds.join(',')+')')+'&active=eq.true&select=*');
  if(currentRows.length!==currentIds.length)throw new Error('部分现行路线不存在或已停用');
  const jmRows=await requestJson('/rest/v1/jiangmen_routes?id=eq.'+queryValue(jiangmenId)+'&select=*'),jm=jmRows?.[0];if(!jm)throw new Error('江门路线不存在');
  const allIds=[...currentIds,jiangmenId];
  const [seaStats,landStats,jmStats,segments]=await Promise.all([
    requestJson('/rest/v1/sea_port_stats?select=*&limit=300'),requestJson('/rest/v1/land_port_stats?select=*&limit=300'),requestJson('/rest/v1/jiangmen_port_stats?select=*&limit=300'),
    requestJson('/rest/v1/route_chain_segments?route_id=in.'+queryValue('('+allIds.join(',')+')')+'&select=*&order=segment_order.asc')
  ]);
  const forRoute=(kind:string,id:string)=>segments.filter((s:any)=>s.route_kind===kind&&s.route_id===id);
  const routes=currentRows.map((r:any)=>routeFromCurrent(r,pickPortStat(String(r.transport_mode||'').includes('陆运')?landStats:seaStats,r,r.current_port),forRoute('current',r.id),showCost));
  routes.push(routeFromJiangmen(jm,pickPortStat(jmStats,jm,'江门',true),forRoute('jiangmen',jm.id),showCost));
  return {routes,currentRows,jm};
}
async function customerAndOpportunity(b:AnyRow,member:any){
  let customer:any=null,opportunity:any=null;const customerId=text(b.customer_id,40),opportunityId=text(b.opportunity_id,40);
  if(customerId){const cs=await requestJson('/rest/v1/customers?id=eq.'+queryValue(customerId)+'&select=id,company_name,contact_name,created_by,owner_id,market_name');customer=cs?.[0];if(!customer)throw new Error('未找到客户');if(!isAdmin(member)&&customer.created_by!==member.user.id&&customer.owner_id!==member.user.id)throw Object.assign(new Error('无权使用该客户生成报告'),{status:403})}
  if(opportunityId){const os=await requestJson('/rest/v1/opportunities?id=eq.'+queryValue(opportunityId)+'&select=id,customer_id,created_by,fruit,cargo_group,origin_country,origin_region,season_month_num,destination_market,stage,status');opportunity=os?.[0];if(!opportunity)throw new Error('未找到商机');if(!isAdmin(member)&&opportunity.created_by!==member.user.id)throw Object.assign(new Error('无权使用该商机生成报告'),{status:403});if(customer&&opportunity.customer_id!==customer.id)throw new Error('所选商机不属于当前客户')}
  return {customer,opportunity};
}
async function createReport(b:AnyRow,member:any){
  const ids=unique((Array.isArray(b.current_route_ids)?b.current_route_ids:[]).map((x:any)=>text(x,40)).filter(Boolean)).slice(0,4),jiangmenId=text(b.jiangmen_route_id,40);
  if(!ids.length||!jiangmenId)throw new Error('请选择至少一条现行路线和一条江门路线');
  const showCost=b.show_cost!==false,{routes,currentRows,jm}=await loadReportRoutes(ids,jiangmenId,showCost),model=await activeModel(),validation=validateRoutes(routes,showCost),comparison=compareRoutes(routes,model),{customer,opportunity}=await customerAndOpportunity(b,member);
  const createdAt=isoNow(),rawDays=Number(b.expiry_days||30),days=Math.max(1,Math.min(365,Number.isFinite(rawDays)?rawDays:30)),id=crypto.randomUUID(),shareToken=randomToken(32),accessCode=text(b.access_code,32);
  if(accessCode&&accessCode.length<6)throw new Error('访问密码至少6位');
  const clientName=text(b.client_name||customer?.company_name||'贵司',120),reportNo='FR-'+createdAt.slice(0,10).replace(/-/g,'')+'-'+randomToken(4).slice(0,6).toUpperCase(),isDemo=routes.some(r=>r.is_demo);
  const scope={cargo_group:text(jm.cargo_group||currentRows[0]?.cargo_group),fruit:text(jm.fruit||currentRows[0]?.fruit),country:text(jm.country||currentRows[0]?.country),origin_region:text(jm.origin_region||currentRows[0]?.origin_region),month:finite(jm.month??currentRows[0]?.month),destination:text(jm.destination_market||currentRows[0]?.destination_market||customer?.market_name),data_scope:text(jm.data_scope),currency:text(jm.currency,3)||'CNY',container_type:text(jm.container_type,20)||'40RF'};
  const snapshot:any={schema_version:2,generated_method:'deterministic',model_version:model.code,model:{code:model.code,label:model.label,method:model.config?.method,weight_total:model.config?.weight_total,weights:model.config?.weights,materiality_thresholds:model.config?.materiality_thresholds},is_demo:isDemo,report_number:reportNo,title:text(b.title||'FONKON供应链路线决策报告',120),client_name:b.show_client_name===false?'贵司':clientName,created_at:createdAt,expires_at:new Date(Date.now()+days*86400000).toISOString(),requires_code:!!accessCode,prepared_by:{name:text(member.profile.name||'FONKON顾问',80),email:text(member.profile.email||'',120)},approval:{status:'draft',submitted_at:null,approved_at:null,approved_by:null},scope,assumptions:text(b.assumptions||'同起点、同终点、同水果、同一业务月份、同币种、同柜型；未知数据不按0计算。',600),show_cost:showCost,routes,comparison,validation,sources:sourceManifest(routes),disclaimer:isDemo?'本报告全部使用系统模拟数据，仅用于功能演示与流程体验，不代表真实港口运营表现，不得作为对外报价或正式业务决策依据。':'本报告由固定规则模型根据生成时已复核的同口径数据计算，数据来源和更新时间见报告。未知值不按0计算，正式切换前仍建议通过试柜复核。'};
  const row={id,report_number:reportNo,title:snapshot.title,customer_id:customer?.id||null,opportunity_id:opportunity?.id||null,created_by:member.user.id,status:'draft',model_version:model.code,is_demo:isDemo,share_token:shareToken,access_code_hash:accessCode?await hashText(id+':'+accessCode):null,expires_at:snapshot.expires_at,snapshot};
  await requestJson('/rest/v1/route_reports',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)});await event(id,'create',member.user.id,{model_version:model.code,is_demo:isDemo,blocker_count:validation.publish_blockers.length});
  return {ok:true,id,report_number:reportNo,status:'draft',is_demo:isDemo,model_version:model.code,readiness_index:comparison.data_readiness.index,publish_blockers:validation.publish_blockers};
}
async function assertReportAccess(reportId:string,member:any){
  const rows=await requestJson('/rest/v1/route_reports?id=eq.'+queryValue(reportId)+'&select=*'),report=rows?.[0];
  if(!report)throw Object.assign(new Error('未找到报告'),{status:404});if(!isAdmin(member)&&report.created_by!==member.user.id)throw Object.assign(new Error('无权管理此报告'),{status:403});return report;
}
async function workflow(action:string,b:AnyRow,member:any){
  const report=await assertReportAccess(text(b.report_id,40),member),now=isoNow(),snapshot={...(report.snapshot||{})},approval={...(snapshot.approval||{})};
  if(action==='submit_review'){
    if(report.status!=='draft')throw new Error('只有草稿可以提交审核');const blockers=snapshot.validation?.publish_blockers||[];if(blockers.length)throw new Error('仍有'+blockers.length+'项发布阻断，请先补齐数据并重新生成草稿');
    approval.status='pending_review';approval.submitted_at=now;snapshot.approval=approval;
    await requestJson('/rest/v1/route_reports?id=eq.'+queryValue(report.id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'pending_review',submitted_at:now,review_notes:null,snapshot,updated_at:now})});await event(report.id,'submit_review',member.user.id,{});return {ok:true,status:'pending_review'};
  }
  if(action==='approve_publish'){
    if(!isAdmin(member))throw Object.assign(new Error('仅最高权限可审核发布'),{status:403});if(report.status!=='pending_review')throw new Error('报告尚未提交审核');
    approval.status='published';approval.approved_at=now;approval.approved_by={name:text(member.profile.name,80),email:text(member.profile.email,120)};snapshot.approval=approval;const snapshotHash=await hashText(canonical(snapshot));
    await requestJson('/rest/v1/route_reports?id=eq.'+queryValue(report.id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'published',approved_at:now,published_at:now,approved_by:member.user.id,snapshot_hash:snapshotHash,review_notes:text(b.review_notes,500)||null,snapshot,updated_at:now})});await event(report.id,'approve_publish',member.user.id,{snapshot_hash:snapshotHash,review_notes:text(b.review_notes,500)||null});return {ok:true,status:'published',share_token:report.share_token,expires_at:report.expires_at};
  }
  if(action==='return_draft'){
    if(!isAdmin(member))throw Object.assign(new Error('仅最高权限可退回草稿'),{status:403});if(report.status!=='pending_review')throw new Error('只有待审核报告可以退回');const note=text(b.review_notes,500);if(!note)throw new Error('请填写退回原因');approval.status='draft';approval.returned_at=now;snapshot.approval=approval;
    await requestJson('/rest/v1/route_reports?id=eq.'+queryValue(report.id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'draft',review_notes:note,snapshot,updated_at:now})});await event(report.id,'return_draft',member.user.id,{review_notes:note});return {ok:true,status:'draft'};
  }
  throw new Error('未知审核操作');
}

async function generatorOptions(member:any){
  const [cur,jm,customers,opps,segments]=await Promise.all([
    requestJson('/rest/v1/current_route_baselines?active=eq.true&data_scope=eq.end_to_end&select=*&order=updated_at.desc&limit=300'),
    requestJson('/rest/v1/jiangmen_routes?data_scope=eq.end_to_end&select=*&order=updated_at.desc&limit=300'),
    requestJson('/rest/v1/customers?select=id,company_name,created_by,owner_id,market_name&archived_at=is.null&order=updated_at.desc&limit=500'),
    requestJson('/rest/v1/opportunities?select=id,customer_id,created_by,fruit,cargo_group,origin_country,origin_region,season_month_num,destination_market,stage,status&archived_at=is.null&order=updated_at.desc&limit=500'),
    requestJson('/rest/v1/route_chain_segments?select=route_kind,route_id,segment_order,public_source_text&limit=5000')
  ]);
  const mineCustomers=isAdmin(member)?customers:customers.filter((c:any)=>c.created_by===member.user.id||c.owner_id===member.user.id),allowedIds=new Set(mineCustomers.map((c:any)=>c.id));
  const mineOpps=isAdmin(member)?opps:opps.filter((o:any)=>o.created_by===member.user.id&&allowedIds.has(o.customer_id));
  const count=(kind:string,id:string)=>segments.filter((s:any)=>s.route_kind===kind&&s.route_id===id).length;
  const clean=(r:any,kind:string)=>({id:r.id,kind,cargo_group:r.cargo_group,fruit:r.fruit,country:r.country,origin_region:r.origin_region,month:r.month,destination_market:r.destination_market,port:kind==='current'?r.current_port:'江门',transport_mode:kind==='current'?r.transport_mode:(r.via_hong_kong?'海运＋香港驳船':'海运'),data_scope:r.data_scope,p50_days:r.p50_days,p90_days:r.p90_days,total_cost_per_container:r.total_cost_per_container,stability_index:r.stability_index,route_congestion_index:r.route_congestion_index,schedule_frequency_per_week:r.schedule_frequency_per_week,capacity_score:r.capacity_score,coldchain_risk_index:r.coldchain_risk_index,abnormal_handling_score:r.abnormal_handling_score,evidence_level:r.evidence_level,sample_size:r.sample_size,is_demo:!!r.is_demo,currency:r.currency,container_type:r.container_type,source_updated_at:r.source_updated_at||r.updated_at,segment_count:count(kind,r.id)});
  return {ok:true,role:member.profile.role,can_approve:isAdmin(member),current_routes:cur.map((r:any)=>clean(r,'current')),jiangmen_routes:jm.map((r:any)=>clean(r,'jiangmen')),customers:mineCustomers.map((c:any)=>({id:c.id,company_name:c.company_name,market_name:c.market_name})),opportunities:mineOpps};
}
async function segmentCatalog(member:any){if(!isAdmin(member))throw Object.assign(new Error('仅最高权限可维护链路分段数据'),{status:403});const opts=await generatorOptions(member),segments=await requestJson('/rest/v1/route_chain_segments?select=*&order=route_kind,route_id,segment_order');return {...opts,segments,segment_codes:SEGMENT_CODES.map((code,i)=>({order:i+1,code,label:SEGMENT_LABELS[code]}))}}
async function saveSegments(b:AnyRow,member:any){
  if(!isAdmin(member))throw Object.assign(new Error('仅最高权限可维护链路分段数据'),{status:403});const kind=text(b.route_kind,20),routeId=text(b.route_id,40),input=Array.isArray(b.segments)?b.segments:[];
  if(!['current','jiangmen'].includes(kind)||!/^[0-9a-f-]{36}$/i.test(routeId))throw new Error('路线参数无效');if(input.length!==9)throw new Error('必须完整填写9个链路环节');
  const codes=input.map((s:any)=>text(s.code,40));if(SEGMENT_CODES.some((c,i)=>codes[i]!==c))throw new Error('链路环节顺序不完整');
  const table=kind==='current'?'current_route_baselines':'jiangmen_routes',parents=await requestJson('/rest/v1/'+table+'?id=eq.'+queryValue(routeId)+'&select=id,p50_days,p90_days,total_cost_per_container,currency,container_type,is_demo'),parent=parents?.[0];if(!parent)throw new Error('未找到路线');
  const rows=input.map((s:any,i:number)=>{const p50=finite(s.p50_days),p90=finite(s.p90_days),cost=finite(s.cost_amount),risk=finite(s.coldchain_risk_index),source=text(s.public_source_text,300);if(p50===null||p90===null||p90<p50||cost===null||risk===null||risk<0||risk>10||!source)throw new Error('第'+(i+1)+'段数据不完整或范围错误');return {route_kind:kind,route_id:routeId,segment_order:i+1,segment_code:SEGMENT_CODES[i],segment_name:text(s.name,100)||SEGMENT_LABELS[SEGMENT_CODES[i]],origin_node:text(s.origin,100)||null,destination_node:text(s.destination,100)||null,p50_days:p50,p90_days:p90,cost_amount:cost,currency:text(parent.currency,3)||'CNY',container_type:text(parent.container_type,20)||'40RF',coldchain_risk_index:risk,evidence_level:['A','B','C','D'].includes(text(s.evidence_level,1))?text(s.evidence_level,1):'C',sample_size:Math.max(0,Math.round(finite(s.sample_size)??0)),public_source_text:source,public_source_url:safeUrl(s.public_source_url),source_updated_at:s.source_updated_at||isoNow(),is_demo:!!parent.is_demo,updated_by:member.user.id,updated_at:isoNow()}});
  const sum=(k:string)=>rows.reduce((a:number,s:any)=>a+Number(s[k]||0),0),p50=sum('p50_days'),p90=sum('p90_days'),cost=sum('cost_amount');if(finite(parent.p50_days)!==null&&Math.abs(p50-Number(parent.p50_days))>.05)throw new Error('9段P50合计必须等于路线P50 '+parent.p50_days+'天');if(finite(parent.p90_days)!==null&&Math.abs(p90-Number(parent.p90_days))>.05)throw new Error('9段P90合计必须等于路线P90 '+parent.p90_days+'天');if(finite(parent.total_cost_per_container)!==null&&Math.abs(cost-Number(parent.total_cost_per_container))>1)throw new Error('9段成本合计必须等于路线TCO '+parent.total_cost_per_container+'元');
  await requestJson('/rest/v1/route_chain_segments?on_conflict=route_kind,route_id,segment_order',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(rows)});return {ok:true,segment_count:9,p50_total:p50,p90_total:p90,cost_total:cost};
}
async function publicReport(req:Request,url:URL){
  const token=text(url.searchParams.get('token'),100);if(!/^[A-Za-z0-9_-]{32,100}$/.test(token))return json({error:'分享链接无效'},404);
  const rows=await requestJson('/rest/v1/route_reports?share_token=eq.'+queryValue(token)+'&select=id,report_number,title,status,model_version,is_demo,access_code_hash,expires_at,locked_until,snapshot,snapshot_hash,approved_at,published_at'),report=rows?.[0];
  if(!report)return json({error:'分享链接无效'},404);if(report.status!=='published')return json({error:'该报告尚未发布或已停止分享'},410);if(report.expires_at&&new Date(report.expires_at).getTime()<Date.now())return json({error:'该报告分享链接已过期'},410);
  if(report.access_code_hash){if(report.locked_until&&new Date(report.locked_until).getTime()>Date.now())return json({requires_code:true,locked:true,locked_until:report.locked_until,error:'尝试次数过多，请稍后再试',title:report.title,report_number:report.report_number},429);const code=text(req.headers.get('x-report-code'),32);if(!code)return json({requires_code:true,title:report.title,report_number:report.report_number},401);const ok=await hashText(report.id+':'+code)===report.access_code_hash;const attempt=await requestJson('/rest/v1/rpc/fonkon_route_report_code_attempt',{method:'POST',body:JSON.stringify({p_report_id:report.id,p_success:ok})});if(!ok)return json({requires_code:true,error:attempt?.locked?'尝试次数过多，已锁定15分钟':'访问密码不正确',locked:!!attempt?.locked,locked_until:attempt?.locked_until,remaining:attempt?.remaining,title:report.title,report_number:report.report_number},attempt?.locked?429:401)}
  const rawVisitor=text(req.headers.get('x-report-visitor'),128),visitorHash=await hashText((rawVisitor||'anonymous')+'|'+text(req.headers.get('user-agent'),160));
  try{await requestJson('/rest/v1/rpc/fonkon_record_route_report_view',{method:'POST',body:JSON.stringify({p_report_id:report.id,p_visitor_hash:visitorHash,p_user_agent:text(req.headers.get('user-agent'),300)||null,p_referrer:text(req.headers.get('referer'),300)||null})})}catch{}
  return json({ok:true,report:{...report.snapshot,is_demo:!!report.is_demo,model_version:report.model_version,expires_at:report.expires_at,integrity:{snapshot_hash:report.snapshot_hash,approved_at:report.approved_at,published_at:report.published_at}}});
}
async function publicQr(url:URL){
  const token=text(url.searchParams.get('token'),100);if(!/^[A-Za-z0-9_-]{32,100}$/.test(token))return json({error:'分享链接无效'},404);const rows=await requestJson('/rest/v1/route_reports?share_token=eq.'+queryValue(token)+'&select=id,status,expires_at'),report=rows?.[0];if(!report||report.status!=='published'||(report.expires_at&&new Date(report.expires_at).getTime()<Date.now()))return json({error:'分享链接无效或已过期'},410);const shareUrl='https://os.fonkonsupply.com/report.html?v=20260824-r11-1-reports5&t='+encodeURIComponent(token),svg=await QRCode.toString(shareUrl,{type:'svg',width:240,margin:1,color:{dark:'#06283b',light:'#ffffff'}});return new Response(svg,{status:200,headers:{'access-control-allow-origin':'*','content-type':'image/svg+xml; charset=utf-8','cache-control':'private, max-age=300'}});
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});const url=new URL(req.url);
  try{
    if(req.method==='GET')return url.searchParams.get('qr')==='1'?await publicQr(url):await publicReport(req,url);
    if(req.method!=='POST')return json({error:'Method not allowed'},405);const b=await req.json(),action=text(b.action,40),member=await currentMember(req);
    if(action==='create')return json(await createReport(b,member));
    if(action==='generator_options')return json(await generatorOptions(member));
    if(action==='segment_catalog')return json(await segmentCatalog(member));
    if(action==='save_segments')return json(await saveSegments(b,member));
    if(['submit_review','approve_publish','return_draft'].includes(action))return json(await workflow(action,b,member));
    if(action==='list'){
      const filter=isAdmin(member)?'':'&created_by=eq.'+queryValue(member.user.id),rows=await requestJson('/rest/v1/route_reports?select=id,report_number,title,status,model_version,is_demo,share_token,expires_at,view_count,unique_view_count,created_at,last_viewed_at,submitted_at,approved_at,published_at,review_notes,snapshot,created_by&order=created_at.desc&limit=150'+filter);
      return json({ok:true,role:member.profile.role,can_approve:isAdmin(member),reports:rows.map((r:any)=>({id:r.id,report_number:r.report_number,title:r.title,status:r.status,model_version:r.model_version,is_demo:r.is_demo,share_token:r.status==='published'?r.share_token:null,expires_at:r.expires_at,view_count:r.view_count,unique_view_count:r.unique_view_count,created_at:r.created_at,last_viewed_at:r.last_viewed_at,submitted_at:r.submitted_at,approved_at:r.approved_at,published_at:r.published_at,review_notes:r.review_notes,client_name:r.snapshot?.client_name||'客户',scope:r.snapshot?.scope||{},route_count:r.snapshot?.routes?.length||0,requires_code:!!r.snapshot?.requires_code,readiness_index:r.snapshot?.comparison?.data_readiness?.index??null,publish_blockers:r.snapshot?.validation?.publish_blockers||[]}))});
    }
    if(['revoke','renew','rotate'].includes(action)){
      const report=await assertReportAccess(text(b.report_id,40),member),now=isoNow();
      if(action==='revoke'){if(report.status!=='published')throw new Error('只有正在分享的报告可以撤销');await requestJson('/rest/v1/route_reports?id=eq.'+queryValue(report.id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'revoked',revoked_at:now,updated_at:now})});await event(report.id,'revoke',member.user.id,{});return json({ok:true})}
      if(action==='renew'){if(report.status!=='published')throw new Error('撤销或草稿报告不能直接续期');const rawDays=Number(b.expiry_days||30),days=Math.max(1,Math.min(365,Number.isFinite(rawDays)?rawDays:30)),expiresAt=new Date(Date.now()+days*86400000).toISOString(),snapshot={...(report.snapshot||{}),expires_at:expiresAt};await requestJson('/rest/v1/route_reports?id=eq.'+queryValue(report.id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({expires_at:expiresAt,snapshot,updated_at:now})});await event(report.id,'renew',member.user.id,{expiry_days:days});return json({ok:true,expires_at:expiresAt,share_token:report.share_token})}
      if(report.status!=='published')throw new Error('只有正在分享的报告可以更换链接');const shareToken=randomToken(32);await requestJson('/rest/v1/route_reports?id=eq.'+queryValue(report.id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({share_token:shareToken,updated_at:now})});await event(report.id,'rotate',member.user.id,{});return json({ok:true,share_token:shareToken,expires_at:report.expires_at});
    }
    return json({error:'Unknown action'},400);
  }catch(e){const status=Number((e as any)?.status)||400;return json({error:e instanceof Error?e.message:String(e)},status)}
});
