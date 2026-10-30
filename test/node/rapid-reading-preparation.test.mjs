/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {installRapidReading} from '../../chrome/content/zotero/research/shared/reader-rapid-reading.mjs';
import {rapidReadingEditKey,rapidModelIdentity} from '../../chrome/content/zotero/research/shared/rapid-reading-data.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function fixture(){
 const state={},calls={sources:0,index:0,model:[],writes:0},session={modelID:'deliberately-selected-model',thinkingLevel:'high'};
 let signature='pdf-v1',text='The paper reports three complementary scores with explicit conditions.';
 const paper={id:7,getField:name=>name==='title'?'Local evidence paper':'A. Author'},attachment={id:13,parentItem:paper,isPDFAttachment:()=>true,dateModified:'fixed'};
 const E={store:{get:(branch,key)=>branch?key===undefined?state[branch]:state[branch]?.[key]:state,update:async fn=>{calls.writes++;return fn(state);}},settings:()=>({endpoint:'https://configured.invalid/v1',model:'configured-default'}),core:{endpoint:value=>value.replace(/\/+$/u,'')},workbenchConversations:{getForScope:()=>session,getActive:()=>session},assets:{key:value=>JSON.stringify(value),fileSignature:async()=>signature,index:async()=>{calls.index++;return {pdfHash:signature,assets:[{id:'original-figure',path:'local-existing.png',label:'Figure 1'}]};}},library:{describe:()=>({id:13}),sources:async(_papers,_selection,options)=>{calls.sources++;assert.equal(options.rapidReading,true);return {sources:[{id:'page-1',attachmentID:13,pageIndex:0,label:'Page 1',text}],warnings:[]};}},studio:{request:async(_system,input,_status,signal,options)=>{calls.model.push({input,options,signal});return {value:{sections:[{role:'method',heading:'Original evidence',points:[{text:'A controlled explanation.',quoteIDs:[input.evidenceExcerpts[0].quoteID]}]}]},model:options.modelConfig.model,at:'controlled'};}},setTimeout,clearTimeout};
 const shutdown=[],errors=[],Zotero={getMainWindow:()=>({AbortController}),Items:{getAsync:async()=>attachment},addShutdownListener:fn=>shutdown.push(fn),logError:error=>errors.push(error)};installRapidReading(E,{Zotero});
 return {E,Zotero,state,calls,session,shutdown,errors,changePDF:()=>{signature='pdf-v2';text='The revised paper reports different explicitly supported evidence.';}};
}

test('concurrent import/open preparation shares local work and the exact selected model request',async()=>{
 const {E,state,calls}=fixture(),gate=deferred(),request=E.studio.request;E.studio.request=async(...args)=>{await gate.promise;return request(...args);};
 const first=E.prepareReaderRapidReading(13),second=E.prepareReaderRapidReading(13);await tick();gate.resolve();const [a,b]=await Promise.all([first,second]);
 assert.equal(calls.sources,1);assert.equal(calls.index,1);assert.equal(calls.model.length,1);assert.deepEqual(a.record,b.record);assert.equal(a.record.model,'deliberately-selected-model');
 assert.equal(calls.model[0].options.modelConfig.selectedModel,true);assert.equal(calls.model[0].options.modelConfig.thinkingLevel,'high');assert.equal(Object.values(state.rapidReads).length,1);
 assert.equal(calls.model[0].input.sources[0].text,undefined,'PDF text is transmitted once through excerpts');assert.ok(calls.model[0].input.evidenceExcerpts.reduce((sum,excerpt)=>sum+excerpt.text.length,0)<=48000);assert.ok(calls.model[0].input.evidenceExcerpts[0].text.includes('three complementary scores'));E.stopRapidReadingPreparation();
});
test('reading-language upgrades preserve legacy manual edits and reuse the existing PDF source cache',async()=>{
 const {E,state,calls}=fixture(),first=await E.prepareReaderRapidReading(13),parts=JSON.parse(first.cacheKey);parts[0]='source-reading-2';const legacyKey=JSON.stringify(parts);state.rapidReads[legacyKey]=structuredClone(first.record);delete state.rapidReads[first.cacheKey];state.rapidReadEdits={[legacyKey]:{points:{saved:{text:'用户自己修改的速读'}}}};
 const reused=await E.prepareReaderRapidReading(13);assert.equal(reused.cacheKey,legacyKey);assert.equal(calls.model.length,1);assert.equal(calls.sources,1);assert.equal(calls.index,1);assert.equal(state.rapidReadEdits[legacyKey].points.saved.text,'用户自己修改的速读');
 delete state.rapidReadEdits[legacyKey];const upgraded=await E.prepareReaderRapidReading(13);assert.notEqual(upgraded.cacheKey,legacyKey);assert.equal(calls.model.length,2);assert.equal(calls.sources,1);assert.equal(calls.index,1);assert.ok(state.rapidReads[legacyKey],'旧阅读记录保留');E.stopRapidReadingPreparation();
});

test('the previous reading-language version keeps manually edited paragraphs during the new detail upgrade',async()=>{
 const {E,state,calls}=fixture(),first=await E.prepareReaderRapidReading(13),parts=JSON.parse(first.cacheKey);parts[0]='source-reading-3';const legacyKey=JSON.stringify(parts);state.rapidReads[legacyKey]=structuredClone(first.record);delete state.rapidReads[first.cacheKey];state.rapidReadEdits={[legacyKey]:{points:{saved:{text:'用户已核对的解释。'}}}};
 const reused=await E.prepareReaderRapidReading(13);assert.equal(reused.cacheKey,legacyKey);assert.equal(calls.model.length,1);assert.equal(state.rapidReadEdits[legacyKey].points.saved.text,'用户已核对的解释。');await E.stopRapidReadingPreparation();
});

test('an old tiny source cache cannot truncate a new reading, but an explicitly edited old reading remains recoverable with its own sources',async()=>{
 for(const manuallyEdited of [false,true]){
  const {E,state,calls}=fixture(),oldSource={id:'old-page-fragment',attachmentID:13,pageIndex:0,label:'旧片段',text:'three complementary scores'},identity=rapidModelIdentity(E.readerRapidReadingModel(7)),legacyKey=E.assets.key(['source-reading-4','pdf-v1',identity,[[oldSource.id,oldSource.text]]]);
  state.rapidReadSources={[E.assets.key(['source-reading-2',13,'pdf-v1'])]:{sources:[oldSource],coverage:{sampled:true,maxChars:436,maxSources:5},pdfHash:'pdf-v1'}};
  state.rapidReads={[legacyKey]:{sections:[{role:'method',heading:'旧速读',points:[{text:'三种评分。',evidence:[{sourceID:oldSource.id,quote:oldSource.text}]}]}]}};
  if(manuallyEdited)state.rapidReadEdits={[legacyKey]:{points:{saved:{text:'用户已核对的旧稿。'}}}};
  const result=await E.prepareReaderRapidReading(13);assert.equal(calls.sources,1,'重新提取完整正文，不能继续使用436字预算');
  if(manuallyEdited){assert.equal(result.cacheKey,legacyKey);assert.equal(result.sources[0].id,oldSource.id);assert.equal(calls.model.length,0);assert.equal(state.rapidReadEdits[legacyKey].points.saved.text,'用户已核对的旧稿。');}
  else{assert.notEqual(result.cacheKey,legacyKey);assert.equal(result.coverage.sampled,false);assert.equal(result.sources[0].id,'page-1');assert.equal(calls.model.length,1);}
  assert.ok(state.rapidReads[legacyKey],'旧记录不删除');await E.stopRapidReadingPreparation();
 }
});

test('a freshly generated current reading with valid personal edits takes precedence over edited legacy copies on reopening',async()=>{
 const {E,state,calls}=fixture(),first=await E.prepareReaderRapidReading(13),parts=JSON.parse(first.cacheKey);parts[0]='source-reading-3';const legacyKey=JSON.stringify(parts);state.rapidReads[legacyKey]=structuredClone(first.record);state.rapidReadEdits={[legacyKey]:{points:{saved:{text:'上一版手动解释。'}}}};
 const fresh=await E.prepareReaderRapidReading(13,{fresh:true}),section=fresh.record.sections[0],point=section.points[0],editKey=E.assets.key(rapidReadingEditKey(section,0,point,0)),edit={originalText:point.text,text:'当前第四版由用户重新核对的解释。'};state.rapidReadEdits[fresh.cacheKey]={points:{[editKey]:edit}};const before=structuredClone(state),requests=calls.model.length;
 const reopened=await E.prepareReaderRapidReading(13);assert.equal(reopened.cacheKey,fresh.cacheKey);assert.notEqual(reopened.cacheKey,legacyKey);assert.equal(state.rapidReadEdits[reopened.cacheKey].points[editKey].text,edit.text);assert.equal(calls.model.length,requests);assert.deepEqual(state,before,'opening the current personal reading preserves all older records and edits');
 state.rapidReadEdits[fresh.cacheKey].points[editKey].originalText='已不匹配重新生成的原句';const fallback=await E.prepareReaderRapidReading(13);assert.equal(fallback.cacheKey,legacyKey,'a stale current edit does not take precedence over a valid legacy personal reading');assert.ok(state.rapidReads[fresh.cacheKey]);await E.stopRapidReadingPreparation();
});

test('a full-text reading repairs an overly short reply with deeper evidence-bound paragraphs rather than accepting a generic abstract',async()=>{
 const {E,state,calls}=fixture();E.library.sources=async()=>({sources:[{id:'actual-method',attachmentID:13,pageIndex:0,label:'完整原文',text:'The original study compares independent reconstruction conditions, baseline procedures and observed failure cases. '.repeat(200)}]});let attempt=0;
 E.studio.request=async(_rules,input,_status,signal,options)=>{attempt++;calls.model.push({input,options,signal});return {model:options.modelConfig.model,value:{sections:[{role:'method',heading:'已读原文的机制与实验设置',points:attempt===1?[{text:'作者提出方法并开展实验。',quoteIDs:['Q1']}]:Array.from({length:12},()=>({text:'原文在独立重建条件下比较处理步骤，说明控制条件和基线之间的关系，并记录实际观察到的失败情形。'.repeat(5),quoteIDs:['Q1']}))}]}};};
 const result=await E.prepareReaderRapidReading(13);assert.equal(result.error,undefined);assert.equal(attempt,2);assert.equal(calls.model[0].options.maxTokens,14000);assert.equal(calls.model[0].input.readingDepth.minimumParagraphs,10);assert.match(calls.model[1].input.validationError,/过于简略/);assert.equal(calls.model[1].options.fresh,true);assert.equal(result.record.sections[0].points.length,12);assert.equal(Object.values(state.rapidReads).length,1);for(const point of result.record.sections[0].points)assert.ok(result.sources[0].text.includes(point.evidence[0].quote));await E.stopRapidReadingPreparation();
});

test('invalid quotes receive one fresh repair, preserve local evidence, and are never saved as reading claims',async()=>{
 const {E,state,calls}=fixture();E.studio.request=async(_system,input,_status,signal,options)=>{calls.model.push({input,options,signal});return {value:{sections:[{role:'results',heading:'Unsupported',points:[{text:'Invented result.',quoteIDs:['Q404']}]}]},model:options.modelConfig.model};};
 const result=await E.prepareReaderRapidReading(13,{background:true});assert.match(result.error,/不存在或无法核对/);assert.equal(result.sources.length,1);assert.equal(result.indexed.assets.length,1);assert.equal(calls.model.length,2);assert.equal(calls.model[0].options.fresh,false);assert.equal(calls.model[1].options.fresh,true);assert.equal(state.rapidReads,undefined);
 assert.equal(state.rapidReadStatus[result.cacheKey].status,'failed');await E.prepareReaderRapidReading(13,{background:true});assert.equal(calls.model.length,2,'opening/importing the same failed version does not repeat provider work');
 await E.prepareReaderRapidReading(13,{fresh:true});assert.equal(calls.model.length,4);assert.equal(calls.model[2].options.fresh,true);E.stopRapidReadingPreparation();
});

test('a valid repair saves only canonically bound original quotations',async()=>{
 const {E,state,calls}=fixture(),request=E.studio.request;let attempts=0;E.studio.request=async(...args)=>{if(++attempts===1)return {value:{sections:[{role:'summary',heading:'Invalid',points:[{text:'Unsupported.',evidence:[{sourceID:'page-1',quote:'An invented 100% improvement'}]}]}]}};return request(...args);};
 const result=await E.prepareReaderRapidReading(13);assert.equal(attempts,2);assert.equal(result.record.sections[0].points[0].evidence[0].quote,result.sources[0].text);assert.equal(calls.model[0].options.fresh,true);assert.equal(Object.values(state.rapidReads).length,1);E.stopRapidReadingPreparation();
});

test('saved text survives model preference changes and only explicit refresh or a changed PDF starts generation',async()=>{
 const f=fixture(),{E,calls,session}=f;await E.prepareReaderRapidReading(13);await E.prepareReaderRapidReading(13);assert.equal(calls.model.length,1);
 session.modelID='another-selected-model';await E.prepareReaderRapidReading(13);session.thinkingLevel='off';await E.prepareReaderRapidReading(13);E.settings=()=>({endpoint:'https://another.invalid/v1',model:'configured-default'});await E.prepareReaderRapidReading(13);
 assert.equal(calls.model.length,1,'修改模型选项不自动重写已保存文字');assert.equal(calls.sources,1);assert.equal(calls.index,1);await E.prepareReaderRapidReading(13,{fresh:true});assert.equal(calls.model.length,2,'主动重新生成才采用新模型设置');assert.equal(calls.model.at(-1).options.modelConfig.model,'another-selected-model');f.changePDF();const changed=await E.prepareReaderRapidReading(13);assert.equal(calls.model.length,3);assert.equal(changed.record.pdfHash,'pdf-v2');E.stopRapidReadingPreparation();
});

test('restarting the preparation service reuses disk-backed text without a model call and does not evict older generated content',async()=>{
 const {E,Zotero,state,calls}=fixture();state.rapidReads=Object.fromEntries(Array.from({length:30},(_,index)=>['retained-'+index,{text:'之前保存的速读'+index}]));
 const first=await E.prepareReaderRapidReading(13);assert.equal(Object.keys(state.rapidReads).length,31,'第25篇之后仍保留历史文字');assert.ok(state.rapidReadDocuments);await E.stopRapidReadingPreparation();
 installRapidReading(E,{Zotero});const reopened=await E.prepareReaderRapidReading(13);assert.equal(calls.model.length,1,'进程内存缓存丢失后仍复用持久文字');assert.equal(reopened.cacheKey,first.cacheKey);assert.deepEqual(reopened.record,first.record);assert.equal(calls.sources,1,'重启复用完整来源缓存');assert.equal(Object.keys(state.rapidReads).length,31);await E.stopRapidReadingPreparation();
});

test('reopening durable source text and reading after restart does not rewrite the workspace',async()=>{
 const {E,Zotero,calls}=fixture();await E.prepareReaderRapidReading(13);const writes=calls.writes;assert.ok(writes>0);await E.stopRapidReadingPreparation();installRapidReading(E,{Zotero});await E.prepareReaderRapidReading(13);assert.equal(calls.writes,writes,'unchanged source text, hash and reading pointers are read-only cache hits');assert.equal(calls.sources,1);assert.equal(calls.model.length,1);await E.stopRapidReadingPreparation();
});

test('a valid current reading created before document pointers is reused across model changes and backfills independent identity',async()=>{
 for(const manuallyEdited of [false,true]){
  const {E,Zotero,state,calls,session}=fixture(),first=await E.prepareReaderRapidReading(13);delete state.rapidReadDocuments;
  if(manuallyEdited){const section=first.record.sections[0],point=section.points[0],key=E.assets.key(rapidReadingEditKey(section,0,point,0));state.rapidReadEdits={[first.cacheKey]:{points:{[key]:{originalText:point.text,text:'此前保存的人工解释。'}}}};}
  await E.stopRapidReadingPreparation();session.modelID='another-selected-model';session.thinkingLevel='low';installRapidReading(E,{Zotero});const reopened=await E.prepareReaderRapidReading(13);
  assert.equal(reopened.cacheKey,first.cacheKey);assert.equal(calls.model.length,1,'missing an old pointer does not authorize regeneration');assert.ok(Object.values(state.rapidReadDocuments).includes(first.cacheKey));if(manuallyEdited)assert.ok(state.rapidReadEdits[first.cacheKey]);await E.stopRapidReadingPreparation();
 }
});

test('a legacy manual reading remains recoverable after changing models even before independent pointers existed',async()=>{
 const {E,Zotero,state,calls,session}=fixture(),first=await E.prepareReaderRapidReading(13),parts=JSON.parse(first.cacheKey);parts[0]='source-reading-4';const legacyKey=JSON.stringify(parts),section=first.record.sections[0],point=section.points[0],key=E.assets.key(rapidReadingEditKey(section,0,point,0));state.rapidReads[legacyKey]=structuredClone(first.record);delete state.rapidReads[first.cacheKey];delete state.rapidReadDocuments;state.rapidReadEdits={[legacyKey]:{points:{[key]:{originalText:point.text,text:'已核对的旧版人工解释。'}}}};
 await E.stopRapidReadingPreparation();session.modelID='another-selected-model';installRapidReading(E,{Zotero});const reopened=await E.prepareReaderRapidReading(13);assert.equal(reopened.cacheKey,legacyKey);assert.equal(calls.model.length,1);assert.ok(Object.values(state.rapidReadDocuments).includes(legacyKey));await E.stopRapidReadingPreparation();
});

test('successful page text survives a failed figure index, and figure recovery cannot regenerate the same saved reading',async()=>{
 const {E,Zotero,state,calls}=fixture(),originalIndex=E.assets.index;E.assets.index=async()=>{calls.index++;throw Error('Controlled figure index unavailable');};const first=await E.prepareReaderRapidReading(13);assert.ok(first.record);assert.equal(first.indexed.pdfHash,'unavailable');assert.equal(calls.sources,1);assert.ok(Object.values(state.rapidReadSources).some(entry=>entry.sources[0].id==='page-1'),'source text is durable even when the independent image index failed');
 await E.stopRapidReadingPreparation();E.assets.index=originalIndex;installRapidReading(E,{Zotero});const recovered=await E.prepareReaderRapidReading(13);assert.equal(recovered.indexed.pdfHash,'pdf-v1');assert.equal(recovered.cacheKey,first.cacheKey);assert.equal(calls.sources,1,'a figure retry must not reread complete text');assert.equal(calls.model.length,1,'recovering figure metadata must not bill another reading');assert.ok(Object.values(state.rapidReadDocuments).includes(first.cacheKey));await E.stopRapidReadingPreparation();
});

test('closing the only consumer prevents late model writes and immediate reopen starts a new request',async()=>{
 const {E,state,calls}=fixture(),firstGate=deferred(),secondGate=deferred(),request=E.studio.request;let started=0;
 E.studio.request=async(...args)=>{const attempt=++started;await (attempt===1?firstGate:secondGate).promise;return request(...args);};
 const cancelled=new AbortController(),first=E.prepareReaderRapidReading(13,{signal:cancelled.signal});await tick();assert.equal(started,1);cancelled.abort();await assert.rejects(first,/已停止/);
 const reopened=E.prepareReaderRapidReading(13);await tick();assert.equal(started,2,'a cancelled pending request is not reused');firstGate.resolve();await tick();assert.equal(state.rapidReads,undefined,'late cancelled results cannot enter the cache');secondGate.resolve();const result=await reopened;assert.ok(result.record);assert.equal(calls.model.length,2);assert.equal(Object.values(state.rapidReads).length,1);E.stopRapidReadingPreparation();
});

test('closing one consumer retains a shared background preparation and stopping aborts every active request',async()=>{
 const {E,state}=fixture(),gate=deferred(),request=E.studio.request;E.studio.request=async(...args)=>{await gate.promise;return request(...args);};
 const cancel=new AbortController(),ui=E.prepareReaderRapidReading(13,{signal:cancel.signal}),background=E.prepareReaderRapidReading(13,{background:true});await tick();cancel.abort();await assert.rejects(ui,/已停止/);gate.resolve();assert.ok((await background).record);assert.equal(Object.values(state.rapidReads).length,1);E.stopRapidReadingPreparation();await assert.rejects(E.prepareReaderRapidReading(13),/已停止/);
});

test('background scheduling bounds pending attachments and runs one preparation at a time',async()=>{
 const {E}=fixture(),gate=deferred();let active=0,maxActive=0,started=0;
 E.prepareReaderRapidReading=async(_id,{signal})=>{started++;active++;maxActive=Math.max(maxActive,active);await gate.promise;assert.equal(signal.aborted,false);active--;};
 for(let id=1;id<=20;id++)E.queueReaderRapidReading(id);await new Promise(resolve=>setTimeout(resolve,400));assert.equal(started,1);assert.equal(maxActive,1);gate.resolve();await new Promise(resolve=>setTimeout(resolve,850));assert.equal(started,8);assert.equal(maxActive,1);E.stopRapidReadingPreparation();
});

test('native test automatic queues prepare local data until a dedicated controlled AI probe opts in',async()=>{
 const {E,Zotero}=fixture();Zotero.test=true;let optIn=false,optionsSeen=[];Zotero.Prefs={get:()=>optIn};E.prepareReaderRapidReading=async(_id,options)=>{optionsSeen.push(options);};
 E.queueReaderRapidReading(13);await new Promise(resolve=>setTimeout(resolve,400));assert.equal(optionsSeen[0].generate,false);optIn=true;E.queueReaderRapidReading(14);await new Promise(resolve=>setTimeout(resolve,400));assert.equal(optionsSeen[1].generate,undefined);E.stopRapidReadingPreparation();
});

test('cold import without a main window completes the existing background cache once and preserves model and thinking',async()=>{
 const {E,Zotero,state,calls,errors}=fixture(),timers=[];Zotero.getMainWindow=()=>null;E.setTimeout=callback=>{timers.push(callback);return timers.length;};E.clearTimeout=()=>{};
 E.queueReaderRapidReading(13);E.queueReaderRapidReading(13);assert.equal(timers.length,1);await timers.shift()();assert.equal(calls.sources,1);assert.equal(calls.index,1);assert.equal(calls.model.length,1);assert.equal(calls.model[0].options.modelConfig.model,'deliberately-selected-model');assert.equal(calls.model[0].options.modelConfig.thinkingLevel,'high');assert.equal(Object.keys(state.rapidReads).length,1);
 E.queueReaderRapidReading(13);await timers.shift()();assert.equal(calls.model.length,1);assert.equal(calls.index,1);assert.equal(errors.length,0);await E.stopRapidReadingPreparation();
});

test('shutdown waits for a cold item read and prevents cache work or another database read after closing begins',async()=>{
 const {E,Zotero,state,calls,shutdown}=fixture(),gate=deferred(),item=await Zotero.Items.getAsync(13);let reads=0,writes=0,finished=false;Zotero.getMainWindow=()=>null;Zotero.Items.getAsync=async()=>{reads++;return gate.promise;};E.store.update=async()=>{writes++;};
 const preparing=E.prepareReaderRapidReading(13,{generate:false}).catch(error=>error);await tick();Zotero.closing=true;const closing=shutdown[0]().then(()=>{finished=true;});await tick();assert.equal(finished,false,'the real shutdown listener includes work that has not entered a shared job yet');gate.resolve(item);assert.match((await preparing).message,/已停止/);await closing;
 assert.equal(finished,true);assert.equal(reads,1);assert.equal(calls.sources,0);assert.equal(calls.index,0);assert.equal(calls.model.length,0);assert.equal(writes,0);assert.deepEqual(state,{});await assert.rejects(E.prepareReaderRapidReading(13),/已停止/);E.queueReaderRapidReading(13);assert.equal(reads,1,'late preparation is rejected before touching Zotero.Items');
});

test('shutdown aborts an active windowless analysis and waits for its late completion without cache mutation or retries',async()=>{
 const {E,Zotero,state,calls,shutdown,errors}=fixture(),gate=deferred(),entered=deferred(),request=E.studio.request;let signal,finished=false;Zotero.getMainWindow=()=>null;E.studio.request=async(...args)=>{signal=args[3];entered.resolve();await gate.promise;return request(...args);};
 const preparing=E.prepareReaderRapidReading(13,{background:true}).catch(error=>error);await entered.promise;const before=structuredClone(state);Zotero.closing=true;const closing=shutdown[0]().then(()=>{finished=true;});await tick();assert.equal(signal.aborted,true);assert.equal(finished,false);gate.resolve();assert.match((await preparing).message,/已停止/);await closing;
 assert.deepEqual(state,before);assert.equal(state.rapidReads,undefined);assert.equal(calls.model.length,1);assert.equal(errors.length,0);
});
