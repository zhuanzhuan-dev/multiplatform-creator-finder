import test from 'node:test';
import assert from 'node:assert/strict';
import {imageUrl,pendingImage} from '../content/feigua-page.js';

test('avatar capture requires a usable URL, independent of CDN decoding',()=>{
 const img={src:'https://example.com/avatar.jpg',complete:true,naturalWidth:80,getAttribute:()=>null};
 assert.equal(pendingImage(null),1);
 assert.equal(pendingImage({...img,src:''}),1);
 assert.equal(pendingImage({...img,complete:false}),0);
 assert.equal(pendingImage({...img,naturalWidth:0}),0);
 assert.equal(pendingImage(img),0);
 assert.equal(imageUrl({...img,currentSrc:'https://example.com/avatar-2x.jpg'}),'https://example.com/avatar-2x.jpg');
});

test('lazy placeholder yields the intended source without scrolling or downloading',()=>{
 const previous=globalThis.location;
 globalThis.location={href:'https://dy.feigua.cn/app/'};
 try {
  const img={src:'https://dy.feigua.cn/placeholder.png',complete:true,naturalWidth:1,getAttribute:name=>name==='data-src'?'/avatar.jpg':null};
  assert.equal(pendingImage(img),0);
  assert.equal(imageUrl(img),'https://dy.feigua.cn/avatar.jpg');
  assert.equal(pendingImage({...img,src:'https://dy.feigua.cn/avatar.jpg'}),0);
 } finally {globalThis.location=previous;}
});

test('avatar containers and placeholder-only images are distinguished',()=>{
 const img={src:'https://example.com/real.jpg'};
 assert.equal(imageUrl({querySelector:()=>img}),img.src);
 for(const src of ['data:image/png;base64,x','javascript:alert(1)','https://example.com/loading.gif','']) {
  assert.equal(imageUrl({src}),'');assert.equal(pendingImage({src}),1);
 }
 assert.equal(imageUrl({...img,naturalWidth:1,naturalHeight:1}),'');
 assert.equal(imageUrl({getAttribute:n=>n==='data-lazy-src'?'//example.com/lazy.jpg':null}),'https://example.com/lazy.jpg');
});
