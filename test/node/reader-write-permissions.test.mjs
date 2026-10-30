/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as Geometry from '../../chrome/content/zotero/research/shared/annotation-geometry.mjs';

const files=await Promise.all(['reader-tools.js','reader-results.js','workflow.js'].map(name=>readFile(new URL('../../chrome/content/zotero/xpcom/research/'+name,import.meta.url),'utf8')));
function fixture(){
 const calls={items:0,index:0,annotations:[]},library={editable:true},parent={deleted:false},attachment={id:7,libraryID:1,parentID:6,parentItem:parent,deleted:false,isPDFAttachment:()=>true,isEditable:()=>true};
 const reader={itemID:7,_iframeWindow:{},_internalReader:{_state:{readOnly:false},_annotationManager:{addAnnotation(value){calls.annotations.push(value);return{id:'annotation'};}},setSelectedAnnotations(){}}};
 const state={};const E={assets:{position:()=>({pageIndex:0,rects:[[20,20,100,40]]}),index:async()=>{calls.index++;return{assets:[]};}},store:{get:()=>({}),update:async fn=>fn(state)},library:{uri:()=> 'zotero://controlled-source'}};
 const Zotero={Research:E,Items:{get:id=>id===7?attachment:id===6?parent:null,getAsync:async id=>id===7?attachment:id===6?parent:null},Libraries:{get:()=>library},Reader:{_readers:[reader],registerEventListener(){}},getMainWindow:()=>({}),Item:function(){calls.items++;throw Error('Unexpected item construction');}};
 const context={Zotero,Cu:{cloneInto:value=>value},ChromeUtils:{importESModule:path=>path.endsWith('annotation-geometry.mjs')?Geometry:path.endsWith('reader-rapid-reading.mjs')?{installRapidReading(){}}:path.endsWith('active-reader.mjs')?{activeReaderForAttachment:()=>reader}:{boundedMapSet:(map,key,value)=>map.set(key,value)}}};
 for(const source of files)vm.runInNewContext(source,context);
 const selection={attachmentID:7,paperID:6,text:'Selected source.',pageIndex:0,position:{pageIndex:0,rects:[[20,20,100,40]]}};
 E.readerSelection=()=>selection;E.installReaderContext();return{E,reader,attachment,parent,library,calls,selection,state};
}

for(const [name,change] of [
 ['a read-only Reader preview',f=>f.reader._internalReader._state.readOnly=true],
 ['an attachment with no file-edit permission',f=>f.attachment.isEditable=()=>false],
 ['a read-only library',f=>f.library.editable=false],
 ['a deleted attachment',f=>f.attachment.deleted=true],
 ['an attachment under a deleted paper',f=>f.parent.deleted=true]
])test(name+' cannot annotate, save a note, or index an image for writing',async()=>{
 const f=fixture();change(f);const actions=[];f.E.readerContextHandler({reader:f.reader,append:item=>actions.push(item)});assert.ok(actions.length>=5);assert.ok(actions.every(item=>item.disabled===true));
 assert.throws(()=>f.E.annotateSelection(f.reader,f.selection,'strikeout'),/只读|回收站/);
 await assert.rejects(f.E.saveReaderNote(f.selection,{result:{sections:[]}}, {reader:f.reader}),/只读|回收站/);
 await assert.rejects(f.E.saveSelectionTranslation(f.selection,undefined,{reader:f.reader}),/只读|回收站/);
 await assert.rejects(f.E.selectionImageNote(f.reader,f.selection),/只读|回收站/);
 await assert.rejects(f.E.saveAssetNote({id:'image',attachmentID:7,pageIndex:0},{reader:f.reader}),/只读|回收站/);
 assert.equal(f.calls.items,0);assert.equal(f.calls.index,0);assert.equal(f.calls.annotations.length,0);
});

test('writable PDF context actions remain enabled and strikeout uses the original exact selection',()=>{
 const f=fixture(),actions=[];f.E.readerContextHandler({reader:f.reader,append:item=>actions.push(item)});assert.ok(actions.every(item=>item.disabled===false));f.E.annotateSelection(f.reader,f.selection,'strikeout');assert.equal(f.calls.annotations.length,1);assert.equal(f.calls.annotations[0].type,'ink');assert.equal(f.calls.annotations[0].color,'#e33b46');assert.deepEqual(Array.from(f.calls.annotations[0].position.paths[0]),[20,30,100,30]);
});
test('strikeout stores the exact quote and per-page geometry because native ink does not persist annotationText',()=>{
 const f=fixture();let sequence=0;f.reader._internalReader._annotationManager.addAnnotation=value=>({id:'STRIKE'+(++sequence)});
 f.selection.position.nextPageRects=[[25,40,120,60]];f.E.annotateSelection(f.reader,f.selection,'strikeout');
 const entries=Object.values(f.state.materialExclusionQuotes);assert.equal(entries.length,2);assert.equal(entries[0].text,f.selection.text);assert.equal(entries[1].text,f.selection.text);
 assert.equal(entries[0].position.pageIndex,0);assert.equal(entries[1].position.pageIndex,1);assert.deepEqual(Array.from(entries[1].position.rects[0]),[25,40,120,60]);
});

test('permission changes during image indexing are checked again before any item is constructed',async()=>{
 const f=fixture();f.E.assets.index=async()=>{f.attachment.isEditable=()=>false;return{assets:[]};};await assert.rejects(f.E.selectionImageNote(f.reader,f.selection),/只读/);assert.equal(f.calls.items,0);
});

test('a Reader cannot write an annotation belonging to another PDF',()=>{
 const f=fixture();f.reader.itemID=8;assert.throws(()=>f.E.annotateSelection(f.reader,f.selection),/来源已切换/);assert.equal(f.calls.annotations.length,0);
});
