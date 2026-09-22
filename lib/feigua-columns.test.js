import test from 'node:test';
import assert from 'node:assert/strict';
import {collectColumns} from '../content/feigua-page.js';

test('captures every rendered column including additional metrics and missing values',()=>{
  const headers=['视频内容','达人','点赞','新增指标'].map(innerText=>({innerText}));
  const cells=['标题\n热词','作者\n粉丝数：1w','2.3w','--'].map(innerText=>({innerText}));
  assert.deepEqual(collectColumns(headers,cells),[
    {label:'视频内容',value:'标题 热词'},{label:'达人',value:'作者 粉丝数：1w'},
    {label:'点赞',value:'2.3w'},{label:'新增指标',value:'--'}
  ]);
});
test('retains cells without guessing labels when the header layout differs',()=>{
  assert.deepEqual(collectColumns([{innerText:'点赞'}],[{innerText:'甲'},{innerText:'300'}]),[
    {label:'',value:'甲'},{label:'',value:'300'}
  ]);
});
