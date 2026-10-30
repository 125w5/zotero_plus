/* SPDX-License-Identifier: AGPL-3.0-or-later */
// WSB-10: paper ticks and 精选/精读/结构参考 marks are saved shortly after a
// change and on destroy. DC-07: 清空选择 clears only the filtered papers.
// WSB-17: the research scope ranks the visible local list.
import test from 'node:test';
import assert from 'node:assert/strict';
import {installPreparationTools} from '../../chrome/content/zotero/research/notebook-preparation.mjs';

class Element{
	constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.value='';this.attributes=new Map();this.listeners=new Map();this.isConnected=true;this.className='';this.classList={toggle:()=>{},contains:name=>this.className.split(' ').includes(name)};}
	set textContent(value){this._text=String(value);this.children=[];}
	get textContent(){return (this._text||'')+this.children.map(node=>node.textContent).join('');}
	append(...nodes){for(let node of nodes){node.parentElement=this;this.children.push(node);}}
	replaceChildren(...nodes){this._text='';this.children=[];this.append(...nodes);}
	before(node){this.parentElement?.append(node);}
	after(node){this.parentElement?.append(node);}
	remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(row=>row!==this);}
	matches(selector){return selector.split(',').some(part=>part[0]==='.'?this.classList.contains(part.slice(1)):part[0]==='#'?this.id===part.slice(1):this.tagName===part);}
	querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
	querySelectorAll(selector){return this.children.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]);}
	setAttribute(key,value){this.attributes.set(key,String(value));}
	getAttribute(key){return this.attributes.get(key);}
	addEventListener(key,run){this.listeners.set(key,run);}
	removeEventListener(key){this.listeners.delete(key);}
	focus(){}
}
const papers=[
	{id:1,title:'A study of zebra stripes',abstract:'Animal patterns.',collectionIDs:[17],folderNames:['生物']},
	{id:2,title:'B survey of bridges',abstract:'Civil structures.',collectionIDs:[17],folderNames:['生物']},
	{id:3,title:'C automatic modulation recognition',abstract:'Modulation recognition under low SNR.',collectionIDs:[18],folderNames:['通信']}
];
async function fixture({selected=[1,2,3]}={}){
	let doc={addEventListener(){},removeEventListener(){}};
	doc.createElement=tag=>new Element(tag,doc);doc.createTextNode=text=>{let node=doc.createElement('text');node.textContent=text;return node;};
	doc.body=doc.createElement('body');doc.querySelector=selector=>doc.body.querySelector(selector);doc.getElementById=id=>doc.querySelector('#'+id);
	globalThis.document=doc;
	let el=(tag,text,cls)=>{let node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
	let button=(text,action,host)=>{let node=el('button',text);node.onclick=action;host?.append(node);return node;};
	let ids=new Map(),$=id=>{if(!ids.has(id)){let node=el('div');node.id=id;ids.set(id,node);doc.body.append(node);}return ids.get(id);};
	$('evaluation').append(el('div',undefined,'preparation-actions'));
	let project={id:'p',title:'调制识别',ui:{},readingSelection:{}},saves=[],messages=[];
	let N={project:()=>project,state:()=>({view:'read'}),
		preparationLibrary:async()=>({papers:structuredClone(papers),folders:[{id:17,name:'生物',paperCount:2},{id:18,name:'通信',paperCount:1}],selectedPaperIDs:selected.slice(),collectionIDs:[],featuredPaperIDs:[],researchScope:{domain:'communications',primaryKeyword:'modulation recognition'}}),
		savePreparationChoice:async(_id,choice)=>{saves.push(structuredClone(choice));},
		setPreparationSources:async(_id,choice)=>{saves.push(structuredClone(choice));},saveReadingSelection:async()=>{}};
	let tools=installPreparationTools({E:{},N,A:{},id:'p',$,el,button,status:text=>messages.push(text),run:async fn=>fn()});
	await tools.refreshLocal();
	let list=doc.querySelector('.preparation-local-papers'),localTools=doc.querySelector('.preparation-local-tools');
	let row=paperID=>list.children.find(node=>node.dataset.paperId===paperID);
	let folderCheck=folderID=>doc.querySelector('.preparation-folder-picker').children[1].children[[17,18].indexOf(folderID)].children[0];
	let clear=localTools.children.find(node=>node.textContent==='清空选择');
	return {tools,list,row,folderCheck,clear,saves,messages};
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('with an empty search the research scope puts matching papers first and keeps every paper listed',async()=>{
	let previous=globalThis.document;
	try{
		let f=await fixture();
		assert.deepEqual(f.list.children.map(node=>node.dataset.paperId),[3,1,2]);
		f.tools.destroy();
	}
	finally{globalThis.document=previous;}
});

test('清空选择 clears only the papers in the current filter',async()=>{
	let previous=globalThis.document;
	try{
		let f=await fixture();
		let check=f.folderCheck(18);check.checked=true;check.onchange();
		assert.deepEqual(f.list.children.map(node=>node.dataset.paperId),[3],'the folder filter shows one paper');
		f.clear.onclick();
		await f.tools.prepareForAssessment();
		assert.deepEqual(f.saves.at(-1).paperIDs.sort(),[1,2],'picks under the other folder stay selected');
		assert.match(f.messages.at(-1),/仍保留/);
		f.tools.destroy();
	}
	finally{globalThis.document=previous;}
});

test('ticks and 精读 marks are saved shortly after the change without starting a task',async()=>{
	let previous=globalThis.document;
	try{
		let f=await fixture();
		let check=f.row(2).children[0];check.checked=false;check.onchange();
		f.row(3).children[2].children[1].onclick();
		assert.equal(f.saves.length,0,'the save waits for a pause');
		await wait(650);
		assert.equal(f.saves.length,1,'one save for the burst');
		assert.deepEqual(f.saves[0].paperIDs.sort(),[1,3]);
		assert.deepEqual(f.saves[0].closeReadingPaperIDs,[3]);
		f.tools.destroy();
	}
	finally{globalThis.document=previous;}
});

test('closing the page saves a choice made just before',async()=>{
	let previous=globalThis.document;
	try{
		let f=await fixture();
		let check=f.row(1).children[0];check.checked=false;check.onchange();
		f.tools.destroy();await wait(0);
		assert.equal(f.saves.length,1,'pagehide/destroy writes the pending choice');
		assert.deepEqual(f.saves[0].paperIDs.sort(),[2,3]);
		await wait(650);
		assert.equal(f.saves.length,1,'the debounced save does not repeat it');
	}
	finally{globalThis.document=previous;}
});
