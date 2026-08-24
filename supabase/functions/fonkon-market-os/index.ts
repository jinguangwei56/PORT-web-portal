const U = Deno.env.get('SUPABASE_URL')!;
const S = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS = {'access-control-allow-origin':'*','access-control-allow-headers':'authorization, content-type, apikey','access-control-allow-methods':'GET,POST,OPTIONS','content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const ah = {apikey:S,authorization:'Bearer '+S,'content-type':'application/json'};
async function sj(url:string, init:RequestInit={}){const r=await fetch(url,init);const t=await r.text();let j:any=null;try{j=t?JSON.parse(t):null}catch{j={raw:t}}if(!r.ok)throw new Error(j?.msg||j?.message||j?.error_description||j?.error||('HTTP '+r.status));return j}
async function currentUser(req:Request){const a=req.headers.get('authorization')||'';if(!a)return null;try{return await sj(U+'/auth/v1/user',{headers:{apikey:S,authorization:a}})}catch{return null}}
async function requireAdmin(req:Request){const me=await currentUser(req);if(!me)throw new Error('请先登录');const ps=await sj(U+'/rest/v1/profiles?id=eq.'+me.id+'&select=id,role,active,approval_status',{headers:ah});const p=ps[0];if(!p||p.role!=='admin'||!p.active||p.approval_status!=='approved')throw new Error('无最高权限');return me}
async function requireMember(req:Request){const me=await currentUser(req);if(!me)throw new Error('请先登录');const ps=await sj(U+'/rest/v1/profiles?id=eq.'+me.id+'&select=id,role,active,approval_status,force_password_change,password_reset_required_at,password_changed_at',{headers:ah});const p=ps[0];if(!p||!p.active||p.approval_status!=='approved')throw new Error('账号尚未获准使用');return {me,profile:p}}
async function clearPasswordRequirement(uid:string,changedAt:string){let last:any=null;for(let i=0;i<3;i++){try{await sj(U+'/rest/v1/profiles?id=eq.'+encodeURIComponent(uid),{method:'PATCH',headers:{...ah,Prefer:'return=minimal'},body:JSON.stringify({force_password_change:false,password_reset_required_at:null,password_changed_at:changedAt,updated_at:changedAt})});return}catch(e){last=e}}throw last||new Error('密码状态保存失败')}
function inviteCode(){const a=new Uint8Array(5);crypto.getRandomValues(a);return 'FONKON-'+[...a].map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase()}
function tempPassword(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#';const a=new Uint8Array(12);crypto.getRandomValues(a);return [...a].map(x=>chars[x%chars.length]).join('')}
function json(data:any,status=200){return new Response(JSON.stringify(data),{status,headers:CORS})}
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
 if(req.method==='GET')return json({ok:true,service:'FONKON Market OS API',version:'1.2-stage3'});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 try{
  const b=await req.json();
  if(b.action==='register'){
   const name=String(b.name||'').trim(),email=String(b.email||'').trim().toLowerCase(),pass=String(b.password||''),ic=String(b.code||'').trim().toUpperCase();
   if(!name||!email||pass.length<6||!ic)throw new Error('请完整填写注册信息');
   if(ic==='FONKON-35A7978E'){
    const admins=await sj(U+'/rest/v1/profiles?role=eq.admin&select=id',{headers:ah});if(admins.length)throw new Error('初始最高权限邀请码已使用');
    const nu=await sj(U+'/auth/v1/admin/users',{method:'POST',headers:ah,body:JSON.stringify({email,password:pass,email_confirm:true,user_metadata:{name}})});
    await sj(U+'/rest/v1/profiles',{method:'POST',headers:{...ah,Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({id:nu.id,name,email,role:'admin',active:true,approval_status:'approved',applied_at:new Date().toISOString(),reviewed_at:new Date().toISOString(),reviewed_by:nu.id,invite_code_used:ic})});return json({ok:true,role:'admin',approved:true});
   }
   const invs=await sj(U+'/rest/v1/staff_invites?code=eq.'+encodeURIComponent(ic)+'&active=eq.true&used_by=is.null&select=*',{headers:ah});const inv=invs[0];
   if(!inv||(inv.expires_at&&new Date(inv.expires_at)<new Date()))throw new Error('邀请码无效或已过期');if(inv.role!=='sales')throw new Error('邀请码类型已停用，请联系最高权限');
   const nu=await sj(U+'/auth/v1/admin/users',{method:'POST',headers:ah,body:JSON.stringify({email,password:pass,email_confirm:true,user_metadata:{name}})});
   await sj(U+'/rest/v1/profiles',{method:'POST',headers:{...ah,Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({id:nu.id,name,email,role:'sales',active:false,approval_status:'pending',applied_at:new Date().toISOString(),invite_code_used:ic})});
   await sj(U+'/rest/v1/staff_invites?code=eq.'+encodeURIComponent(ic),{method:'PATCH',headers:{...ah,Prefer:'return=minimal'},body:JSON.stringify({active:false,used_by:nu.id,used_at:new Date().toISOString()})});
   return json({ok:true,role:'sales',pending:true,message:'注册申请已提交，等待最高权限审批'});
  }
	  if(b.action==='complete_password_change'){
	   const {me,profile}=await requireMember(req);const password=String(b.new_password||''),requiredAt=profile.password_reset_required_at?new Date(profile.password_reset_required_at).getTime():0,authUpdated=me.updated_at?new Date(me.updated_at).getTime():0;
	   if(password.length<6)throw new Error('密码至少6位');
	   if(profile.force_password_change&&requiredAt&&authUpdated>requiredAt){const reconciledAt=me.updated_at||new Date().toISOString();await clearPasswordRequirement(me.id,reconciledAt);return json({ok:true,force_password_change:false,password_changed_at:reconciledAt,reconciled:true})}
	   try{await sj(U+'/auth/v1/admin/users/'+encodeURIComponent(me.id),{method:'PUT',headers:ah,body:JSON.stringify({password})})}
	   catch(e){const msg=e instanceof Error?e.message:String(e);if(/different from the old|same.password/i.test(msg))throw new Error('新密码不能与当前或临时密码相同，请设置一个全新的密码');throw e}
	   const now=new Date().toISOString();
	   await clearPasswordRequirement(me.id,now);
   try{await sj(U+'/rest/v1/admin_audit_log',{method:'POST',headers:{...ah,Prefer:'return=minimal'},body:JSON.stringify({actor_id:me.id,action:'change_own_password',target_type:'profile',target_id:me.id,detail:{forced_change_completed:true}})})}catch{}
   return json({ok:true,force_password_change:false,password_changed_at:now});
  }
  if(b.action==='invite'){await requireAdmin(req);const c=inviteCode();await sj(U+'/rest/v1/staff_invites',{method:'POST',headers:{...ah,Prefer:'return=minimal'},body:JSON.stringify({code:c,role:'sales',active:true,expires_at:new Date(Date.now()+7*86400000).toISOString()})});return json({ok:true,code:c,role:'sales'})}
  if(b.action==='approve_user'){const me=await requireAdmin(req);const uid=String(b.user_id||'');if(!uid)throw new Error('缺少账号ID');const ps=await sj(U+'/rest/v1/profiles?id=eq.'+encodeURIComponent(uid)+'&select=id,role',{headers:ah});if(!ps[0]||ps[0].role!=='sales')throw new Error('只能审批业务员账号');await sj(U+'/rest/v1/profiles?id=eq.'+encodeURIComponent(uid),{method:'PATCH',headers:{...ah,Prefer:'return=minimal'},body:JSON.stringify({active:true,approval_status:'approved',approval_note:String(b.note||'').trim()||null,reviewed_at:new Date().toISOString(),reviewed_by:me.id})});return json({ok:true})}
  if(b.action==='reject_user'){const me=await requireAdmin(req);const uid=String(b.user_id||'');if(!uid)throw new Error('缺少账号ID');await sj(U+'/rest/v1/profiles?id=eq.'+encodeURIComponent(uid),{method:'PATCH',headers:{...ah,Prefer:'return=minimal'},body:JSON.stringify({active:false,approval_status:'rejected',approval_note:String(b.note||'').trim()||'最高权限驳回',reviewed_at:new Date().toISOString(),reviewed_by:me.id})});return json({ok:true})}
  if(b.action==='set_user_active'){await requireAdmin(req);const uid=String(b.user_id||''),active=Boolean(b.active);const ps=await sj(U+'/rest/v1/profiles?id=eq.'+encodeURIComponent(uid)+'&select=id,role,approval_status',{headers:ah});const p=ps[0];if(!p||p.role!=='sales')throw new Error('只能管理业务员账号');if(active&&p.approval_status!=='approved')throw new Error('未审批通过不能启用');await sj(U+'/rest/v1/profiles?id=eq.'+encodeURIComponent(uid),{method:'PATCH',headers:{...ah,Prefer:'return=minimal'},body:JSON.stringify({active})});return json({ok:true,active})}
  if(b.action==='admin_reset_password'){
   await requireAdmin(req);const uid=String(b.user_id||'');if(!uid)throw new Error('缺少账号ID');const ps=await sj(U+'/rest/v1/profiles?id=eq.'+encodeURIComponent(uid)+'&select=id,role,email',{headers:ah});const p=ps[0];if(!p||p.role!=='sales')throw new Error('只能重置业务员密码');const pwd=tempPassword();
   await sj(U+'/auth/v1/admin/users/'+encodeURIComponent(uid),{method:'PUT',headers:ah,body:JSON.stringify({password:pwd})});
   await sj(U+'/rest/v1/profiles?id=eq.'+encodeURIComponent(uid),{method:'PATCH',headers:{...ah,Prefer:'return=minimal'},body:JSON.stringify({force_password_change:true,password_reset_required_at:new Date().toISOString(),password_changed_at:null})});
   return json({ok:true,temporary_password:pwd,email:p.email});
  }
  return json({error:'Unknown action'},400);
 }catch(e){const msg=e instanceof Error?e.message:String(e);const status=msg==='请先登录'?401:(msg.includes('权限')?403:400);return json({error:msg},status)}
});
