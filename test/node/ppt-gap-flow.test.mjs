/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Gap tests for the PPT wizard UI (R/ui/ppt-main.js, ppt-flow.js, ppt-editor.js) with a
// small fake DOM, backed by the real studio service (X/ppt-studio.js) in a VM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as model from '../../chrome/content/zotero/research/shared/ppt-model.mjs';
import * as scope from '../../chrome/content/zotero/research/shared/ppt-scope.mjs';
import * as outline from '../../chrome/content/zotero/research/shared/ppt-outline.mjs';
import * as policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as outputs from '../../chrome/content/zotero/research/shared/workspace-outputs.mjs';

const xpcom=new URL('../../chrome/content/zotero/xpcom/research/',import.meta.url),ui=new URL('../../chrome/content/zotero/research/ui/',import.meta.url);
async function studio(){
 let state={pptDrafts:{},settings:{}},counter=0;
 const E={store:{get:(...path)=>structuredClone(path.reduce((value,key)=>value?.[key],state)),peek:(...path)=>path.reduce((value,key)=>value?.[key],state),update:async fn=>{const next=structuredClone(state);fn(next);state=next;},flush:async()=>{}},library:{selection:()=>[],describe:value=>({id:value.id,title:'Paper '+value.id}),uri:()=>''},assets:{key:value=>JSON.stringify(value),index:async()=>({assets:[]})}};
 const context=vm.createContext({structuredClone,console,URL,ChromeUtils:{importESModule:path=>path.includes('workspace-outputs')?outputs:path.includes('ppt-model')?model:path.includes('ppt-scope')?scope:path.includes('ppt-outline')?outline:policy},IOUtils:{},PathUtils:{join:(...parts)=>parts.join('/')},Zotero:{Research:E,Utilities:{randomString:()=>'r'+(++counter)},Items:{getAsync:async()=>null},getMainWindow:()=>({AbortController})}});
 for(const name of ['ppt-studio.js','ppt-studio-ai.js'])vm.runInContext(await readFile(new URL(name,xpcom),'utf8'),context,{filename:name});
 return E;
}
function element(tag,text,className){
 return {tag,textContent:text??'',className:className||'',children:[],dataset:{},style:{},hidden:false,disabled:false,value:'',isConnected:true,parentElement:null,
  classList:{add(){},remove(){},toggle(){}},setAttribute(name,value){this['attr:'+name]=String(value);},getAttribute(name){return this['attr:'+name]??null;},removeAttribute(name){delete this['attr:'+name];},
  append(...rows){for(const row of rows){if(row&&typeof row==='object')row.parentElement=this;this.children.push(row);}},prepend(...rows){this.children.unshift(...rows);},replaceChildren(...rows){this.children=[];this.append(...rows);},remove(){},
  querySelector(){return null;},querySelectorAll(){return [];},closest(){return null;},focus(){},select(){},scrollIntoView(){},addEventListener(){},removeEventListener(){}};
}
const walk=(node,found=[])=>{if(node&&typeof node==='object'){found.push(node);for(const child of node.children||[])walk(child,found);}return found;};
const button=(root,text)=>walk(root).find(node=>node.tag==='button'&&(node.textContent===text||walk(node).some(child=>child!==node&&child.textContent===text)));
async function screen(E,files=['ppt-main.js','ppt-flow.js','ppt-editor.js']){
 const view=element('section'),calls={patches:[],renders:0},screenUI={E,status(){},show(){},$:id=>id==='view-ppt'?view:null,el:(tag,text,className)=>element(tag,text,className)};
 const context=vm.createContext({EasySchUI:screenUI,structuredClone,console,setTimeout,clearTimeout,AbortController,window:{frameElement:{researchOverlayMode:'embedded'}},document:{querySelector:()=>element('div')}});
 for(const name of files)vm.runInContext(await readFile(new URL(name,ui),'utf8'),context,{filename:name});
 const patch=screenUI.pptPatch;screenUI.pptPatch=async(fn,history)=>{calls.patches.push(history);return patch.call(screenUI,fn,history);};
 screenUI.renderPPT=()=>{calls.renders++;};screenUI.renderPPTTask=()=>{};screenUI.pptFlushEdits=async()=>false;
 return {ui:screenUI,calls,view};
}

const aiOutline=['研究动机与问题','方法的核心思想','实验结果与边界'].map((title,i)=>({id:'outline-'+i,title,purpose:title+'的讲述任务（人工改写）',diagram:false,sourceIDs:['s'+i]}));
test('PPT-02: a template switch keeps matching sections and says exactly which pages are archived',()=>{
 const slides=aiOutline.map((row,i)=>({id:'slide-'+i,outlineID:row.id,notes:'人工讲稿 '+i})),sections=model.initialOutline('single');
 const none=outline.templateOutlineProposal(aiOutline,slides,sections,{name:'单篇论文精读'});
 assert.doesNotMatch(none.summary,/原有页面和讲稿在确认后继续保留/);
 assert.match(none.summary,/3 个板块不在新模板中/);assert.match(none.summary,/已归档页面/);assert.deepEqual(none.archived.sort(),['outline-0','outline-1','outline-2']);
 const own=[{id:'own-1',title:'研究背景',purpose:'我写的背景讲述',sourceIDs:['s1']},{id:'own-2',title:'局限与质疑',purpose:'我写的质疑',sourceIDs:[]}];
 const kept=outline.templateOutlineProposal(own,[{id:'p1',outlineID:'own-1'},{id:'p2',outlineID:'own-2'}],sections,{name:'单篇论文精读'});
 const background=kept.sections.find(row=>row.id==='own-1'),limits=kept.sections.find(row=>row.id==='own-2');
 assert.equal(background.purpose,'我写的背景讲述','matched section keeps the written task');assert.deepEqual(background.sourceIDs,['s1']);assert.ok(limits);
 assert.equal(new Set(kept.sections.map(row=>row.id)).size,kept.sections.length,'one existing section maps to one template section');
 assert.match(kept.summary,/保留 2 个对应板块/);assert.deepEqual(kept.archived,[]);
});
test('PPT-02: pages archived by a template switch can be restored from the editor with their notes',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([{id:1,title:'Paper 1'}]);
 await S.patch(d.id,x=>{x.outline=structuredClone(aiOutline);x.outlineModel='stub';x.materialsReady=true;});await S.prepareSlides(d.id);
 await S.patch(d.id,x=>{for(const page of x.slides){page.status='user_edited';page.notes='人工讲稿 '+page.id;page.blocks=[{kind:'my_interpretation',text:'内容',evidenceIDs:[]}];}});
 const before=S.get(d.id),proposal=outline.templateOutlineProposal(before.outline,before.slides,model.initialOutline('single'),{name:'单篇论文精读'});
 await S.patch(d.id,x=>{x.outlineProposal={base:outline.outlineFingerprint(x.outline),sections:proposal.sections,templateID:'single',summary:proposal.summary,model:'template'};});
 await S.acceptOutline(d.id);await S.prepareSlides(d.id);
 const archived=S.get(d.id).archivedSlides.map(page=>page.id);assert.equal(archived.length,3);
 const {ui:screenUI}=await screen(E);screenUI.pptDraft=S.get(d.id);
 await screenUI.pptRestoreArchivedPage(archived[0]);
 let restored=S.get(d.id).slides.find(page=>page.id===archived[0]);
 assert.ok(restored,'page is back in the deck');assert.equal(restored.notes,'人工讲稿 '+archived[0]);assert.equal(restored.outlineID,undefined);
 assert.equal(S.get(d.id).archivedSlides.some(page=>page.id===archived[0]),false);
 await S.prepareSlides(d.id);assert.ok(S.get(d.id).slides.some(page=>page.id===archived[0]),'a restored page survives the next confirmation');
 await S.history(d.id);await S.history(d.id);
 const undone=S.get(d.id);assert.ok(undone.archivedSlides.some(page=>page.id===archived[0])||undone.slides.some(page=>page.id===archived[0]),'undo never loses the page');
});
test('PPT-02: the template button proposes a reviewable change whose text matches what confirmation does',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([{id:1,title:'Paper 1'}]);
 await S.patch(d.id,x=>{x.outline=structuredClone(aiOutline);x.outlineModel='stub';x.materialsReady=true;});await S.prepareSlides(d.id);
 const {ui:screenUI,calls}=await screen(E);screenUI.pptDraft=S.get(d.id);const body=element('div');screenUI.pptTemplates(body);
 await button(body,'单篇论文精读').onclick();
 const proposal=S.get(d.id).outlineProposal;assert.ok(proposal,'existing pages get a proposal, not an overwrite');assert.equal(calls.patches.at(-1),false,'a pending proposal is not an undo step');
 assert.doesNotMatch(proposal.summary,/继续保留/);assert.match(proposal.summary,/已归档页面/);assert.deepEqual(S.get(d.id).outline,aiOutline,'the current outline is untouched until accepted');
});
test('PPT-16: template choice on an empty draft, theme choice and PPTX theme import are undoable',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([]);
 const {ui:screenUI,calls}=await screen(E);screenUI.pptDraft=S.get(d.id);
 E.pick=async()=>'/theme.pptx';E.runArtifactEngine=async()=>({id:'imported',name:'导入主题',bg:'FFFFFF',text:'222222',accent:'333333',muted:'444444',soft:'EEEEEE',font:'Microsoft YaHei'});
 const body=element('div');screenUI.pptTemplates(body);
 await button(body,'多篇文献综述').onclick();assert.equal(S.get(d.id).templateID,'review');assert.equal(calls.patches.at(-1),true,'empty-draft template change records history');
 await button(body,'学术深色').onclick();assert.equal(S.get(d.id).themeID,'dark');assert.equal(calls.patches.at(-1),true,'theme change records history');
 await button(body,'导入 PPTX 模板').onclick();assert.equal(S.get(d.id).themeID,'imported');assert.equal(calls.patches.at(-1),true,'imported theme records history');
 await S.history(d.id);assert.equal(S.get(d.id).themeID,'dark','undo reverts only the import');
 await S.history(d.id);assert.equal(S.get(d.id).themeID,'light');assert.equal(S.get(d.id).templateID,'review');
});
