/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createReaderPreparationQueue} from '../../chrome/content/zotero/research/shared/reader-preparation.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const identify=async id=>({id,key:String(id)});

test('an open tab and a pane share preparation, and leaving the pane does not abort the tab',async()=>{
 const gate=deferred(),calls=[],states=[],queue=createReaderPreparationQueue({identify,onState:state=>states.push(state),prepare:async(item,{signal,status})=>{calls.push({item,signal});status('正在预备真实图表');await gate.promise;return {record:{text:'Saved complete reading'}};}}),tab=new AbortController(),pane=new AbortController();
 const opened=queue.acquire(13,{signal:tab.signal}),visible=queue.acquire(13,{signal:pane.signal});await tick();assert.equal(calls.length,1);pane.abort();await assert.rejects(visible,{name:'AbortError'});assert.equal(calls[0].signal.aborted,false);gate.resolve();assert.deepEqual(await opened,{record:{text:'Saved complete reading'}});assert.equal(states.at(-1).status,'ready');
 const again=await queue.acquire(13);assert.equal(again.record.text,'Saved complete reading');assert.equal(calls.length,1,'already prepared paper is available immediately');await queue.stop();
});

test('closing the last consumer aborts the real preparation signal and never retains its late result',async()=>{
 const entered=deferred(),gate=deferred();let actualSignal,calls=0;const queue=createReaderPreparationQueue({identify,prepare:async(_item,{signal})=>{calls++;actualSignal=signal;entered.resolve();await gate.promise;return {record:{text:'Late result'}};}}),closed=new AbortController(),work=queue.acquire(13,{signal:closed.signal});await entered.promise;closed.abort();await assert.rejects(work,{name:'AbortError'});assert.equal(actualSignal.aborted,true);gate.resolve();await tick();assert.equal(queue.snapshot().cached,0);assert.equal(queue.state(13).status,'cancelled');await queue.acquire(13);assert.equal(calls,2,'cancelled results never masquerade as cached readiness');await queue.stop();
});

test('only one paper prepares at a time, newly opened papers precede queued imports, and cancelled queued papers never start',async()=>{
 const gates=new Map([[1,deferred()],[2,deferred()],[3,deferred()],[4,deferred()]]),order=[];let active=0,maxActive=0;const queue=createReaderPreparationQueue({identify,prepare:async item=>{order.push(item.id);active++;maxActive=Math.max(maxActive,active);await gates.get(item.id).promise;active--;return {id:item.id};}}),cancelled=new AbortController();
 const a=queue.acquire(1),b=queue.acquire(2),c=queue.acquire(3,{priority:true}),d=queue.acquire(4,{signal:cancelled.signal});await tick();cancelled.abort();await assert.rejects(d,{name:'AbortError'});assert.deepEqual(order,[1]);gates.get(1).resolve();await a;await tick();assert.deepEqual(order,[1,3]);gates.get(3).resolve();await c;await tick();assert.deepEqual(order,[1,3,2]);gates.get(2).resolve();await b;assert.equal(maxActive,1);await queue.stop();
});

test('shutdown includes identity resolution and aborts work before it can populate the prepared cache',async()=>{
 const identity=deferred();let calls=0,finished=false;const queue=createReaderPreparationQueue({identify:()=>identity.promise,prepare:async()=>{calls++;return {};}}),work=queue.acquire(13);await tick();const stopping=queue.stop().then(()=>{finished=true;});await tick();assert.equal(finished,false);identity.resolve({id:13,key:'13'});await assert.rejects(work,{name:'AbortError'});await stopping;assert.equal(calls,0);assert.equal(queue.snapshot().cached,0);await assert.rejects(queue.acquire(13),{name:'AbortError'});
});

function adapterFixture(state={}){
 const calls={imageRequests:0,imageGenerations:0,readingRequests:0,readingGenerations:0,writes:0,imageChanges:[]},errors=[],shutdown=[],observers=new Map();let signature='same-local-file';
 const E={assets:{key:JSON.stringify,fileSignature:async()=>signature,imageState:id=>state.imageIngestion?.[id],queueImages:async(id,_status,{signal,changed})=>{assert.equal(signal.aborted,false);calls.imageRequests++;calls.imageChanges.push(changed);if(state.imageIngestion?.[id]?.fileSignature===signature&&state.imageIngestion[id].status==='complete')return state.imageIngestion[id];calls.imageGenerations++;state.imageIngestion||={};state.imageIngestion[id]={status:'complete',fileSignature:signature,total:2,completed:2};return state.imageIngestion[id];}},store:{get:(branch,key)=>state[branch]?.[key],update:async fn=>{calls.writes++;return fn(state);}},prepareReaderRapidReading:async(id,{signal,background,fresh,generate})=>{assert.equal(signal.aborted,false);assert.equal(background,!fresh);calls.readingRequests++;state.savedReadings||={};if(fresh||!state.savedReadings[id]){calls.readingGenerations++;state.savedReadings[id]={record:{text:'Complete saved detail',manual:true},generate};}return state.savedReadings[id];}};
 const Zotero={Research:E,closing:false,test:false,Items:{getAsync:async id=>({id,isPDFAttachment:()=>true})},Notifier:{registerObserver:observer=>{observers.set(1,observer);return 1;},unregisterObserver:id=>observers.delete(id)},addShutdownListener:fn=>shutdown.push(fn),logError:error=>errors.push(error)};
 vm.runInNewContext(fs.readFileSync(new URL('../../chrome/content/zotero/xpcom/research/reader-preparation.js',import.meta.url),'utf8'),{Zotero,Components:{utils:{Sandbox:function(){return {AbortController};}}},Services:{scriptSecurityManager:{getSystemPrincipal:()=>({})}},ChromeUtils:{importESModule:()=>({createReaderPreparationQueue})}});
 return {E,Zotero,state,calls,errors,shutdown,observers,changeFile:()=>{signature='replaced-local-file';}};
}

test('a second application adapter reuses durable reading and image records without generating them again',async()=>{
 const state={},first=adapterFixture(state);const prepared=await first.E.prepareReaderPaper(13);assert.equal(prepared.record.manual,true);assert.equal(first.calls.imageGenerations,1);assert.equal(first.calls.readingGenerations,1);await first.E.stopReaderPreparation();
 const reopened=adapterFixture(state),again=await reopened.E.prepareReaderPaper(13);assert.equal(again.record.text,'Complete saved detail');assert.equal(reopened.calls.imageGenerations,0);assert.equal(reopened.calls.readingGenerations,0,'restarting the orchestration layer does not discard stored content');assert.equal(state.readerPreparations[13].readingStatus,'ready');await reopened.E.stopReaderPreparation();
});

test('opening an unchanged ready paper after a restart causes no workspace writes or dirty image queue',async()=>{
 const state={},first=adapterFixture(state);await first.E.prepareReaderPaper(13);const writes=first.calls.writes;assert.ok(writes>0);await first.E.prepareReaderPaper(13);assert.equal(first.calls.writes,writes,'ready state must not be rewritten merely to change updatedAt');await first.E.stopReaderPreparation();
 const restarted=adapterFixture(state);await restarted.E.prepareReaderPaper(13);assert.equal(restarted.calls.writes,0);assert.deepEqual(restarted.calls.imageChanges,[],'unchanged complete images bypass other papers\' queued model work');assert.equal(restarted.calls.imageGenerations,0);assert.equal(restarted.calls.readingGenerations,0);
 restarted.changeFile();await restarted.E.prepareReaderPaper(13);assert.ok(restarted.calls.writes>0,'a replaced source still persists the changed preparation state');assert.equal(restarted.calls.imageChanges.at(-1),true);await restarted.E.stopReaderPreparation();
});

test('paper preparation only shares inflight work and immediately observes directly refreshed durable content',async()=>{
 const f=adapterFixture();const first=await f.E.prepareReaderPaper(13);assert.equal(first.record.text,'Complete saved detail');f.state.savedReadings[13]={record:{text:'Directly refreshed durable reading'}};
 const second=await f.E.prepareReaderPaper(13);assert.equal(second.record.text,'Directly refreshed durable reading');assert.equal(f.calls.readingRequests,2);assert.equal(f.calls.readingGenerations,1,'rechecking durable content does not spend another model request');assert.equal(f.calls.imageGenerations,1);await f.E.stopReaderPreparation();
});

test('a previously failed image service is an explicit retry, while its failure cannot swallow the saved complete reading',async()=>{
 const state={readerPreparations:{13:{signature:'same-local-file',imagesStatus:'partial',imagesError:'Controlled image service unavailable'}},imageIngestion:{13:{status:'partial',error:'Controlled image service unavailable'}}},f=adapterFixture(state);const ready=await f.E.prepareReaderPaper(13);assert.ok(ready.record);assert.equal(f.calls.imageRequests,0);assert.equal(ready.preparationWarnings.length,1);assert.equal(f.E.readerPreparationState(13).status,'partial');
 await f.E.prepareReaderPaper(13,{fresh:true});assert.equal(f.calls.imageRequests,1,'user refresh explicitly retries the failed stage');await f.E.stopReaderPreparation();
});

test('closing a reader tab cancels only its warm lease, while an active pane keeps the shared job alive',async()=>{
 const f=adapterFixture(),gate=deferred(),entered=deferred();let actualSignal;f.E.assets.queueImages=async(_id,_status,{signal})=>{actualSignal=signal;entered.resolve();await gate.promise;return {status:'complete'};};f.E.startReaderPreparation();const reader={itemID:13,tabID:'real-tab-13'},warm=f.E.queueReaderPreparation(reader),pane=f.E.prepareReaderPaper(13);await entered.promise;f.observers.get(1).notify('close','tab',[['real-tab-13']]);assert.equal(actualSignal.aborted,false);gate.resolve();assert.ok((await pane).record);await warm;assert.equal(f.errors.length,0);await f.E.stopReaderPreparation();
});

test('the image-only pane preparation does not wait for a reading and stops its real work on shutdown',async()=>{
 const f=adapterFixture(),entered=deferred();let actualSignal;f.E.assets.queueImages=async(_id,_status,{signal})=>{actualSignal=signal;entered.resolve();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('Stopped actual image request'),{name:'AbortError'})),{once:true}));};
 const images=f.E.prepareReaderEvidence(13);await entered.promise;const closing=f.E.stopReaderPreparation();await assert.rejects(images,{name:'AbortError'});await closing;assert.equal(actualSignal.aborted,true);assert.equal(f.calls.readingRequests,0);assert.equal(f.state.readerPreparations,undefined,'cancelled work cannot persist a failed content record');
});

test('native automatic preparation only warms local sources unless the fixture explicitly permits model requests',async()=>{
 const f=adapterFixture();f.Zotero.test=true;f.Zotero.Prefs={get:()=>false};let seen;f.E.prepareReaderRapidReading=async(_id,options)=>{seen=options;return {sources:[{text:'Actual local page'}]};};
 await f.E.queueReaderPreparation({itemID:13,tabID:'isolated-native-tab'});assert.equal(seen.generate,false);assert.equal(seen.background,true);assert.equal(f.calls.imageRequests,0);assert.equal(f.E.readerPreparationState(13),undefined,'a local-only warmup cannot be cached as a completed model reading');await f.E.stopReaderPreparation();
});

test('automatic toolbar preparation yields until the first-paint delay and closing it cancels before source work',async()=>{
 const f=adapterFixture(),timers=new Map();let serial=0;f.E.setTimeout=(callback,delay)=>{assert.equal(delay,180);timers.set(++serial,callback);return serial;};f.E.clearTimeout=id=>timers.delete(id);
 f.E.startReaderPreparation();const reader={itemID:13,tabID:'deferred-reader'},work=f.E.queueReaderPreparation(reader);await tick();assert.equal(f.calls.imageRequests,0);assert.equal(f.calls.readingRequests,0);assert.equal(timers.size,1);
 f.observers.get(1).notify('close','tab',[['deferred-reader']]);await work;assert.equal(timers.size,0);assert.equal(f.calls.imageRequests,0);assert.equal(f.calls.readingRequests,0);assert.equal(f.errors.length,0);await f.E.stopReaderPreparation();
});

test('startup warms only the selected restored PDF and switching tabs starts the other paper once',async()=>{
 const f=adapterFixture(),window={Zotero_Tabs:{selectedID:'shown'},addEventListener(){},removeEventListener(){}},shown={itemID:13,type:'pdf',tabID:'shown',_window:window},hidden={itemID:14,type:'pdf',tabID:'hidden',_window:window};f.Zotero.Reader={_readers:[shown,hidden]};
 f.E.startReaderPreparation();await tick();await tick();assert.ok(f.state.savedReadings[13]);assert.equal(f.state.savedReadings[14],undefined,'restoring a background tab does not extract or generate its paper');
 window.Zotero_Tabs.selectedID='hidden';f.observers.get(1).notify('select','tab',['hidden']);await tick();await tick();assert.ok(f.state.savedReadings[14]);assert.equal(f.calls.readingGenerations,2);await f.E.stopReaderPreparation();
});

test('complete evidence is immediately reusable even while the image worker belongs to another paper',async()=>{
 const f=adapterFixture({imageIngestion:{13:{status:'complete',fileSignature:'same-local-file',total:5}}});f.E.assets.queueImages=()=>{throw Error('a cache hit must not enter the busy global image queue');};
 const result=await f.E.prepareReaderEvidence(13);assert.equal(result.total,5);assert.equal(f.calls.writes,0);await f.E.stopReaderPreparation();
});

test('reader progress is closed for success, provider failure and cancellation, so no running progress remains',async()=>{
 for(const outcome of ['ready','failed','cancelled']){
  const f=adapterFixture(),active=new Set(),closed=[],entered=deferred();f.E.taskProgress={begin:()=>{const token={update(){},close:value=>{active.delete(token);closed.push(value);}};active.add(token);return token;}};
  if(outcome==='failed')f.E.prepareReaderRapidReading=async()=>{throw Error('Controlled model failure');};
  if(outcome==='cancelled')f.E.assets.queueImages=async(_id,_status,{signal})=>{entered.resolve();await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('Stopped'),{name:'AbortError'})),{once:true}));};
  const signal=new AbortController(),work=f.E.prepareReaderPaper(13,{signal:signal.signal});
  if(outcome==='cancelled'){await entered.promise;signal.abort();await assert.rejects(work,{name:'AbortError'});await tick();}else if(outcome==='failed')await assert.rejects(work,/Controlled model failure/);else await work;
  await f.E.stopReaderPreparation();assert.equal(active.size,0,outcome+' must not leave a stale loading task');assert.equal(closed.length,1);assert.equal(!!closed[0].cancelled,outcome==='cancelled');assert.equal(!!closed[0].error,outcome!=='ready');
 }
});

test('repeated automatic attachment warmups do not re-enter source/model pipelines for a durably ready file',async()=>{
 const f=adapterFixture();await f.E.prepareReaderPaper(13);const requests={...f.calls};
 for(let n=0;n<8;n++)assert.equal((await f.E.queueReaderPreparation(13,{origin:'import'})).cacheHit,true);
 assert.equal(f.calls.imageRequests,requests.imageRequests);assert.equal(f.calls.readingRequests,requests.readingRequests);assert.equal(f.calls.writes,requests.writes);
 f.changeFile();await f.E.queueReaderPreparation(13,{origin:'import'});assert.equal(f.calls.readingRequests,requests.readingRequests+1,'a changed PDF is prepared normally');await f.E.stopReaderPreparation();
});
