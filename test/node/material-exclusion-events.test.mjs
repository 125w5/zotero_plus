/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createMaterialExclusionEvents} from '../../chrome/content/zotero/research/shared/material-exclusion-events.mjs';
import {changedMaterialExclusionAttachments,materialAttachmentIDs,filterMaterialExclusions} from '../../chrome/content/zotero/research/shared/material-exclusions.mjs';

function fixture(){
 const rows=new Map([[7,[]],[8,[]]]),items=new Map(),timers=new Map(),reads=[],native=new Set(),stores=new Set(),errors=[];let nextTimer=0;
 const schedule=fn=>{const id=++nextTimer;timers.set(id,fn);return id;},cancel=id=>timers.delete(id);
 const events=createMaterialExclusionEvents({snapshot:async id=>{reads.push(id);return structuredClone(rows.get(id)||[]);},item:id=>items.get(id),subscribeItems:fn=>{native.add(fn);return ()=>native.delete(fn);},subscribeStore:fn=>{stores.add(fn);return ()=>stores.delete(fn);},schedule,cancel,onError:error=>errors.push(error)});
 const drain=async()=>{let passes=0;while(timers.size){assert.ok(passes++<20,'events settle without a notification/render loop');const current=[...timers];timers.clear();for(const [,fn] of current)await fn();}};
 return {events,rows,items,reads,native,stores,errors,timers,drain,notify:(event,type,ids)=>{for(const fn of native)fn(event,type,ids);},store:change=>{for(const fn of stores)fn(change);}};
}
const mark=(key='MARK',id=70)=>({annotationKey:key,annotationID:id,attachmentID:7,quote:'omitted',position:{pageIndex:0}});

test('metadata changes identify only their PDF, including deletions, without a whole workspace scan',()=>{
 const before={'7:MARK':{text:'old'},'8:KEEP':{text:'same'}},after={'7:MARK':{text:'new'},'8:KEEP':{text:'same'},'9:ADD':{text:'new'}};
 assert.deepEqual(changedMaterialExclusionAttachments(before,after),[7,9]);assert.deepEqual(changedMaterialExclusionAttachments(after,{'8:KEEP':{text:'same'}}),[7,9]);
 assert.deepEqual(changedMaterialExclusionAttachments(before,structuredClone(before)),[]);
});

test('only the changed watched PDF refreshes; native and sidecar events coalesce and erase restores its view',async()=>{
 const f=fixture(),left=[],right=[],offLeft=f.events.subscribe(change=>left.push(change),{attachmentIDs:[7]}),offRight=f.events.subscribe(change=>right.push(change),{attachmentIDs:[8]});await f.drain();left.length=right.length=f.reads.length=0;
 f.rows.set(7,[mark()]);f.items.set(70,{parentID:7,isAnnotation:()=>true});
 for(let i=0;i<40;i++){f.notify('add','item',[70]);f.notify('add','item-tag',['70-3']);f.store({changedBranches:['materialExclusionQuotes'],attachmentIDs:[7]});}
 await f.drain();assert.deepEqual(f.reads,[7]);assert.deepEqual(left.map(row=>[...row.attachmentIDs]),[[7]]);assert.equal(right.length,0);
 f.notify('modify','item',[70]);await f.drain();assert.equal(left.length,1,'an identical real marker snapshot does not repaint');
 f.rows.set(7,[]);f.items.delete(70);f.notify('delete','item',[70]);await f.drain();assert.equal(left.length,2,'cached marker identity handles erase after the native item is gone');assert.deepEqual([...left[1].attachmentIDs],[7]);assert.equal(right.length,0);assert.deepEqual(f.errors,[]);offLeft();offRight();
 assert.equal(f.native.size,0);assert.equal(f.stores.size,0);
});

test('draft saves, notes, unobserved PDFs and ordinary ink do not repaint a material view',async()=>{
 const f=fixture(),changes=[],off=f.events.subscribe(change=>changes.push(change),{attachmentIDs:[7]});await f.drain();changes.length=f.reads.length=0;
 f.items.set(11,{isAnnotation:()=>false,isNote:()=>true});f.items.set(80,{parentID:8,isAnnotation:()=>true});
 for(let i=0;i<60;i++){f.store({changedBranches:['researchConversations']});f.store({changedBranches:['papers']});f.notify('modify','item',[11]);f.notify('modify','item',[80]);}
 await f.drain();assert.deepEqual(f.reads,[]);assert.deepEqual(changes,[]);
 f.items.set(71,{parentID:7,isAnnotation:()=>true});f.notify('modify','item',[71]);await f.drain();assert.deepEqual(f.reads,[7]);assert.deepEqual(changes,[],'ordinary ink has no exclusion signature change');
 off();f.store({changedBranches:['materialExclusionQuotes'],attachmentIDs:[7]});f.notify('delete','item',[71]);await f.drain();assert.equal(f.reads.length,1);
});

test('scope changes and disposal cancel obsolete work, and a mark removed before the initial load still refreshes',async()=>{
 const f=fixture(),changes=[],off=f.events.subscribe(change=>changes.push(change),{attachmentIDs:[7]});
 // A prior synchronous view may have seen a mark, then native erase happens
 // before the first asynchronous snapshot completes. Its empty snapshot must
 // still complete that view's initial refresh.
 await f.drain();assert.deepEqual(changes.map(row=>[...row.attachmentIDs]),[[7]]);
 changes.length=0;off.update([8]);await f.drain();assert.deepEqual(changes.map(row=>[...row.attachmentIDs]),[[8]]);
 f.items.set(70,{parentID:7,isAnnotation:()=>true});f.rows.set(7,[mark()]);f.notify('add','item',[70]);await f.drain();assert.equal(changes.length,1,'the old PDF is no longer watched');
 f.events.refresh([8]);assert.equal(f.timers.size,1);off();assert.equal(f.timers.size,0);assert.equal(f.native.size,0);assert.equal(f.stores.size,0);
});

test('stopping during a native load suppresses its late callback and permits a fresh subscription',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),scheduled=[],seen=[];let reads=0;
 const events=createMaterialExclusionEvents({snapshot:async()=>{if(++reads===1)await gate;return [];},item:()=>null,subscribeItems:()=>()=>{},subscribeStore:()=>()=>{},schedule:fn=>{scheduled.push(fn);return fn;},cancel:fn=>{const at=scheduled.indexOf(fn);if(at>=0)scheduled.splice(at,1);}});
 const first=events.subscribe(()=>seen.push('old'),{attachmentIDs:[7]}),pending=scheduled.shift()();first();const last=events.subscribe(()=>seen.push('new'),{attachmentIDs:[8]});release();await pending;
 while(scheduled.length)await scheduled.shift()();assert.deepEqual(seen,['new']);last();
});

test('assembly exclusion events refresh the material list and relevant detail without redrawing or saving authored paragraphs',async()=>{
 const source=await readFile(new URL('../../chrome/content/zotero/research/manuscript/main.mjs',import.meta.url),'utf8'),refresh=source.match(/function refreshMaterialExclusionViews\([^]*?\n}/)?.[0];assert.ok(refresh);
 const material={id:'m1',sourceText:'Original source',anchor:{attachmentID:7}},project={materials:[material],blocks:[{text:'正在输入的人工正文'}],ui:{left:'materials',rightOpen:true}},before=JSON.stringify(project),seen=[];
 const U={ready:true,p:project,previewMaterialID:'m1',A:{materialAttachmentIDs,assetLibrary:()=>{throw Error('known selected material should not re-clone the library');}}};
 const context={U,renderLibrary:()=>seen.push('list'),materialDetails:value=>seen.push(value.id)};vm.runInNewContext(refresh+';this.refreshExclusions=refreshMaterialExclusionViews',context);
 context.refreshExclusions({attachmentIDs:[8]});assert.deepEqual(seen,['list']);context.refreshExclusions({attachmentIDs:[7]});assert.deepEqual(seen,['list','list','m1']);assert.equal(JSON.stringify(project),before);
 U.p.ui.left='structure';context.refreshExclusions({attachmentIDs:[7]});assert.deepEqual(seen,['list','list','m1','m1'],'hidden material lists and the canvas are not rebuilt');
 U.closing=true;context.refreshExclusions({attachmentIDs:[7]});assert.equal(seen.length,4);
});

test('notebook exclusion events update excerpts and count while leaving question and plan editors untouched',async()=>{
 const source=await readFile(new URL('../../chrome/content/zotero/research/notebook.mjs',import.meta.url),'utf8'),refresh=source.match(/function refreshMaterialExclusionView\([^]*?\n}/)?.[0];assert.ok(refresh);
 const state={selectedMaterial:'m1',view:'read'},count={textContent:'1 张'},question={value:'正在写的问题'},seen=[];let materials=[];
 const context={selectedRendered:'m1:1',id:'p',N:{state:()=>state,materials:()=>materials,passageResults:()=>[]},$:id=>id==='count'?count:question,browser:{render:()=>seen.push('list')},detail:material=>seen.push(material?.id||'empty')};vm.runInNewContext(refresh+';this.refreshExclusions=refreshMaterialExclusionView',context);
 context.refreshExclusions();assert.equal(count.textContent,'0 张');assert.deepEqual(seen,['list','empty']);assert.equal(question.value,'正在写的问题');
 materials=[{id:'m1',sourceText:'restored'}];context.refreshExclusions();assert.equal(count.textContent,'1 张');assert.deepEqual(seen,['list','empty','list','m1']);
 state.view='plan';context.refreshExclusions();assert.equal(seen.length,4,'a hidden material view does not replace an active plan editor');assert.equal(question.value,'正在写的问题');
});

test('editing a filtered material detail writes the original project record and preserves the complete source cache',async()=>{
 const source=await readFile(new URL('../../chrome/content/zotero/research/manuscript/main.mjs',import.meta.url),'utf8'),start=source.indexOf('export function materialDetails('),end=source.indexOf('export async function openMaterial(',start),detail=source.slice(start,end).replace(/^export /,'');assert.ok(start>=0&&end>start);
 const raw={id:'m1',revision:1,kind:'paragraph',title:'原标题',sourceText:'Before OMITTED after.',anchor:{attachmentID:7,pageIndex:0,sourceText:'Before OMITTED after.'}},project={materials:[raw],sections:[],blocks:[],ui:{catalog:{selection:['m1']},rightOpen:true}},rows=[{annotationKey:'MARK',attachmentID:7,quote:'OMITTED',position:{pageIndex:0}}];
 const filter=(cards,options)=>filterMaterialExclusions(cards,{...options,exclusionsFor:()=>rows}),node=(tag,text)=>({tag,textContent:text||'',dataset:{},children:[],append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},querySelector:()=>null,querySelectorAll:()=>[],focus(){},select(){}}),box=node('div'),library=node('div');let rendered,saver,saves=0;
 const U={p:project,previewMaterialID:'m1',E:{},A:{materialAttachmentIDs,filterAutomaticMaterials:filter,assetLibrary:()=>({}),titleFor:m=>m.title,ensureChineseSummaries:()=>{}},workflow:{closePanel(){}}};
 const context={U,el:node,$:()=>library,clearDetails:()=>box,button:(text,fn,host)=>{const item=node('button',text);item.onclick=fn;host.append(item);return item;},syncMaterialSelection:()=>{},persist:async()=>{saves++;},snapshot:()=>{},renderLibrary:()=>{},assetDetailSignature:()=>'',materialAnchors:m=>[m.anchor],renderMaterialOverview:(_host,m)=>{rendered=m;return {summaryHost:node('div'),dispose(){}};},renderMaterialExplanationEditor:(_host,_m,options)=>{saver=options.onSave;return {isDirty:()=>false};},M:{invalidate(){}},status:()=>{}};
 vm.runInNewContext(detail+';this.showMaterial=materialDetails',context);context.showMaterial(filter([raw])[0]);assert.equal(rendered.sourceText,'Before \n\n after.');assert.equal(raw.sourceText,'Before OMITTED after.');
 await saver({summary:'我写的中文说明',contents:[]});assert.equal(raw.summary,'我写的中文说明');assert.equal(raw.revision,2);assert.equal(raw.userEdited,true);assert.equal(saves,1);assert.equal(project.materials[0].sourceText,'Before OMITTED after.');assert.equal(raw.anchor.sourceText,'Before OMITTED after.');
});
