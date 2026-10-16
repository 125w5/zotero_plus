/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/manuscript.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const files=new Map([['book.xlsx',{size:100,lastModified:1}]]),calls=[];let python='python-a',parse=async request=>({sheet:'Sheet 1',rows:[[request.file,'original']]}),writes=0;
 const E={store:{update:()=>writes++},runArtifactEngine:async request=>{calls.push(request);return parse(request);}},Zotero={Research:E,Prefs:{get:()=>python}};
 vm.runInNewContext(source,{Zotero,ChromeUtils:{importESModule:()=>({})},IOUtils:{stat:async file=>{if(!files.has(file))throw Error('File not found');return {...files.get(file)};}}});
 return {A:E.manuscripts,files,calls,setPython:value=>python=value,setParser:value=>parse=value,get writes(){return writes;}};
}

test('unchanged workbook reads share one parser and return detached data without material writes',async()=>{
 const f=fixture();let release;f.setParser(request=>new Promise(resolve=>release=()=>resolve({sheet:'Data',rows:[[request.file,3]]})));const first=f.A.dataset('book.xlsx'),second=f.A.dataset('book.xlsx');await tick();assert.equal(f.calls.length,1);release();const [a,b]=await Promise.all([first,second]);a.rows[0][1]=99;assert.equal(b.rows[0][1],3);const c=await f.A.dataset('book.xlsx');assert.equal(c.rows[0][1],3);assert.notStrictEqual(c,b);assert.equal(f.calls.length,1);
 const material=await f.A.refreshMaterial({file:'book.xlsx'});assert.equal(material.sourceText,JSON.stringify(material.data.rows));assert.equal(f.writes,0);assert.equal(f.calls.length,1);
});

test('mtime, file size and interpreter configuration independently invalidate parsed data',async()=>{
 const f=fixture();await f.A.dataset('book.xlsx');f.files.set('book.xlsx',{size:100,lastModified:2});await f.A.dataset('book.xlsx');f.files.set('book.xlsx',{size:101,lastModified:2});await f.A.dataset('book.xlsx');f.setPython('python-b');await f.A.dataset('book.xlsx');await f.A.dataset('book.xlsx');assert.equal(f.calls.length,4);assert.equal(f.calls.at(-1).python,'python-b');assert.equal(f.calls.at(-1).operation,'manuscript-data');
});

test('deleted files cannot return cached rows and recreating the same stat reparses them',async()=>{
 const f=fixture();await f.A.dataset('book.xlsx');f.files.delete('book.xlsx');await assert.rejects(()=>f.A.dataset('book.xlsx'),/File not found/);assert.equal(f.calls.length,1);f.files.set('book.xlsx',{size:100,lastModified:1});await f.A.dataset('book.xlsx');assert.equal(f.calls.length,2);
});

test('a changed or deleted workbook during parsing is rejected and a failed parser can retry',async()=>{
 const f=fixture();let release;f.setParser(()=>new Promise(resolve=>release=resolve));const changed=f.A.dataset('book.xlsx');await tick();f.files.set('book.xlsx',{size:100,lastModified:2});release({rows:[['stale']]});await assert.rejects(()=>changed,/读取时发生变化/);
 f.setParser(async()=>{throw Error('Controlled parser failure');});await assert.rejects(()=>f.A.dataset('book.xlsx'),/Controlled parser failure/);f.setParser(async()=>({rows:[['latest']]}));assert.equal((await f.A.dataset('book.xlsx')).rows[0][0],'latest');assert.equal(f.calls.length,3);
 f.files.set('book.xlsx',{size:100,lastModified:3});f.setParser(()=>new Promise(resolve=>release=resolve));const deleted=f.A.dataset('book.xlsx');await tick();f.files.delete('book.xlsx');release({rows:[['deleted']]});await assert.rejects(()=>deleted,/File not found/);
});

test('workbook retention is bounded and keeps recently used results',async()=>{
 const f=fixture();for(let index=0;index<8;index++){const file='book-'+index+'.xlsx';f.files.set(file,{size:100,lastModified:1});await f.A.dataset(file);}await f.A.dataset('book-0.xlsx');f.files.set('book-8.xlsx',{size:100,lastModified:1});await f.A.dataset('book-8.xlsx');assert.equal(f.calls.length,9);await f.A.dataset('book-0.xlsx');assert.equal(f.calls.length,9);await f.A.dataset('book-1.xlsx');assert.equal(f.calls.length,10);
});

test('a result larger than the memory quota is returned without being retained',async()=>{
 const f=fixture(),text='x'.repeat(4*1024*1024);f.setParser(async()=>({rows:[[text]]}));assert.equal((await f.A.dataset('book.xlsx')).rows[0][0].length,text.length);await f.A.dataset('book.xlsx');assert.equal(f.calls.length,2);
});

async function focusFixture(){
 const source=await readFile(new URL('../../chrome/content/zotero/research/manuscript/main.mjs',import.meta.url),'utf8'),start=source.indexOf('export function installMaterialFocusRefresh(){'),end=source.indexOf('\nasync function init(){',start),listeners=new Map(),calls=[],errors=[];let check=async()=>{};
 const U={p:{materials:[{id:'source',aiGenerated:true,assetID:'asset'},{id:'book',file:'book.xlsx'}]},A:{syncAssets:()=>calls.push('sync'),checkAssetSource:async material=>{calls.push(material.id);await check();}}},scope=vm.createContext({U,window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);}},M:{invalidate:(_,id)=>calls.push('invalidate:'+id)},status:message=>errors.push(message),refreshMaterial:async material=>calls.push(material.id)});
 vm.runInContext(source.slice(start,end).replace('export function ','function ')+'\nthis.install=installMaterialFocusRefresh;',scope);return {calls,errors,listeners,dispose:scope.install(),setCheck:fn=>check=fn};
}

test('repeated focus events share the current validation and listener disposal prevents further work',async()=>{
 const f=await focusFixture();let release;f.setCheck(()=>new Promise(resolve=>release=resolve));const listener=f.listeners.get('focus'),first=listener(),second=listener();assert.strictEqual(first,second);await Promise.resolve();assert.deepEqual(f.calls,['sync','source']);release();await first;assert.deepEqual(f.calls,['sync','source','sync','book']);
 f.setCheck(async()=>{});await listener();assert.equal(f.calls.filter(value=>value==='book').length,2);f.dispose();assert.equal(f.listeners.has('focus'),false);await listener();assert.equal(f.calls.filter(value=>value==='book').length,2);
});

test('closing during source validation stops remaining refreshes while source errors preserve invalidation',async()=>{
 const f=await focusFixture();f.setCheck(async()=>{throw Error('Source unavailable');});await f.listeners.get('focus')();assert.deepEqual(f.errors,['Source unavailable']);assert.ok(f.calls.includes('invalidate:source'));assert.ok(f.calls.includes('book'));
 let release;f.setCheck(()=>new Promise(resolve=>release=resolve));const pending=f.listeners.get('focus')();await Promise.resolve();f.dispose();release();await pending;assert.equal(f.calls.filter(value=>value==='book').length,1);
});
