/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Legacy E.ai.run jobs started from a workspace page take that page's signal,
// so 取消 and closing the page stop them. 整理选中文献 runs in the library
// frame, whose status bar is hidden, so its card carries progress and 停止.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let read=name=>fs.readFileSync(new URL('../../chrome/content/zotero/research/ui/'+name,import.meta.url),'utf8');

class Node {
	constructor(tag,text,className){this.tagName=tag;this.children=[];this.parentElement=null;this.hidden=false;this.disabled=false;this.checked=false;this.type='';this.dataset={};this.attributes={};this.textContent=text??'';this.className=className||'';this.classList={toggle(){},add(){},remove(){}};}
	append(...nodes){for(let node of nodes){node.remove?.();node.parentElement=this;this.children.push(node);}}
	prepend(...nodes){for(let node of nodes.reverse()){node.remove?.();node.parentElement=this;this.children.unshift(node);}}
	remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}}
	replaceChildren(...nodes){this.children=[];this.append(...nodes);}
	setAttribute(key,value){this.attributes[key]=String(value);}
	removeAttribute(key){delete this.attributes[key];}
	get text(){return [this.textContent,...this.children.map(node=>node.text)].join(' ');}
	all(tag){return this.children.flatMap(node=>[...(node.tagName===tag?[node]:[]),...node.all(tag)]);}
}

function page({view='agent'}={}){
	let runs=[],ids=new Map(),node=id=>{if(!ids.has(id)){let value=new Node('div');value.id=id;ids.set(id,value);}return ids.get(id);};
	new Node('div').append(node('status'));
	let views=['view-research','view-agent','view-graph'].map(id=>{let value=node(id);value.className='view';value.hidden=id!=='view-'+view;return value;});
	let E={paperSkills:{},core:{task:()=>({id:'k1'})},store:{update:async()=>{}},
		library:{addTags:async(paper,tags)=>runs.push({saved:{paper:paper.id,tags}}),openSource(){}},getItem:async()=>({getTags:()=>[{tag:'旧标签'}],removeTag(){},saveTx:async()=>{}}),
		ai:{run:options=>new Promise((resolve,reject)=>{runs.push(options);if(!options.signal){reject(Error('no signal'));return;}options.signal.addEventListener('abort',()=>reject(Error('已停止本次分析；未保存不完整结果，可重新运行')));options.resolve=resolve;})}};
	let document={getElementById:id=>node(id),querySelectorAll:selector=>selector==='.view'?views:selector.includes('slide-part')?[]:[],createElementNS:(_ns,tag)=>new Node(tag)};
	let context={document,window:{parent:{Zotero:{Research:E}},addEventListener(){}},AbortController,Error,Promise};
	for(let name of ['main.js','research.js','knowledge.js','flow.js'])vm.runInNewContext(read(name),context);
	let ui=context.EasySchUI;
	// As in ppt-main.js: a failed action is reported only through ui.status.
	ui.pptButton=(label,action,parent)=>{let button=ui.el('button',label);button.onclick=async()=>{try{await action();}catch(error){ui.status(error.message,true);}};parent.append(button);return button;};
	ui.renderHistory=()=>{};ui.renderResult=()=>{};
	ui.current={id:7,title:'迁移学习的跨域评估'};ui.papers=[ui.current];
	return {ui,E,runs,node,settle:()=>new Promise(resolve=>setImmediate(resolve))};
}
let buttons=card=>card.all('button').map(button=>button.textContent);

test('research, knowledge and organize jobs pass the page signal, so 取消 stops each of them',async()=>{
	for(let start of [ui=>ui.run('analyze'),ui=>ui.suggestKnowledge(),ui=>ui.showOrganize()]){
		let f=page({view:'research'}),job=start(f.ui).catch(error=>error);await f.settle();
		assert.ok(f.runs[0]?.signal,'E.ai.run receives the signal of this page');assert.equal(f.runs[0].signal.aborted,false);
		f.ui.cancelLegacyJob();assert.equal(f.runs[0].signal.aborted,true);await job;
		assert.equal(f.ui.busy,false,'the page is free for the next job');
	}
});

test('整理选中文献 in the library frame shows its progress, a 停止 button and the stopped state in the visible view',async()=>{
	let f=page({view:'agent'}),job=f.ui.showOrganize();await f.settle();
	let agent=f.node('view-agent'),card=agent.children[0];
	assert.ok(card,'the card is in the conversation view that the library frame shows');assert.equal(f.node('result').children.length,0,'not in the hidden research view');
	assert.match(card.text,/迁移学习的跨域评估/);assert.match(card.text,/正在建议标签/);assert.deepEqual(buttons(card),['停止']);
	card.all('button')[0].onclick();assert.equal(f.runs[0].signal.aborted,true);
	assert.equal(await job,undefined,'a stop is not reported as a failure');
	assert.match(card.text,/已停止，标签未改动/);assert.deepEqual(buttons(card),['关闭']);
	card.all('button')[0].onclick();assert.equal(agent.children.length,0);
});

test('a finished organize job lists the suggested tags and saves only the checked ones',async()=>{
	let f=page({view:'agent'}),job=f.ui.showOrganize();await f.settle();
	f.runs[0].resolve({result:{keywords:['迁移学习','领域适应']}});await job;
	let card=f.node('view-agent').children[0];
	assert.match(card.text,/核对后保存/);assert.deepEqual(buttons(card),['保存选中标签','关闭']);
	card.all('input')[1].checked=false;await card.all('button')[0].onclick();
	assert.deepEqual(JSON.parse(JSON.stringify(f.runs.at(-1))),{saved:{paper:7,tags:['迁移学习']}});assert.match(card.text,/标签已保存/);assert.ok(buttons(card).includes('撤销新增标签'));
});

test('a failed save or undo is shown in the card, because the library frame hides the status bar',async()=>{
	let f=page({view:'agent'}),job=f.ui.showOrganize();await f.settle();
	f.runs[0].resolve({result:{keywords:['迁移学习']}});await job;
	let card=f.node('view-agent').children[0],state=card.all('p')[0],save=card.all('button')[0];
	f.E.library.addTags=async()=>{throw Error('当前资料库只读');};
	await save.onclick();
	assert.equal(state.textContent,'当前资料库只读','the card names why nothing was saved');assert.ok(!buttons(card).includes('撤销新增标签'));
	f.E.library.addTags=async()=>{};f.E.getItem=async()=>({getTags:()=>[],removeTag(){},saveTx:async()=>{throw Error('数据库已锁定');}});
	await save.onclick();assert.equal(state.textContent,'标签已保存');
	await card.all('button').find(button=>button.textContent==='撤销新增标签').onclick();
	assert.equal(state.textContent,'数据库已锁定','a failed undo is shown too');assert.ok(card.parentElement,'the card stays, so the undo can be tried again');
});
