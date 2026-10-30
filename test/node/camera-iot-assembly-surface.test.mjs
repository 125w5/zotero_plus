/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {notebookBrowser} from '../../chrome/content/zotero/research/notebook-browser.mjs';
import {installPreparationTools} from '../../chrome/content/zotero/research/notebook-preparation.mjs';

class Element{
 constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.value='';this.attributes=new Map();this.listeners=new Map();this.isConnected=true;this.className='';this.classList={toggle:(name,value)=>{const names=new Set(this.className.split(' ').filter(Boolean));value?names.add(name):names.delete(name);this.className=[...names].join(' ');},contains:name=>this.className.split(' ').includes(name)};}
 set textContent(value){this._text=String(value);this.children=[];}get textContent(){return (this._text||'')+this.children.map(node=>node.textContent).join('');}
 append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}prepend(...nodes){for(const node of nodes)node.parentElement=this;this.children.unshift(...nodes);}
 replaceChildren(...nodes){this._text='';this.children=[];this.append(...nodes);}get firstChild(){return this.children[0]||null;}
 before(node){this.parentElement?.append(node);}after(node){this.parentElement?.append(node);}
 matches(selector){return selector.split(',').some(part=>part[0]==='.'?this.classList.contains(part.slice(1)):part[0]==='#'?this.id===part.slice(1):this.tagName===part);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}querySelectorAll(selector){return this.children.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]);}
 closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)||null;}contains(node){return node===this||this.children.some(child=>child.contains(node));}
 setAttribute(key,value){this.attributes.set(key,String(value));}getAttribute(key){return this.attributes.get(key);}addEventListener(key,run){this.listeners.set(key,run);}removeEventListener(key){this.listeners.delete(key);}focus(){}getClientRects(){return [{}];}
}
function documentFixture(){const listeners=new Map(),doc={hidden:false,activeElement:null,addEventListener:(key,run)=>listeners.set(key,run),removeEventListener:key=>listeners.delete(key),defaultView:{addEventListener(){},removeEventListener(){}}};doc.createElement=tag=>new Element(tag,doc);doc.createElementNS=(_,tag)=>doc.createElement(tag);doc.createTextNode=text=>{const node=doc.createElement('text');node.textContent=text;return node;};doc.body=doc.createElement('body');doc.querySelector=selector=>doc.body.querySelector(selector);doc.getElementById=id=>doc.querySelector('#'+id);const el=(tag,text,cls)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};const button=(text,action,host,cls)=>{const node=el('button',text,cls);node.onclick=action;host?.append(node);return node;};return {doc,el,button,listeners};}

test('the top project refresh updates prepared-paper candidates and preserves unsaved choices after import',async()=>{
 const {doc,el,button}=documentFixture(),previous=globalThis.document;globalThis.document=doc;
 try{
  const ids=new Map(),$=id=>{if(!ids.has(id)){const node=el(id.includes('search')?'input':'div');node.id=id;ids.set(id,node);doc.body.append(node);}return ids.get(id);};
  $('evaluation').append(el('div',undefined,'preparation-actions'));const project={title:'Camera IoT',ui:{},readingSelection:{}},state={view:'read'};
  let rows=[1,2].map(id=>({id,title:'Camera IoT '+id,collectionIDs:[17],folderNames:['项目']})),selected=[1,2],saved;
  const N={project:()=>project,state:()=>state,paperFolders:async()=>({collections:[{id:17,name:'项目'}]}),ensureProjectCollection:async()=>({collectionID:17,name:'项目',papers:rows,selectedPaperIDs:selected}),preparationLibrary:async()=>({papers:structuredClone(rows),folders:[{id:17,name:'项目',paperCount:rows.length}],selectedPaperIDs:selected.slice(),collectionIDs:[17],featuredPaperIDs:[],researchScope:{}}),setPreparationSources:async(_id,value)=>{saved=value;},saveReadingSelection:async()=>{}};
  let tools;const browser=notebookBrowser({E:{},N,A:{},id:'study',$,el,button,status:()=>{},run:async fn=>fn(),onPaperScopeRefresh:()=>tools.refreshLocal()});
  tools=installPreparationTools({E:{},N,A:{},id:'study',$,el,button,status:()=>{},run:async fn=>fn(),refreshPapers:()=>browser.refreshPaperSelection()});
  await browser.refreshPaperSelection();const list=doc.querySelector('.preparation-local-papers');assert.equal(list.children.length,2);const unchecked=list.children[1].children[0];unchecked.checked=false;unchecked.onchange();
  rows.push({id:3,title:'Camera IoT newly imported',collectionIDs:[17],folderNames:['项目']});selected.push(3);
  const refresh=doc.querySelector('.preparation-paper-actions').children.find(node=>node.textContent==='刷新');await refresh.onclick();
  assert.equal(list.children.length,3,'the already-open candidate list includes the import');assert.equal(list.children.find(node=>node.dataset.paperId===2).children[0].checked,false);assert.equal(list.children.find(node=>node.dataset.paperId===3).children[0].checked,true);
  await tools.prepareForAssessment();assert.deepEqual(saved.paperIDs.sort(),[1,3]);tools.destroy();
 }finally{globalThis.document=previous;}
});

test('preparation selects all filtered candidates across pages while retaining selections outside the filter',async()=>{
 const {doc,el,button}=documentFixture(),previous=globalThis.document;globalThis.document=doc;
 try{const ids=new Map(),$=id=>{if(!ids.has(id)){const node=el('div');node.id=id;ids.set(id,node);doc.body.append(node);}return ids.get(id);};$('evaluation').append(el('div',undefined,'preparation-actions'));
  const rows=Array.from({length:70},(_,index)=>({id:index+1,title:(index<40?'Subset':'Other')+' method '+index,collectionIDs:[17]})),project={title:'项目',ui:{},readingSelection:{}},state={view:'read'};let saved;
  const N={project:()=>project,state:()=>state,preparationLibrary:async()=>({papers:rows,folders:[],selectedPaperIDs:[70],collectionIDs:[],featuredPaperIDs:[],researchScope:{}}),setPreparationSources:async(_id,value)=>{saved=value;},saveReadingSelection:async()=>{}};
  const tools=installPreparationTools({E:{},N,A:{},id:'p',$,el,button,status:()=>{},run:async fn=>fn()});await tools.refreshLocal();const list=doc.querySelector('.preparation-local-papers'),query=doc.querySelector('.preparation-local-tools').children[0],all=doc.querySelector('.preparation-paper-select-all').children[0];assert.equal(list.children.length,24);
  query.value='Subset';query.oninput();await new Promise(resolve=>setTimeout(resolve,210));all.checked=true;all.onchange();await tools.prepareForAssessment();assert.equal(saved.paperIDs.length,41);assert.ok(saved.paperIDs.includes(70));assert.ok(saved.paperIDs.includes(40),'全选包含尚未渲染的第二页候选');assert.equal(all.indeterminate,false);all.checked=false;all.onchange();await tools.prepareForAssessment();assert.deepEqual(saved.paperIDs,[70],'取消筛选结果的选择保留其他查询下的勾选');tools.destroy();
 }finally{globalThis.document=previous;}
});

test('project cards refresh after editor saves on returning home and preserve a focused search or creation dialog',async()=>{
 const {doc,el,listeners}=documentFixture(),windowListeners=new Map(),timers=new Map();let serial=0,listener,disposed=false,reads=0;
 const window={addEventListener:(key,run)=>windowListeners.set(key,run),removeEventListener:key=>windowListeners.delete(key)},host=el('div');doc.body.append(host);
 const ui={activeView:'writing',E:{store:{subscribe:run=>{listener=run;return()=>{disposed=true;};}},manuscripts:{all:()=>{reads++;return {study:{id:'study',title:'Camera IoT',sections:Array.from({length:5},(_,id)=>({id})),blocks:Array.from({length:ui.blocks},(_,id)=>({id,materials:[]}))}};}},notebook:{state:()=>({versions:[]})}},el,$:id=>id==='view-writing'?host:doc.querySelector('#'+id),blocks:0};
 const code=await readFile(new URL('../../chrome/content/zotero/research/ui/manuscript-projects.js',import.meta.url),'utf8');vm.runInNewContext(code,{EasySchUI:ui,document:doc,window,setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id)});ui.initManuscriptProjects();
 ui.blocks=5;ui.activeView='reader';listener({changedBranches:['manuscripts']});for(const fn of [...timers.values()])fn();assert.equal(reads,1,'the hidden home page does not rebuild per editor save');
 ui.activeView='writing';windowListeners.get('focus')();assert.equal(reads,2);assert.equal(ui.$('manuscript-projects').querySelector('.project-card-facts').children[1].textContent,'5 模块');
 const search=el('input');ui.$('manuscript-projects').append(search);doc.activeElement=search;ui.blocks=6;listener({changedBranches:['manuscripts']});for(const fn of [...timers.values()])fn();assert.equal(reads,2);doc.activeElement=null;host.listeners.get('focusout')();for(const fn of [...timers.values()])fn();assert.equal(reads,3);assert.equal(ui.$('manuscript-projects').querySelector('.project-card-facts').children[1].textContent,'6 模块');
 const dialog=el('dialog',undefined,'project-create-dialog');ui.$('manuscript-projects').append(dialog);listener();for(const fn of [...timers.values()])fn();assert.equal(reads,3,'a new-project dialog is never destroyed by an unrelated save');windowListeners.get('pagehide')();assert.equal(disposed,true);assert.equal(timers.size,0);
});
