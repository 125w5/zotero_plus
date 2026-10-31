/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The images and diagrams stage (R/ui/ppt-flow.js pptVisuals) shows one primary action:
// filling pages while any page is pending or failed, otherwise moving to the next stage.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const ui=new URL('../../chrome/content/zotero/research/ui/',import.meta.url);
function element(tag,text,className){
 const node={tag,textContent:text??'',className:className||'',children:[],dataset:{},style:{},hidden:false,disabled:false,isConnected:true,parentElement:null,
  setAttribute(name,value){this['attr:'+name]=String(value);},getAttribute(name){return this['attr:'+name]??null;},removeAttribute(name){delete this['attr:'+name];},
  append(...rows){for(const row of rows){if(row&&typeof row==='object')row.parentElement=this;this.children.push(row);}}};
 const names=()=>node.className.split(/\s+/).filter(Boolean),write=(list)=>{node.className=list.join(' ');};
 node.classList={add:(...values)=>write([...new Set([...names(),...values])]),remove:(...values)=>write(names().filter(name=>!values.includes(name))),toggle:(name,force)=>{const on=force??!names().includes(name);if(on)node.classList.add(name);else node.classList.remove(name);return on;},contains:name=>names().includes(name)};
 return node;
}
const walk=(node,found=[])=>{if(node&&typeof node==='object'){found.push(node);for(const child of node.children||[])walk(child,found);}return found;};
async function stage(slides){
 const screenUI={E:{studio:{generateRemaining:async()=>{}},previewImage:async()=>''},status(){},el:(tag,text,className)=>element(tag,text,className)};
 const context=vm.createContext({EasySchUI:screenUI,console,setTimeout,clearTimeout,AbortController});
 for(const name of ['ppt-main.js','ppt-flow.js'])vm.runInContext(await readFile(new URL(name,ui),'utf8'),context,{filename:name});
 screenUI.pptDraft={id:'deck',title:'组会',assets:[],outline:[],slides:slides.map((status,i)=>({id:'page-'+i,title:'第 '+(i+1)+' 页',status,blocks:[],assetIDs:[]}))};
 const body=element('div');screenUI.pptVisuals(body);
 const toolbar=walk(body).find(node=>node.className==='ppt-stage-actions'),buttons=walk(toolbar).filter(node=>node.tag==='button'),find=label=>buttons.find(node=>node.textContent===label);
 return {fill:find('补齐未完成页面'),next:find('加入我的理解或实验'),primary:buttons.filter(node=>node.classList.contains('primary')).map(node=>node.textContent)};
}

test('PPT visuals: pages still to fill make filling the only primary action',async()=>{
 for(const pending of [['generated','pending'],['user','failed']]){
  const {fill,next,primary}=await stage(pending);
  assert.ok(fill&&next,'both actions stay in the stage action row');
  assert.deepEqual(primary,['补齐未完成页面'],pending.join('+'));
  assert.equal(next.className,'ppt-control','moving on is an ordinary button while pages remain');assert.equal(next.id,'ppt-next');
 }
});
test('PPT visuals: when every page is done, moving on is the only primary action',async()=>{
 for(const done of [['generated','user_edited'],['user'],[]]){
  const {fill,primary}=await stage(done);
  assert.deepEqual(primary,['加入我的理解或实验'],done.join('+')||'no pages');
  assert.equal(fill.className,'ppt-control','filling does nothing here, so it is not primary');
 }
});
