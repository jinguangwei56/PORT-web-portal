import QRCode from 'npm:qrcode@1.5.4';

const U = Deno.env.get('SUPABASE_URL')!;
const S = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-report-code',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store, private, max-age=0'
};
const ADMIN_HEADERS = {apikey:S, authorization:'Bearer '+S, 'content-type':'application/json'};
type AnyRow = Record<string, any>;

function json(data:any,status=200){return new Response(JSON.stringify(data),{status,headers:CORS})}
function text(v:any,max=160){return String(v??'').trim().slice(0,max)}
function num(v:any){return v===null||v===undefined||v===''?null:Number(v)}
function finite(v:any){const n=num(v);return n!==null&&Number.isFinite(n)?n:null}
function isoNow(){return new Date().toISOString()}
function queryValue(v:any){return encodeURIComponent(String(v??''))}
function randomToken(bytes=32){const a=new Uint8Array(bytes);crypto.getRandomValues(a);let s='';for(const x of a)s+=String.fromCharCode(x);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
async function hashText(v:string){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function requestJson(path:string,init:RequestInit={}){
  const r=await fetch(U+path,{...init,headers:{...ADMIN_HEADERS,...(init.headers||{})}});
  const raw=await r.text();let body:any=null;try{body=raw?JSON.parse(raw):null}catch{body={raw}}
  if(!r.ok)throw Object.assign(new Error(body?.message||body?.msg||body?.error_description||body?.error||('HTTP '+r.status)),{status:r.status});
  return body;
}
async function currentMember(req:Request){
  const authorization=req.headers.get('authorization')||'';
  if(!authorization.startsWith('Bearer '))throw Object.assign(new Error('请先登录'),{status:401});
  const r=await fetch(U+'/auth/v1/user',{headers:{apikey:S,authorization}});if(!r.ok)throw Object.assign(new Error('登录状态已失效'),{status:401});
  const user=await r.json();
  const rows=await requestJson('/rest/v1/profiles?id=eq.'+queryValue(user.id)+'&select=id,name,email,role,active,approval_status');
  const profile=rows?.[0];
  if(!profile||!profile.active||profile.approval_status!=='approved')throw Object.assign(new Error('账号尚未获准使用'),{status:403});
  return {user,profile};
}
function normalizePort(v:any){return text(v,80).toLowerCase().replace(/广州市?|港区|港口|口岸|港/g,'').replace(/\s+/g,'')}
function evidenceWeight(v:any){return ({A:100,B:85,C:65,D:40} as AnyRow)[text(v,1)]||35}
function evidenceLabel(v:any){return ({A:'官方/最高权威',B:'政府、海关或船公司正式来源',C:'交叉验证基准',D:'公司实操样本'} as AnyRow)[text(v,1)]||'当前业务样本'}
function pickPortStat(rows:AnyRow[],route:AnyRow,portName:string,jiangmen=false){
  const target=normalizePort(portName);let candidates=rows.filter(x=>jiangmen||normalizePort(x.port_name)===target);
  candidates=candidates.filter(x=>(!x.fruit||!route.fruit||x.fruit===route.fruit)&&(!x.month||!route.month||Number(x.month)===Number(route.month)));
  candidates.sort((a,b)=>((b.fruit?4:0)+(b.month?2:0))-((a.fruit?4:0)+(a.month?2:0)));
  return candidates[0]||null;
}
function latestDate(...values:any[]){const xs=values.filter(Boolean).map(x=>new Date(x).getTime()).filter(Number.isFinite);return xs.length?new Date(Math.max(...xs)).toISOString():null}
function safeMetric(v:any,show=true){return show?finite(v):null}
function routeFromCurrent(r:AnyRow,port:AnyRow,showCost:boolean){
  const origin=text(r.origin_region||r.country||'产地'),destination=text(r.destination_market||'最终市场'),portName=text(r.current_port||'当前口岸');
  return {
    kind:'current',name:portName+'方案',port:portName,transport:text(r.transport_mode||'海运'),
    path:[origin,portName,destination].filter(Boolean),cargo_group:text(r.cargo_group),fruit:text(r.fruit),country:text(r.country),origin_region:text(r.origin_region),month:finite(r.month),destination,
    metrics:{p50_days:finite(r.p50_days??r.total_days),p90_days:finite(r.p90_days??r.total_days),tco:safeMetric(r.total_cost_per_container,showCost),stability:finite(r.stability_index),rci:finite(r.route_congestion_index),pci:finite(port?.congestion_index),inspection_rate:finite(port?.inspection_rate),testing_rate:finite(port?.testing_rate),inspection_days:finite(port?.inspection_days),testing_days:finite(port?.testing_days),coldchain:finite(r.coldchain_risk_index),capacity:finite(r.capacity_score),schedule:finite(r.schedule_frequency_per_week),abnormal:finite(r.abnormal_handling_score)},
    evidence:{route:text(r.evidence_level,1)||'C',port:text(port?.evidence_level,1)||null,label:evidenceLabel(r.evidence_level),sample_size:finite(r.sample_size),updated_at:latestDate(r.updated_at,port?.updated_at)}
  };
}
function routeFromJiangmen(r:AnyRow,port:AnyRow,showCost:boolean){
  const origin=text(r.origin_region||r.country||'产地'),destination=text(r.destination_market||'最终市场');
  const path=[origin,text(r.origin_port||'起运港')];if(r.via_hong_kong)path.push('香港中转');path.push('江门口岸',destination);
  return {
    kind:'jiangmen',name:'FONKON江门方案',port:'江门',transport:r.via_hong_kong?'海运＋香港驳船':'海运',path:path.filter(Boolean),cargo_group:text(r.cargo_group),fruit:text(r.fruit),country:text(r.country),origin_region:text(r.origin_region),month:finite(r.month),destination,
    metrics:{p50_days:finite(r.p50_days??r.total_days),p90_days:finite(r.p90_days??r.total_days),tco:safeMetric(r.total_cost_per_container,showCost),stability:finite(r.stability_index),rci:finite(r.route_congestion_index),pci:finite(port?.congestion_index),inspection_rate:finite(port?.inspection_rate),testing_rate:finite(port?.testing_rate),inspection_days:finite(port?.inspection_days),testing_days:finite(port?.testing_days),coldchain:finite(r.coldchain_risk_index),capacity:finite(r.capacity_score),schedule:finite(r.schedule_frequency_per_week),abnormal:finite(r.abnormal_handling_score)},
    evidence:{route:text(r.evidence_level,1)||'C',port:text(port?.evidence_level,1)||null,label:evidenceLabel(r.evidence_level),sample_size:finite(r.sample_size),updated_at:latestDate(r.updated_at,port?.updated_at)}
  };
}
const GROUPS=[
  {key:'time',label:'端到端时效',metrics:[['p50_days','P50常态','天',true,12],['p90_days','P90旺季/尾部','天',true,8]]},
  {key:'cost',label:'全链路TCO',metrics:[['tco','TCO总成本','元/柜',true,18]]},
  {key:'stability',label:'时效稳定性',metrics:[['stability','稳定性','/100',false,11]]},
  {key:'route_congestion',label:'路线拥堵',metrics:[['rci','路线RCI','/10',true,7]]},
  {key:'port_congestion',label:'口岸拥堵',metrics:[['pci','口岸PCI','/10',true,7]]},
  {key:'regulatory',label:'监管与查验送检',metrics:[['inspection_rate','查验率','%',true,5],['testing_rate','送检率','%',true,5],['inspection_days','查验时长','天',true,3],['testing_days','送检时长','天',true,3]]},
  {key:'coldchain',label:'冷链风险',metrics:[['coldchain','冷链风险','/10',true,5]]},
  {key:'capacity',label:'运力保障',metrics:[['capacity','运力能力','/10',false,4]]},
  {key:'schedule',label:'班期频率',metrics:[['schedule','班期','次/周',false,3]]},
  {key:'abnormal',label:'异常处置',metrics:[['abnormal','异常处置','/10',false,4]]}
] as any[];
function compareRoutes(routes:AnyRow[]){
  const routeScores=routes.map((r,i)=>({index:i,name:r.name,points:0,weight:0,coverage:0,wins:[] as string[]}));
  const rows:any[]=[];let knownGroups=0;
  for(const group of GROUPS){let groupComparable=false;const metricRows:any[]=[];
    for(const [key,label,unit,lower,weight] of group.metrics){
      const values=routes.map((r,i)=>({i,value:finite(r.metrics[key])})).filter(x=>x.value!==null) as {i:number,value:number}[];
      const comparable=values.length>=2;groupComparable ||= comparable;
      let winners:number[]=[];
      if(comparable){const nums=values.map(x=>x.value),best=lower?Math.min(...nums):Math.max(...nums),worst=lower?Math.max(...nums):Math.min(...nums),span=Math.abs(worst-best);
        winners=values.filter(x=>Math.abs(x.value-best)<=Math.max(0.0001,Math.abs(best)*0.002)).map(x=>x.i);
        for(const x of values){const normalized=span<0.0001?50:(lower?(worst-x.value)/span*100:(x.value-worst)/span*100);routeScores[x.i].points+=normalized*weight;routeScores[x.i].weight+=weight;routeScores[x.i].coverage++;if(winners.includes(x.i))routeScores[x.i].wins.push(label)}
      }
      metricRows.push({key,label,unit,lower,values:routes.map(r=>finite(r.metrics[key])),comparable,winners});
    }
    if(groupComparable)knownGroups++;
    rows.push({key:group.key,label:group.label,metrics:metricRows,comparable:groupComparable});
  }
  const scored=routeScores.map(x=>({...x,score:x.weight?Math.round(x.points/x.weight):null}));
  const ranked=scored.filter(x=>x.score!==null).sort((a,b)=>(b.score??0)-(a.score??0));
  const jmIndex=routes.findIndex(r=>r.kind==='jiangmen');const jm=scored[jmIndex];
  const jmAdvantages=jm?Array.from(new Set(jm.wins)):[];
  const jmGaps:string[]=[];
  for(const row of rows)for(const m of row.metrics)if(m.comparable&&m.winners.length&&!m.winners.includes(jmIndex))jmGaps.push(m.label);
  const routeEvidence=routes.map(r=>evidenceWeight(r.evidence.route));const evidenceAvg=routeEvidence.length?routeEvidence.reduce((a,b)=>a+b,0)/routeEvidence.length:35;
  const confidence=Math.round((knownGroups/GROUPS.length)*60+evidenceAvg*0.4);
  const leader=ranked[0]||null;
  let summary='当前同口径数据不足，系统暂不作路线优劣结论。';
  if(leader&&knownGroups>0)summary='在当前已知的 '+knownGroups+'/10 个全链路维度中，'+leader.name+'的综合表现暂时领先；结论仅适用于本报告约定的水果、月份、起点和终点。';
  let recommendation='建议先补齐“待补数据”，再决定是否切换口岸。';
  if(confidence>=60&&leader){recommendation=leader.index===jmIndex?'建议先安排1柜江门试运行，用实际时效、成本和通关结果继续校准模型。':'当前不建议直接整体切换江门；可针对江门短板补强后，再以1柜进行对照试运行。'}
  return {dimension_count:knownGroups,confidence,rows,scores:scored,leader_index:leader?.index??null,summary,jiangmen_advantages:jmAdvantages,jiangmen_gaps:Array.from(new Set(jmGaps)),recommendation};
}
async function assertReportAccess(reportId:string,member:any){
  const rows=await requestJson('/rest/v1/route_reports?id=eq.'+queryValue(reportId)+'&select=id,created_by,status,share_token,expires_at,snapshot');const report=rows?.[0];
  if(!report)throw Object.assign(new Error('未找到报告'),{status:404});if(member.profile.role!=='admin'&&report.created_by!==member.user.id)throw Object.assign(new Error('无权管理此报告'),{status:403});return report;
}
async function createReport(req:Request,b:AnyRow,member:any){
  const ids=Array.from(new Set((Array.isArray(b.current_route_ids)?b.current_route_ids:[]).map((x:any)=>text(x,40)).filter(Boolean))).slice(0,4);
  const jiangmenId=text(b.jiangmen_route_id,40);if(!ids.length||!jiangmenId)throw new Error('请选择至少一条现行路线和一条江门路线');
  const currentRows=await requestJson('/rest/v1/current_route_baselines?id=in.'+queryValue('('+ids.join(',')+')')+'&active=eq.true&select=*');
  if(currentRows.length!==ids.length)throw new Error('部分现行路线不存在或已停用');
  const jmRows=await requestJson('/rest/v1/jiangmen_routes?id=eq.'+queryValue(jiangmenId)+'&select=*');const jm=jmRows?.[0];if(!jm)throw new Error('江门路线不存在');
  for(const r of currentRows){
    if(r.fruit&&jm.fruit&&r.fruit!==jm.fruit)throw new Error('所选路线水果不一致，请按同一水果生成报告');
    if(r.country&&jm.country&&r.country!==jm.country)throw new Error('所选路线原产国不一致，请按同一原产国生成报告');
    if(r.origin_region&&jm.origin_region&&r.origin_region!==jm.origin_region)throw new Error('所选路线产区不一致，请按同一产区生成报告');
    if(r.month&&jm.month&&Number(r.month)!==Number(jm.month))throw new Error('所选路线业务月份不一致，请按同一月份生成报告');
    if(r.destination_market&&jm.destination_market&&r.destination_market!==jm.destination_market)throw new Error('所选路线最终市场不一致，请按同一终点生成报告');
  }
  let customer:any=null;const customerId=text(b.customer_id,40);
  if(customerId){const cs=await requestJson('/rest/v1/customers?id=eq.'+queryValue(customerId)+'&select=id,company_name,contact_name,created_by,owner_id,market_name');customer=cs?.[0];if(!customer)throw new Error('未找到客户');if(member.profile.role!=='admin'&&customer.created_by!==member.user.id&&customer.owner_id!==member.user.id)throw Object.assign(new Error('无权使用该客户生成报告'),{status:403})}
  const [seaStats,landStats,jmStats]=await Promise.all([requestJson('/rest/v1/sea_port_stats?select=*&limit=200'),requestJson('/rest/v1/land_port_stats?select=*&limit=200'),requestJson('/rest/v1/jiangmen_port_stats?select=*&limit=200')]);
  const showCost=b.show_cost!==false;const routes=currentRows.map((r:any)=>routeFromCurrent(r,pickPortStat(String(r.transport_mode||'').includes('陆运')?landStats:seaStats,r,r.current_port),showCost));routes.push(routeFromJiangmen(jm,pickPortStat(jmStats,jm,'江门',true),showCost));
  const comparison=compareRoutes(routes);const createdAt=isoNow();const rawDays=Number(b.expiry_days||30),days=Math.max(1,Math.min(365,Number.isFinite(rawDays)?rawDays:30));const id=crypto.randomUUID();const shareToken=randomToken(32);const accessCode=text(b.access_code,32);if(accessCode&&accessCode.length<4)throw new Error('访问密码至少4位');const clientName=text(b.client_name||customer?.company_name||'贵司',120);const reportNo='FR-'+createdAt.slice(0,10).replace(/-/g,'')+'-'+randomToken(4).slice(0,6).toUpperCase();
  const snapshot={schema_version:1,report_number:reportNo,title:text(b.title||'FONKON供应链路线决策报告',120),client_name:b.show_client_name===false?'贵司':clientName,created_at:createdAt,expires_at:new Date(Date.now()+days*86400000).toISOString(),requires_code:!!accessCode,prepared_by:{name:text(member.profile.name||'FONKON顾问',80),email:text(member.profile.email||'',120)},scope:{cargo_group:text(jm.cargo_group||currentRows[0]?.cargo_group),fruit:text(jm.fruit||currentRows[0]?.fruit),country:text(jm.country||currentRows[0]?.country),origin_region:text(jm.origin_region||currentRows[0]?.origin_region),month:finite(jm.month??currentRows[0]?.month),destination:text(jm.destination_market||currentRows[0]?.destination_market||customer?.market_name||'最终市场')},assumptions:text(b.assumptions||'同起点、同终点、同水果、同一业务月份；未知数据不按0计算。',600),show_cost:showCost,routes,comparison,disclaimer:'本报告基于报告生成时已验证的数据和公司实际样本。待补数据不参与优势计算，正式切换前建议通过试柜复核。'};
  const row={id,report_number:reportNo,title:snapshot.title,customer_id:customer?.id||null,opportunity_id:null,created_by:member.user.id,status:'published',share_token:shareToken,access_code_hash:accessCode?await hashText(id+':'+accessCode):null,expires_at:snapshot.expires_at,snapshot};
  await requestJson('/rest/v1/route_reports',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)});
  return {ok:true,id,report_number:reportNo,share_token:shareToken,expires_at:snapshot.expires_at,requires_code:!!accessCode};
}
async function publicReport(req:Request,url:URL){
  const token=text(url.searchParams.get('token'),100);if(!/^[A-Za-z0-9_-]{32,100}$/.test(token))return json({error:'分享链接无效'},404);
  const rows=await requestJson('/rest/v1/route_reports?share_token=eq.'+queryValue(token)+'&select=id,report_number,title,status,access_code_hash,expires_at,snapshot');const report=rows?.[0];
  if(!report)return json({error:'分享链接无效'},404);if(report.status!=='published')return json({error:'该报告已停止分享'},410);if(report.expires_at&&new Date(report.expires_at).getTime()<Date.now())return json({error:'该报告分享链接已过期'},410);
  if(report.access_code_hash){const code=text(req.headers.get('x-report-code'),32);if(!code)return json({requires_code:true,title:report.title,report_number:report.report_number},401);if(await hashText(report.id+':'+code)!==report.access_code_hash)return json({requires_code:true,error:'访问密码不正确',title:report.title,report_number:report.report_number},401)}
  try{await requestJson('/rest/v1/rpc/fonkon_record_route_report_view',{method:'POST',body:JSON.stringify({p_report_id:report.id,p_user_agent:text(req.headers.get('user-agent'),300)||null,p_referrer:text(req.headers.get('referer'),300)||null})})}catch{}
  return json({ok:true,report:{...report.snapshot,expires_at:report.expires_at}});
}
async function publicQr(url:URL){
  const token=text(url.searchParams.get('token'),100);if(!/^[A-Za-z0-9_-]{32,100}$/.test(token))return json({error:'分享链接无效'},404);
  const rows=await requestJson('/rest/v1/route_reports?share_token=eq.'+queryValue(token)+'&select=id,status,expires_at');const report=rows?.[0];
  if(!report||report.status!=='published'||(report.expires_at&&new Date(report.expires_at).getTime()<Date.now()))return json({error:'分享链接无效或已过期'},410);
  const shareUrl='https://os.fonkonsupply.com/report.html?t='+encodeURIComponent(token);
  const svg=await QRCode.toString(shareUrl,{type:'svg',width:240,margin:1,color:{dark:'#06283b',light:'#ffffff'}});
  return new Response(svg,{status:200,headers:{'access-control-allow-origin':'*','content-type':'image/svg+xml; charset=utf-8','cache-control':'private, max-age=300'}});
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
  const url=new URL(req.url);
  try{
    if(req.method==='GET')return url.searchParams.get('qr')==='1'?await publicQr(url):await publicReport(req,url);
    if(req.method!=='POST')return json({error:'Method not allowed'},405);
    const b=await req.json();const action=text(b.action,40);
    const member=await currentMember(req);
    if(action==='create')return json(await createReport(req,b,member));
    if(action==='list'){
      const filter=member.profile.role==='admin'?'':'&created_by=eq.'+queryValue(member.user.id);
      const rows=await requestJson('/rest/v1/route_reports?select=id,report_number,title,status,share_token,expires_at,view_count,created_at,last_viewed_at,snapshot,created_by&order=created_at.desc&limit=100'+filter);
      return json({ok:true,reports:rows.map((r:any)=>({id:r.id,report_number:r.report_number,title:r.title,status:r.status,share_token:r.share_token,expires_at:r.expires_at,view_count:r.view_count,created_at:r.created_at,last_viewed_at:r.last_viewed_at,client_name:r.snapshot?.client_name||'客户',scope:r.snapshot?.scope||{},route_count:r.snapshot?.routes?.length||0,requires_code:!!r.snapshot?.requires_code}))});
    }
    if(['revoke','renew','rotate'].includes(action)){
      const report=await assertReportAccess(text(b.report_id,40),member);
      if(action==='revoke'){await requestJson('/rest/v1/route_reports?id=eq.'+queryValue(report.id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'revoked',revoked_at:isoNow(),updated_at:isoNow()})});return json({ok:true})}
      if(action==='renew'){const rawDays=Number(b.expiry_days||30),days=Math.max(1,Math.min(365,Number.isFinite(rawDays)?rawDays:30)),expiresAt=new Date(Date.now()+days*86400000).toISOString(),snapshot={...(report.snapshot||{}),expires_at:expiresAt};await requestJson('/rest/v1/route_reports?id=eq.'+queryValue(report.id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'published',revoked_at:null,expires_at:expiresAt,snapshot,updated_at:isoNow()})});return json({ok:true,expires_at:expiresAt,share_token:report.share_token})}
      const shareToken=randomToken(32);await requestJson('/rest/v1/route_reports?id=eq.'+queryValue(report.id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'published',revoked_at:null,share_token:shareToken,updated_at:isoNow()})});return json({ok:true,share_token:shareToken,expires_at:report.expires_at});
    }
    return json({error:'Unknown action'},400);
  }catch(e){const status=Number((e as any)?.status)||400;return json({error:e instanceof Error?e.message:String(e)},status)}
});
