/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../../chrome/content/zotero/elements/notesContext.js',import.meta.url),'utf8');
function setup(){
 let Class,created=0,saves=0,scheduled=0,searches=0;
 const deck={children:[],selectedPanel:null,querySelector(){return this.children[0]||null;},append(node){this.children.push(node);}};
 const document={createXULElement(type){
  if(type==='note-editor'){
   created++;let item,destroyed=false;
   return {style:{},focus(){},saveSync(){saves++;},destroy(){if(!destroyed){destroyed=true;this.saveSync();}},set item(next){if(item?.id&&item.id!==next.id)saves++;item=next;},get item(){return item;}};
  }
  return {style:{},setAttribute(){},append(editor){this.editor=editor;},querySelector(){return this.editor;},remove(){this.editor.destroy();deck.children=deck.children.filter(x=>x!==this);}};
 }};
 const pane={splitter:{getAttribute:()=> 'open'},context:{mode:'notes'},updateAddToNote(){}};
 const Zotero={Utilities:{throttle:fn=>function(...args){scheduled++;return undefined;}},Reader:{getByTabID:()=>({itemID:10})},Items:{get:()=>({parentItemID:2})},Search:class{constructor(){searches++;}},Prefs:{get:()=> 'page'}};
 vm.runInNewContext(source,{XULElementBase:class{},MozXULElement:{parseXULToFragment(){}},customElements:{define(name,C){Class=C;}},Zotero,Zotero_Tabs:{selectedID:'test-reader'},ZoteroContextPane:pane,document});
 const context=new Class();context.node={selectedIndex:0};context.tabNotesDeck=deck;context.input={value:''};context.notesList={};context.updatePinnedNoteTitle=()=>{};context._editable=true;
 return {context,deck,counts:()=>({created,saves,scheduled,searches})};
}
test('reopening a note keeps its iframe; switching notes and returning flush each old note once',async()=>{
 const {context,deck,counts}=setup(),one={id:31,parentItemID:2},two={id:32,parentItemID:2};
 context._setPinnedNote(one);const editor=context._getCurrentEditor();
 for(let i=0;i<100;i++)context._setPinnedNote(one);
 assert.equal(context._getCurrentEditor(),editor);assert.equal(counts().created,1);assert.equal(counts().saves,0);
 context._setPinnedNote(two);assert.equal(context._getCurrentEditor(),editor);assert.equal(counts().saves,1);assert.equal(counts().created,1);
 context._cachedNotesQuery='';context.cachedNotes=[{id:31,title:'metadata only'}];
 context._handleNoteEditorReturn();assert.equal(counts().saves,2,'回退只执行销毁的那次保存');assert.equal(deck.children.length,0);assert.equal(context.mode,'notesList');assert.equal(context.notesList.notes[0].id,31);assert.equal(counts().searches,0,'回退即时恢复缓存，无同步全库搜索');
});
test('a hidden notes list leaves invalidations pending without scheduling a perpetual refresh',async()=>{
 const {context,counts}=setup();context._isNotesListVisible=()=>false;context.affectedIDs.add(9);
 await context._updateNotesList();assert.equal(counts().scheduled,0);assert.equal(counts().searches,0);assert.equal(context.affectedIDs.has(9),true);
 context.mode='notesList';assert.equal(counts().scheduled,1,'回到列表时由可见性事件唤醒');
});
test('cached previews cannot overwrite a changed search query',async()=>{
 const {context,counts}=setup();context._cachedNotesQuery='old';context.cachedNotes=[{id:1}];context.input.value='new';
 await context._updateNotesList(true);assert.equal(context.notesList.notes,undefined);assert.equal(counts().searches,0);
});
