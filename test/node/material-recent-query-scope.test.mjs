/* SPDX-License-Identifier: AGPL-3.0-or-later */
// A recent query chosen under the assembly material search box keeps its
// results. The notebook subscription that init() installs restores the browse
// keyword saved in the project on every query change, so the choice must be
// saved there first, as findEvidence does. Runs the real material-library.mjs
// history buttons, material-research-filters.mjs and the subscription of main.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Filters from '../../chrome/content/zotero/research/manuscript/material-research-filters.mjs';
import * as Catalog from '../../chrome/content/zotero/research/shared/material-catalog.mjs';

const read=async path=>(await readFile(new URL('../../chrome/content/zotero/research/'+path,import.meta.url),'utf8')).replace(/\r/g,'');
const library=(await read('manuscript/material-library.mjs')).replace(/^import [^\n]*\n/gm,'').replace(/^export /gm,'');
const main=await read('manuscript/main.mjs'),from='U.E.notebook.subscribe(',start=main.indexOf(from)+from.length,subscription=main.slice(start,main.indexOf(');Object.assign(U,{persist,',start));
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};

class Node{
	constructor(tag,text){this.tag=tag;this.children=[];this.attributes={};this.hidden=false;this.value='';this.textContent=text??'';this.parent=null;}
	get isConnected(){return true;}
	append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
	replaceChildren(...nodes){this.children=[];this.append(...nodes);}
	contains(node){for(let at=node;at;at=at.parent)if(at===this)return true;return false;}
	setAttribute(name,value){this.attributes[name]=String(value);}
	addEventListener(){}
	focus(){document.activeElement=this;}
}
const document={activeElement:null,addEventListener(){}};

function load({browse,recent}){
	const input=new Node('input'),host=new Node('div'),nodes={'material-search':input,'material-search-history':host},saves={count:0},renders={count:0};host.id='material-search-history';
	const N={data:{query:browse,recentQueries:recent},listeners:new Set(),state(){return structuredClone(this.data);},subscribe(fn){this.listeners.add(fn);return ()=>this.listeners.delete(fn);},
		// The notebook service emits only real changes, after its store commit.
		async update(id,change){if(Object.entries(change).every(([name,value])=>JSON.stringify(this.data[name])===JSON.stringify(value)))return;await null;Object.assign(this.data,structuredClone(change));for(const fn of this.listeners)fn(id,change);},
		async rememberQuery(id,query){if(!query.trim())return;await this.update(id,{recentQueries:[query.trim(),...(this.data.recentQueries||[]).filter(row=>row!==query.trim())].slice(0,8)});}};
	const U={E:{notebook:N},p:{id:'p',materials:[],blocks:[],ui:{left:'materials',materialResearchScope:{primaryKeyword:browse,fuzzy:true}}}};U.materialQuery=Filters.materialSearchScope(U.p).primaryKeyword;
	const el=(tag,text)=>new Node(tag,text),context={U,document,$:id=>nodes[id]||null,el,...Filters,...Catalog,
		button:(text,fn,parent)=>{const node=el('button',text);node.onclick=event=>fn(event);parent?.append(node);return node;},
		persist:()=>{saves.count++;},status(){},renderAssessment(){},renderLibrary:()=>{renders.count++;},renderDetails(){},materialDetails(){},libraryAsset:()=>null};
	vm.runInNewContext(library+"\n;const id='p';this.renderSearchHistory=renderSearchHistory;this.notebookChanged="+subscription+';',context);
	N.subscribe(context.notebookChanged);
	return {U,N,input,host,saves,renders,history:()=>context.renderSearchHistory()};
}

test('a recent query keeps its results after the notebook subscription runs',async()=>{
	const f=load({browse:'image measurement',recent:['CNN','调制识别']});
	f.input.focus();f.history();assert.equal(f.host.hidden,false,'the empty focused search box offers recent queries');
	const item=f.host.children.find(node=>node.textContent==='CNN');assert.ok(item);
	item.onclick();await settle();
	assert.equal(f.N.data.query,'CNN');
	assert.equal(f.U.materialQuery,'CNN','the subscription does not restore the saved browse keyword');
	assert.equal(f.input.value,'CNN');
	assert.equal(Filters.materialSearchScope(f.U.p).primaryKeyword,'CNN','the project browse scope follows the chosen query');
	assert.ok(f.saves.count>0,'the project scope is saved');
	assert.equal(f.U.p.researchScope,undefined,'browsing does not rewrite the plan research scope');
});
