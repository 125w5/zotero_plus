/* SPDX-License-Identifier: AGPL-3.0-or-later */
// E.store.update() hands its mutator a path-copying draft, a Proxy that structuredClone rejects.
// The other PPT tests use a fake store that passes a structuredClone copy instead, so these run the
// studio service (X/ppt-studio.js) and the editor (R/ui/ppt-editor.js) on the real X/storage.js store.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {types} from 'node:util';
import vm from 'node:vm';
import * as model from '../../chrome/content/zotero/research/shared/ppt-model.mjs';
import * as scope from '../../chrome/content/zotero/research/shared/ppt-scope.mjs';
import * as outline from '../../chrome/content/zotero/research/shared/ppt-outline.mjs';
import * as policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as outputs from '../../chrome/content/zotero/research/shared/workspace-outputs.mjs';

const xpcom=new URL('../../chrome/content/zotero/xpcom/research/',import.meta.url),uiDir=new URL('../../chrome/content/zotero/research/ui/',import.meta.url);
const run=async(context,dir,name)=>vm.runInContext(await readFile(new URL(name,dir),'utf8'),context,{filename:name});
async function studio(){
 let counter=0;const E={library:{selection:()=>[],describe:value=>({id:value.id,title:'Paper '+value.id}),uri:()=>''},assets:{key:value=>JSON.stringify(value),index:async()=>({assets:[]})}};
 const context=vm.createContext({structuredClone,console,URL,EasySch:E,ChromeUtils:{importESModule:path=>path.includes('workspace-outputs')?outputs:path.includes('ppt-model')?model:path.includes('ppt-scope')?scope:path.includes('ppt-outline')?outline:policy},IOUtils:{},PathUtils:{join:(...parts)=>parts.join('/')},Zotero:{Research:E,logError(){},Utilities:{randomString:()=>'r'+(++counter)},Items:{getAsync:async()=>null}}});
 await run(context,xpcom,'storage.js');E.store=E.createStore({read:async()=>({version:1,papers:{},projects:{},settings:{}}),write:async()=>{}});await E.store.init();
 for(const name of ['ppt-studio.js','ppt-studio-ai.js'])await run(context,xpcom,name);
 const S=E.studio,{id}=await S.create([{id:1,title:'Paper 1'}]);
 await S.patch(id,d=>{d.slides=[{id:'page1',outlineID:d.outline[0].id,title:'研究方法与实验条件',explanation:'先说明研究问题。',blocks:[],assetIDs:[],notes:'人工讲稿原样保留',status:'user'},{id:'page2',title:'数据与适用边界',explanation:'',blocks:[],assetIDs:[],notes:'第二页讲稿',status:'pending'}];d.archivedSlides=[{id:'old',outlineID:'removed-section',title:'归档页',blocks:[],assetIDs:[],notes:'归档讲稿'}];});
 return {E,S,id,context};
}
// Values read from the VM are compared as plain data of this realm.
const plain=value=>JSON.parse(JSON.stringify(value));
// Committed data is plain: no draft Proxy outlives its transaction.
const proxyIn=value=>value!==null&&typeof value==='object'&&(types.isProxy(value)||Object.keys(value).some(key=>proxyIn(value[key])));

test('a snapshot write, undo and redo run on the real store draft and keep each page as it was',async()=>{
 const {E,S,id}=await studio(),edited=await S.patch(id,d=>{d.slides[0].title='改后标题';},{snapshot:true});
 assert.equal(edited.slides[0].title,'改后标题');assert.equal(edited.history.length,1);assert.equal(edited.redo.length,0);
 const [saved]=edited.history;assert.equal(saved.slides[0].title,'研究方法与实验条件','the snapshot keeps the page before the edit');assert.equal(saved.slides[0].notes,'人工讲稿原样保留');assert.equal(saved.archivedSlides[0].notes,'归档讲稿');assert.equal(saved.outline.length,edited.outline.length);
 await S.history(id);let d=S.get(id);assert.equal(d.slides[0].title,'研究方法与实验条件');assert.equal(d.slides[0].notes,'人工讲稿原样保留');assert.deepEqual([d.history.length,d.redo.length],[0,1]);
 await S.history(id,true);d=S.get(id);assert.equal(d.slides[0].title,'改后标题');assert.deepEqual([d.history.length,d.redo.length],[1,0]);
 d=await S.addContribution(id,{title:'我的理解与实验',text:'保留人工实验记录与独立批次的观察。',kind:'unverified',notes:'人工记录：不能改成论文实验结论。'},'page1');
 assert.match(d.slides[1].id,/^user-/);assert.equal(d.slides[1].notes,'人工记录：不能改成论文实验结论。');assert.equal(d.history.length,2);
 const committed=E.store.peek('pptDrafts',id);assert.equal(proxyIn(committed),false);assert.doesNotThrow(()=>structuredClone(committed));
});

test('manual outline add, edit, move, undo and redo run on the real store draft',async()=>{
 const {S,id}=await studio(),base=S.get(id).outline,row={id:'manual-section',title:'人工补充讨论',purpose:'围绕独立批次实验整理可验证问题。',diagram:false,sourceIDs:[]};
 await S.editOutline(id,{type:'add',row});assert.equal(S.get(id).outline.at(-1).id,row.id);
 await S.editOutline(id,{type:'update',id:row.id,patch:{purpose:'补充批次差异及其证据。'}});assert.equal(S.get(id).outline.at(-1).purpose,'补充批次差异及其证据。');
 await S.editOutline(id,{type:'move',id:row.id,delta:-1});assert.equal(S.get(id).outline.at(-2).id,row.id);
 await S.history(id);let d=S.get(id);assert.equal(d.outline.at(-1).id,row.id,'undo restores the order');assert.equal(d.outline.at(-1).purpose,'补充批次差异及其证据。');assert.deepEqual([d.history.length,d.redo.length],[2,1]);
 await S.history(id);await S.history(id);d=S.get(id);assert.deepEqual(plain(d.outline),plain(base),'undoing every edit restores the outline');assert.equal(d.redo.length,3);
 await S.history(id,true);assert.equal(S.get(id).outline.at(-1).purpose,row.purpose,'redo restores the added section');
});

test('an accepted AI structure proposal and its undo run on the real store draft',async()=>{
 const {S,id}=await studio(),base=S.get(id).outline;
 S.request=async(system,input)=>({model:'controlled-structure-review',value:{summary:'保留研究问题，并新增实验比较。',sections:[{...input.outline[0],purpose:'先界定独立批次问题，再说明研究范围。'},{title:'实验比较',purpose:'固定采集条件，比较证据并列出待补实验。',sourceIDs:[],diagram:false}]}});
 await S.proposeOutline(id,'请新增一个实验比较板块，并调整结构');assert.equal(S.get(id).outline.length,base.length,'a proposal does not replace the outline');
 await S.acceptOutline(id);const accepted=S.get(id);
 assert.deepEqual(plain(accepted.outline.map(row=>row.title)),[base[0].title,'实验比较']);assert.equal(accepted.outline[0].id,base[0].id);assert.equal(accepted.outlineProposal,undefined);assert.equal(accepted.history.length,1);
 await S.history(id);const undone=S.get(id);assert.deepEqual(plain(undone.outline),plain(base),'undo restores the outline before the proposal');assert.equal(undone.redo.length,1);
});

// A fake page for R/ui/ppt-main.js and ppt-editor.js; the editor's canvas and property panel are not needed here.
// The buttons' running state belongs to pptButton and is tested in ppt-gap-main.test.mjs; this test checks only what the store holds.
const element=(tag,text,className)=>({tag,textContent:text??'',className:className||'',id:'',children:[],dataset:{},style:{},attributes:{},disabled:false,classList:{toggle(){}},setAttribute(name,value){this.attributes[name]=String(value);},getAttribute(name){return this.attributes[name]??null;},removeAttribute(name){delete this.attributes[name];},append(...rows){this.children.push(...rows);}});
const find=(node,predicate)=>predicate(node)?node:(node.children||[]).map(child=>find(child,predicate)).find(Boolean);
test('copying the current page and restoring an archived page write through the real store draft',async()=>{
 const {E,S,id,context}=await studio(),statuses=[],ui={E,el:element,status:(message,error)=>statuses.push({message,error})};context.EasySchUI=ui;
 for(const name of ['ppt-main.js','ppt-editor.js'])await run(context,uiDir,name);
 ui.renderPPT=ui.pptCanvas=ui.pptProperties=()=>{};ui.pptDraft=S.get(id);ui.pptSelected=0;
 let body=element('div');ui.pptEditor(body);const copy=find(body,node=>node.textContent==='复制本页'),job=copy.onclick();
 copy.onclick();await job;assert.deepEqual(statuses,[],'copying reports no error');
 let d=S.get(id);const copied=d.slides[1];
 assert.deepEqual(plain(d.slides.map(row=>row.id)),['page1',copied.id,'page2'],'a second click while copying adds nothing');assert.match(copied.id,/^copy-/);assert.equal(copied.notes,'人工讲稿原样保留');assert.equal(copied.outlineID,undefined);assert.equal(d.slides[0].outlineID,d.outline[0].id);assert.equal(d.history.length,1);
 body=element('div');ui.pptEditor(body);const restore=find(body,node=>node.textContent==='恢复：归档页');await restore.onclick();assert.deepEqual(statuses,[],'restoring reports no error');
 d=S.get(id);assert.deepEqual(plain(d.slides.map(row=>row.id)),['page1',copied.id,'old','page2'],'the archived page returns after the current page');assert.equal(d.slides[2].notes,'归档讲稿');assert.equal(d.slides[2].outlineID,undefined);assert.equal(d.archivedSlides.length,0);assert.equal(d.history.length,2);assert.equal(ui.pptSelected,2);
 const revision=E.store.revision;await restore.onclick();
 assert.deepEqual(statuses,[{message:'这页已恢复或不在归档中',error:true}],'a refused restore is reported');assert.equal(E.store.revision,revision,'and writes nothing');
 assert.equal(proxyIn(E.store.peek('pptDrafts',id)),false);
});
