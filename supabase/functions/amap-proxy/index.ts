const AMAP_JS_SECURITY_CODE=Deno.env.get('AMAP_JS_SECURITY_CODE')||'';
const ALLOWED_ORIGINS=new Set(['https://os.fonkonsupply.com','https://jinguangwei56.github.io']);

function cors(origin:string){return {
  'access-control-allow-origin':origin,
  'access-control-allow-methods':'GET,POST,OPTIONS',
  'access-control-allow-headers':'content-type,x-requested-with',
  'access-control-max-age':'86400',
  'access-control-expose-headers':'content-type,cache-control',
  'cross-origin-resource-policy':'cross-origin',
  'x-content-type-options':'nosniff',
  'vary':'Origin'
}}
function response(message:string,status:number,origin:string){return new Response(JSON.stringify({error:message}),{status,headers:{...cors(origin),'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}
function trustedOrigin(req:Request){
  const origin=req.headers.get('origin')||'';if(ALLOWED_ORIGINS.has(origin))return origin;
  const referer=req.headers.get('referer')||'';try{const refererOrigin=new URL(referer).origin;if(ALLOWED_ORIGINS.has(refererOrigin))return refererOrigin}catch{}
  return '';
}

Deno.serve(async(req)=>{
  const origin=trustedOrigin(req);
  if(!origin)return response('Origin not allowed',403,'https://os.fonkonsupply.com');
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(origin)});
  if(!['GET','POST'].includes(req.method))return response('Method not allowed',405,origin);
  if(!AMAP_JS_SECURITY_CODE)return response('Map security service unavailable',503,origin);
  const incoming=new URL(req.url),marker='/_AMapService',index=incoming.pathname.indexOf(marker);
  if(index<0)return response('Route not found',404,origin);
  const suffix=incoming.pathname.slice(index+marker.length)||'/';
  if(!/^\/(?:v3|v4|ws)\//.test(suffix))return response('Map route not allowed',403,origin);
  const upstream=new URL((suffix.startsWith('/v4/map/styles')?'https://webapi.amap.com':'https://restapi.amap.com')+suffix);
  incoming.searchParams.forEach((value,key)=>{if(key!=='jscode')upstream.searchParams.append(key,value)});upstream.searchParams.set('jscode',AMAP_JS_SECURITY_CODE);
  const headers:Record<string,string>={accept:req.headers.get('accept')||'*/*'};const contentType=req.headers.get('content-type');if(contentType)headers['content-type']=contentType;
  try{
    const upstreamResponse=await fetch(upstream,{method:req.method,headers,body:req.method==='POST'?await req.arrayBuffer():undefined}),outHeaders={...cors(origin),'content-type':upstreamResponse.headers.get('content-type')||'application/json; charset=utf-8','cache-control':upstreamResponse.headers.get('cache-control')||'public, max-age=300'};
    return new Response(upstreamResponse.body,{status:upstreamResponse.status,headers:outHeaders});
  }catch{return response('Map upstream unavailable',502,origin)}
});
