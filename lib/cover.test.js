import test from 'node:test';
import assert from 'node:assert/strict';
import './douyin-page-parser.js';
import { buildObservationRecord, creatorWorkCovers } from './cloud.js';
const {coverUrl,coverUrlFromImage}=globalThis.DouyinAutoFinderParser;
const image=(attrs, props={})=>({getAttribute:name=>attrs[name] || '',...props});

test('cover URLs reject non-portable data and known placeholder paths',()=>{
  for(const url of ['', 'data:image/png;base64,abc', 'blob:https://example.com/id', 'javascript:alert(1)', '/relative.jpg', 'https://example.com/loading.gif','https://example.com/placeholder.png','https://name:secret@example.com/image.jpg']) assert.equal(coverUrl(url),'',url);
  assert.equal(coverUrl('//example.com/cover.webp'),'https://example.com/cover.webp');
  assert.equal(coverUrl('https://example.com/a.jpg?sig=123'),'https://example.com/a.jpg?sig=123');
});

test('image cover prefers currentSrc and falls back past placeholders to lazy URLs',()=>{
  assert.equal(coverUrlFromImage(image({src:'https://example.com/small.jpg'},{currentSrc:'https://example.com/large.jpg'})),'https://example.com/large.jpg');
  assert.equal(coverUrlFromImage(image({src:'data:image/gif;base64,abc','data-src':'https://example.com/lazy.jpg'})),'https://example.com/lazy.jpg');
  assert.equal(coverUrlFromImage(image({src:'https://example.com/placeholder.png','data-original':'//example.com/original.jpg'})),'https://example.com/original.jpg');
  assert.equal(coverUrlFromImage(image({src:'https://example.com/pixel.gif'},{naturalWidth:1,naturalHeight:1})), '');
  assert.equal(coverUrlFromImage(image({src:'https://example.com/pixel.gif','data-lazy-src':'https://example.com/real.jpg'},{naturalWidth:1,naturalHeight:1})),'https://example.com/real.jpg');
});

test('upload includes only bounded deduplicated covers from a verified creator panel',()=>{
  const work={videoId:'123456789', videoUrl:'https://www.douyin.com/video/123456789', coverUrl:'https://example.com/work.jpg',coverAlt:'private other field',likes:10};
  const profile={ready:true,recentVideos:[work,{...work,coverUrl:'https://example.com/alternate.jpg'},{coverUrl:'data:placeholder'},{coverUrl:'https://example.com/unlinked.jpg'},{coverUrl:'https://example.com/unlinked.jpg'}]};
  const record=buildObservationRecord({observation:{coverUrl:'https://example.com/current.jpg',coverSource:'video.poster'},profile});
  const feedback=JSON.parse(JSON.stringify(record)).rpa_feedback;
  assert.equal(feedback.video_cover_url,'https://example.com/current.jpg');
  assert.equal(feedback.video_cover_source,'video.poster');
  assert.deepEqual(feedback.creator_work_covers,[{aweme_id:work.videoId,video_url:work.videoUrl,cover_url:work.coverUrl},{aweme_id:'',video_url:'',cover_url:'https://example.com/unlinked.jpg'}]);
  assert.deepEqual(creatorWorkCovers({...profile,stale:true}),[]);
  assert.deepEqual(creatorWorkCovers({...profile,ready:false}),[]);
  assert.equal(creatorWorkCovers({ready:true,recentVideos:Array.from({length:30},(_,i)=>({...work,videoId:String(i)}))}).length,24);
  assert.deepEqual(buildObservationRecord({}).rpa_feedback.creator_work_covers,[]);
});
