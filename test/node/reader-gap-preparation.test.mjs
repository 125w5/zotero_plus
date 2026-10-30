/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let {createReaderPreparationQueue}=await import(new URL('../../chrome/content/zotero/research/shared/reader-preparation.mjs',import.meta.url));
let tick=()=>new Promise(resolve=>setImmediate(resolve));
let deferred=()=>{let resolve,reject;let promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

// Paper 1 is mid-preparation behind a gate. Paper 2 was prepared earlier:
// its signature, reading status and image state are all durable and current.
function fixture(){
 let gate=deferred(),calls=[],writes=[];
 let state={readerPreparations:{2:{signature:'sig-2',imagesStatus:'complete',readingStatus:'ready'}},imageIngestion:{2:{status:'complete',fileSignature:'sig-2'}},savedReadings:{2:{record:{text:'Saved reading of paper 2'}}}};
 let E={
  assets:{key:JSON.stringify,fileSignature:async id=>'sig-'+id,imageState:id=>state.imageIngestion[id],
   queueImages:async(id,_status,{signal})=>{calls.push('images:'+id);if(id===1)await gate.promise;if(signal.aborted)throw Object.assign(Error('stopped'),{name:'AbortError'});state.imageIngestion[id]={status:'complete',fileSignature:'sig-'+id};return state.imageIngestion[id];}},
  store:{get:(branch,key)=>state[branch]?.[key],update:async fn=>{writes.push(1);return fn(state);}},
  prepareReaderRapidReading:async(id,{signal,generate})=>{calls.push('reading:'+id+(generate?':generate':''));if(id===1)await gate.promise;if(signal?.aborted)throw Object.assign(Error('stopped'),{name:'AbortError'});state.savedReadings[id]||={record:{text:'Generated reading of paper '+id}};return state.savedReadings[id];}
 };
 let Zotero={Research:E,closing:false,test:false,Items:{getAsync:async id=>({id,isPDFAttachment:()=>true})},Notifier:{registerObserver:()=>1,unregisterObserver(){}},addShutdownListener(){},logError(){},Prefs:{get:()=>true}};
 vm.runInNewContext(fs.readFileSync(new URL('../../chrome/content/zotero/xpcom/research/reader-preparation.js',import.meta.url),'utf8'),{Zotero,Components:{utils:{Sandbox:function(){return {AbortController};}}},Services:{scriptSecurityManager:{getSystemPrincipal:()=>({})}},ChromeUtils:{importESModule:()=>({createReaderPreparationQueue})}});
 return {E,state,calls,writes,gate};
}

test('速读 on a durably ready paper restores at once while another paper is still being prepared',async()=>{
 let f=fixture(),first=f.E.prepareReaderPaper(1,{priority:true});await tick();await tick();
 assert.equal(f.E.readerPreparationState(1)?.status,'running');
 let statuses=[],done=false,second=f.E.prepareReaderPaper(2,{fresh:false,priority:true,status:text=>statuses.push(text)}).then(value=>{done=true;return value;});
 for(let i=0;i<10&&!done;i++)await tick();
 assert.equal(done,true,'a ready paper must not wait for the other paper to finish');
 assert.ok(!statuses.includes('论文阅读准备已排队'),'the panel never shows the queued notice for a ready paper');
 let value=await second;assert.equal(value.record.text,'Saved reading of paper 2');assert.equal(value.preparationWarnings.length,0);assert.equal(value.imageState.status,'complete');
 assert.ok(f.calls.includes('reading:2:generate'));assert.ok(!f.calls.includes('images:2'),'the restore does not enter the image queue');
 f.gate.resolve();assert.equal((await first).record.text,'Generated reading of paper 1');await f.E.stopReaderPreparation();
});

test('explicit refresh and papers without a durable reading still go through the single bounded worker',async()=>{
 let f=fixture(),first=f.E.prepareReaderPaper(1);await tick();await tick();
 let refreshed=f.E.prepareReaderPaper(2,{fresh:true}),cold=f.E.prepareReaderPaper(3);for(let i=0;i<10;i++)await tick();
 assert.ok(!f.calls.includes('reading:2:generate'),'an explicit refresh waits for the running paper');assert.ok(!f.calls.includes('reading:3:generate'),'an unprepared paper waits for the running paper');
 assert.equal(f.E.readerPreparationState(3)?.status,'queued');
 f.gate.resolve();await first;assert.ok((await refreshed).record);assert.ok((await cold).record);assert.equal(f.state.readerPreparations[3].readingStatus,'ready');await f.E.stopReaderPreparation();
});

test('a failed direct restore is recorded instead of leaving the paper marked ready',async()=>{
 let f=fixture();f.E.prepareReaderRapidReading=async()=>({error:'Controlled reading failure'});
 await assert.rejects(f.E.prepareReaderPaper(2),/Controlled reading failure/);
 assert.equal(f.state.readerPreparations[2].readingStatus,'failed');assert.equal(f.state.readerPreparations[2].readingError,'Controlled reading failure');await f.E.stopReaderPreparation();
 let g=fixture();g.E.prepareReaderRapidReading=async()=>{throw Error('Controlled thrown failure');};
 await assert.rejects(g.E.prepareReaderPaper(2),/Controlled thrown failure/);assert.equal(g.state.readerPreparations[2].readingStatus,'failed','a thrown reading error is recorded like the queued path');await g.E.stopReaderPreparation();
});

test('shutdown aborts and waits for a direct restore',async()=>{
 let f=fixture(),entered=deferred(),seen;f.E.prepareReaderRapidReading=async(_id,{signal})=>{seen=signal;entered.resolve();await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('stopped'),{name:'AbortError'})),{once:true}));};
 let work=f.E.prepareReaderPaper(2);await entered.promise;let writes=f.writes.length,stopped=f.E.stopReaderPreparation();
 await assert.rejects(work,{name:'AbortError'});await stopped;assert.equal(seen.aborted,true);assert.equal(f.writes.length,writes,'no state is written after shutdown began');
});
