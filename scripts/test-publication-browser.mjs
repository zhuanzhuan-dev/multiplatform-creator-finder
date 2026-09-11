// Verify publication and cover extraction with real DOM layout in isolated, offline Chromium.
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const executable = process.env.CHROME_BIN;
if (!executable) throw Error('Set CHROME_BIN');
const root = resolve(import.meta.dirname, '..');
const folder = await mkdtemp(resolve(tmpdir(), 'finder-publication-'));
let chrome; let ws;
const delay = ms => new Promise(r => setTimeout(r, ms));
try {
  const bundle = await build({ stdin: { contents: `import './lib/douyin-page-parser.js'; import { buildObservationRecord } from './lib/cloud.js'; import { imageUrl, pendingImage } from './content/feigua-page.js'; window.feiguaImages={imageUrl,pendingImage}; window.makeRecord = buildObservationRecord;`, resolveDir: root }, bundle: true, write: false, platform: 'browser', format: 'iife' });
  const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="img-src 'none'; media-src 'none'"><style>.card{width:600px;height:600px}.decoy{display:none}</style>
  <div class="video-create-time"><span class="time">· 1小时前</span></div>
  <div class="card" data-e2e="feed-item">
    <div data-e2e="feed-video" data-e2e-vid="123456789"></div>
    <a href="https://www.douyin.com/user/test" data-e2e="feed-video-nickname">测试作者</a>
    <div data-e2e="video-desc">文案 3小时前</div><div>评论 · 2小时前</div>
    <div class="video-create-time decoy"><span class="time">· 4小时前</span></div>
    <div class="video-create-time" style="visibility:hidden"><span class="time">· 5小时前</span></div>
    <div class="video-create-time actual"><span class="time">· 9小时前</span></div>
    <div data-e2e="video-player-digg">123</div><div>00:01 / 01:30</div>
  </div>
  <script>${bundle.outputFiles[0].text}</script>
  <script>
  const scenarios=[]; const ensure=(v,m)=>{if(!v)throw Error(m)};
  try {
    const parser=window.DouyinAutoFinderParser;
    const card=document.querySelector('.card');
    const observation=parser.parseFeedItem(card);
    ensure(observation.publishedTimeText==='· 9小时前','must use visible time in current card');
    ensure(Date.parse(observation.observedAt)-Date.parse(observation.publishedAt)===9*3600000,'relative timestamp');
    ensure(observation.durationSeconds===90,'duration unaffected');
    const record=window.makeRecord({observation});
    ensure(record.rpa_feedback.published_time_estimated===true,'upload estimate marker');
    ensure(record.rpa_feedback.published_at===observation.publishedAt,'upload timestamp');
    scenarios.push('supplied-markup-visible-card-time-and-upload');
    document.querySelector('.actual').remove();
    ensure(parser.parseFeedItem(card).publishedAt===null,'must not use hidden time, outside card or comments');
    scenarios.push('hidden-adjacent-card-and-comment-times-excluded');
    const empty=document.createElement('div');empty.className='video-create-time actual';empty.innerHTML='<span class="time">未知时间</span>';card.append(empty);
    ensure(parser.parseFeedItem(card).publishedTimeText==='未知时间','keep unknown original');
    ensure(parser.parseFeedItem(card).publishedAt===null,'unknown remains null');
    scenarios.push('unknown-text-preserved');
    const video=document.createElement('video');video.style.cssText='width:300px;height:300px';video.setAttribute('poster','https://example.com/current.jpg');card.append(video);
    ensure(parser.parseFeedItem(card).coverUrl==='https://example.com/current.jpg','read active video poster');
    ensure(window.makeRecord({observation:parser.parseFeedItem(card)}).rpa_feedback.video_cover_url==='https://example.com/current.jpg','upload current cover');
    const avatar=document.createElement('img');avatar.setAttribute('src','https://example.com/avatar.jpg');card.append(avatar);
    video.removeAttribute('poster');
    ensure(parser.parseFeedItem(card).coverUrl==='','never use arbitrary image as cover');
    const cover=document.createElement('div');cover.setAttribute('data-e2e','video-cover');cover.style.cssText='width:150px;height:100px';cover.innerHTML='<img src="data:image/gif;base64,abc" data-src="https://example.com/lazy.jpg">';card.append(cover);
    ensure(parser.parseFeedItem(card).coverUrl==='https://example.com/lazy.jpg','dedicated lazy cover');
    cover.innerHTML='';cover.removeAttribute('data-e2e');cover.className='xgplayer-poster';cover.style.backgroundImage='url("https://example.com/background.jpg")';
    ensure(parser.parseFeedItem(card).coverUrl==='https://example.com/background.jpg','dedicated background cover');
    cover.remove();scenarios.push('video-poster-lazy-image-background-and-avatar-exclusion');
    const drawer=document.createElement('aside');drawer.style.cssText='position:absolute;top:80px;left:320px;width:250px;height:450px';
    drawer.innerHTML='<a href="https://www.douyin.com/user/test">测试作者</a><p>10万粉丝</p><p>50万获赞</p><button role="tab" aria-selected="true">TA的作品</button><div data-e2e="author-card-list"><a href="https://www.douyin.com/video/900000001"><img data-src="https://example.com/work1.jpg" alt="作品一">5000</a><a href="https://www.douyin.com/video/900000001"><img src="https://example.com/duplicate.jpg" alt="重复作品">5000</a><a href="https://www.douyin.com/video/900000002"><img src="https://example.com/placeholder.png" data-original="https://example.com/work2.jpg" alt="作品二">3000</a></div><div class="xgplayer-poster" style="width:100px;height:100px;background-image:url(https://example.com/wrong.jpg)"></div>';
    card.append(drawer);
    const current=parser.parseFeedItem(card);
    ensure(current.coverUrl==='','creator panel cover must not become feed cover');
    const profile=parser.parseCreatorPanel(document,current);
    ensure(profile.ready,'creator panel fixture ready');
    const covers=window.makeRecord({observation:current,profile}).rpa_feedback.creator_work_covers;
    ensure(covers.length===2,'deduplicate works by video id');
    ensure(covers[0].aweme_id==='900000001'&&covers[0].cover_url==='https://example.com/work1.jpg','lazy work linked to video');
    ensure(covers[1].video_url==='https://www.douyin.com/video/900000002'&&covers[1].cover_url==='https://example.com/work2.jpg','skip placeholder and preserve link');
    scenarios.push('creator-cover-id-link-lazy-placeholder-dedup-and-feed-isolation');
    const works=drawer.querySelector('[data-e2e="author-card-list"]');
    works.innerHTML='<img data-lazy-src="https://example.com/unlinked.jpg" alt="已加载但没有视频链接的作品">';
    const unlinked=parser.parseCreatorPanel(document,current);
    ensure(unlinked.ready,'lazy-only works list is readable');
    const unlinkedCovers=window.makeRecord({observation:current,profile:unlinked}).rpa_feedback.creator_work_covers;
    ensure(unlinkedCovers.length===1&&unlinkedCovers[0].aweme_id===''&&unlinkedCovers[0].video_url==='','never invent missing video identity');
    scenarios.push('lazy-only-works-and-missing-video-identity');

    const avatarBox=document.createElement('div');avatarBox.dataset.e2e='video-avatar';
    avatarBox.innerHTML='<img data-lazy-src="https://example.com/late-avatar.jpg">';card.append(avatarBox);
    ensure(parser.parseFeedItem(card).avatarUrl==='https://example.com/late-avatar.jpg','extract lazy-only avatar');
    avatarBox.querySelector('img').src='https://example.com/placeholder.png';
    ensure(parser.parseFeedItem(card).avatarUrl==='https://example.com/late-avatar.jpg','exclude avatar placeholder');
    works.setAttribute('aria-busy','true');
    ensure(!parser.parseCreatorPanel(document,current).ready,'busy works must not be ready even with existing rows');
    works.removeAttribute('aria-busy');
    ensure(parser.parseCreatorPanel(document,current).ready,'works become readable after loading finishes');
    works.innerHTML='<a href="https://www.douyin.com/video/900000003"></a>';
    ensure(!parser.parseCreatorPanel(document,current).ready,'empty work cards must not produce a ready profile');
    scenarios.push('lazy-avatar-busy-works-and-empty-work-cards');

    const wrapped=document.createElement('div');wrapped.className='blogger-avatar';
    wrapped.innerHTML='<img src="https://example.com/placeholder.png" data-src="https://example.com/feigua-avatar.jpg">';
    ensure(window.feiguaImages.imageUrl(wrapped)==='https://example.com/feigua-avatar.jpg','unwrap Feigua avatar and read intended lazy source');
    ensure(window.feiguaImages.pendingImage(wrapped)===0,'CDN decoding does not block URL capture');
    wrapped.innerHTML='<img src="data:image/gif;base64,abc">';
    ensure(window.feiguaImages.pendingImage(wrapped)===1,'placeholder-only image still waits');
    scenarios.push('feigua-container-lazy-url-and-placeholder-readiness');


    document.body.innerHTML='<pre id="result">'+JSON.stringify({passed:true,scenarios})+'</pre>';
  }catch(error){document.body.innerHTML='<pre id="result">'+JSON.stringify({passed:false,error:String(error)})+'</pre>'}
  </script>`;
  const file = resolve(folder, 'fixture.html'); await writeFile(file, html);
  chrome = spawn(executable, ['--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--disable-background-networking', `--user-data-dir=${folder}/profile`, 'about:blank'], {stdio:'ignore'});
  let endpoint;
  for(let i=0;i<100;i++) {
    try { const [port,path]=(await readFile(resolve(folder,'profile/DevToolsActivePort'),'utf8')).trim().split('\n'); endpoint=`ws://127.0.0.1:${port}${path}`; break; } catch {await delay(100);}
  }
  assert.ok(endpoint,'Chrome debug endpoint');
  ws = new WebSocket(endpoint); await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let seq=0;const pending=new Map();
  ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}});
  const cmd=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'));},10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,sessionId}));});
  const {targetId}=await cmd('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await cmd('Target.attachToTarget',{targetId,flatten:true});
  await cmd('Page.navigate',{url:`file://${file}`},sessionId);
  let result;
  for(let i=0;i<50;i++){
    const r=await cmd('Runtime.evaluate',{expression:'document.querySelector("#result")?.textContent',returnByValue:true},sessionId);
    if(r.result.value){result=JSON.parse(r.result.value);break;}await delay(100);
  }
  assert.ok(result,'fixture returned a result');
  await mkdir(resolve(root, 'test-results'), {recursive:true});
  await writeFile(resolve(root, 'test-results/publication.json'), JSON.stringify(result, null, 2));
  assert.equal(result.passed, true, JSON.stringify(result));
  console.log(JSON.stringify(result));
} finally {
  ws?.close();
  if(chrome && chrome.exitCode===null){const exited=new Promise(r=>chrome.once('exit',r));chrome.kill();await exited;}
  await rm(folder, {recursive:true,force:true});
}
