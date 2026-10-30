/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/reader-tools.js',import.meta.url),'utf8');
test('annotation typing reuses its link index, invalidates on link commits and checks note deletion live',()=>{
 let revision=1,reads=0;const links={one:{attachmentID:8,annotationKey:'A',noteID:1},two:{attachmentID:8,annotationKey:'A',noteID:2}},notes=new Map([[1,{deleted:false}],[2,{deleted:false}]]);
 const E={store:{branchRevision:()=>revision,get:()=>{reads++;return links;}}};
 vm.runInNewContext(source,{Zotero:{Research:E,Items:{get:id=>notes.get(id)}},ChromeUtils:{importESModule:path=>path.endsWith('reader-rapid-reading.mjs')?{installRapidReading(){}}:{}}});
 for(let n=0;n<100;n++)assert.equal(E.noteLinkForAnnotation(8,'A').noteID,1);assert.equal(reads,1);
 notes.get(1).deleted=true;assert.equal(E.noteLinkForAnnotation(8,'A').noteID,2);assert.equal(reads,1);
 links.three={attachmentID:9,annotationKey:'B',noteID:2};revision++;assert.equal(E.noteLinkForAnnotation(9,'B').noteID,2);assert.equal(reads,2);
});
test('sorting a thousand linked notes reads the links branch once and preserves page order',()=>{
 let reads=0;const links=Object.fromEntries(Array.from({length:1000},(_,i)=>[i,{noteID:i+1,annotationID:i+2000,annotationKey:'KEY'+i,attachmentID:8,pageIndex:999-i}]));
 const E={store:{branchRevision:()=>1,get:()=>{reads++;return links;}}};
 vm.runInNewContext(source,{Zotero:{Research:E},ChromeUtils:{importESModule:path=>path.endsWith('reader-rapid-reading.mjs')?{installRapidReading(){}}:{}}});
 const notes=Array.from({length:1000},(_,i)=>({id:i+1,getNote(){throw Error('有明确来源的笔记排序不得解析正文');}}));
 notes.sort((a,b)=>E.notePage(a)-E.notePage(b));assert.equal(notes[0].id,1000);assert.equal(notes.at(-1).id,1);assert.equal(reads,1);
});
test('typing notifications coalesce by note and edits arriving during a save drain afterwards',async()=>{
 const timers=[],synced=[];let observer,release;
 const E={id:'test',setTimeout:fn=>timers.push(fn)};
 const Zotero={Research:E,Reader:{registerEventListener(){}},Notifier:{registerObserver(value){observer=value;}},Items:{get:id=>({isNote:()=>id===1||id===2})},logError(error){throw error;}};
 vm.runInNewContext(source,{Zotero,ChromeUtils:{importESModule:path=>path.endsWith('reader-rapid-reading.mjs')?{installRapidReading(){}}:{}}});
 E.syncNoteLinks=async ids=>{synced.push([...ids]);if(synced.length===1)await new Promise(resolve=>{release=resolve;});};E.installReaderTools();
 for(let n=0;n<100;n++)observer.notify('modify','item',[1]);assert.equal(timers.length,1);
 const flushing=timers.shift()();await Promise.resolve();assert.deepEqual(synced,[[1]]);
 observer.notify('modify','item',[1,2]);observer.notify('modify','item',[2]);assert.equal(timers.length,0,'处理中不累积单独排队任务');release();await flushing;
 assert.deepEqual(synced,[[1],[1,2]],'保存中的后续变更没有丢失');
});
