/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function fixture(){
 let signature='local-v1';const calls=[],paper={id:7,loadDataType:async()=>{},getField:name=>'paper-'+name},attachment={id:13,parentItemID:7,loadDataType:async()=>{},getFilePathAsync:async()=>'fixture.pdf'};
 const E={library:{uri:(_item,page)=>'source:'+page},runArtifactEngine:async request=>{calls.push(request);return {pdfHash:signature,assets:[{id:signature,kind:'figure',pageIndex:0,evidenceEligible:true}]};}},Zotero={Research:E,getMainWindow:()=>({AbortController}),Items:{getAsync:async id=>id===7?paper:attachment},logError(){}};
 vm.runInNewContext(fs.readFileSync(new URL('../../chrome/content/zotero/xpcom/research/assets.js',import.meta.url),'utf8'),{Zotero,ChromeUtils:{importESModule:()=>({})}});
 E.assets.fileSignature=async()=>signature;
 return {E,calls,changeFile:()=>{signature='local-v2';}};
}

test('toolbar, images and rapid reading reuse one completed extraction for an unchanged local file',async()=>{
 const f=fixture(),first=await f.E.assets.index(13),second=await f.E.assets.index(13);assert.strictEqual(second,first);assert.equal(f.calls.length,1,'opening another reading surface must not spawn another artifact process');
 assert.equal(first.assets[0].paperItemID,7);assert.equal(first.assets[0].uri,'source:0');f.changeFile();const changed=await f.E.assets.index(13);assert.equal(changed.pdfHash,'local-v2');assert.equal(f.calls.length,2);await f.E.assets.index(13,undefined,undefined,true);assert.equal(f.calls.length,3,'explicit extraction refresh remains available');
});

test('simultaneous first-open consumers share extraction and metadata enrichment rather than mutating the result repeatedly',async()=>{
 const f=fixture(),gate=deferred();f.E.runArtifactEngine=async request=>{f.calls.push(request);await gate.promise;return {pdfHash:'file',assets:[{id:'figure',pageIndex:0}]};};
 const a=f.E.assets.index(13),b=f.E.assets.index(13);await tick();assert.equal(f.calls.length,1);gate.resolve();const [left,right]=await Promise.all([a,b]);assert.strictEqual(left,right);assert.strictEqual(f.E.assets.active.get(13),left);
});

test('late older extraction cannot replace a newer file or an explicitly refreshed index',async()=>{
 const f=fixture(),old=deferred(),fresh=deferred();let n=0;f.E.runArtifactEngine=async()=>{const index=++n;await(index===1?old:fresh).promise;return {pdfHash:index===1?'old':'new',assets:[{id:'figure-'+index,pageIndex:0}]};};
 const first=f.E.assets.index(13);await tick();f.changeFile();const second=f.E.assets.index(13);await tick();fresh.resolve();await second;old.resolve();await first;
 assert.equal(f.E.assets.active.get(13).pdfHash,'new');assert.equal((await f.E.assets.index(13)).pdfHash,'new');assert.equal(n,2);
});

test('a cancelled extraction never becomes a reusable completed cache entry',async()=>{
 const f=fixture(),gate=deferred(),cancel=new AbortController();let n=0;f.E.runArtifactEngine=async()=>{n++;await gate.promise;return {pdfHash:'file',assets:[]};};const first=f.E.assets.index(13,undefined,cancel.signal);await tick();cancel.abort();await assert.rejects(first,{name:'AbortError'});gate.resolve();await tick();assert.equal(f.E.assets.active.has(13),false);await f.E.assets.index(13);assert.equal(n,2);
});

test('an intentional crop invalidates the completed index even though the original PDF signature stays unchanged',async()=>{
 const f=fixture();await f.E.assets.index(13);await f.E.assets.crop({attachmentID:13},[0,0,30,30]);await f.E.assets.index(13);assert.deepEqual(f.calls.map(row=>row.operation),['assets-index','assets-crop','assets-index']);
});
