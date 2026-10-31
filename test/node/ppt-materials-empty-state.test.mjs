/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The 汇报材料 card shows one empty state: the drop zone names both ways to add
// material, and a files-only draft gets no paper placeholder under its cards.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as model from '../../chrome/content/zotero/research/shared/ppt-model.mjs';
import * as scope from '../../chrome/content/zotero/research/shared/ppt-scope.mjs';
import * as outline from '../../chrome/content/zotero/research/shared/ppt-outline.mjs';
import * as policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as outputs from '../../chrome/content/zotero/research/shared/workspace-outputs.mjs';

const xpcom=new URL('../../chrome/content/zotero/xpcom/research/',import.meta.url),uiDir=new URL('../../chrome/content/zotero/research/ui/',import.meta.url);
async function studio(){
 let state={pptDrafts:{},settings:{}},counter=0;
 const E={store:{get:(...path)=>structuredClone(path.reduce((value,key)=>value?.[key],state)),peek:(...path)=>path.reduce((value,key)=>value?.[key],state),update:async fn=>{const next=structuredClone(state);fn(next);state=next;},flush:async()=>{}},library:{selection:()=>[],describe:value=>({id:value.id,title:'Paper '+value.id}),uri:()=>''},assets:{key:value=>JSON.stringify(value),index:async()=>({assets:[]})}};
 const context=vm.createContext({structuredClone,console,URL,ChromeUtils:{importESModule:path=>path.includes('workspace-outputs')?outputs:path.includes('ppt-model')?model:path.includes('ppt-scope')?scope:path.includes('ppt-outline')?outline:policy},IOUtils:{},PathUtils:{join:(...parts)=>parts.join('/')},Zotero:{Research:E,Utilities:{randomString:()=>'r'+(++counter)},Items:{getAsync:async()=>null},getMainWindow:()=>({AbortController})}});
 for(const name of ['ppt-studio.js','ppt-studio-ai.js'])vm.runInContext(await readFile(new URL(name,xpcom),'utf8'),context,{filename:name});
 return E;
}
const matches=(node,selector)=>selector.startsWith('#')?node.id===selector.slice(1):selector.startsWith('.')?String(node.className).split(/\s+/).includes(selector.slice(1)):node.tag===selector;
const descendants=(node,found=[])=>{for(const child of node.children||[])if(child&&typeof child==='object'){found.push(child);descendants(child,found);}return found;};
function element(tag,text,className){
 return {tag,textContent:text??'',className:className||'',id:'',children:[],dataset:{},style:{},attributes:{},hidden:false,disabled:false,value:'',isConnected:true,parentElement:null,
  classList:{add(){},remove(){},toggle(){}},
  setAttribute(name,value){this.attributes[name]=String(value);},getAttribute(name){return this.attributes[name]??null;},removeAttribute(name){delete this.attributes[name];},
  append(...rows){for(const row of rows){if(row&&typeof row==='object')row.parentElement=this;this.children.push(row);}},
  prepend(...rows){for(const row of rows)if(row&&typeof row==='object')row.parentElement=this;this.children.unshift(...rows);},
  replaceChildren(...rows){this.children=[];this.append(...rows);},
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);},
  querySelectorAll(selector){const parts=selector.split(',').map(part=>part.trim());return descendants(this).filter(child=>parts.some(part=>matches(child,part)));},
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;},
  closest(selector){const parts=selector.split(',').map(part=>part.trim());for(let current=this;current;current=current.parentElement)if(parts.some(part=>matches(current,part)))return current;return null;},
  get lastElementChild(){return this.children.filter(child=>child&&typeof child==='object').at(-1)||null;},
  cloneNode(){const copy=element(this.tag,this.textContent,this.className);copy.value=this.value;return copy;},
  focus(){},select(){},scrollIntoView(){},addEventListener(){},removeEventListener(){}};
}
async function screen(E){
 const view=element('section');view.id='view-ppt';
 const page={E,status(){},show(){},el:(tag,text,className)=>element(tag,text,className),$:id=>id==='view-ppt'?view:descendants(view).find(node=>node.id===id)||null};
 const context=vm.createContext({EasySchUI:page,structuredClone,console,setTimeout,clearTimeout,AbortController,window:{frameElement:{researchOverlayMode:'embedded'},addEventListener(){}},document:{querySelector:()=>element('div')}});
 for(const name of ['ppt-main.js','ppt-flow.js','ppt-editor.js'])vm.runInContext(await readFile(new URL(name,uiDir),'utf8'),context,{filename:name});
 page.renderPPT=()=>{};page.renderPPTTask=()=>{};
 return page;
}
const list=body=>descendants(body).find(node=>node.id==='ppt-material-list');
const visibleDrop=body=>descendants(body).filter(node=>String(node.className).includes('ppt-material-dropzone')&&!node.hidden);

test('an empty 汇报材料 card has one empty state that names both ways to add material',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([]),ui=await screen(E);ui.pptDraft=S.get(d.id);
 const body=element('div');ui.pptMaterials(body);
 assert.equal(list(body).children.length,0,'no separate paper placeholder in the list');
 const drop=visibleDrop(body);
 assert.equal(drop.length,1);
 assert.equal(drop[0].textContent,'选择一篇深入讲解或多篇对照，也可从左侧拖入论文、表格、图片或文字资料');
});

test('a draft with only files shows its file cards without a paper placeholder or drop zone',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([]);
 await S.patch(d.id,x=>{x.materialFiles=[{id:'f1',kind:'spreadsheet',title:'实验对照.xlsx'}];});
 const ui=await screen(E);ui.pptDraft=S.get(d.id);
 const body=element('div');ui.pptMaterials(body);
 assert.deepEqual(list(body).children.map(node=>node.className),['ppt-paper-card ppt-file-card']);
 assert.equal(visibleDrop(body).length,0);
});
