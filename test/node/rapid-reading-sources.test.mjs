/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function fixture(){
 const pages=Array.from({length:74},(_,pageIndex)=>({pageIndex,text:'START '+ 'Actual contiguous PDF page evidence. '.repeat(100)+' END'})),calls=[];
 const pdf={id:13,key:'LOCALPDF',libraryID:1,parentID:7,isPDFAttachment:()=>true,isAttachment:()=>true,getAnnotations:()=>[],getFilePathAsync:async()=>'/scoped/local-paper.pdf',getField:()=>''};
 const E={core:{paperKey:()=> 'local-paper'},store:{get:()=>({})},runArtifactEngine:async(request,_status,signal)=>{calls.push({request,signal});return {pages,pdfHash:'real-local-hash'};}};
 const Zotero={Items:{getAsync:async()=>pdf},Libraries:{get:()=>({libraryType:'user'})},PDFWorker:{getFullText:async()=>({text:'Original fallback full text with actual attachment evidence.'})}};
 vm.runInNewContext(fs.readFileSync(new URL('../../chrome/content/zotero/xpcom/research/zotero.js',import.meta.url),'utf8'),{EasySch:E,Zotero,IOUtils:{exists:async()=>true}});
 return {E,pages,calls,Zotero};
}

test('rapid source option reads complete exact page text while ordinary source collection retains its existing budget',async()=>{
 const {E,pages,calls}=fixture(),paper={id:13,title:'Local paper'},signal=new AbortController().signal;
 const rapid=await E.library.sources([paper],undefined,{rapidReading:true,signal});assert.equal(rapid.sources.length,74);for(const source of rapid.sources){assert.equal(source.text,pages[source.pageIndex].text);assert.equal(source.attachmentID,13);assert.equal(source.paperItemID,7);assert.ok(source.uri.endsWith('?page='+(source.pageIndex+1)));}assert.equal(calls[0].request.operation,'assets-text');assert.equal(calls[0].signal,signal);
 const ordinary=await E.library.sources([paper]);assert.equal(ordinary.sources.length,75,'metadata and the original 74-page collection remain available');assert.ok(ordinary.sources.filter(source=>source.attachmentID).every(source=>source.text.length===810),'the new option leaves ordinary callers unchanged');
});

test('rapid extraction fallback keeps the real attachment anchor without inventing page coordinates',async()=>{
 const {E}=fixture();E.runArtifactEngine=async()=>{throw Error('Controlled extraction unavailable');};const rapid=await E.library.sources([{id:13,title:'Local paper'}],undefined,{rapidReading:true});assert.equal(rapid.sources.length,1);assert.equal(rapid.sources[0].pageIndex,undefined);assert.equal(rapid.sources[0].position,undefined);assert.equal(rapid.sources[0].attachmentID,13);assert.equal(rapid.sources[0].uri,'zotero://open-pdf/library/items/LOCALPDF');assert.ok(rapid.warnings.length);
});

test('rapid page collection stops before extraction when cancelled',async()=>{
 const {E,calls}=fixture(),controller=new AbortController();controller.abort();await assert.rejects(E.library.sources([{id:13,title:'Local paper'}],undefined,{rapidReading:true,signal:controller.signal}),/已停止/);assert.equal(calls.length,0);
});
