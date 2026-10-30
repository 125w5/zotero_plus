import * as WorkspaceOutputs from '../../chrome/content/zotero/research/shared/workspace-outputs.mjs';
/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as model from '../../chrome/content/zotero/research/shared/ppt-model.mjs';
import * as scope from '../../chrome/content/zotero/research/shared/ppt-scope.mjs';
import * as outline from '../../chrome/content/zotero/research/shared/ppt-outline.mjs';
import * as policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
const root=new URL('../../chrome/content/zotero/xpcom/research/',import.meta.url);
async function service(){
 let state={pptDrafts:{}},counter=0;const item=id=>({id,key:'key-'+id,parentItem:null,isAttachment:()=>false,getAttachments:()=>[],getField:()=>'',getFilePathAsync:async()=>'/kept/image.png'});
 const E={store:{get:(...path)=>structuredClone(path.reduce((value,key)=>value?.[key],state)),update:async fn=>{const next=structuredClone(state);fn(next);state=next;}},library:{selection:()=>[],describe:value=>({id:value.id,title:'Paper '+value.id}),uri:()=>''},chatAttachments:{read:async files=>({rows:files.map(file=>({id:'evidence:'+file.id,text:'Measured 0.73',title:file.title})),warnings:[]})}};
 const context=vm.createContext({structuredClone,console,ChromeUtils:{importESModule:path=>path.includes('workspace-outputs')?WorkspaceOutputs:path.includes('ppt-model')?model:path.includes('ppt-scope')?scope:path.includes('ppt-outline')?outline:policy},Zotero:{Research:E,Utilities:{randomString:()=>String(++counter)},Items:{getAsync:async id=>Array.isArray(id)?id.map(item):item(id)}}});
 for(const name of ['ppt-studio.js','ppt-studio-ai.js'])vm.runInContext(await readFile(new URL(name,root),'utf8'),context,{filename:name});
 const d=await E.studio.create([{id:1,title:'Paper 1'}]);return {E,S:E.studio,id:d.id};
}
test('manual outline add, edit, move and delete use stable IDs and are undoable without touching slides',async()=>{
 const {S,id}=await service();await S.patch(id,d=>{d.slides=[{id:'manual',notes:'keep',blocks:[{text:'Human observation'}]}];});
 const original=S.get(id),row={id:'manual-section',title:'对比实验',purpose:'对比独立采集批次，不混淆训练与测试。',sourceIDs:[],diagram:false};await S.editOutline(id,{type:'add',row});assert.equal(S.get(id).outline.at(-1).id,row.id);
 await S.editOutline(id,{type:'move',id:row.id,delta:-1});assert.equal(S.get(id).outline.at(-2).id,row.id);
 await S.editOutline(id,{type:'update',id:row.id,patch:{purpose:'补充批次差异及其证据。'}});assert.equal(S.get(id).outline.at(-2).purpose,'补充批次差异及其证据。');
 await S.editOutline(id,{type:'remove',id:row.id});assert.equal(S.get(id).outline.some(value=>value.id===row.id),false);await S.history(id);assert.equal(S.get(id).outline.at(-2).id,row.id);await S.history(id,true);assert.equal(S.get(id).outline.some(value=>value.id===row.id),false);assert.deepEqual(S.get(id).slides,original.slides);
});
test('AI changes are reviewable proposals, retain the users exact request, and accept/undo restores the full editable outline',async()=>{
 const {S,id}=await service(),before=S.get(id);let input;S.request=async(system,value)=>{input=value;return {model:'controlled',value:{summary:'新增实验比较',sections:[{...before.outline[0],purpose:'保留封面与汇报范围。'},{title:'实验比较',purpose:'先固定条件，再比较指标；没有结果时列出待补证据。',sourceIDs:['invented']}]}};};
 await S.proposeOutline(id,'新增实验比较，并删去无关的板块');const proposed=S.get(id);assert.equal(input.question,'新增实验比较，并删去无关的板块');assert.deepEqual(proposed.outline,before.outline);assert.equal(proposed.outlineProposal.sections[0].id,before.outline[0].id);assert.deepEqual(proposed.outlineProposal.sections[1].sourceIDs,[]);assert.ok(outline.outlineDiff(proposed.outline,proposed.outlineProposal.sections).some(row=>row.kind==='removed'));
 await S.acceptOutline(id);assert.equal(S.get(id).outline.length,2);assert.equal(S.get(id).outlineProposal,undefined);await S.history(id);assert.deepEqual(S.get(id).outline,before.outline);await S.history(id,true);assert.equal(S.get(id).outline.length,2);
});
test('late AI answers and stale acceptance never overwrite a concurrent manual structure edit',async()=>{
 const {S,id}=await service(),before=S.get(id);let release;S.request=()=>new Promise(resolve=>release=resolve);const pending=S.proposeOutline(id,'调整结构');await S.editOutline(id,{type:'update',id:before.outline[0].id,patch:{title:'人工新标题'}});release({model:'controlled',value:{sections:before.outline}});await assert.rejects(pending,/人工编辑已保留/);assert.equal(S.get(id).outline[0].title,'人工新标题');assert.equal(S.get(id).outlineProposal,undefined);
 S.request=async()=>({model:'controlled',value:{sections:S.get(id).outline}});await S.proposeOutline(id,'检查结构');await S.patch(id,d=>d.outline[0].purpose='继续修改');await assert.rejects(S.acceptOutline(id),/结构已发生变化/);assert.equal(S.get(id).outline[0].purpose,'继续修改');await S.discardOutline(id);assert.equal(S.get(id).outlineProposal,undefined);
});
test('confirming an amended structure preserves generated pages, human notes, images and independent contributions',async()=>{
 const {S,id}=await service(),before=S.get(id),first=before.outline[0].id;await S.patch(id,d=>{d.outline=d.outline.slice(0,1);d.slides=[{id:'kept',outlineID:first,title:'Human title',notes:'Human speaker notes',blocks:[{text:'Human evidence'}],assetIDs:['image'],status:'user_edited'},{id:'independent',notes:'Independent experiment',blocks:[],status:'user'}];});await S.editOutline(id,{type:'add',row:{id:'added',title:'New section',purpose:'New argument',sourceIDs:[],diagram:false}});await S.prepareSlides(id);const d=S.get(id);assert.equal(d.slides[0].id,'kept');assert.equal(d.slides[0].notes,'Human speaker notes');assert.deepEqual(d.slides[0].assetIDs,['image']);assert.equal(d.slides[1].id,'independent','a page outside the outline stays after the page it followed');assert.equal(d.slides[2].outlineID,'added');assert.equal(d.outlineApproved,true);
});
test('drop-selected papers and spreadsheet files persist as report materials and are actually read',async()=>{
 const {S,id}=await service(),before=S.get(id);await S.selectMaterials(id,[{id:'paper-2',kind:'paper',paperItemID:2},{id:'sheet',kind:'spreadsheet',title:'Independent batches.csv',attachmentID:12,paperItemID:12}]);await S.selectMaterials(id,[{id:'paper-2',kind:'paper',paperItemID:2},{id:'sheet',kind:'spreadsheet',title:'Independent batches.csv',attachmentID:12,paperItemID:12}]);let d=S.get(id);assert.deepEqual(d.papers.map(row=>row.id),[1,2]);assert.equal(d.materialFiles.length,1);assert.deepEqual(d.outline,before.outline);assert.equal(d.materialsReady,false);await S.collect(id,()=>{});d=S.get(id);assert.ok(d.sources.some(row=>row.id==='evidence:sheet'&&row.text.includes('0.73')));assert.equal(d.materialsReady,true);
});
test('outline diffs distinguish removals, additions, changed prose and order while rejecting invalid output',()=>{
 const before=[{id:'a',title:'A',purpose:'Purpose A'},{id:'b',title:'B',purpose:'Purpose B'},{id:'c',title:'C',purpose:'Purpose C'}],after=[before[1],{...before[0],purpose:'Revised A'},{id:'d',title:'D',purpose:'Purpose D'}],diff=outline.outlineDiff(before,after);assert.deepEqual(diff.map(row=>row.kind),['moved','changed','added','removed']);assert.throws(()=>outline.normalizeOutline([]),/1–50/);assert.throws(()=>outline.normalizeOutline([{title:'',purpose:'Missing title'}]),/标题/);assert.throws(()=>outline.applyOutlineEdit([before[0]],{type:'remove',id:'a'}),/至少保留/);
});

async function editorFixture(){
 const element=(tag,text,className)=>({tag,textContent:text||'',className:className||'',children:[],dataset:{},style:{},classList:{toggle(){}},setAttribute(){},append(...rows){this.children.push(...rows);}}),d={id:'editable',title:'Meeting',themeID:'academic',assets:[],datasets:[],history:[],redo:[],sources:[],slides:[{id:'first',title:'First page',blocks:[],assetIDs:[],notes:'Human notes'},{id:'second',title:'Second page',blocks:[],assetIDs:[],notes:'Keep second notes'}]},calls={writes:0,renders:0};
 const ui={pptDraft:d,pptSelected:0,E:{studio:{model}},el:element,pptCanvas(){},pptProperties(){},renderPPT(){calls.renders++;},pptField:()=>({value:''}),pptButton(label,action,parent,className){const node=element('button',label,className);node.onclick=action;parent.append(node);return node;},async pptPatch(fn,snapshot){calls.writes++;assert.equal(snapshot,true);fn(d);return d;}},context=vm.createContext({EasySchUI:ui,structuredClone});
 vm.runInContext(await readFile(new URL('../../chrome/content/zotero/research/ui/ppt-editor.js',import.meta.url),'utf8'),context);ui.pptCanvas=ui.pptProperties=()=>{};const body=element('div');ui.pptEditor(body);const find=(node,predicate)=>predicate(node)?node:node.children.map(child=>find(child,predicate)).find(Boolean),list=find(body,node=>node.id==='ppt-slide-list'),canvas=find(body,node=>node.id==='ppt-page-canvas');return {ui,d,calls,element,list,canvas};
}
test('editor material drops keep their page target and bypass slide sorting without rewriting the deck',async()=>{
 const {list,canvas,calls,d}=await editorFixture(),saved=structuredClone(d.slides);let handled=0;const event={dataTransfer:{types:['zotero/item','text/plain'],getData:()=> '12'},preventDefault(){handled++;},stopPropagation(){handled++;}};await list.children[1].ondrop(event);assert.equal(handled,0,'the shared material receiver still receives this event');assert.equal(calls.writes,0);assert.deepEqual(d.slides,saved);assert.equal(canvas.dataset.pageId,'first');
});
test('editor page reordering uses its typed identity, keeps the moved page active and remains undoable',async()=>{
 const {ui,d,list,calls}=await editorFixture(),payload=new Map();list.children[0].ondragstart({dataTransfer:{setData:(type,value)=>payload.set(type,value)}});assert.equal(payload.get('application/x-easysch-ppt-slide'),'first');let handled=0;await list.children[1].ondrop({dataTransfer:{types:[...payload.keys()],getData:type=>payload.get(type)},preventDefault(){handled++;},stopPropagation(){handled++;}});assert.equal(handled,2);assert.deepEqual(d.slides.map(row=>row.id),['second','first']);assert.equal(d.slides[1].notes,'Human notes');assert.equal(ui.pptSelected,1);assert.equal(calls.writes,1);assert.equal(calls.renders,1);
});
test('an editor reopened after deleting its last page selects a newly added page instead of staying at minus one',async()=>{
 const {ui,d,element}=await editorFixture();ui.pptSelected=-1;d.slides=[];ui.pptEditor(element('div'));assert.equal(ui.pptSelected,0);d.slides=[{id:'new',title:'New experiment',blocks:[],assetIDs:[],notes:'New notes'}];const body=element('div');ui.pptEditor(body);assert.equal(ui.pptSelected,0);assert.ok(body.children.some(node=>node.className==='ppt-editor-grid'));
});
