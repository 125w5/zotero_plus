/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {readDiscoveryPDF,installDiscoveryPDF,verifiedDiscoveryRecords,PDF_PROBE_TIMEOUT,PDF_TRANSIENT_RETRY,PDF_CHECK_VERSION} from '../../chrome/content/zotero/research/shared/discovery-pdf.mjs';
import {createDiscoverySearchRunner} from '../../chrome/content/zotero/research/shared/discovery-search-task.mjs';
import * as Feed from '../../chrome/content/zotero/research/shared/discovery-feed.mjs';
import * as References from '../../chrome/content/zotero/research/shared/reference-matcher.mjs';
import * as WorkspaceOutputs from '../../chrome/content/zotero/research/shared/workspace-outputs.mjs';

const pdf=new TextEncoder().encode('%PDF-1.7\n'+'actual controlled PDF bytes '.repeat(100));
const response=(bytes=pdf,{type='application/pdf',status=200,onCancel=()=>{}}={})=>({ok:status>=200&&status<300,status,headers:{get:name=>name==='content-type'?type:''},body:new ReadableStream({start(controller){controller.enqueue(bytes.subarray(0,1024));controller.enqueue(bytes.subarray(1024));},cancel:onCancel})});
function storeFixture(state={}){const reads=[];return {state,reads,store:{get(...path){reads.push(path);let value=state;for(const key of path)value=value?.[key];return value&&structuredClone(value);},update:async fn=>fn(state),replaceBranch:async(key,value)=>{state[key]=structuredClone(value);}}};}

test('PDF checks inspect real bytes and cancel the remaining stream before downloading the full file',async()=>{
 let cancelled=0;const result=await readDiscoveryPDF(response(pdf,{onCancel:()=>cancelled++}),{probe:true});assert.equal(result.bytesChecked,1024);assert.equal(cancelled,1);
 const bytes=await readDiscoveryPDF({ok:true,status:200,headers:{get:()=>''},arrayBuffer:async()=>pdf.buffer});assert.deepEqual(bytes,pdf);
 await assert.rejects(readDiscoveryPDF(response(new TextEncoder().encode('<html>Access denied</html>'),{type:'text/html'}),{probe:true}),/网页/);
 await assert.rejects(readDiscoveryPDF(response(new Uint8Array(1100),{type:'application/pdf'}),{probe:true}),/非 PDF/);
});

test('a stalled PDF stream is cancelled at the transport deadline and cannot hold the next download',async()=>{
 let cancelled=0;const E={};installDiscoveryPDF(E,{fetch:async()=>({ok:true,status:200,headers:{get:()=>''},body:new ReadableStream({cancel:()=>cancelled++})})});
 await assert.rejects(E.requestDiscoveryPDF('https://repository.example/a.pdf',{timeout:15}),error=>error.name==='TimeoutError');assert.equal(cancelled,1);
});

test('a cold PDF connection responding after eight seconds remains available within the twelve-second probe budget',async()=>{
 const timers=new Map();let serial=0;const later=(fn,delay)=>{const id=++serial;timers.set(id,{fn,delay});return id;},E={};
 installDiscoveryPDF(E,{setTimeout:later,clearTimeout:id=>timers.delete(id),fetch:()=>new Promise(resolve=>later(()=>resolve(response()),9000))});
 const pending=E.verifyDiscoveryPDF('https://repository.example/cold.pdf');assert.equal(PDF_PROBE_TIMEOUT,12000);assert.ok([...timers.values()].some(row=>row.delay===12000));
 const responseTimer=[...timers.entries()].find(([,row])=>row.delay===9000);timers.delete(responseTimer[0]);responseTimer[1].fn();
 assert.equal((await pending).available,true);assert.equal(timers.size,0,'completed prefix reads cancel the remaining deadline timer');
});

test('a transient PDF timeout expires quickly instead of hiding a recoverable source for ten minutes',async()=>{
 const f=storeFixture({discoveryPDFChecks:{'https://repository.example/retry.pdf':{available:false,transient:true,error:'请求超时',checkedAt:Date.now()-PDF_TRANSIENT_RETRY-1,version:PDF_CHECK_VERSION}}});let calls=0;const E={store:f.store};
 installDiscoveryPDF(E,{fetch:async()=>{calls++;return response();}});assert.equal((await E.verifyDiscoveryPDF('https://repository.example/retry.pdf')).available,true);assert.equal(calls,1);assert.equal(PDF_TRANSIENT_RETRY,15000);
});

test('concurrent panes share one PDF probe and a negative result has an explicit refresh path',async()=>{
 const f=storeFixture();let calls=0,available=false;const E={store:f.store};installDiscoveryPDF(E,{fetch:async()=>{calls++;return available?response():response(pdf,{type:'text/html'});}});
 const [first,second]=await Promise.all([E.verifyDiscoveryPDF('https://repository.example/a.pdf'),E.verifyDiscoveryPDF('https://repository.example/a.pdf')]);assert.equal(first.available,false);assert.equal(second.available,false);assert.equal(calls,1);
 await E.verifyDiscoveryPDF('https://repository.example/a.pdf');assert.equal(calls,1);available=true;assert.equal((await E.verifyDiscoveryPDF('https://repository.example/a.pdf',{refresh:true})).available,true);assert.equal(calls,2);
 await E.flushDiscoveryPDFChecks();let reopenedCalls=0;const reopened={store:f.store};installDiscoveryPDF(reopened,{fetch:()=>{reopenedCalls++;throw Error('cached checks must survive app restart');}});assert.equal((await reopened.verifyDiscoveryPDF('https://repository.example/a.pdf')).available,true);assert.equal(reopenedCalls,0);
});

test('an inaccessible publisher PDF falls back to a verified repository location, with bounded concurrency',async()=>{
 let active=0,peak=0;const E={verifyDiscoveryPDF:async url=>{active++;peak=Math.max(active,peak);await new Promise(resolve=>setTimeout(resolve,2));active--;return{available:url.includes('/repository/'),error:'HTTP 403',checkedAt:1};}};
 const rows=Array.from({length:18},(_,id)=>({id,title:'Paper '+id,pdf:'https://source.example/denied/'+id,pdfCandidates:['https://source.example/repository/'+id]})),result=await verifiedDiscoveryRecords(E,rows);
 assert.equal(result.records.length,18);assert.equal(peak,6);assert.ok(result.records.every(row=>row.pdfVerified&&row.pdf.includes('/repository/')));
});

test('the service deadline preserves verified partial results and discards late progress',async()=>{
 const progress=[],run=createDiscoverySearchRunner();let publish,inner;
 const result=await run((signal,onProgress)=>{inner=signal;publish=onProgress;onProgress({records:[{id:'verified'}],provider:'openalex',nextPage:1,nextCursor:'same-page',hasMore:true});return new Promise(()=>{});},{timeout:15,onProgress:value=>progress.push(value)});
 assert.equal(inner.aborted,true);assert.equal(result.records[0].id,'verified');assert.equal(result.nextCursor,'same-page','unfinished current batch stays retryable');assert.match(result.error,/时间上限/);publish({records:[{id:'late'}]});assert.equal(progress.length,1);
});

test('public preparation search has its own overall deadline even without the discovery UI',async()=>{
 const f=storeFixture(),E={store:f.store,setTimeout,clearTimeout,createProviderController:()=>new AbortController(),requestProvider:()=>new Promise(()=>{}),library:{},manuscripts:{}},Zotero={Research:E,getMainWindow:()=>({AbortController}),addShutdownListener(){}};
 const modules={'discovery-feed.mjs':Feed,'reference-matcher.mjs':References,'workspace-outputs.mjs':WorkspaceOutputs};
 vm.runInNewContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/discovery.js',import.meta.url),'utf8'),{Zotero,ChromeUtils:{importESModule:url=>modules[url.split('/').at(-1)]||{}},globalThis:{}});
 await assert.rejects(E.searchPaperPage('psychology',{timeout:15}),error=>error.name==='TimeoutError');
});

test('a large feed reads small state branches once per batch and excludes invalid bytes from candidates',async()=>{
 const f=storeFixture({journalMetricSnapshots:{}}),E={store:f.store,fetchDiscoveryPDF:async url=>response(pdf,{type:url.includes('blocked')?'text/html':'application/pdf'}),requestProvider:async()=>JSON.stringify({results:Array.from({length:40},(_,id)=>({id:'https://openalex.org/W'+id,title:'Psychology evidence '+id,best_oa_location:{is_oa:true,pdf_url:'https://repository.example/'+(id===0?'blocked':id)+'.pdf'}})),meta:{count:40,next_cursor:null}})},Zotero={getMainWindow:()=>({AbortController}),addShutdownListener(){}};
 Feed.installDiscoveryFeed(E,{Zotero});const result=await E.recommendationFeed({mode:'latest',query:'psychology',limit:40});assert.equal(result.records.length,39);assert.ok(result.records.every(row=>row.pdfVerified));assert.equal(f.reads.filter(path=>!path.length).length,0,'does not clone manuscripts, reader caches or corpus state');assert.equal(f.reads.filter(path=>path[0]==='journalMetricSnapshots').length,1);
});
