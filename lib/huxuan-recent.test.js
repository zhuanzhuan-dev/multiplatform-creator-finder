import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const bundle=await build({stdin:{contents:"export {RecentDecisions} from './src/sidepanel/components.tsx'; export {HuxuanTaskPage} from './src/sidepanel/HuxuanTaskPage.tsx';",resolveDir:new URL('../',import.meta.url).pathname},bundle:true,format:'cjs',platform:'node',jsx:'automatic',loader:{'.css':'empty'},external:['react','react/jsx-runtime'],write:false});
const module={exports:{}};
vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:createRequire(import.meta.url),URL,console});
const {RecentDecisions,HuxuanTaskPage}=module.exports;
const candidate={authorId:'sphTestHuxuan',authorName:'互选样例作者',followerCount:'50万+',avatarUrl:'https://example.com/avatar.png',profileUrl:'https://huxuan.qq.com/trade/selection/12345678/finder_trade_detail?id=sphTestHuxuan'};

test('Huxuan saved candidates remain visible when processing history is empty',()=>{
 const markup=renderToStaticMarkup(createElement(RecentDecisions,{now:Date.now(),history:[],total:0,huxuanCandidates:[candidate],huxuanCandidateTotal:60}));
 assert.match(markup,/互选样例作者/);
 assert.match(markup,/本轮候选 60/);
 assert.match(markup,/50万\+/);
 assert.doesNotMatch(markup,/开始运行后，这里会显示/);
 assert.doesNotMatch(markup,/<time/,'old candidates without observation time must not invent a time');
});

test('Huxuan candidates and processing history show a creator once, with the current task name',()=>{
 const now=Date.now();
 const markup=renderToStaticMarkup(createElement(RecentDecisions,{now,taskName:'财经分身',huxuanCandidates:[{...candidate,shortPrice:0,longPrice:2000,observedAt:new Date(now-60000).toISOString()}],huxuanCandidateTotal:1,huxuanFinalized:true,history:[{id:'history',sourcePlatform:'huxuan',authorId:candidate.authorId,accountName:candidate.authorName,code:'HUXUAN_CANDIDATE_REVIEW',occurredAt:new Date(now).toISOString()}],total:1}));
 assert.equal((markup.match(/<article\b/g) || []).length,1,'the same creator must occupy one row');
 assert.match(markup,/腾讯互选 · 财经分身/);
 assert.match(markup,/本轮已保存/);
 assert.match(markup,/1–60秒报价 ¥0/);
 assert.match(markup,/60秒以上报价 ¥2,000/);
 assert.match(markup,/1 分钟前/);
});

test('recent Huxuan candidates are bounded and other platform history still renders',()=>{
 const rows=Array.from({length:8},(_,i)=>({...candidate,authorId:`sphAuthor${i}`,authorName:`候选${i}`}));
 const markup=renderToStaticMarkup(createElement(RecentDecisions,{now:Date.now(),huxuanCandidates:rows,huxuanCandidateTotal:8}));
 assert.match(markup,/候选7/);assert.doesNotMatch(markup,/候选2/);
 assert.ok(markup.indexOf('候选7')<markup.indexOf('候选6'));
 assert.equal(rows[0].authorName,'候选0');
 const xingtu=renderToStaticMarkup(createElement(RecentDecisions,{now:Date.now(),xingtuCandidates:[{name:'星图样例',xingtuId:'123456',followers:'12w'}],xingtuCandidateTotal:1}));
 assert.match(xingtu,/星图样例/);
 const history=renderToStaticMarkup(createElement(RecentDecisions,{now:Date.now(),history:[{id:'saved',sourcePlatform:'huxuan',accountName:'历史互选作者',code:'HUXUAN_CANDIDATE_REVIEW'}],total:1}));
 assert.match(history,/历史互选作者/);assert.match(history,/需人工确认/);
});

test('a finished creator is shown first as complete while the rest of its list is still collecting',()=>{
 const now=Date.now(),observedAt=new Date(now-600000).toISOString(),completedAt=new Date(now-60000).toISOString();
 const markup=renderToStaticMarkup(createElement(RecentDecisions,{now,huxuanCandidates:[{...candidate,authorId:'sphWaiting',authorName:'尚未采完的作者',observedAt},{...candidate,authorName:'刚采完的作者',observedAt,completedAt}],huxuanCandidateTotal:12,history:[]}));
 assert.ok(markup.indexOf('刚采完的作者')<markup.indexOf('尚未采完的作者'));
 assert.match(markup,/刚采完的作者<\/span><span[^>]*>采集完成/);
 assert.match(markup,/尚未采完的作者<\/span><span[^>]*>本轮候选/);
 assert.ok(markup.includes(`dateTime="${completedAt}"`));
 assert.doesNotMatch(markup,/开始运行后，这里会显示/);
});

test('Huxuan active profile progress distinguishes completed pages from uploaded records',()=>{
 const snapshot={state:{status:'running',runId:'run',stats:{matched:60,uploaded:95},runtime:{authorName:'正在读取的作者',dataset:'persona'}},huxuan:{pageCount:2,listPageCount:3,pageNumber:'2',finalized:false,candidates:[],currentPage:{pageNumber:3,completed:2,total:30}},cloud:{connected:true}};
 const markup=renderToStaticMarkup(createElement(HuxuanTaskPage,{now:Date.now(),draft:{},extension:{snapshot,notice:{text:'',error:false}}}));
 assert.match(markup,/已上传记录/);
 assert.match(markup,/正在采集第 3 页：达人资料已完成 2\/30/);
 assert.match(markup,/正在读取的作者 · 创作者亮点/);
 assert.match(markup,/<dt>已获取列表页<\/dt><dd>3<\/dd>/);
 assert.match(markup,/资料已完成 2 页/);
});

test('Huxuan prominently shows the current run interval separately from next-run settings',()=>{
 const snapshot={state:{status:'paused',runId:'run',runSettings:{huxuanDelay:{minSeconds:4,maxSeconds:6}}},settings:{huxuanDelay:{minSeconds:8,maxSeconds:12}},huxuan:{pageCount:2,pageNumber:'2',finalized:false,candidates:[]}};
 const markup=renderToStaticMarkup(createElement(HuxuanTaskPage,{now:Date.now(),draft:{},extension:{snapshot,notice:{text:'',error:false}}}));
 const visibleCard=markup.slice(0,markup.indexOf('<details'));
 assert.match(visibleCard,/本轮达人间隔：4–6 秒/);
 assert.match(visibleCard,/下轮达人间隔：8–12 秒/);
 assert.match(markup,/达人之间最短等待（秒）<input[^>]*value="8"/);
 assert.match(markup,/达人之间最长等待（秒）<input[^>]*value="12"/);
 assert.doesNotMatch(markup,/主页栏目、作品分页和列表翻页共用此间隔|保存后的页数与间隔用于新一轮采集|本轮继续按|使用当前登录账号的创作者广场筛选结果|列表获取后页数立即更新|打开视频号创作者广场并设置筛选后开始/);
});

test('Huxuan idle settings and older running snapshots show the interval they actually use',()=>{
 const snapshot={state:{status:'idle'},settings:{huxuanDelay:{minSeconds:9,maxSeconds:9}}};
 const render=()=>renderToStaticMarkup(createElement(HuxuanTaskPage,{now:Date.now(),draft:{},extension:{snapshot,notice:{text:'',error:false}}}));
 assert.match(render(),/达人间隔：9 秒（固定等待）/);
 snapshot.state={status:'running',runId:'older-run'};
 assert.match(render(),/本轮达人间隔：2–4 秒/);
});

test('Huxuan renders separate editable creator/page ranges and the live work-page count',()=>{
 const snapshot={state:{status:'running',runId:'run',runtime:{dataset:'videos:0',pageIndex:7,received:56,total:121}},settings:{huxuanDelay:{minSeconds:2,maxSeconds:3},huxuanPageDelay:{minSeconds:40,maxSeconds:80}},huxuan:{finalized:false}};
 const markup=renderToStaticMarkup(createElement(HuxuanTaskPage,{now:Date.now(),draft:{},extension:{snapshot,notice:{text:'',error:false}}}));
 assert.match(markup,/列表及作品翻页前最短等待（秒）<input[^>]*value="40"/);
 assert.match(markup,/列表及作品翻页前最长等待（秒）<input[^>]*value="80"/);
 assert.match(markup,/作品第 8 页 · 已获取 56 \/ 121 条/);
 assert.doesNotMatch(markup,/max="30"|每次请求后/);
});

test('video page setting defaults to one and displays the saved value',()=>{
 const snapshot={state:{status:'idle'},settings:{},huxuan:{}};
 const render=()=>renderToStaticMarkup(createElement(HuxuanTaskPage,{now:Date.now(),draft:{},extension:{snapshot,notice:{text:'',error:false}}}));
 assert.match(render(),/每位达人视频页数（发表视频、商单各自上限）<input[^>]*value="1"/);
 snapshot.settings.huxuanVideoMaxPages=3;
 assert.match(render(),/每位达人视频页数（发表视频、商单各自上限）<input[^>]*value="3"/);
});
