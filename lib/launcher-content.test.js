import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
const built = await build({entryPoints:[new URL('../content/floating-launcher.js',import.meta.url).pathname],bundle:true,write:false,format:'iife'});
async function fixture(saved={}, existing=null) {
 let storageListener, messageListener;
 const handlers={},attributes={},style={setProperty(){}},stored={...saved},requests=[];
 let host;
 const button={style:{setProperty(){}},setAttribute(k,v){attributes[k]=v;},setPointerCapture(){},getBoundingClientRect:()=>host.getBoundingClientRect(),addEventListener(k,fn){handlers[k]=fn;}};
 const element=()=>({children:[],dataset:{},handlers:{},style:{},append(...items){this.children.push(...items);for(const item of items)item.parent=this;},remove(){this.parent.children=this.parent.children.filter(item=>item!==this);},addEventListener(k,fn){this.handlers[k]=fn;}});
 const parts={'.summary':element(),'.task-list':element(),'.footer':element()};
 const hint={style:{},querySelector:s=>parts[s],getBoundingClientRect:()=>({bottom:100})},dot={};
 host={addEventListener(){},style,dataset:{},getBoundingClientRect:()=>({left:parseFloat(style.left)||0,top:parseFloat(style.top)||0,width:36,height:36}),attachShadow:()=>({querySelector:s=>s==='button'?button:s==='.hint'?hint:dot}),setAttribute(k,v){attributes[k]=v;},removeAttribute(k){delete attributes[k];},toggleAttribute(k,v){if(v)attributes[k]='';else delete attributes[k];},remove(){}};
 const window={};window.top=window;
 const context={window,document:{getElementById:()=>existing,createElement:tag=>tag==='div'?host:element(),documentElement:{append(){}}},location:{hostname:"example.com"},innerWidth:1000,innerHeight:800,matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){},
 chrome:{runtime:{getManifest:()=>({version:'1.0.24'}),onMessage:{addListener(fn){messageListener=fn;}},async sendMessage(m){requests.push(m);return {ok:true,launcher:{status:'idle',visible:true}};}},storage:{onChanged:{addListener(fn){storageListener=fn;}},local:{async get(){return stored;},async set(v){Object.assign(stored,structuredClone(v));}}}}};
 vm.runInNewContext(built.outputFiles[0].text,context);
 await new Promise(r=>setImmediate(r));
 const event=(type,patch={})=>handlers[type]?.({type,pointerId:1,button:0,clientX:970,clientY:500,detail:1,preventDefault(){},stopPropagation(){},...patch});
 return {parts,event,host,stored,requests,attributes, message: (message) => {let reply;messageListener(message,{},value=>{reply=value;});return reply;}, change: changes => storageListener(changes,"local")};
}
test('XY dragging persists position and suppresses opening on pointer release',async()=>{
 const f=await fixture();
 const before=f.host.getBoundingClientRect();
 f.event('pointerdown');f.event('pointermove',{clientX:800,clientY:350});f.event('pointerup');await f.event('click');
 assert.ok(f.host.getBoundingClientRect().left<before.left-100);
 assert.ok(f.host.getBoundingClientRect().top<before.top-100);
 assert.equal(typeof f.stored.draLauncherPosition.x,'number');
 assert.equal(f.requests.some(m=>m.type==='DRA_OPEN_PANEL'),false);
 f.event('pointerdown');f.event('pointerup');await f.event('click');
 assert.equal(f.requests.filter(m=>m.type==='DRA_OPEN_PANEL').length,1);
});
test('keyboard moves horizontally and old saved Y position is restored',async()=>{
 const f=await fixture({draLauncherPosition:.2});
 const before=f.host.getBoundingClientRect();
 f.event('keydown',{key:'ArrowLeft'});
 assert.equal(f.host.getBoundingClientRect().left,before.left-24);
 assert.ok(Math.abs(f.stored.draLauncherPosition.y-.2)<1e-10);
 assert.ok(Object.hasOwn(f.attributes,'data-visible'));
});

test('persistent visibility preferences are respected on first render and runtime updates',async()=>{
 for (const saved of [{draLauncherEnabled:false},{'draLauncherBlocked:example.com':true}]) {
  const f=await fixture(saved);
  assert.equal(Object.hasOwn(f.attributes,'data-visible'),false);
  f.message({type:'DRA_LAUNCHER_CHANGED',launcher:{visible:true,status:'running'}});
  f.change({draState:{newValue:{status:'paused'}}});
  assert.equal(Object.hasOwn(f.attributes,'data-visible'),false);
 }
 const f=await fixture({'draLauncherBlocked:elsewhere.com':true});
 assert.ok(Object.hasOwn(f.attributes,'data-visible'));
 f.change({draLauncherEnabled:{newValue:false}});
 assert.equal(Object.hasOwn(f.attributes,'data-visible'),false);
 f.change({draLauncherEnabled:{newValue:true}});
 assert.ok(Object.hasOwn(f.attributes,'data-visible'));
});
test('temporary hide survives ping, task updates and size changes, and can be restored',async()=>{
 const f=await fixture();
 assert.equal(f.message({type:'DRA_LAUNCHER_VISIT',hidden:true}).ok,true);
 assert.equal(f.message({type:'DRA_LAUNCHER_PING'}).visitHidden,true);
 f.message({type:'DRA_LAUNCHER_CHANGED',launcher:{visible:true,status:'running'}});
 f.change({draLauncherCompact:{newValue:true}});
 assert.equal(Object.hasOwn(f.attributes,'data-visible'),false);
 assert.equal(f.host.dataset.visitHidden,'true');
 assert.equal(Object.keys(f.stored).length,0,'visit hide must not leak to other tabs or visits');
 f.message({type:'DRA_LAUNCHER_VISIT',hidden:false});
 assert.ok(Object.hasOwn(f.attributes,'data-visible'));
 const nextVisit=await fixture();
 assert.ok(Object.hasOwn(nextVisit.attributes,'data-visible'));
});
test('replacement launcher preserves the current document hide flag',async()=>{
 const f=await fixture({}, {dataset:{launcherVersion:'old',visitHidden:'true'},remove(){}});
 assert.equal(Object.hasOwn(f.attributes,'data-visible'),false);
 assert.equal(f.message({type:'DRA_LAUNCHER_PING'}).visitHidden,true);
});
test('compact mode keeps right edge in bounds and responds to size changes',async()=>{
 const f=await fixture({draLauncherCompact:true,draLauncherPosition:{x:1,y:1}});
 assert.ok(Object.hasOwn(f.attributes,'data-compact'));
 assert.equal(f.host.style.left,'964px');
 assert.equal(f.host.style.top,'764px');
 f.change({draLauncherCompact:{newValue:false}});
 assert.equal(Object.hasOwn(f.attributes,'data-compact'),false);
 assert.equal(f.host.style.left,'956px');
 assert.equal(f.host.style.top,'756px');
});

test('Kuaishou storage updates render separate progress and row click targets its panel',async()=>{
 const f=await fixture();
 f.change({draState:{newValue:{status:'running',stats:{scanned:461}}},draKuaishou:{newValue:{state:{status:'running',stats:{scanned:128}}}},draFeiguaState:{newValue:{status:'paused',stats:{scanned:14}}}});
 const rows=f.parts['.task-list'].children;
 assert.equal(f.parts['.summary'].textContent,'2 个任务运行中');
 assert.deepEqual(rows.map(row=>row.children.map(child=>child.textContent)),[['抖音 · 运行中','已刷 461 条'],['快手 · 运行中','已刷 128 条'],['飞瓜 · 已暂停','已采集 14 页']]);
 rows[1].handlers.click();await new Promise(r=>setImmediate(r));
 assert.equal(f.requests.at(-1).platform,'kuaishou');
 f.change({draKuaishou:{newValue:{state:{status:'running',stats:{scanned:129}}}}});
 assert.equal(f.parts['.task-list'].children[1],rows[1]);
 assert.equal(rows[1].children[1].textContent,'已刷 129 条');
});
