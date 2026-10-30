/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as language from '../../chrome/content/zotero/research/shared/material-language.mjs';
import * as sections from '../../chrome/content/zotero/research/shared/article-section-materials.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(){
 const state={},errors=[],images=[],A={model:{}},E={manuscripts:A,assets:{key:JSON.stringify,queueImages:async id=>{images.push(id);}},store:{get:(...keys)=>keys.reduce((value,key)=>value?.[key],state),update:async fn=>fn(state)}};
 const scope=vm.createContext({Zotero:{Research:E,getMainWindow:()=>({AbortController}),logError:error=>errors.push(error)},ChromeUtils:{importESModule:path=>path.includes('material-language')?language:sections}});
 vm.runInContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/manuscript-index.js',import.meta.url),'utf8'),scope);return {A,E,Zotero:scope.Zotero,state,errors,images};
}
test('pre-cancelled imports never enqueue text, figure or translation jobs',async()=>{const f=await fixture(),controller=new AbortController();controller.abort();let calls=0;f.A.indexArticle=async()=>calls++;await assert.rejects(f.A.queueArticle(8,{signal:controller.signal}),/停止/);assert.equal(calls,0);assert.equal(f.images.length,0);});
test('cancelling a waiter does not stop the existing background import',async()=>{const f=await fixture();let finish,activeSignal,progress;f.A.indexArticle=(_id,status,signal)=>{activeSignal=signal;progress=status;return new Promise(resolve=>finish=resolve);};const background=f.A.queueArticle(8);await tick();const controller=new AbortController(),messages=[],waiting=f.A.queueArticle(8,{signal:controller.signal,status:text=>messages.push(text)});progress('真实章节进度');assert.deepEqual(messages,['真实章节进度']);controller.abort();await assert.rejects(waiting,/停止/);assert.equal(activeSignal.aborted,false);finish({count:5});assert.equal((await background).count,5);});
test('an owned active import forwards cancellation to source analysis immediately',async()=>{const f=await fixture(),controller=new AbortController();let innerSignal;f.A.indexArticle=(_id,_status,signal)=>{innerSignal=signal;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('原文处理中止'))));};const waiting=f.A.queueArticle(8,{signal:controller.signal});await tick();controller.abort();await assert.rejects(waiting,/停止/);assert.equal(innerSignal.aborted,true);});
test('cancelling a queued owned import stops the wait and does not restart it later',async()=>{const f=await fixture();let finish;const calls=[];f.A.indexArticle=id=>{calls.push(id);return id===8?new Promise(resolve=>finish=resolve):Promise.resolve();};const first=f.A.queueArticle(8);await tick();const controller=new AbortController(),second=f.A.queueArticle(9,{signal:controller.signal});controller.abort();await assert.rejects(second,/停止/);finish({count:1});await first;await tick();assert.deepEqual(calls,[8]);assert.equal(f.state.manuscriptIndex[9].status,'partial');});
test('explicit indexing failures propagate to the workflow and do not poison later imports',async()=>{const f=await fixture();f.A.indexArticle=async id=>{if(id===8)throw Error('附件解析失败');return {count:3};};await assert.rejects(f.A.queueArticle(8,{status:()=>{}}),/附件解析失败/);assert.equal((await f.A.queueArticle(9,{status:()=>{}})).count,3);});

test('attachment metadata notifications reuse finished content without queued state writes or model pipelines',async()=>{
 const f=await fixture();f.state.manuscriptIndex={8:{status:'complete',fileSignature:'same-pdf',assetIDs:['saved'],count:1}};f.E.assets.fileSignature=async()=>'same-pdf';let writes=0,indexes=0,translations=0;f.E.store.update=async fn=>{writes++;return fn(f.state);};f.A.indexArticle=async()=>{indexes++;};f.A.prepareTranslation=async()=>{translations++;};
 for(let n=0;n<6;n++)assert.equal((await f.A.queueArticle(8)).cacheHit,true);assert.equal(writes,0);assert.equal(indexes,0);assert.equal(translations,0);assert.equal(f.images.length,0);assert.equal(f.state.manuscriptIndex[8].status,'complete');
 f.E.assets.fileSignature=async()=>'changed-pdf';await f.A.queueArticle(8);assert.equal(indexes,1);assert.equal(translations,1);assert.equal(f.images.length,1);assert.ok(writes>0,'replaced source files still enter the real pipeline');
});

test('queued imports do not fan out extraction/translation, and the paper being read gets the next worker',async()=>{
 const f=await fixture(),order=[],translations=[],finish=new Map();f.A.prepareTranslation=async id=>{translations.push(id);};f.A.indexArticle=id=>{order.push(id);return new Promise(resolve=>finish.set(id,resolve));};
 const first=f.A.queueArticle(8),waiting=f.A.queueArticle(9),reading=f.A.queueArticle(10);await tick();assert.deepEqual(order,[8]);assert.deepEqual(f.images,[8]);assert.deepEqual(translations,[8],'queued papers have not started their independent local text workers');
 f.Zotero.Reader={_readers:[{itemID:10,tabID:'currently-read',_window:{Zotero_Tabs:{selectedID:'currently-read'}}}]};finish.get(8)({count:1});await first;await tick();assert.deepEqual(order,[8,10]);assert.deepEqual(f.images,[8,10]);
 finish.get(10)({count:1});await reading;await tick();assert.deepEqual(order,[8,10,9]);finish.get(9)({count:1});await waiting;assert.deepEqual(translations,[8,10,9]);
});

test('cancelling queued automatic material work removes it immediately and leaves no fake queued state',async()=>{
 const f=await fixture();let finish;const order=[];f.A.indexArticle=id=>{order.push(id);return id===8?new Promise(resolve=>finish=resolve):Promise.resolve();};
 const first=f.A.queueArticle(8),cancelled=f.A.queueArticle(9);await tick();f.A.cancelArticle(9);await cancelled;assert.equal(f.state.manuscriptIndex[9].status,'partial');assert.deepEqual(f.images,[8]);finish({count:1});await first;await tick();assert.deepEqual(order,[8]);assert.equal(f.errors.length,0);
});
