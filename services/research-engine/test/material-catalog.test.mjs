import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogFor,searchMaterials,canonicalTag,reorder,removeFromTopic,mergeTags,mergeTopics} from '../../../chrome/content/zotero/research/shared/material-catalog.mjs';
test('explicit tag and topic merges retain old aliases and IDs',()=>{
 const c={aliases:[],topics:[{id:'a',name:'旧主题'},{id:'b',name:'目标主题'}],entries:{x:{tags:['CNN','卷积网络'],topics:['a']}}};
 assert.equal(mergeTags(c,['CNN','卷积网络'],'卷积神经网络'),1);assert.equal(searchMaterials([{id:'x',tags:c.entries.x.tags}],'卷积网络',{tags:c.aliases})[0].m.id,'x');
 assert.equal(mergeTopics(c,'a','b'),1);assert.deepEqual(c.entries.x.topics,['b']);assert.ok(c.topics[0].aliases.includes('旧主题'));
});
import {screenPaper,paperIdentity} from '../../../chrome/content/zotero/research/shared/paper-screening.mjs';
test('screening uses evidence and relevance, never rejects new papers for low citations',()=>{
 const p={id:'1706.03762v1',title:'Attention methods',abstract:'Attention encodes context',url:'https://arxiv.org/abs/1706.03762v1',citationCount:0};
 assert.equal(screenPaper(p,'attention').autoDownload,true);assert.equal(screenPaper({...p,citationCount:undefined},'attention').citations,null);assert.equal(screenPaper({...p,retracted:true},'attention').autoDownload,false);assert.equal(screenPaper(p,'生存分析').autoDownload,false);assert.notEqual(paperIdentity(p),paperIdentity({...p,id:'1706.03762v2'}));
});
test('Chinese search matches aliases, full-width tags and updated user summaries without conflating domains',()=>{
 const cards=[{id:'cnn',title:'ＣＮＮ',sourceText:'A convolutional neural network.',summary:'提取信号特征'}, {id:'da',title:'Domain adaptation',summary:'域适应方法'}, {id:'dg',title:'Domain generalization',summary:'域泛化方法'}];
 assert.equal(searchMaterials(cards,'卷积神经网络')[0].m.id,'cnn');assert.equal(canonicalTag(' ＣＮＮ '),'卷积神经网络');assert.notEqual(canonicalTag('域适应'),canonicalTag('域泛化'));
 assert.deepEqual(searchMaterials(cards,'域适应').map(x=>x.m.id),['da']);cards[0].summary='我的实验需要跨域调制识别';assert.equal(searchMaterials(cards,'跨域调制识别')[0].m.id,'cnn');assert.match(searchMaterials(cards,'CNN')[0].reason,/命中/);
});
test('migration retains every material and user edit, ordering and topic removal never change sources',()=>{
 const cards=[{id:'a',kind:'note',sourceText:'用户修改',summary:'我的概括',userEdited:true},{id:'b',category:'method'},{id:'c',category:'unknown'}],before=structuredClone(cards),p={id:'p',title:'主题'};const c=catalogFor(p,cards);
 assert.equal(Object.keys(c.entries).length,3);assert.equal(c.entries.c.type,'待整理');assert.equal(c.entries.a.type,'用户笔记');reorder(c,'p|方法',['a','b','c'],['c'],'a');assert.deepEqual(c.orders['p|方法'],['c','a','b']);removeFromTopic(c,['a'],'p');assert.deepEqual(c.entries.a.topics,[]);catalogFor(p,cards);assert.deepEqual(c.entries.a.topics,[]);assert.deepEqual(cards,before);
 const restored=JSON.parse(JSON.stringify(p));assert.deepEqual(restored.materialCatalog.orders,c.orders);
});

test('Chinese aliases show the actual matching phrase deep in an English source',()=>{
 const text='Introduction without the requested method. '.repeat(12)+'We use a CNN to classify signals.';
 const hits=searchMaterials([{id:'long-paper',title:'Methods',sourceText:text}],'卷积神经网络');
 assert.equal(hits.length,1);assert.match(hits[0].snippet,/CNN/);assert.match(hits[0].reason,/别名/);
});
