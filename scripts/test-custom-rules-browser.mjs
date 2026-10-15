// Real built sidepanel with isolated runtime fixtures: target edit -> save -> resume.
// Uses an isolated Chrome profile; no pairing or uploads.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const delay = ms => new Promise(r=>setTimeout(r,ms));
const root=resolve(import.meta.dirname,'..');
const profile=process.env.RESUME_PROFILE || await mkdtemp(resolve(tmpdir(),'finder-panel-test-'));
if(process.env.RESUME_PROFILE) { const { unlink } = await import('node:fs/promises'); await unlink(resolve(profile,'DevToolsActivePort')).catch(()=>{}); }
const executable=process.env.CHROME_BIN;
if(!executable)throw new Error('Set CHROME_BIN to Chrome for Testing executable');
const chrome=spawn(executable,[`--user-data-dir=${profile}`,'--remote-debugging-port=0','--enable-unsafe-extension-debugging','--no-first-run','--no-default-browser-check',`--disable-extensions-except=${root}/dist`,`--load-extension=${root}/dist`,'about:blank'],{stdio:'ignore'});
process.on('exit',()=>chrome.kill());
let endpoint;
for(let i=0;i<100;i++){try{const [port,path]=(await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');endpoint=`ws://127.0.0.1:${port}${path}`;break;}catch{await delay(100);}}
if(!endpoint)throw new Error('Chrome failed to start');
console.log(JSON.stringify({profile,endpoint,pid:chrome.pid}));
const ws=new WebSocket(endpoint);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let seq=0;const pending=new Map(),listeners=new Set();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}}else for(const f of [...listeners])f(m);});
function cmd(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout ${method}`));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,sessionId}));});}
async function attach(targetId){return (await cmd('Target.attachToTarget',{targetId,flatten:true})).sessionId;}
async function evaluate(sessionId,expression){const r=await cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
let extensionId;
for(let i=0;i<50&&!extensionId;i++){
 const {targetInfos}=await cmd('Target.getTargets');
 for(const worker of targetInfos.filter(t=>t.type==='service_worker'&&t.url.startsWith('chrome-extension://')&&t.url.endsWith('/background.js'))){
  const candidate=await attach(worker.targetId);
  const manifest=await evaluate(candidate,'globalThis.chrome?.runtime?.getManifest?.()');
  await cmd('Target.detachFromTarget',{sessionId:candidate});
  if(manifest?.name==='多平台自动找号助手'){extensionId=new URL(worker.url).host;break;}
 }
 if(!extensionId)await delay(200);
}
assert.ok(extensionId,'extension worker loaded');



const report={version:JSON.parse(await readFile(resolve(root,'dist/manifest.json'),'utf8')).version,scenarios:[],startedAt:new Date().toISOString()};
await mkdir(resolve(root,'test-results'),{recursive:true});
const waitFor=async(fn,label)=>{for(let i=0;i<80;i++){if(await fn().catch(()=>false))return;await delay(100);}throw Error(label);};
try {
 const worker=(await cmd('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${extensionId}/background.js`);
 const sw=await attach(worker.targetId);
 await evaluate(sw,`chrome.tabs.create({url:chrome.runtime.getURL('sidepanel/index.html'),active:true})`);
 let target;
 await waitFor(async()=>{target=(await cmd('Target.getTargets')).targetInfos.find(t=>t.type==='page'&&t.url===`chrome-extension://${extensionId}/sidepanel/index.html`);return !!target;},'panel');
 const panel=await attach(target.targetId);
 const api=expression=>evaluate(panel,expression);
 await waitFor(()=>api(`Boolean(document.querySelector('#themePreference'))`),'loaded');
 const status=platform=>api(`chrome.runtime.sendMessage({type:'DRA_GET_STATUS',platform:${JSON.stringify(platform)}})`);
 const click=selector=>api(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const fill=async(selector,value)=>{
  await api(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw Error('Missing input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(String(value))});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await delay(50);
 };
 const selectPlatform=async(index,expected)=>{
  await click('.platform-trigger');await click(`.platform-row:nth-child(${index+1})`);
  await waitFor(()=>api(`document.querySelector('.platform-trigger').getAttribute('aria-label').includes(${JSON.stringify(expected)})`),'platform selected');
  await waitFor(()=>api(`Boolean(document.querySelector('.configuration-panel'))`),'configuration loaded');
  await waitFor(()=>api(`document.querySelector('#hardRulesTitle')?.textContent.includes('B\u7ad9') === ${index >= 2}`),'rules platform loaded');
  await delay(150);
  await api(`document.querySelector('.configuration-panel').open=true;document.querySelector('#configuration-tab-1').click()`);
  await delay(100);
 };
 const screenshot=async(name,selector)=>{
  await api(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'})`);
  await delay(150);
  const result=await cmd('Page.captureScreenshot',{format:'png'},panel);
  await writeFile(resolve(root,'test-results',name),Buffer.from(result.data,'base64'));
 };
 await cmd('Emulation.setDeviceMetricsOverride',{width:420,height:1000,deviceScaleFactor:1,mobile:false},panel);
 for(const [index,label,platform] of [[0,'抖音','douyin'],[1,'快手','kuaishou'],[2,'首页','bilibili'],[3,'热门','bilibili-popular']]) {
  await selectPlatform(index,label);
  await click('#configuration-tab-0');
  const fresh=await status(platform);
  assert.equal(fresh.settings.target.mode,'time',`${platform} fresh persisted default`);
  assert.equal(fresh.settingsDraft,null,`${platform} fresh draft`);
  assert.equal(await api(`document.querySelector('[aria-labelledby="targetSettingTitle"] select').value`),'time',`${platform} actual rendered default`);
  await screenshot(`fresh-target-${platform}.png`,'[aria-labelledby="targetSettingTitle"]');
 }
 report.freshDefaults='Four recommendation surfaces: real clean Chrome profile, stored target and rendered selector are time, no settings draft';
 for(const [index,label,platform] of [[0,'抖音','douyin'],[1,'快手','kuaishou']]) {
  await selectPlatform(index,label);
  await api(`document.querySelector('[aria-labelledby="categoryRulesTitle"] .category-editor').open=true`);
  assert.equal(await api(`document.querySelectorAll('#configuration-panel-1 textarea').length`),0);
  const scope=await api(`document.querySelector('.keyword-match-scope').textContent`);
  assert.ok(scope.includes('视频文案') && scope.includes('话题标签') && scope.includes('作者昵称'));
  assert.equal(scope.includes('抖音号'),platform==='douyin');
  await click('[aria-labelledby="categoryRulesTitle"] .category-editor [aria-label="添加关键词"]');
  await fill('[aria-labelledby="categoryRulesTitle"] .term-input','测试探店词、测试删除词,测试探店词');
  await api(`document.querySelector('[aria-labelledby="categoryRulesTitle"] .term-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await click('[aria-label="移除测试删除词"]');
  await click('[aria-label="添加排除关键词"]');
  await fill('[aria-labelledby="blacklistRulesTitle"] .term-input','测试排除词');
  await api(`document.querySelector('[aria-labelledby="blacklistRulesTitle"] .term-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await click('.save-rules');
  await waitFor(async()=>((await status(platform)).rules.positiveCategories[0].keywords.includes('测试探店词')),'saved keyword chips');
  const rules=(await status(platform)).rules;
  assert.equal(rules.positiveCategories[0].keywords.filter(x=>x==='测试探店词').length,1);
  assert.equal(rules.positiveCategories[0].keywords.includes('测试删除词'),false);
  assert.ok(rules.gameBlacklist.includes('测试排除词'));
  const {evaluateVideoRules}=await import('../lib/rule-engine.js');
  assert.ok(evaluateVideoRules({contentType:'video',caption:'今天测试探店词',durationSeconds:120,likes:5000},rules).matchedGroups.includes(rules.positiveCategories[0].id));
  assert.equal(evaluateVideoRules({contentType:'video',caption:'测试排除词',durationSeconds:120,likes:5000},rules).code,'RISK_FILTERED');
  await screenshot(`keywords-${platform}.png`,'[aria-labelledby="categoryRulesTitle"]');
 }
 await selectPlatform(1,'快手');
 await api(`document.querySelectorAll('#scoringRulesTitle').forEach(e=>e.closest('section').querySelectorAll('details').forEach(d=>d.open=true))`);
 await fill('[aria-label="均赞档位 2 下限"]',6000);
 await fill('[aria-label="均赞档位 2 加分"]',31);
 await fill('[aria-label="粉丝档位 1 上限"]','');
 await fill('[aria-label="S 级最低均赞"]',9000);
 await screenshot('rules-01-scoring.png','[aria-labelledby="scoringRulesTitle"]');
 await click('.save-rules');
 await waitFor(async()=>((await status('kuaishou')).rules.scoring.levels.S.minAverageLikes===9000),'saved scoring');
 const saved=(await status('kuaishou')).rules;
 assert.equal(saved.scoring.likes[1].min,6000);assert.equal(saved.scoring.likes[1].points,31);assert.equal(saved.scoring.followers[0].max,null);
 assert.equal((await status('douyin')).rules.scoring.likes[1].min,4000);
 const {scoreCreator}=await import('../lib/rule-engine.js');
 const decision=scoreCreator({profile:{followers:200000,averageLikes:7000},categories:[{name:'test',score:20}],rules:saved});
 assert.equal(decision.level,'A');assert.equal(decision.score,71);
 await cmd('Page.reload',{},panel);
 await waitFor(()=>api(`Boolean(document.querySelector('.platform-trigger'))`),'reload');
 await selectPlatform(1,'快手');
 assert.equal(await api(`document.querySelector('[aria-label="S 级最低均赞"]').value`),'9000');
 await api(`document.querySelectorAll('[aria-labelledby="scoringRulesTitle"] details').forEach(d=>d.open=true)`);
 await screenshot('rules-03-grading.png','[aria-labelledby="scoringRulesTitle"] details:nth-of-type(3)');
 await api(`document.querySelector('[aria-label="均赞档位 1 下限"]').closest('details').open=true`);
 await fill('[aria-label="均赞档位 1 加分"]',101);
 await click('.save-rules');
 await waitFor(()=>api(`document.querySelector('.message.error')?.textContent.includes('0–100')`),'invalid points rejected');
 assert.equal((await status('kuaishou')).rules.scoring.likes[0].points,20);
 await fill('[aria-label="均赞档位 1 加分"]',20);
 await click('.save-rules');
 await selectPlatform(2,'首页');
 const inputFor=async label=>{
  const id='rule-'+Math.random().toString(36).slice(2);
  await api(`(()=>{const l=[...document.querySelectorAll('#configuration-panel-1 label')].find(l=>l.textContent.trim()===${JSON.stringify(label)});if(!l)throw Error('Missing label');l.querySelector('input').id=${JSON.stringify(id)}})()`);
  return '#'+id;
 };
 await fill(await inputFor('最低粉丝'),1000);
 await fill(await inputFor('最高粉丝'),2000);
 const ogv=await inputFor('排除平台标记的影视内容（OGV）');
 await click(ogv);
 await screenshot('rules-02-bilibili.png','[aria-labelledby="hardRulesTitle"]');
 await click('.form-actions button');
 await waitFor(async()=>((await status('bilibili')).rules.hard.maxFollowers===2000),'Bilibili saved');
 const bili=(await status('bilibili')).rules;
 assert.equal(bili.excludeOgv,false);assert.equal(bili.hard.minFollowers,1000);assert.equal(bili.gameBlacklist,undefined);
 const {decideBilibili}=await import('../lib/bilibili-rules.js');
 const video={contentType:'video',caption:'美食',tname:'美食',durationSeconds:120,plays:150000,pubdateSeconds:Math.floor(Date.now()/1000),isOgv:true};
 assert.equal(decideBilibili(video,{followers:2001},bili).code,'FOLLOWERS_TOO_HIGH');
 assert.equal(decideBilibili(video,{followers:1500},bili).matched,true);
 assert.equal((await status('bilibili-popular')).rules.hard.maxFollowers,null);
 await fill(await inputFor('最低粉丝'),'');await fill(await inputFor('最高粉丝'),'');
 await click('.form-actions button');
 await waitFor(async()=>((await status('bilibili')).rules.hard.maxFollowers===null),'clear bounds');
 await selectPlatform(3,'热门');
 assert.equal(await api(`!!document.querySelector('[aria-labelledby="hardRulesTitle"]')`),true);
 await click('.platform-trigger');await click('.platform-row:nth-child(6)');
 await waitFor(()=>api(`Boolean(document.querySelector('[aria-label="添加整账号排除词"]'))`),'Xingtu keyword chips');
 await api(`document.querySelector('.feigua-config').open=true`);
 await click('[aria-label="添加整账号排除词"]');
 await fill('.feigua-config .term-input','星图测试词');
 await api(`document.querySelector('.feigua-config .term-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
 await click('.feigua-config button[type="submit"]');
 await waitFor(async()=>((await status('xingtu')).rules.xingtuKeywords.includes('星图测试词')),'Xingtu keywords saved');
 await waitFor(()=>api(`document.querySelector('.feigua-config button[type="submit"]')?.disabled===false`),'Xingtu save completed');
 await click('[aria-label="移除星图测试词"]');
 await waitFor(()=>api(`!document.querySelector('[aria-label="移除星图测试词"]')`),'Xingtu chip removed');
 await click('.feigua-config button[type="submit"]');
 await waitFor(async()=>!(await status('xingtu')).rules.xingtuKeywords.includes('星图测试词'),'Xingtu keyword removed');
 for(const width of [320,420]){
  await cmd('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false},panel);
  for(const [index,label] of [[0,'抖音'],[1,'快手'],[2,'首页'],[3,'热门']]){
   await selectPlatform(index,label);
   await api(`document.querySelectorAll('#configuration-panel-1 details').forEach(d=>d.open=true)`);
   assert.ok(await api(`document.documentElement.scrollWidth<=${width}`),`${label} ${width} overflow`);
  }
 }
 report.keywordChips='Douyin/Kuaishou add, deduplicate, remove, save and evaluate passed';
 report.scenarios=['真实侧栏编辑均赞/粉丝加分及S级条件并保存，实际评分结果符合配置','重新加载面板保留规则，平台间独立','非法加分拒绝保存，旧配置保持','B站范围与OGV开关保存并改变实际判定，清空上下限恢复不限','抖音/快手/B站首页/热门在320与420宽度无横向溢出'];
 report.passed=true;
}catch(error){report.passed=false;report.error=String(error.stack||error);process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await writeFile(resolve(root,'test-results/custom-rules-panel.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));ws.close();chrome.kill();}
