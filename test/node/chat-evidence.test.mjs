/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceAliases,citedSources,evidenceCitationText,questionForAnswer,answerWithQuestion,sourceGroups,historySourceContext,selectPaperContext} from '../../chrome/content/zotero/research/shared/chat-evidence.mjs';

test('legacy PDF ID-only lines expose exact saved evidence without changing prose, formula, code or ambiguous IDs',()=>{
 const a={id:'P1-T7',stableID:'evidence:paper:4:P1-T7'},b={id:'P1-T6',stableID:'evidence:paper:4:P1-T6'},sources=[a,b],text='原文记录为 28 GHz。\nP1-T7 P1-T6\n\n$x_{P1-T7}$\n```\nP1-T7\n```\nP1-T70\n普通正文 P1-T7';
 const rendered=evidenceCitationText(text,sources);assert.equal(rendered,text.replace('P1-T7 P1-T6','[evidence:paper:4:P1-T7] [evidence:paper:4:P1-T6]'));assert.deepEqual(citedSources({text,sources}),sources);
 assert.equal(evidenceCitationText('P1-T7',[a,{...a,stableID:'evidence:paper:5:P1-T7'},a]),'P1-T7');assert.equal(evidenceCitationText('P1-T7 P1-T8',sources),'P1-T7 P1-T8');assert.equal(evidenceCitationText('$$\nP1-T7\n$$',sources),'$$\nP1-T7\n$$');assert.equal(text.includes('[evidence:'),false,'原始消息不改写');
});

test('citations match the exact saved stable identity with its evidence prefix alias',()=>{
 const source={id:'passage:document:7',stableID:'evidence:passage:document:7',materialID:'material-7'},unread={id:'passage:document:8',stableID:'evidence:passage:document:8'};
 assert.ok(sourceAliases(source).includes('passage:document:7'));assert.ok(sourceAliases(source).includes('evidence:passage:document:7'));
 for(const text of ['依据原文。[evidence:passage:document:7]','依据原文。[passage:document:7]'])assert.deepEqual(citedSources({text,sources:[source,unread]}),[source]);
});

test('uncited sources and a partial or unknown bracketed identity are never displayed',()=>{
 const sources=Array.from({length:63},(_,index)=>({id:'source-'+index,stableID:'evidence:source-'+index}));
 assert.deepEqual(citedSources({text:'你好，继续讨论研究问题。',sources}),[]);
 assert.deepEqual(citedSources({text:'只是提到了 evidence:source-6，尚未引用。[evidence:source-60-extra][missing]',sources}),[]);
 assert.deepEqual(citedSources({text:'使用实际读取的片段。[evidence:source-6]',sources}),[sources[6]]);
});

test('explicit cited IDs preserve source order and duplicate records with the same stable identity appear once',()=>{
 const a={id:'old-a',stableID:'evidence:actual-a'},b={id:'old-b',stableID:'evidence:actual-b'},duplicate={...a,title:'同一来源的重复记录'},before=JSON.stringify([a,b,duplicate]);
 assert.deepEqual(citedSources({text:'已核对两个片段。',citedSourceIDs:['actual-b','evidence:actual-a','missing'],sources:[a,b,duplicate]}),[a,b]);
 assert.equal(JSON.stringify([a,b,duplicate]),before);
});

test('429 paragraph anchors stay one paper and only actually cited identities enter a greeting follow-up',()=>{
 const sources=Array.from({length:429},(_,i)=>({id:'P1-L'+i,stableID:'evidence:paper:13:13:P1-L'+i,paperItemID:13,paperTitle:'Review of deep learning',title:'第 '+i+' 段',sourceText:'long original '.repeat(400),coverage:'已读取原文片段'})),messages=[{id:'q',role:'user',text:'介绍这篇论文'},{id:'a',role:'assistant',text:'这篇综述讨论 CNN 架构。[evidence:paper:13:13:P1-L93]',sources}];
 const before=JSON.stringify(messages),context=historySourceContext(messages);assert.equal(context.length,1);assert.equal(context[0].id,sources[93].stableID);assert.ok(JSON.stringify(context).length<500);assert.equal(sourceGroups(sources).length,1);assert.equal(sourceGroups(sources)[0].sources.length,429);assert.equal(JSON.stringify(messages),before);
 assert.equal(questionForAnswer(messages,messages[1]),'介绍这篇论文');assert.equal(answerWithQuestion(messages,messages[1]).question,'介绍这篇论文');assert.equal(questionForAnswer(messages,{id:'missing'}),'');
});

test('a long paper supplies bounded relevant excerpts and distributed coverage without changing originals',()=>{
 const rows=Array.from({length:429},(_,i)=>({id:'P'+i,text:(i===287?'robustness under unknown channel. ':'generic CNN architectures. ').repeat(150),pageIndex:Math.floor(i/6),position:{pageIndex:Math.floor(i/6),rects:[[1,2,3,4]]}})),before=JSON.stringify(rows),context=selectPaperContext(rows,'robustness unknown channel');
 assert.ok(context.sources.length<=24);assert.ok(context.sources.some(row=>row.id==='P287'));assert.ok(context.sources.some(row=>row.pageIndex>=70));assert.ok(context.sources.reduce((sum,row)=>sum+row.text.length,0)<=48000);assert.equal(context.total,429);assert.equal(context.truncated,true);assert.equal(JSON.stringify(rows),before);
 assert.deepEqual(selectPaperContext([],''),{sources:[],total:0,selected:0,truncated:false});
});
