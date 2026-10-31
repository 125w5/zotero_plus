/* SPDX-License-Identifier: AGPL-3.0-or-later */
// DC-10/WSB-26: a button bound with EasySchUI.bind() shows that its job is
// running, as the settings page does: disabled with aria-busy="true" from the
// click until the job succeeds, fails or is cancelled. A second click while it
// runs starts nothing, and a job that ends first does not free a button that
// another running job still holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let read=name=>fs.readFileSync(new URL('../../chrome/content/zotero/research/ui/'+name,import.meta.url),'utf8');
let settle=()=>new Promise(resolve=>setImmediate(resolve));

class Element {
	constructor(tag){this.tagName=tag.toUpperCase();this.id='';this.children=[];this.parentElement=null;this.hidden=false;this.disabled=false;this.checked=false;this.value='';this.textContent='';this.className='';this.dataset={};this.style={};this.attributes={};this.listeners={};let names=new Set();this.classList={toggle:(name,force)=>{if(force??!names.has(name))names.add(name);else names.delete(name);},add:(...list)=>list.forEach(name=>names.add(name)),remove:(...list)=>list.forEach(name=>names.delete(name)),contains:name=>names.has(name)};}
	get firstChild(){return this.children[0]||null;}
	addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
	setAttribute(key,value){this.attributes[key]=String(value);}
	getAttribute(key){return this.attributes[key]??null;}
	removeAttribute(key){delete this.attributes[key];}
	append(...nodes){for(let node of nodes){if(typeof node==='string'){let text=new Element('#text');text.textContent=node;node=text;}node.remove();node.parentElement=this;this.children.push(node);}}
	prepend(...nodes){for(let node of nodes.reverse()){node.remove();node.parentElement=this;this.children.unshift(node);}}
	after(...nodes){let parent=this.parentElement;if(parent)for(let node of nodes.reverse()){node.remove();node.parentElement=parent;parent.children.splice(parent.children.indexOf(this)+1,0,node);}}
	before(...nodes){let parent=this.parentElement;if(parent)for(let node of nodes){node.remove();node.parentElement=parent;parent.children.splice(parent.children.indexOf(this),0,node);}}
	remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}}
	replaceChildren(...nodes){for(let node of this.children)node.parentElement=null;this.children=[];this.append(...nodes);}
	// As in settings-actions.test.mjs, a click runs the listeners even on a
	// disabled button, so the page's own guard decides whether it starts anything.
	click(){return Promise.all((this.listeners.click||[]).map(fn=>fn({type:'click'})));}
}

// main.js and the given page scripts on a fake page in which every id exists.
function page(files=['research.js']){
	let ids=new Map(),node=id=>{if(!ids.has(id)){let value=new Element('button');value.id=id;ids.set(id,value);}return ids.get(id);};
	new Element('div').append(node('status'));
	let runs=[],E={paperSkills:{},meetings:{all:()=>({})},
		ai:{run:options=>new Promise((resolve,reject)=>{runs.push(options);options.resolve=resolve;options.signal.addEventListener('abort',()=>reject(Error('已停止本次分析；未保存不完整结果，可重新运行')));})}};
	let nav=new Element('nav'),document={body:new Element('body'),getElementById:node,querySelector:selector=>(selector==='nav'?nav:null),querySelectorAll:()=>[],createElementNS:(_ns,tag)=>new Element(tag)};
	let context=vm.createContext({document,window:{parent:{Zotero:{Research:E}},addEventListener(){},confirm:()=>true},AbortController});
	for(let name of ['main.js',...files])vm.runInContext(read(name),context,{filename:name});
	let ui=context.EasySchUI;
	ui.renderHistory=()=>{};ui.renderResult=()=>{};
	ui.current={id:7,title:'迁移学习的跨域评估'};ui.papers=[ui.current];
	return {ui,E,runs,node};
}
let state=button=>({disabled:button.disabled,busy:button.getAttribute('aria-busy')});
let shown=f=>({text:f.node('status').textContent,error:f.node('status').parentElement.classList.contains('error')});

test('a bound button is running from the click until its job ends, and a second click starts nothing',async()=>{
	let f=page([]),button=f.node('save-paper-skill'),release,calls=0;
	f.ui.bind('save-paper-skill',()=>{calls++;return new Promise(resolve=>release=resolve);});
	let job=button.click();
	assert.deepEqual(state(button),{disabled:true,busy:'true'});
	button.click();await settle();assert.equal(calls,1,'the second click starts nothing');
	release();await job;
	assert.deepEqual(state(button),{disabled:false,busy:'false'});
	job=button.click();assert.equal(calls,2,'the next click runs the job again');release();await job;
});

test('a second click starts nothing even when other code re-enables the running button',async()=>{
	let f=page([]),button=f.node('meeting-save'),release,calls=0;
	f.ui.bind('meeting-save',()=>{calls++;return new Promise(resolve=>release=resolve);});
	let job=button.click();
	// Code that still writes disabled directly can free the button while its job runs.
	button.disabled=false;
	button.click();await settle();assert.equal(calls,1);
	release();await job;
	assert.deepEqual(state(button),{disabled:false,busy:'false'});
});

test('a failed job is reported and frees its button',async()=>{
	let f=page([]),button=f.node('meeting-data'),fail;
	f.ui.bind('meeting-data',()=>new Promise((_,reject)=>fail=reject));
	let job=button.click();assert.deepEqual(state(button),{disabled:true,busy:'true'});
	fail(Error('数据文件无法读取'));await job;
	assert.deepEqual(state(button),{disabled:false,busy:'false'});assert.deepEqual(shown(f),{text:'数据文件无法读取',error:true});
	// A handler that throws before it awaits anything frees its button too.
	f.ui.bind('meeting-preview',()=>{throw Error('页面计划缺少 slides');});
	await f.node('meeting-preview').click();
	assert.deepEqual(state(f.node('meeting-preview')),{disabled:false,busy:'false'});assert.equal(shown(f).text,'页面计划缺少 slides');
});

test('取消 stops the running analysis and frees its button',async()=>{
	let f=page(),button=f.node('make-outline'),cancel=f.node('cancel');
	f.ui.bind('cancel',()=>f.ui.cancelLegacyJob());f.ui.initResearch();
	let job=button.click();
	assert.equal(f.runs.length,1);assert.deepEqual(state(button),{disabled:true,busy:'true'});assert.equal(cancel.hidden,false);
	button.click();await settle();assert.equal(f.runs.length,1,'a second click starts no second analysis');
	await cancel.click();await job;
	assert.equal(f.runs[0].signal.aborted,true);assert.deepEqual(state(button),{disabled:false,busy:'false'});
	assert.equal(cancel.hidden,true);assert.equal(cancel.disabled,false,'取消 can stop the next job');
	assert.match(shown(f).text,/已停止本次分析/);
});

test('a job that ends first does not free a button another running job still holds',async()=>{
	let f=page(),refresh=f.node('refresh'),outline=f.node('make-outline'),release,reads=0;
	f.ui.refresh=()=>{reads++;return new Promise(resolve=>release=resolve);};
	f.ui.bind('refresh',()=>f.ui.refresh());f.ui.initResearch();
	// 读取选中文献 is still reading when an analysis starts, and ends first.
	let reading=refresh.click(),analysis=outline.click();assert.equal(f.runs.length,1);
	release();await reading;
	assert.deepEqual(state(refresh),{disabled:true,busy:'false'},'the analysis still holds 读取选中文献');
	refresh.click();await settle();assert.equal(reads,1,'so the papers cannot change under the analysis');
	f.runs[0].resolve({id:'record-1'});await analysis;
	assert.deepEqual(state(refresh),{disabled:false,busy:'false'});
	// The analysis ends first: 读取选中文献 stays running until its own job ends.
	reading=refresh.click();analysis=outline.click();
	f.runs[1].resolve({id:'record-2'});await analysis;
	assert.deepEqual(state(refresh),{disabled:true,busy:'true'});assert.deepEqual(state(outline),{disabled:false,busy:'false'});
	refresh.click();await settle();assert.equal(reads,2);
	release();await reading;
	assert.deepEqual(state(refresh),{disabled:false,busy:'false'});
});

test('导出投稿材料 stays running from choosing the folder until the export ends, also when cancelled or failed',async()=>{
	let f=page(['writing.js']),button=f.node('export'),pick,exporting,picks=0;
	f.E.pick=()=>{picks++;return new Promise(resolve=>pick=resolve);};
	f.E.exportDocument=()=>new Promise((resolve,reject)=>exporting={resolve,reject});
	f.ui.initWriting();
	let job=button.click();await settle();
	assert.equal(picks,1);assert.deepEqual(state(button),{disabled:true,busy:'true'},'running while the folder is chosen');
	button.click();await settle();assert.equal(picks,1,'a second click opens no second folder picker');
	pick('D:/exports');await settle();assert.deepEqual(state(button),{disabled:true,busy:'true'},'running while the export runs');
	exporting.resolve({path:'D:/exports/paper.docx',warnings:[]});await job;
	assert.deepEqual(state(button),{disabled:false,busy:'false'});assert.match(shown(f).text,/^已导出：D:\/exports\/paper\.docx/);
	job=button.click();await settle();pick(null);await job;
	assert.deepEqual(state(button),{disabled:false,busy:'false'},'choosing no folder ends the job');
	job=button.click();await settle();pick('D:/exports');await settle();exporting.reject(Error('未找到 Pandoc'));await job;
	assert.deepEqual(state(button),{disabled:false,busy:'false'});assert.deepEqual(shown(f),{text:'未找到 Pandoc',error:true});
});

// 搜索论文 is not covered here: initDiscovery() (discovery.js) replaces #search-academic with a clone that submits
// its form and stays enabled while a search runs (researchLibraryWorkspaceTest.js), so search.js's bind never runs.
test('有道翻译 is running until its request ends and is free again after a failure',async()=>{
	let f=page(['search.js']),button=f.node('youdao-translate'),fail,requests=0;
	f.E.translateYoudao=()=>{requests++;return new Promise((_,reject)=>fail=reject);};
	f.ui.initSearch();
	let job=button.click();
	assert.deepEqual(state(button),{disabled:true,busy:'true'});
	button.click();await settle();assert.equal(requests,1,'a second click sends no second request');
	fail(Error('服务暂时不可用'));await job;
	assert.deepEqual(state(button),{disabled:false,busy:'false'});assert.deepEqual(shown(f),{text:'服务暂时不可用',error:true});
});

test('组会 buttons stay running until 取消当前任务 stops the job',async()=>{
	let f=page(['meetings.js']),button=f.node('meeting-outline');
	f.E.meetings.outline=(_id,_onStatus,signal)=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('已取消'))));
	f.ui.initMeetings();f.ui.meetingID='meeting-1';
	let job=button.click();assert.deepEqual(state(button),{disabled:true,busy:'true'});
	f.ui.meetingTaskUI.cancelTask.onclick();await job;
	assert.deepEqual(state(button),{disabled:false,busy:'false'});assert.equal(f.ui.busy,false);
	assert.match(f.ui.meetingTaskUI.taskText.textContent,/^已取消/);
});
