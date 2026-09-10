import test from 'node:test';
import assert from 'node:assert/strict';
import {imageUrl,pendingImage} from '../content/feigua-page.js';

test('avatar readiness requires a source and successfully decoded pixels',()=>{
 const img={src:'https://example.com/avatar.jpg',complete:true,naturalWidth:80,getAttribute:()=>null};
 assert.equal(pendingImage(null),1);
 assert.equal(pendingImage({...img,src:''}),1);
 assert.equal(pendingImage({...img,complete:false}),1);
 assert.equal(pendingImage({...img,naturalWidth:0}),1);
 assert.equal(pendingImage(img),0);
 assert.equal(imageUrl({...img,currentSrc:'https://example.com/avatar-2x.jpg'}),'https://example.com/avatar-2x.jpg');
});

test('loaded lazy placeholder waits for the intended image source',()=>{
 const previous=globalThis.location;
 globalThis.location={href:'https://dy.feigua.cn/app/'};
 try {
  const img={src:'https://dy.feigua.cn/placeholder.png',complete:true,naturalWidth:1,getAttribute:name=>name==='data-src'?'/avatar.jpg':null};
  assert.equal(pendingImage(img),1);
  assert.equal(pendingImage({...img,src:'https://dy.feigua.cn/avatar.jpg'}),0);
 } finally {globalThis.location=previous;}
});
