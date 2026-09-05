import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../assets/r11/customer-linkage.js.txt', import.meta.url), 'utf8');
const CUSTOMER = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
class Node {
  constructor(tag) { this.tagName=tag; this.children=[]; this.dataset={}; this.attributes={}; this.listeners={}; this.value=''; this.parent=null; }
  get textContent() { return this.value+this.children.map(x=>x.textContent).join(' '); }
  set textContent(value) { this.value=String(value); this.children=[]; }
  get isConnected() { return this.tagName==='root'||!!this.parent?.isConnected; }
  appendChild(child) { child.parent=this; this.children.push(child); return child; }
  replaceChildren(...children) { this.children.forEach(x=>x.parent=null); this.children=[]; this.value=''; children.forEach(x=>this.appendChild(x)); }
  remove() { if(this.parent) { this.parent.children=this.parent.children.filter(x=>x!==this); this.parent=null; } }
  setAttribute(key,value) { this.attributes[key]=value; }
  addEventListener(name,fn) { this.listeners[name]=fn; }
}
function harness(fetcher) {
  const root = new Node('root'); let body=null; const calls=[], events={};
  const ctx={console,AbortController,Intl,Date,JSON,Set,setTimeout,clearTimeout,
    U:'https://fixture.invalid',K:'synthetic-publishable-key',
    ses:{user:{id:'synthetic-staff-A'},access_token:'synthetic-token-A'},
    profile:{id:'synthetic-staff-A',active:true,approval_status:'approved'},
    customers:[{id:CUSTOMER},{id:OTHER}],
    document:{createElement:tag=>new Node(tag),querySelector:()=>body},
    fetch:async (...args)=>{calls.push(args);return fetcher(...args);},
    openCustomer:async()=>{body=new Node('body');root.replaceChildren(body);},
    closeModal:()=>{root.replaceChildren();body=null;},
    clearSession:()=>{ctx.ses=null;ctx.profile=null;},
    saveSession:next=>{ctx.ses=next;},
    addEventListener:(name,fn)=>{events[name]=fn;}
  };
  ctx.window=ctx;
  vm.runInNewContext(source,ctx);
  return {ctx,root,calls,events,panel:()=>body?.children[0]};
}
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const summary=(id=CUSTOMER)=>({crm_customer_id:id,requests:[{request_no:'REQ-SYNTH',cargo_name:'<img src=x onerror=alert(1)>',request_status:'reviewing',created_at:'2026-09-05T00:00:00Z',bank_account:'DO-NOT-RENDER'}],orders:[{order_no:'ORDER-SYNTH',cargo_name:'Longan',status:'海运中',progress:50,eta:'2026-09-06T00:00:00Z',internal_note:'DO-NOT-RENDER',cost:123}],bank_account:'DO-NOT-RENDER'});

test('uses the current staff JWT, no-store POST and renders only text allowlists',async()=>{
  const h=harness(async()=>response(summary())); await h.ctx.openCustomer(CUSTOMER);
  assert.equal(h.panel().dataset.linkageState,'ready');
  assert.match(h.root.textContent,/REQ-SYNTH/); assert.match(h.root.textContent,/<img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(h.root.textContent,/DO-NOT-RENDER/);
  const [url,options]=h.calls[0]; assert.equal(url,'https://fixture.invalid/rest/v1/rpc/fonkon_market_customer_summary');
  assert.equal(options.cache,'no-store'); assert.equal(options.method,'POST'); assert.equal(options.credentials,'omit');
  assert.equal(options.headers.authorization,'Bearer synthetic-token-A'); assert.deepEqual(JSON.parse(options.body),{p_crm_customer_id:CUSTOMER});
  assert.equal(h.calls.length,1);
});
for(const [name,data,status,state] of [
  ['empty',{crm_customer_id:CUSTOMER,requests:[],orders:[]},200,'empty'],
  ['not deployed',{code:'PGRST202',message:'DO-NOT-RENDER'},404,'unavailable'],
  ['forbidden',{code:'42501',message:'DO-NOT-RENDER'},403,'forbidden'],
  ['expired session',{message:'DO-NOT-RENDER'},401,'signed_out'],
  ['malformed or wrong customer',summary(OTHER),200,'error'],
  ['server error',{message:'DO-NOT-RENDER'},500,'error']
]) test(name,async()=>{const h=harness(async()=>response(data,status));await h.ctx.openCustomer(CUSTOMER);assert.equal(h.panel().dataset.linkageState,state);assert.doesNotMatch(h.root.textContent,/DO-NOT-RENDER|ORDER-SYNTH/);});
test('an old customer response cannot overwrite a newly opened customer',async()=>{
  let resolve; const late=new Promise(r=>{resolve=r;});
  const h=harness(async(_url,opt)=>JSON.parse(opt.body).p_crm_customer_id===CUSTOMER?late:response({crm_customer_id:OTHER,requests:[],orders:[]}));
  const first=h.ctx.openCustomer(CUSTOMER); await Promise.resolve();
  await h.ctx.openCustomer(OTHER); resolve(response(summary())); await first;
  assert.equal(h.panel().dataset.linkageState,'empty'); assert.doesNotMatch(h.root.textContent,/ORDER-SYNTH/);
});
test('logout clears visible data and discards a late response even if transport ignores abort',async()=>{
  let resolve; const late=new Promise(r=>{resolve=r;}); const h=harness(async()=>late);
  const request=h.ctx.openCustomer(CUSTOMER); await Promise.resolve(); h.ctx.clearSession();
  resolve(response(summary())); await request; assert.equal(h.panel(),undefined); assert.doesNotMatch(h.root.textContent,/ORDER-SYNTH/);
});
test('switching users clears data and subsequent opens use the new token',async()=>{
  const h=harness(async()=>response(summary()));await h.ctx.openCustomer(CUSTOMER);
  h.ctx.saveSession({user:{id:'synthetic-staff-B'},access_token:'synthetic-token-B'});
  assert.equal(h.panel(),undefined);h.ctx.profile={id:'synthetic-staff-B',active:true,approval_status:'approved'};
  await h.ctx.openCustomer(CUSTOMER);assert.equal(h.calls[1][1].headers.authorization,'Bearer synthetic-token-B');
});
test('other-tab signout and closing the detail clear visible summaries',async()=>{
  const h=harness(async()=>response(summary()));await h.ctx.openCustomer(CUSTOMER);
  h.events.storage({key:'fonkon_session'});assert.equal(h.panel(),undefined);
  await h.ctx.openCustomer(CUSTOMER);h.ctx.closeModal();assert.doesNotMatch(h.root.textContent,/ORDER-SYNTH/);
});
