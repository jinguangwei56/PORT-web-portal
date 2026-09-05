import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../assets/r11/staff-handoff.js.txt', import.meta.url), 'utf8');
const legacySource = await fs.readFile(new URL('../assets/stage3/a.js.txt', import.meta.url), 'utf8');
class Element {
  constructor(tag,text='') { this.tagName=tag; this.value=text; this.children=[]; this.listeners={}; this.classes=new Set(); this.classList={add:x=>this.classes.add(x)}; this.selectors={}; }
  set textContent(text) { this.value=String(text);this.children=[]; }
  get textContent() { return this.value+this.children.map(x=>x.textContent).join(' '); }
  appendChild(node) { this.children.push(node);return node; }
  prepend(node) { this.children.unshift(node); }
  replaceChildren(...nodes) { this.value='';this.children=nodes;this.selectors={}; }
  addEventListener(event,handler) { this.listeners[event]=handler; }
  querySelector(selector) { return this.selectors[selector]?.[0]||null; }
  querySelectorAll(selector) { return this.selectors[selector]||[]; }
  click() { this.listeners.click?.(); }
}
function setup(options={}) {
  const nodes={},calls=[],events={},state={teamRenders:0,handovers:0,legacyActions:0,loginClicks:0,historyWrites:[]};
  const storage=new Map([['fonkon_session','synthetic-market-session'],['synthetic-business-state','retain-me']]);
  if(options.recoveryStored)storage.set('fonkon_recovery_token','synthetic-recovery-token');
  const register=nodes.registerForm=new Element('form');
  const registrationPassword=new Element('input','synthetic-old-password');
  register.children=[registrationPassword];register.selectors.input=[registrationPassword];
  nodes.tabRegister=new Element('button','首次注册');nodes.tabLogin=new Element('button');
  nodes.tabLogin.listeners.click=()=>{state.loginClicks++;};
  const view=nodes.view=new Element('main');
  for(const fn of ['makeSalesInvite','adminResetPassword','approveSales','rejectSales','toggleSales','revokeInvite'])view.selectors['button[onclick^="'+fn+'("]']=[new Element('button','old action')];
  const password=nodes.pwdForm=new Element('form'),field1=new Element('input'),field2=new Element('input'),hint=new Element('p');
  password.selectors['input[name="password"],input[name="password2"]']=[field1,field2];password.selectors['.notice,.danger-note']=[hint];
  nodes.inviteResult=new Element('div','OLD INVITE CODE');
  nodes.forgotPwd=new Element('button','忘记密码？');
  const ctx={console,Set,Error,Object,profile:{id:'synthetic-manager',role:'admin'},
    ses:{access_token:'synthetic-market-token',aal:'aal1'},
    document:{createElement:tag=>new Element(tag),getElementById:id=>nodes[id]||null,querySelector:()=>null,addEventListener:(name,fn)=>{events[name]=fn;}},
    modal:(_title,body)=>{
      nodes['fonkon-staff-handoff']=new Element('div');nodes['fonkon-recovery-handoff']=new Element('div');
      if(body.includes('id="recoverForm"')){const form=nodes.recoverForm=new Element('form');form.id='recoverForm';form.selectors.input=[new Element('input','synthetic-input')];}
    },
    URLSearchParams,location:{pathname:'/app-r11-1.html',search:options.recoveryQuery?'?mode=recovery':'?v=synthetic',hash:options.recoveryHash?'#type=recovery&access_token=synthetic-recovery-token':''},
    history:{replaceState:(_state,_title,url)=>{state.historyWrites.push(url);}},
    sessionStorage:{getItem:key=>storage.get(key)||null,removeItem:key=>storage.delete(key)},
    fetch:async(...args)=>{calls.push(args);return {ok:true,text:async()=>''};},
    edge:async body=>{calls.push(body);if(options.error)throw options.error;return {ok:true};},
    teamView:async()=>{state.teamRenders++;return 'existing-team';},
    passwordModal:()=>password,
    handoverSales:async()=>{state.handovers++;return 'existing-handover';},
  };
  for(const name of ['makeSalesInvite','adminResetPassword','approveSales','rejectSales','toggleSales','revokeInvite'])ctx[name]=async()=>{state.legacyActions++;};
  ctx.window=ctx;const handover=ctx.handoverSales;let legacySubmit,legacyForgot;
  if(options.legacyRecovery){
    ctx.$=selector=>nodes[selector.slice(1)]||null;ctx.input=()=>'';ctx.bindPasswordVisibility=()=>{};
    const recovery=legacySource.slice(legacySource.indexOf('function openRecoveryModal(token){'),legacySource.indexOf('async function handleRecoveryHash(){'));
    const forgot=legacySource.slice(legacySource.indexOf('window.forgotPassword=function(){'),legacySource.indexOf('const loginForm=document.querySelector'));
    vm.runInNewContext(recovery+'\n'+forgot,ctx);
    ctx.openRecoveryModal('synthetic-recovery-token');legacySubmit=nodes.recoverForm.onsubmit;
    legacyForgot=ctx.forgotPassword;nodes.forgotPwd.onclick=legacyForgot;
  }
  vm.runInNewContext(source,ctx);
  return {ctx,nodes,calls,state,handover,password,field1,field2,hint,registrationPassword,events,storage,legacySubmit,legacyForgot};
}
const links=node=>[...(node.tagName==='a'?[node]:[]),...node.children.flatMap(links)];

test('legacy administrative edge actions cannot send requests or resolve fake success',async()=>{
  const h=setup();for(const action of ['invite','admin_reset_password','approve_user','reject_user','set_user_active','register']){
    let success=false;await assert.rejects(async()=>{await h.ctx.edge({action,user_id:'synthetic-user',password:'DO-NOT-FORWARD'});success=true;},/未执行/);
    assert.equal(success,false);
  }
  assert.equal(h.calls.length,0);assert.equal(h.ctx.ses.access_token,'synthetic-market-token');assert.equal(h.ctx.ses.aal,'aal1');
});
test('all old account UI functions hand off without running legacy handlers',async()=>{
  const h=setup();for(const name of ['makeSalesInvite','adminResetPassword','approveSales','rejectSales','toggleSales','revokeInvite'])await h.ctx[name]('synthetic-user',true);
  assert.equal(h.state.legacyActions,0);assert.equal(h.calls.length,0);
  assert.match(h.nodes['fonkon-staff-handoff'].textContent,/没有执行旧邀请码撤销/);
  const destinations=links(h.nodes['fonkon-staff-handoff']);assert.equal(destinations.length,1);
  assert.equal(destinations[0].href,'https://ops.fonkonsupply.com/zh/staff');
  assert.equal(destinations[0].target,'_blank');assert.equal(destinations[0].rel,'noopener noreferrer');
  assert.doesNotMatch(destinations[0].href,/token|user_id|\?|#/);
});
test('existing team view and customer handover remain intact',async()=>{
  const h=setup();assert.equal(await h.ctx.teamView(),'existing-team');assert.equal(h.state.teamRenders,1);
  assert.equal(h.ctx.handoverSales,h.handover);assert.equal(await h.ctx.handoverSales(),'existing-handover');assert.equal(h.state.handovers,1);
  assert.match(h.nodes.view.textContent,/此操作尚未执行/);
  assert.equal(h.nodes.inviteResult.textContent,'');assert.equal(h.nodes.inviteResult.classes.has('hide'),true);
  assert.equal(h.nodes.view.selectors['button[onclick^="approveSales("]'][0].textContent,'前往 OPS 审批');
});
test('registration removes password fields and its submit handler performs no request',async()=>{
  const h=setup();assert.equal(h.registrationPassword.value,'');assert.equal(h.nodes.registerForm.querySelectorAll('input').length,0);
  let prevented=false;h.nodes.registerForm.onsubmit({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(h.calls.length,0);
  assert.match(h.nodes.registerForm.textContent,/公司邀请开通/);assert.equal(h.nodes.tabRegister.textContent,'受邀加入');
  h.nodes.registerForm.children.find(x=>x.tagName==='button').click();assert.equal(h.state.loginClicks,1);
  assert.deepEqual(links(h.nodes.registerForm).map(x=>x.href),['https://ops.fonkonsupply.com/zh/login']);
});
test('password UI and request validation match the existing 10–72 character backend policy',async()=>{
  const h=setup();h.ctx.passwordModal(true);
  assert.equal(h.field1.minLength,10);assert.equal(h.field2.minLength,10);assert.equal(h.field1.maxLength,72);assert.match(h.hint.textContent,/10–72/);
  await assert.rejects(()=>h.ctx.edge({action:'complete_password_change',new_password:'ShortA1'}),/10–72/);
  await assert.rejects(()=>h.ctx.edge({action:'complete_password_change',new_password:'alllowercase12'}),/大写/);
  assert.equal(h.calls.length,0);
  const body={action:'complete_password_change',new_password:'SyntheticA12'};
  assert.deepEqual(await h.ctx.edge(body),{ok:true});assert.equal(h.calls[0],body);
});
test('password handler errors remain truthful and unrelated actions pass through',async()=>{
  const error=Error('密码已修改，但账号状态尚未同步。');const h=setup({error});
  await assert.rejects(()=>h.ctx.edge({action:'complete_password_change',new_password:'SyntheticA12'}),x=>x===error);
  const business=setup();const body={action:'ordinary_business_action',value:'synthetic'};
  await business.ctx.edge(body);assert.equal(business.calls[0],body);
});

test('the actual legacy recovery form and captured forgot onclick are retired before any Auth request',async()=>{
  const h=setup({legacyRecovery:true});
  assert.notEqual(h.nodes.recoverForm.onsubmit,h.legacySubmit);
  assert.equal(h.nodes.recoverForm.querySelectorAll('input').length,0);
  assert.notEqual(h.nodes.forgotPwd.onclick,h.legacyForgot);
  let prevented=0;const event={preventDefault(){prevented++;}};
  await h.nodes.recoverForm.onsubmit(event);await h.nodes.forgotPwd.onclick(event);
  assert.equal(prevented,2);assert.equal(h.calls.length,0);
  assert.match(h.nodes['fonkon-recovery-handoff'].textContent,/未发送重置邮件，也未修改密码/);
  assert.equal(links(h.nodes['fonkon-recovery-handoff'])[0].href,'https://ops.fonkonsupply.com/zh/forgot-password');
  assert.doesNotMatch(h.nodes['fonkon-recovery-handoff'].textContent,/synthetic-recovery-token/);
});
test('a late legacy recoverForm submit is blocked in capture phase',()=>{
  const h=setup();let prevented=false,stopped=false;
  h.events.submit({target:{id:'recoverForm'},preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});
  assert.equal(prevented,true);assert.equal(stopped,true);assert.equal(h.calls.length,0);
  let ordinaryPrevented=false;h.events.submit({target:{id:'pwdForm'},preventDefault(){ordinaryPrevented=true;}});assert.equal(ordinaryPrevented,false);
});
test('recovery cleanup removes only legacy recovery data and never forwards a token',()=>{
  const h=setup({recoveryStored:true,recoveryHash:true,recoveryQuery:true});
  assert.equal(h.storage.has('fonkon_recovery_token'),false);assert.equal(h.storage.get('fonkon_session'),'synthetic-market-session');
  assert.equal(h.storage.get('synthetic-business-state'),'retain-me');assert.deepEqual(h.state.historyWrites,['/app-r11-1.html']);
  assert.equal(h.ctx.ses.access_token,'synthetic-market-token');assert.equal(h.ctx.ses.aal,'aal1');
  assert.deepEqual(links(h.nodes['fonkon-recovery-handoff']).map(x=>x.href),['https://ops.fonkonsupply.com/zh/forgot-password']);
  assert.equal(setup().state.historyWrites.length,0);
});

async function assembledApplication(transformStage3=x=>x){
  const loader=await fs.readFile(new URL('../app-r11-1.html',import.meta.url),'utf8');let html='',error=null;
  await vm.runInNewContext(loader.match(/<script>([\s\S]*)<\/script>/)[1],{
    console:{error:e=>{error=e;}},
    fetch:async name=>({ok:true,text:async()=>{const path=name.split('?')[0],text=await fs.readFile(new URL('../'+path,import.meta.url),'utf8');return path==='assets/stage3/a.js.txt'?transformStage3(text):text;}}),
    document:{getElementById:()=>({textContent:''}),querySelector:()=>null,open(){},write(value){html=value;},close(){}}
  });return {html,error};
}
test('actual loader disables the closed-over recovery timer before the final handoff module',async()=>{
  const {html,error}=await assembledApplication();assert.equal(error,null);
  assert.ok(html.includes('window.__fonkonLegacyRecoveryTimerDisabled=true;'));
  assert.ok(html.includes('window.__fonkonLegacyRecoveryCountdownDisabled=true'));
  assert.ok(!html.includes('setTimeout(handleRecoveryHash,300);'));
  assert.ok(html.indexOf('data-fonkon-module="assets/stage3/a.js.txt"')<html.indexOf('data-fonkon-module="assets/r11/staff-handoff.js.txt"'));
});
test('loader fails closed when a recovery patch marker is missing or duplicated',async()=>{
  const marker='setTimeout(handleRecoveryHash,300);';
  for(const transform of [text=>text.replace(marker,''),text=>text+'\n'+marker]){
    const {html,error}=await assembledApplication(transform);assert.equal(html,'');assert.match(String(error),/recovery startup/);
  }
});
