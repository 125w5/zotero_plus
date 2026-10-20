/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as model from '../../chrome/content/zotero/research/shared/ppt-model.mjs';

const source=await readFile(new URL('../../chrome/content/zotero/research/ui/ppt-editor.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const page=(id='first')=>({id,title:'Original '+id,explanation:'Mechanism',blocks:[],assetIDs:[],notes:'Human notes',layout:'text'});
function fixture(slides=[page(),page('second')]){
 let state={id:'draft',slides,assets:[],datasets:[],history:[],redo:[],sources:[]},gate=null,failure=null;
 const calls={writes:[],renders:0,status:[],timers:new Map()},element=(tag,text,className)=>({tag,textContent:text||'',className:className||'',children:[],dataset:{},style:{},classList:{toggle(){}},setAttribute(){},append(...rows){for(const row of rows){row.parentElement=this;this.children.push(row);}},cloneNode(){return element(tag,text,className);}});
 const studio={model,get:()=>structuredClone(state),async patch(id,change,{snapshot}={}){
  assert.equal(id,state.id);assert.equal(snapshot,true);if(failure){const error=failure;failure=null;throw error;}
  const next=structuredClone(state);change(next);state=next;calls.writes.push(structuredClone(next));
  if(gate){const wait=gate;gate=null;wait.entered.resolve();await wait.release.promise;}
  return next;
 }};
 const ui={pptDraft:studio.get(),pptSelected:0,E:{studio},el:element,status:(...args)=>calls.status.push(args),renderPPT(){calls.renders++;},
  pptField(label,value,parent){const field=element('input');field.fieldLabel=label;field.value=value??'';const wrapper=element('label',label);wrapper.append(field);parent.append(wrapper);return field;},
  pptButton(label,action,parent,className){const node=element('button',label,className);node.onclick=action;parent.append(node);return node;},
  async pptPatch(change,snapshot){const next=await studio.patch(state.id,change,{snapshot});ui.pptDraft=next;return next;}
 };
 let timerID=0;const context=vm.createContext({EasySchUI:ui,structuredClone,setTimeout:callback=>{calls.timers.set(++timerID,callback);return timerID;},clearTimeout:id=>calls.timers.delete(id)});vm.runInContext(source,context,{filename:'ppt-editor.js'});
 const find=(node,predicate)=>predicate(node)?node:node.children?.map(child=>find(child,predicate)).find(Boolean);
 const session=()=>{const form=structuredClone(ui.pptDraft.slides[ui.pptSelected]),control={},status={};ui.pptWatchPageEdits(form,()=>({title:form.title,explanation:form.explanation,blocks:form.blocks,notes:form.notes,layout:form.layout,assetIDs:form.assetIDs}),[control],status);return {form,control,status};};
 return {ui,calls,studio,element,find,session,get state(){return state;},pauseNext(){const entered=deferred(),release=deferred();gate={entered,release};return {entered:entered.promise,release:release.resolve};},failNext(){failure=Error('disk unavailable');}};
}

test('typing coalesces to an idle save without re-rendering or losing focus state',async()=>{
 const f=fixture(),{form,control,status}=f.session();form.title='First keystroke';control.oninput();form.title='Completed edit';control.oninput();
 assert.equal(f.calls.writes.length,0);assert.equal(f.calls.timers.size,1);assert.equal(status.textContent,'待保存…');
 await [...f.calls.timers.values()][0]();assert.equal(f.calls.writes.length,1);assert.equal(f.state.slides[0].title,'Completed edit');assert.equal(f.calls.renders,0);assert.equal(status.textContent,'已自动保存');
 await f.ui.pptFlushEdits();assert.equal(f.calls.writes.length,1,'unchanged fields do not create history entries');
});

test('flush drains edits made while an earlier save awaits I/O',async()=>{
 const f=fixture(),{form,control}=f.session(),gate=f.pauseNext();form.title='Earlier edit';control.oninput();const saving=f.ui.pptFlushEdits();await gate.entered;
 form.title='Latest edit';control.oninput();gate.release();await saving;
 assert.equal(f.calls.writes.length,2);assert.equal(f.state.slides[0].title,'Latest edit');assert.equal(f.ui.pptDraft.slides[0].title,'Latest edit');assert.equal(f.calls.renders,0);
});

test('synchronous render disposal preserves the old fields and serializes replacement-session edits',async()=>{
 const f=fixture(),old=f.session(),gate=f.pauseNext();old.form.title='A';old.control.oninput();const first=f.ui.pptFlushEdits();await gate.entered;
 old.form.title='B';old.control.oninput();const disposed=f.ui.pptCancelEdits();assert.equal(f.ui.pptDraft.slides[0].title,'B','the synchronous render sees the final field values');
 const current=f.session();current.form.title='C';current.control.oninput();const latest=f.ui.pptFlushEdits();gate.release();await Promise.all([first,disposed,latest]);
 assert.deepEqual(f.calls.writes.map(draft=>draft.slides[0].title),['A','B','C']);assert.equal(f.state.slides[0].title,'C');assert.equal(f.ui.pptDraft.slides[0].title,'C');
});

test('a late save cannot switch the user back into the previous draft',async()=>{
 const f=fixture(),{form,control}=f.session(),gate=f.pauseNext();form.notes='Preserve these notes';control.oninput();const pending=f.ui.pptFlushEdits();await gate.entered;
 const disposed=f.ui.pptCancelEdits();f.ui.pptDraft={id:'other',slides:[page('other')]};gate.release();await Promise.all([pending,disposed]);
 assert.equal(f.ui.pptDraft.id,'other');assert.equal(f.state.slides[0].notes,'Preserve these notes');
});

test('failed persistence retains the fields and can be retried; a deleted page is never resurrected',async()=>{
 const f=fixture(),{form,control,status}=f.session();form.title='Unsaved title';control.oninput();f.failNext();await assert.rejects(f.ui.pptFlushEdits(),/disk unavailable/);
 assert.equal(status.textContent,'保存失败，请重试');assert.equal(form.title,'Unsaved title');assert.equal(f.state.slides[0].title,'Original first');await f.ui.pptFlushEdits();assert.equal(f.state.slides[0].title,'Unsaved title');
 form.title='After deletion';control.oninput();f.state.slides.shift();await assert.rejects(f.ui.pptFlushEdits(),/当前页面已删除/);assert.equal(f.state.slides.length,1);assert.equal(f.state.slides[0].id,'second');
});

test('page selection saves the active properties before changing the selected page',async()=>{
 const f=fixture(),body=f.element('div');f.ui.pptEditor(body);const title=f.find(body,node=>node.fieldLabel==='结论式标题'),list=f.find(body,node=>node.id==='ppt-slide-list');
 title.value='Edited before switching';title.oninput();await list.children[1].onclick();
 assert.equal(f.state.slides[0].title,'Edited before switching');assert.equal(f.ui.pptSelected,1);assert.equal(f.calls.renders,1);assert.equal(f.calls.writes.length,1);
});

test('copying a page uses the just-saved title and speaker notes rather than the render closure',async()=>{
 const f=fixture(),body=f.element('div');f.ui.pptEditor(body);const title=f.find(body,node=>node.fieldLabel==='结论式标题'),notes=f.find(body,node=>node.fieldLabel==='讲者备注（可写追问与回答）');
 title.value='Current human title';title.oninput();notes.value='Current human notes';notes.oninput();await f.find(body,node=>node.textContent==='复制本页').onclick();
 assert.equal(f.state.slides.length,3);assert.equal(f.state.slides[1].title,'Current human title');assert.equal(f.state.slides[1].notes,'Current human notes');assert.notEqual(f.state.slides[1].id,'first');assert.equal(f.ui.pptSelected,1);
});

test('legacy empty decks can create a real page and missing page fields render safely',async()=>{
 const f=fixture([]);delete f.ui.pptDraft.assets;delete f.ui.pptDraft.history;const body=f.element('div');f.ui.pptEditor(body);await f.find(body,node=>node.id==='ppt-add-blank').onclick();
 assert.equal(f.state.slides.length,1);assert.equal(f.ui.pptSelected,0);assert.equal(f.state.slides[0].status,'user');assert.equal(f.state.slides[0].layout,'text');
 const legacy=fixture([{id:'legacy',blocks:[{text:'Kept old text'}]}]),legacyBody=legacy.element('div');delete legacy.ui.pptDraft.sources;delete legacy.ui.pptDraft.datasets;assert.doesNotThrow(()=>legacy.ui.pptEditor(legacyBody));assert.equal(legacy.ui.pptDraft.slides[0].blocks[0].kind,'my_interpretation');
});

test('moving pages keeps the same page active, preserves notes, and rejects out-of-range moves',async()=>{
 const f=fixture();assert.equal(await f.ui.pptMoveEditorPage('first',-1),false);assert.equal(f.calls.writes.length,0);assert.equal(await f.ui.pptMoveEditorPage('first',1),true);
 assert.deepEqual(f.state.slides.map(row=>row.id),['second','first']);assert.equal(f.ui.pptSelected,1);assert.equal(f.state.slides[1].notes,'Human notes');assert.equal(await f.ui.pptMoveEditorPage('first',1),false);assert.equal(f.calls.writes.length,1);
});

test('inserting after a stable page ID selects the inserted page and respects the 50-page limit',async()=>{
 const f=fixture(),id=await f.ui.pptInsertBlankPage('first');assert.deepEqual(f.state.slides.map(row=>row.id),['first',id,'second']);assert.equal(f.ui.pptSelected,1);
 const full=fixture(Array.from({length:50},(_,i)=>page('p-'+i)));await assert.rejects(full.ui.pptInsertBlankPage('p-0'),/最多 50 页/);assert.equal(full.calls.writes.length,0);assert.equal(full.state.slides.length,50);
});
