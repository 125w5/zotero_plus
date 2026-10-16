/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../../chrome/content/zotero/research/ui/agent-workbench.js',import.meta.url),'utf8');
function fixture(){
 const ui={},calls={all:0,project:0,workspace:0,materials:0,paging:0},revisions={manuscripts:1,researchMaterials:1,tasks:1,materialDescriptions:1,settings:1},timers=new Map();let sequence=0;
 const node=(tag,text='',className='')=>({tag,textContent:text,className,dataset:{},children:[],value:'',scrollTop:0,append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;this.replacements=(this.replacements||0)+1;},setAttribute(key,value){this[key]=value;},contains(){return false;},querySelectorAll(){return [];}});
 vm.runInNewContext(source,{EasySchUI:ui,document:{querySelectorAll:()=>[],activeElement:null},setTimeout:fn=>{const id=++sequence;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
 ui.el=node;ui.agentButton=(label,action,className)=>node('button',label,className);ui.agentOption=(value,label)=>({...node('option',label),value});ui.agentProjectSelect=node('select');ui.agentSourceList=node('div');ui.agentData={activeSessionID:'a',projectID:'p1',selectedID:''};ui.agentTab='sources';ui.agentQuery='';ui.agentWebSources=[];ui.agentSources=[{id:1,title:'论文一',journal:'期刊',year:2026}];ui.renderAgentSessions=()=>{};ui.installAgentPaging=()=>calls.paging++;
 ui.E={store:{branchRevision:key=>revisions[key],get(key){if(!key)calls.workspace++;return key==='settings'?{discoveryDestination:{projectID:'p1',collectionID:9}}:undefined;}},manuscripts:{all(){calls.all++;return {p1:{id:'p1',title:'研究一'},p2:{id:'p2',title:'研究二'}};},get(id){calls.project++;return {id,title:'研究一',paperCollectionID:9,materialPaperIDs:[1]};},summaryFor:row=>row.summary||'',summaryReader:()=>row=>row.summary||''}};
 ui.agentMaterials=()=>{calls.materials++;return [{id:'m1',title:'素材',summary:'完整说明'}];};ui.agentCatalog={searchMaterials:rows=>rows.map(m=>({m}))};ui.discoveryCollectionRows=[{id:9,path:'我的文库 / 研究资料'}];
 return {ui,calls,revisions,timers,flush(){for(const [id,fn]of timers){timers.delete(id);fn();}}};
}

test('conversation-only saves skip project scans and source refresh while legacy and material changes remain observable',()=>{
 const {ui,calls,revisions,timers,flush}=fixture();ui.activeView='agent';ui.refreshAgentProjects();assert.equal(calls.all,1);
 for(let index=0;index<30;index++){ui.receiveAgentStoreChange({revision:index+2,changedBranches:['researchWorkbench']});ui.refreshAgentProjects();}assert.equal(calls.all,1);assert.equal(timers.size,0);ui.agentData.projectID='p2';ui.refreshAgentProjects();assert.equal(ui.agentProjectSelect.value,'p2','selection changes still work with cached project choices');
 revisions.manuscripts++;ui.receiveAgentStoreChange({changedBranches:['manuscripts']});assert.equal(calls.all,2);assert.equal(timers.size,1);flush();assert.equal(calls.paging,1);ui.receiveAgentStoreChange();assert.equal(timers.size,1,'older stores with no change metadata retain conservative refresh');ui.agentDisposed=true;flush();assert.equal(calls.paging,1,'pending refresh does not render a closed workspace');
});

test('shared rail context reads only settings and caches project metadata across unchanged conversation renders',()=>{
 const {ui,calls,revisions}=fixture();for(let index=0;index<30;index++)assert.equal(ui.agentWorkspaceContext().folder,'我的文库 / 研究资料');assert.equal(calls.workspace,0);assert.equal(calls.project,1);revisions.manuscripts++;ui.agentWorkspaceContext();assert.equal(calls.project,2);ui.agentData.projectID='p2';ui.agentWorkspaceContext();assert.equal(calls.project,3);
});

test('unchanged source notifications retain rows, scroll and selection while changed inputs invalidate the local result',()=>{
 const {ui,calls,revisions}=fixture();ui.renderAgentSources();const row=ui.agentSourceList.children[0];ui.agentSourceList.scrollTop=180;for(let index=0;index<30;index++)ui.renderAgentSources();assert.equal(ui.agentSourceList.replacements,1);assert.equal(ui.agentSourceList.children[0],row);assert.equal(ui.agentSourceList.scrollTop,180);assert.equal(calls.project,1);assert.equal(calls.paging,1);
 ui.agentData.selectedID='paper:1';ui.renderAgentSources();assert.equal(ui.agentSourceList.children[0]['aria-selected'],'true');ui.agentTab='materials';ui.renderAgentSources();assert.equal(calls.materials,1);ui.renderAgentSources();assert.equal(calls.materials,1);revisions.materialDescriptions++;ui.renderAgentSources();assert.equal(calls.materials,2,'new translated material descriptions are displayed');ui.agentSources=[...ui.agentSources];ui.renderAgentSources();assert.equal(calls.materials,3,'fresh library candidates invalidate even without a store mutation');
});
