import test from 'node:test';
import assert from 'node:assert/strict';
import { accountProfile } from './account-profile.js';
test('display identity is restricted to the currently authorised user',()=>{
 assert.equal(accountProfile({id:'other',email:'other@example.com'},'mine'),null);
 assert.deepEqual(accountProfile({id:'mine',name:'张三',email:'one@example.com',token:'private'},'mine'),{id:'mine',name:'张三',email:'one@example.com'});
 assert.equal(accountProfile(null,'mine'),null);
});
