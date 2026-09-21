import test from 'node:test';import assert from 'node:assert/strict';
import {validateTopics,applyTopics} from '../../../chrome/content/zotero/research/shared/research-topics.mjs';
import {catalogFor,catalogResults} from '../../../chrome/content/zotero/research/shared/material-catalog.mjs';
test('research themes are independent of paper structure and never drop manual memberships',()=>{
 const p={id:'p',title:'项目'},materials=[{id:'a',title:'跨域识别',kind:'note'},{id:'b',title:'交通信息新鲜度',category:'方法'}],c=catalogFor(p,materials);c.entries.a.topics.push('manual');
 const groups=validateTopics({topics:[{name:'方法',description:'结构类型不是主题',materialIDs:['a']},{name:'跨信道识别',description:'跨信道条件下的识别问题',materialIDs:['a','invented']},{name:'车联网信息新鲜度',description:'信息年龄与调度策略',materialIDs:['b']}]},materials,c);
 assert.equal(groups.length,2);applyTopics(p,materials,groups);assert.ok(c.entries.a.topics.includes('manual'));assert.equal(materials.length,2);assert.deepEqual(catalogResults(materials,'',p,{topic:groups[1].id}).map(r=>r.m.id),['b']);
 applyTopics(p,materials,groups);assert.equal(c.topics.length,3);assert.equal(c.entries.a.topics.filter(t=>t===groups[0].id).length,1);
});
