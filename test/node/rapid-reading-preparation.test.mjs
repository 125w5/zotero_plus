/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {installRapidReading} from '../../chrome/content/zotero/research/shared/reader-rapid-reading.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function fixture(){
 const state={},calls={sources:0,index:0,model:[]},session={modelID:'deliberately-selected-model',thinkingLevel:'high'};
 let signature='pdf-v1',text='The paper reports three complementary scores with explicit conditions.';
 const paper={id:7,getField:name=>name==='title'?'Local evidence paper':'A. Author'},attachment={id:13,parentItem:paper,isPDFAttachment:()=>true,dateModified:'fixed'};
 const E={store:{get:(branch,key)=>branch?key===undefined?state[branch]:state[branch]?.[key]:state,update:async fn=>fn(state)},settings:()=>({endpoint:'https://configured.invalid/v1',model:'configured-default'}),core:{endpoint:value=>value.replace(/\/+$/u,'')},workbenchConversations:{getForScope:()=>session,getActive:()=>session},assets:{key:value=>JSON.stringify(value),fileSignature:async()=>signature,index:async()=>{calls.index++;return {pdfHash:signature,assets:[{id:'original-figure',path:'local-existing.png',label:'Figure 1'}]};}},library:{describe:()=>({id:13}),sources:async(_papers,_selection,options)=>{calls.sources++;assert.equal(options.rapidReading,true);return {sources:[{id:'page-1',attachmentID:13,pageIndex:0,label:'Page 1',text}],warnings:[]};}},studio:{request:async(_system,input,_status,signal,options)=>{calls.model.push({input,options,signal});return {value:{sections:[{role:'method',heading:'Original evidence',points:[{text:'A controlled explanation.',quoteIDs:[input.evidenceExcerpts[0].quoteID]}]}]},model:options.modelConfig.model,at:'controlled'};}},setTimeout,clearTimeout};
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

test('cache follows selected model, thinking, endpoint and PDF changes while reusing unchanged local sources',async()=>{
 const f=fixture(),{E,calls,session}=f;await E.prepareReaderRapidReading(13);await E.prepareReaderRapidReading(13);assert.equal(calls.model.length,1);
 session.modelID='another-selected-model';await E.prepareReaderRapidReading(13);session.thinkingLevel='off';await E.prepareReaderRapidReading(13);E.settings=()=>({endpoint:'https://another.invalid/v1',model:'configured-default'});await E.prepareReaderRapidReading(13);
 assert.equal(calls.model.length,4);assert.equal(calls.sources,1);assert.equal(calls.index,1);f.changePDF();const changed=await E.prepareReaderRapidReading(13);assert.equal(calls.model.length,5);assert.equal(calls.sources,2);assert.equal(calls.index,2);assert.equal(changed.record.pdfHash,'pdf-v2');E.stopRapidReadingPreparation();
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
