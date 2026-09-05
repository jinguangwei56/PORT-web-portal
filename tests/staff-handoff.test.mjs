import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../assets/r11/staff-handoff.js.txt', import.meta.url), 'utf8');
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
  const nodes={},calls=[],state={teamRenders:0,handovers:0,legacyActions:0,loginClicks:0};
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
  const ctx={console,Set,Error,Object,profile:{id:'synthetic-manager',role:'admin'},
    ses:{access_token:'synthetic-market-token',aal:'aal1'},
    document:{createElement:tag=>new Element(tag),getElementById:id=>nodes[id]||null,querySelector:()=>null},
    modal:()=>{nodes['fonkon-staff-handoff']=new Element('div');},
    edge:async body=>{calls.push(body);if(options.error)throw options.error;return {ok:true};},
    teamView:async()=>{state.teamRenders++;return 'existing-team';},
    passwordModal:()=>password,
    handoverSales:async()=>{state.handovers++;return 'existing-handover';},
  };
  for(const name of ['makeSalesInvite','adminResetPassword','approveSales','rejectSales','toggleSales','revokeInvite'])ctx[name]=async()=>{state.legacyActions++;};
  ctx.window=ctx;const handover=ctx.handoverSales;vm.runInNewContext(source,ctx);
  return {ctx,nodes,calls,state,handover,password,field1,field2,hint,registrationPassword};
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
