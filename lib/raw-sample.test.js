import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRaw, pageCardData } from './raw-sample.js';
test('raw samples redact credentials and bound cyclical graphs without invoking getters',()=>{
 const value={aweme_type:68,is_ads:false,cookie:'private',nested:{access_token:'private'},url:'https://cdn.example/v?msToken=private&item=1'};value.self=value;
 Object.defineProperty(value,'danger',{enumerable:true,get(){throw Error('getter called');}});
 const safe=sanitizeRaw(value);assert.equal(safe.aweme_type,68);assert.equal(safe.cookie,'[redacted]');assert.equal(safe.nested.access_token,'[redacted]');assert.equal(safe.self,'[circular]');assert.equal(safe.danger,undefined);assert.ok(!safe.url.includes('private'));
});
test('card-associated data requires matching content identity',()=>{
 const card={querySelectorAll:()=>[],__reactProps$fixture:{item:{aweme_id:'123',aweme_type:68,is_ads:true},other:{aweme_id:'456',aweme_type:0}}};
 const result=pageCardData(card,'123');assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].data.aweme_type,68);assert.equal(result.candidates[0].data.is_ads,true);
 assert.equal(pageCardData(card,'missing').candidates.length,0);
});
