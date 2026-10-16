/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRapidReading,selectRapidSources,rapidEvidenceExcerpts,bindRapidReadingEvidence,rapidModelIdentity,rapidReadingFlow,rapidReadingArticleFlow,rapidReadingBrief,rapidAuthorNames,rapidReadingEditKey,rapidReadingEditedText,assetAtPoint,visibleComments} from '../../chrome/content/zotero/research/shared/rapid-reading-data.mjs';
const sources=[{id:'p1',text:'The detector uses a voting rule across three complementary scores.',pageIndex:2}];
const result={sections:[{role:'method',heading:'互补分数投票',points:[{text:'三种互补评分共同决定是否拒绝样本。',evidence:[{sourceID:'p1',quote:'a voting rule across three complementary scores'}]}]}]};
test('reading explanation retains real exact evidence and rejects invented source/quote',()=>{assert.equal(validateRapidReading(result,sources).sections[0].points[0].evidence[0].sourceID,'p1');for(const e of [{sourceID:'missing',quote:'a voting rule'},{sourceID:'p1',quote:'100% accuracy on all benchmarks'}]){const bad=structuredClone(result);bad.sections[0].points[0].evidence=[e];assert.throws(()=>validateRapidReading(bad,sources));}assert.throws(()=>validateRapidReading({sections:[{role:'method',heading:'无依据',points:[{text:'自称有效',evidence:[]}]}]},sources));});
test('legacy evidence preserves actual PDF characters and never repairs or splices words',()=>{
 const original=[{id:'p1',text:'The detector\nuses a voting rule across three complementary scores.'}];
 const value=structuredClone(result);value.sections[0].points[0].evidence[0].quote='The detector uses a voting rule';
 assert.equal(validateRapidReading(value,original).sections[0].points[0].evidence[0].quote,'The detector\nuses a voting rule');
 for(const quote of ['The detector three complementary scores','The detector uses an improved voting rule']){value.sections[0].points[0].evidence[0].quote=quote;assert.throws(()=>validateRapidReading(value,original),/不能在提供的原文中核对/);}
});
test('small rapid inputs keep source IDs and positions after foreign attachments and annotations are excluded',()=>{
 const position={pageIndex:2,rects:[[10,20,30,40]]},input=[{...sources[0],attachmentID:8,position},{id:'foreign',attachmentID:9,text:'This is another attachment.'},{id:'annotation',attachmentID:8,annotationKey:'USER',text:'User opinion is not article text.'}];
 const before=structuredClone(input),selected=selectRapidSources(input,{attachmentID:8});
 assert.deepEqual(selected.sources,[input[0]]);assert.strictEqual(selected.sources[0].position,position);assert.equal(selected.coverage.sampled,false);assert.equal(selected.coverage.availableSources,1);assert.equal(selected.coverage.selectedPages,1);assert.deepEqual(input,before);
});
test('74-page rapid sampling covers every page with bounded balanced contiguous original passages',()=>{
 const pages=Array.from({length:74},(_,pageIndex)=>({id:'page-'+pageIndex,attachmentID:8,pageIndex,position:{pageIndex,rects:[[1,2,3,4]]},text:`START-${pageIndex} `+'start passage '.repeat(160)+`MIDDLE-${pageIndex} `+'ending passage '.repeat(160)+`END-${pageIndex}`}));
 const input=[{id:'foreign',attachmentID:9,pageIndex:90,text:'Wrong PDF '.repeat(10000)},{id:'annotation',annotationKey:'USER',attachmentID:8,pageIndex:91,text:'User note '.repeat(10000)},...pages],before=structuredClone(input),selected=selectRapidSources(input,{attachmentID:8});
 assert.equal(selected.coverage.availablePages,74);assert.equal(selected.coverage.selectedPages,74);assert.equal(new Set(selected.sources.map(source=>source.pageIndex)).size,74);assert.ok(selected.coverage.selectedChars<=48000);assert.ok(selected.sources.length<=96);assert.equal(selected.coverage.sampled,true);assert.deepEqual(selectRapidSources(input,{attachmentID:8}),selected);assert.deepEqual(input,before);
 for(const source of selected.sources){const original=pages[source.pageIndex];assert.equal(source.attachmentID,8);assert.ok(original.text.includes(source.text));assert.ok(source.text.length<=650);assert.deepEqual(source.position,original.position);assert.equal(source.originSourceID,original.id);assert.equal(original.text.slice(...source.sourceTextRange),source.text);}
 const initial=selected.sources.slice(0,74);assert.equal(initial[0].sourceTextRange[0],0);assert.ok(initial[1].sourceTextRange[0]>0&&initial[1].sourceTextRange[1]<pages[1].text.length);assert.equal(initial[2].sourceTextRange[1],pages[2].text.length);
});
test('sampling under smaller limits retains distributed first and final pages and never exceeds either limit',()=>{
 const pages=Array.from({length:74},(_,pageIndex)=>({id:'p'+pageIndex,attachmentID:8,pageIndex,text:'Contiguous original page evidence. '.repeat(100)}));
 const selected=selectRapidSources(pages,{attachmentID:8,maxChars:1800,maxSources:6,chunkChars:650});
 assert.equal(selected.sources.length,6);assert.ok(selected.coverage.selectedChars<=1800);assert.equal(selected.sources[0].pageIndex,0);assert.equal(selected.sources.at(-1).pageIndex,73);
 for(const options of [{maxChars:0},{maxSources:0},{chunkChars:0},{maxChars:7}])assert.deepEqual(selectRapidSources(pages,{attachmentID:8,...options}).sources,[]);
});
test('paragraphs on the same page share coverage slots instead of crowding later PDF pages out',()=>{
 const input=[...Array.from({length:120},(_,index)=>({id:'paragraph-'+index,attachmentID:8,pageIndex:0,text:'First-page paragraph '+index+' '+ 'original evidence '.repeat(20)})),...Array.from({length:73},(_,index)=>({id:'page-'+(index+1),attachmentID:8,pageIndex:index+1,text:'Later page original evidence. '.repeat(100)}))];
 const selected=selectRapidSources(input,{attachmentID:8});assert.equal(selected.coverage.selectedPages,74);assert.ok(selected.sources.length<=96);assert.ok(selected.coverage.selectedChars<=48000);
});
test('software excerpts bind quote IDs to real source text without model retyping or source overrides',()=>{
 const original=[{id:'p1',text:'Actual PDF\nline break remains unchanged. '+ 'Contiguous original evidence. '.repeat(40),pageIndex:2}],excerpts=rapidEvidenceExcerpts(original);
 assert.ok(excerpts.length>1);assert.ok(excerpts.every(excerpt=>excerpt.text.length<=650&&original[0].text.includes(excerpt.text)));
 const value={sections:[{role:'method',heading:'真实证据',points:[{text:'中文解释',quoteIDs:[excerpts[0].quoteID,excerpts[0].quoteID]}]}]},bound=bindRapidReadingEvidence(value,excerpts,original);
 assert.deepEqual(bound.sections[0].points[0].evidence,[{sourceID:'p1',quote:excerpts[0].text}]);assert.ok(bound.sections[0].points[0].evidence[0].quote.includes('\n'));assert.equal(value.sections[0].points[0].evidence,undefined);
 value.sections[0].points[0]={text:'中文解释',evidence:[{quoteID:excerpts[0].quoteID,sourceID:'invented',quote:'invented text'}]};assert.deepEqual(bindRapidReadingEvidence(value,excerpts,original),bound);
});
test('quote ID binding rejects unknown IDs, stale sources, edited or spliced software excerpts',()=>{
 const excerpts=rapidEvidenceExcerpts(sources),value={sections:[{role:'method',heading:'核验',points:[{text:'解释',quoteIDs:['Q404']}]}]};
 assert.throws(()=>bindRapidReadingEvidence(value,excerpts,sources),/不存在或无法核对/);value.sections[0].points[0].quoteIDs=['Q1'];
 for(const invalid of [{...excerpts[0],sourceID:'missing'},{...excerpts[0],text:'The detector three complementary scores.'},{...excerpts[0],text:'The detector obtains 100% accuracy.'}])assert.throws(()=>bindRapidReadingEvidence(value,[invalid],sources),/不存在或无法核对/);
 assert.throws(()=>bindRapidReadingEvidence(value,excerpts,[]),/不存在或无法核对/);value.sections[0].points[0].quoteIDs=[];assert.throws(()=>bindRapidReadingEvidence(value,excerpts,sources),/缺少原文摘录编号/);
});
test('model cache identity follows endpoint, explicit model and reasoning settings without mutating configuration',()=>{
 const config={endpoint:' https://provider.invalid/v1/ ',model:'user-selected-model',thinkingLevel:'high',reasoningParameter:'reasoning_effort',selectedModel:true},before=structuredClone(config),identity=rapidModelIdentity(config);
 assert.deepEqual(identity,{endpoint:'https://provider.invalid/v1',model:'user-selected-model',thinkingLevel:'high',reasoningParameter:'reasoning_effort'});assert.deepEqual(config,before);
 for(const change of [{endpoint:'https://other.invalid/v1'},{model:'another-model'},{thinkingLevel:'off'},{reasoningParameter:'thinking'}])assert.notDeepEqual(rapidModelIdentity({...config,...change}),identity);
 assert.deepEqual(rapidModelIdentity({endpoint:'https://provider.invalid/v1/',model:'user-selected-model'}),{endpoint:'https://provider.invalid/v1',model:'user-selected-model',thinkingLevel:'off',reasoningParameter:''});
});
test('reading flow follows earliest actual evidence pages and top-origin asset positions with stable ties',()=>{
 const sourceData=[{id:'later',attachmentID:8,pageIndex:5},{id:'early',attachmentID:8,pageIndex:1},{id:'same',attachmentID:8,pageIndex:1},{id:'foreign',attachmentID:9,pageIndex:0}];
 const section=(heading,ids)=>({role:'method',heading,points:[{text:heading,evidence:ids.map(sourceID=>({sourceID,quote:'actual excerpt'}))}]}),record={sections:[section('later',['later']),section('first same page',['later','early']),section('second same page',['same']),section('no actual page',['missing','foreign'])]};
 const assets=[{id:'table',kind:'table',attachmentID:8,pageIndex:1,bbox:[5,100,100,200]},{id:'figure-right',kind:'figure',attachmentID:8,pageIndex:1,bbox:[70,10,100,80]},{id:'formula',kind:'formula',attachmentID:8,pageIndex:0,bbox:[10,20,90,40]},{id:'figure-left',kind:'figure',attachmentID:8,pageIndex:1,bbox:[10,10,60,80]},{id:'figure-tie',kind:'figure',attachmentID:8,pageIndex:1,bbox:[10,10,60,80]},{id:'foreign',attachmentID:9,pageIndex:0,bbox:[0,0,100,100]}];
 assets.push(assets[0],{...assets[0]});const before=structuredClone({record,sourceData,assets}),flow=rapidReadingFlow(record,sourceData,assets,{attachmentID:8});
 assert.deepEqual(flow.map(entry=>entry.section?.heading||entry.asset.id),['formula','first same page','second same page','figure-left','figure-tie','figure-right','table','later','no actual page']);
 assert.deepEqual(flow.map(entry=>entry.pageIndex),[0,1,1,1,1,1,1,5,null]);assert.equal(flow.find(entry=>entry.section===record.sections[1]).index,1);assert.equal(flow.find(entry=>entry.asset===assets[2]).index,2);
 assert.deepEqual({record,sourceData,assets},before);
});
test('unlocated flow entries keep their stable tail without inferring pages from labels or text ranges',()=>{
 const sourceData=[{id:'page-label',pageLabel:'1',sourceTextRange:[0,100]},{id:'negative',pageIndex:-1}],record={sections:[{heading:'unknown one',points:[{evidence:[{sourceID:'page-label'}]}]},{heading:'unknown two',points:[{evidence:[{sourceID:'negative'}]}]}]},first={kind:'figure',page:1,bbox:[5,5,10,10]},second={kind:'table',pageIndex:NaN,bbox:[0,0,10,10]},third={kind:'formula',pageIndex:2,bbox:[2,2,3,3]};
 const flow=rapidReadingFlow(record,sourceData,[first,second,third,first]);
 assert.deepEqual(flow.map(entry=>entry.section?.heading||entry.asset.kind),['formula','unknown one','unknown two','figure','table']);assert.ok(flow.slice(1).every(entry=>entry.pageIndex===null));
});
test('article flow splits multi-page topics and keeps each original figure beside its specifically cited explanation',()=>{
 const sourceData=[{id:'intro',attachmentID:8,pageIndex:0},{id:'figure-one',attachmentID:8,pageIndex:1},{id:'figure-ten',attachmentID:8,pageIndex:3},{id:'foreign',attachmentID:9,pageIndex:0}],point=(text,ids)=>({text,evidence:ids.map(sourceID=>({sourceID,quote:'Original exact evidence.'}))});
 const record={sections:[{role:'results',heading:'测试结果',points:[point('Figure 10 reports the held-out result.',['figure-ten']),point('图 1 显示实际测试条件。',['intro','figure-one'])]},{role:'problem',heading:'问题定义',points:[point('作者研究跨域测试条件。',['intro'])]}]},assets=[{id:'one',label:'Figure 1',kind:'figure',attachmentID:8,pageIndex:1,bbox:[10,20,100,100]},{id:'ten',label:'Figure 10',kind:'figure',attachmentID:8,pageIndex:3,bbox:[10,30,100,100]},{id:'orphan',label:'表 2',kind:'table',attachmentID:8,pageIndex:2,bbox:[10,30,100,100]},{id:'foreign',label:'图 3',kind:'figure',attachmentID:9,pageIndex:0}];assets.push(assets[0],{...assets[0]});
 const before=structuredClone({record,sourceData,assets}),flow=rapidReadingArticleFlow(record,sourceData,assets,{attachmentID:8});
 assert.deepEqual(flow.map(entry=>entry.pageIndex),[0,1,2,3]);assert.deepEqual(flow.filter(entry=>entry.kind==='point').map(entry=>entry.point.text),[record.sections[1].points[0].text,record.sections[0].points[1].text,record.sections[0].points[0].text]);
 assert.deepEqual(flow[1].assets.map(asset=>asset.id),['one']);assert.deepEqual(flow[3].assets.map(asset=>asset.id),['ten']);assert.equal(flow[2].asset.id,'orphan','没有同页说明的真实图表仍按原页保留');
 assert.equal(flow[1].pointIndex,1);assert.equal(flow[1].index,0);assert.strictEqual(flow[1].section,record.sections[0]);assert.deepEqual({record,sourceData,assets},before,'呈现派生，不改缓存正文或素材');
 assert.equal(rapidReadingEditKey(flow[1].section,flow[1].index,flow[1].point,flow[1].pointIndex),rapidReadingEditKey(record.sections[0],0,record.sections[0].points[1],1));
});
test('article figures without named references attach to real neighboring PDF text coordinates without guessing another page',()=>{
 const sourceData=[{id:'upper',attachmentID:8,pageIndex:2,position:{rects:[[10,740,200,760]]}},{id:'lower',attachmentID:8,pageIndex:2,position:{rects:[[10,200,200,220]]}}],record={sections:[{role:'method',heading:'上方文字',points:[{text:'上方实际说明。',evidence:[{sourceID:'upper',quote:'Original upper evidence.'}]}]},{role:'results',heading:'下方文字',points:[{text:'下方实际说明。',evidence:[{sourceID:'lower',quote:'Original lower evidence.'}]}]}]},assets=[{id:'top',label:'图 4',kind:'figure',attachmentID:8,pageIndex:2,pageHeight:800,bbox:[10,80,200,150]},{id:'bottom',label:'表 2',kind:'table',attachmentID:8,pageIndex:2,pageHeight:800,bbox:[10,570,200,650]},{id:'different-page',label:'图 5',kind:'figure',attachmentID:8,pageIndex:3,bbox:[10,570,200,650]}];
 const flow=rapidReadingArticleFlow(record,sourceData,assets,{attachmentID:8});assert.equal(flow[0].top,40);assert.equal(flow[1].top,580);assert.deepEqual(flow[0].assets.map(asset=>asset.id),['top']);assert.deepEqual(flow[1].assets.map(asset=>asset.id),['bottom']);assert.equal(flow[2].asset.id,'different-page');assert.equal(flow[2].pageIndex,3);
});
test('article point locations use actual evidence and never treat an unverified figure label as a page number',()=>{
 const point={text:'图 3 显示用户已编辑的表述。',evidence:[{sourceID:'real',quote:'Original evidence.'}]},record={sections:[{role:'method',heading:'真实方法',points:[point]}]},sourceData=[{id:'real',attachmentID:8,pageIndex:0}],asset={id:'three',label:'图 3',kind:'figure',attachmentID:8,pageIndex:5,bbox:[1,2,3,4]};
 const flow=rapidReadingArticleFlow(record,sourceData,[asset],{attachmentID:8});assert.equal(flow[0].pageIndex,0);assert.deepEqual(flow[0].assets,[]);assert.equal(flow[1].pageIndex,5);assert.equal(flow[1].asset.id,asset.id);
});
test('article flow restores original ranges within one sampled source rather than sampling round order',()=>{
 const sources=[{id:'last',originSourceID:'page-original',pageIndex:2,sourceTextRange:[200,300]},{id:'first',originSourceID:'page-original',pageIndex:2,sourceTextRange:[0,100]},{id:'middle',originSourceID:'page-original',pageIndex:2,sourceTextRange:[100,200]}],record={sections:[{role:'method',heading:'原文顺序',points:sources.map(source=>({text:source.id,evidence:[{sourceID:source.id,quote:'original passage'}]}))}]},before=structuredClone({sources,record});
 assert.deepEqual(rapidReadingArticleFlow(record,sources,[]).map(entry=>entry.point.text),['first','middle','last']);assert.deepEqual({sources,record},before);
 for(const source of sources)delete source.pageIndex;assert.ok(rapidReadingArticleFlow(record,sources,[]).every(entry=>entry.pageIndex===null),'来源范围不能推断页码');
});
test('brief tabs reuse concrete verified text and local edits with intact quantities and LaTeX, without altering the full article',()=>{
 const point={text:'独立测试准确率为 91.2%，阈值为 $x_i \\leq 2$。',evidence:[{sourceID:'actual',quote:'Accuracy 91.2%, x_i <= 2.'}]},record={sections:[{role:'results',heading:'独立测试条件',points:[point,{text:'无来源的套话。',evidence:[]}]},{role:'method',heading:'阈值方法',points:[{text:'方法文字。',evidence:[{sourceID:'actual',quote:'x_i <= 2.'}]}]}]},before=structuredClone(record),edited='我的核对：独立测试为 91.2%，仍使用 $x_i \\leq 2$。';
 const initial=rapidReadingBrief(record,'results');assert.equal(initial.length,1);assert.equal(initial[0].text,point.text);assert.strictEqual(initial[0].point,point);assert.equal(initial[0].section.heading,'独立测试条件');
 const changed=rapidReadingBrief(record,'results',{textForPoint:current=>current===point?edited:current.text});assert.equal(changed[0].text,edited);assert.deepEqual(rapidReadingBrief(record,'limitations'),[]);assert.deepEqual(record,before);
});
test('rapid authors preserve complete personal and institutional names and filter known nonauthor roles',()=>{
 const creators=[{firstName:' Ada ',lastName:' Lovelace ',creatorTypeID:1},{lastName:'Research Group',fieldMode:1,creatorType:'author'},{firstName:'Grace',lastName:'Hopper',creatorTypeID:4},{firstName:'Alan',lastName:'Turing',creatorType:'editor'},{firstName:'Unknown',lastName:'Role'},{firstName:'Ada',lastName:'Lovelace',creatorTypeID:1}],before=structuredClone(creators);
 assert.deepEqual(rapidAuthorNames(creators,'Fallback et al.'),['Ada Lovelace','Research Group','Unknown Role','Ada Lovelace']);assert.deepEqual(creators,before);
});
test('author metadata fallback preserves genuine string and list values including et al.',()=>{
 assert.deepEqual(rapidAuthorNames([], '  Lee et al.  '),['Lee et al.']);
 const fallback=['Jane Doe',{given:'Marie',family:'Curie'},{name:'International Research Consortium'},{institution:'Shared Laboratory'},'Li et al.'],before=structuredClone(fallback);
 assert.deepEqual(rapidAuthorNames([{lastName:'An Editor',creatorTypeID:3}],fallback),['Jane Doe','Marie Curie','International Research Consortium','Shared Laboratory','Li et al.']);assert.deepEqual(fallback,before);assert.deepEqual(rapidAuthorNames(null,null),[]);
});
test('point edit identity follows original text and evidence while surviving section and point reordering',()=>{
 const section={role:'method',heading:'原理'},point={text:'阈值为 x ≤ 2。\n保留公式和换行。',evidence:[{sourceID:'p1',quote:'x ≤ 2\nOriginal formula.'},{sourceID:'p2',quote:'Second original excerpt.'}]},key=rapidReadingEditKey(section,0,point,0);
 assert.equal(rapidReadingEditKey(section,3,point,7),key);assert.equal(rapidReadingEditKey(section,0,{...point,evidence:[...point.evidence].reverse()},0),key);
 for(const changed of [{...point,text:point.text+'更新'},{...point,evidence:[{...point.evidence[0],sourceID:'new-source'}]},{...point,evidence:[{...point.evidence[0],quote:'Different original formula.'}]}])assert.notEqual(rapidReadingEditKey(section,0,changed,0),key);
 assert.notEqual(rapidReadingEditKey({...section,role:'results'},0,point,0),key);
});
test('personal point edits apply only to the matching original and leave source records immutable',()=>{
 const record=structuredClone(result),point=record.sections[0].points[0],sourceData=structuredClone(sources),before=structuredClone({record,sourceData}),edit={originalText:point.text,text:'我的解释：\ny = x²，保留换行。',at:123},key=rapidReadingEditKey(record.sections[0],0,point,0),edits={'pdf-one:model-a':{[key]:edit},'pdf-two:model-a':{},'pdf-one:model-b':{}};
 assert.equal(rapidReadingEditedText(point,edits['pdf-one:model-a'][key]),edit.text);assert.equal(rapidReadingEditedText(point,edits['pdf-two:model-a'][key]),point.text);assert.equal(rapidReadingEditedText(point,edits['pdf-one:model-b'][key]),point.text);
 const regenerated={...point,text:'重新生成的解释。'};assert.equal(rapidReadingEditedText(regenerated,edit),regenerated.text);assert.equal(rapidReadingEditedText(point,{text:'legacy edit with no original'}),point.text);assert.equal(rapidReadingEditedText(point,{...edit,text:null}),point.text);
 delete edits['pdf-one:model-a'][key];assert.equal(rapidReadingEditedText(point,edits['pdf-one:model-a'][key]),point.text);assert.deepEqual({record,sourceData},before);
});
test('original article click chooses the smallest actual figure/table/formula region on its own page',()=>{const assets=[{id:'whole',pageIndex:1,r:[0,0,200,200]},{id:'formula',pageIndex:1,r:[20,30,100,60]},{id:'other',pageIndex:2,r:[20,30,100,60]}],to=a=>({rects:[a.r]});assert.equal(assetAtPoint(assets,{pageIndex:1,rects:[[40,40,40,40]]},to).id,'formula');assert.equal(assetAtPoint(assets,{pageIndex:0,rects:[[40,40,40,40]]},to),null);assert.equal(assetAtPoint(assets,{pageIndex:1,rects:[[210,40,210,40]]},to),null);});
test('margin comments retain actual machine translations while excluding empty and duplicated original excerpts',()=>{const data=[{id:'a',comment:'The threshold needs checking'},{id:'b',comment:'译文\n三种评分'},{id:'c',comment:''},{id:'d',comment:'我认为需要消融验证'},{id:'e',comment:'机器翻译（请核对）\n三种评分',tags:[{name:'机器翻译'}]},{id:'f',comment:'机器翻译\n',tags:[{name:'机器翻译'}]},{id:'g',comment:'The exact original excerpt'}],links={b:{translation:'三种评分'},d:{generatedComment:'三种评分'},e:{translation:'三种评分',generatedComment:'机器翻译（请核对）\n三种评分'},g:{generatedComment:'The exact original excerpt'}};assert.deepEqual(visibleComments(data,id=>links[id]).map(x=>x.annotation.id),['a','d','e']);});
