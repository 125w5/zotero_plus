/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../../chrome/content/zotero/xpcom/reader.js',import.meta.url),'utf8');
function fixture(){
 const logged=[],element=()=>({setAttribute(){},appendChild(){},addEventListener(){},removeEventListener(){},docShell:{},style:{}}),container=element();
 const win={document:{createXULElement:element,getElementById:()=>container},addEventListener(){},removeEventListener(){},Zotero_Tabs:{add:()=>({id:'controlled-tab',container}),selectedID:'controlled-tab'},open:()=>({addEventListener(){}})};
 const Zotero={Utilities:{randomString:()=> 'controlled'},Libraries:{userLibraryID:1},SyncedSettings:{loadAll:async()=>{}},File:{getContentsFromURL:()=> 'controlled FTL'},logError:error=>logged.push(error),Promise:{delay:ms=>new Promise(resolve=>setTimeout(resolve,ms))}};
 const context={Zotero,Services:{wm:{getMostRecentWindow:()=>win},locale:{appLocalesAsBCP47:['en-US']}},BlockingObserver:class{register(){}},Components:{utils:{cloneInto:value=>value}},Error,Promise};
 vm.runInNewContext(source.slice(source.indexOf('class ReaderInstance {'),source.indexOf('class ReaderPreview extends'))+'\nglobalThis.ReaderClasses={ReaderInstance,ReaderTab,ReaderWindow};',context);
 const item={id:13,attachmentReaderType:'pdf',getAnnotations:()=>[]};
 return {...context.ReaderClasses,Zotero,item,logged,win};
}

test('closing while synchronous FTL loads prevents any access to the destroyed Reader iframe and settles readiness',async()=>{
 const {ReaderInstance,Zotero,item}=fixture(),reader=new ReaderInstance({item});let iframeAccess=0;
 reader.updateTitle=()=>{};reader._getData=async()=>({});reader.migrateMendeleyColors=async()=>false;reader._waitForReader=async()=>{};reader._iframe={};reader._iframeWindow={addEventListener(){}};
 Object.defineProperty(reader._iframeWindow,'wrappedJSObject',{get(){iframeAccess++;throw Error('Destroyed iframe must not be read');}});
 Zotero.File.getContentsFromURL=()=>{reader._isTabClosed=true;return 'controlled FTL';};
 assert.equal(await reader._open({state:{}}),false);assert.equal(iframeAccess,0);await assert.rejects(reader._initPromise,error=>error.name==='AbortError'&&/closed before initialization/.test(error.message));
});

test('uninitializing a pending Reader settles its readiness even when the caller awaits only after closure',async()=>{
 const {ReaderInstance,item}=fixture(),reader=new ReaderInstance({item});reader._hideReadAloudGuidance=()=>{};reader._flushState=()=>{};reader._isTransient=()=>true;
 reader.uninit();await new Promise(resolve=>setImmediate(resolve));await assert.rejects(reader._initPromise,{name:'AbortError'});assert.equal(reader._isUninitialized,true);reader.uninit();
});

test('closing an initialized Reader does not change its already fulfilled readiness promise',async()=>{
 const {ReaderInstance,item}=fixture(),reader=new ReaderInstance({item});reader._hideReadAloudGuidance=()=>{};reader._flushState=()=>{};reader._isTransient=()=>true;reader._resolveInitPromise();reader.uninit();await reader._initPromise;
});

test('a ReaderTab open failure reaches readiness and is handled without post-open DOM setup',async()=>{
 const {ReaderTab,item,logged}=fixture(),error=Error('Controlled PDF initialization error');ReaderTab.prototype._updateDocShellActivity=()=>{};ReaderTab.prototype._open=async()=>{throw error;};
 const reader=new ReaderTab({item});await assert.rejects(reader._initPromise,value=>value===error);assert.deepEqual(logged,[error]);await new Promise(resolve=>setImmediate(resolve));
});

test('a standalone ReaderWindow open failure also settles readiness',async()=>{
 const {ReaderWindow,item,logged}=fixture(),error=Error('Controlled window initialization error');ReaderWindow.prototype._open=async()=>{throw error;};
 const reader=new ReaderWindow({item});await assert.rejects(reader._initPromise,value=>value===error);assert.deepEqual(logged,[error]);
});
