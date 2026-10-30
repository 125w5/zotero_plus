/* SPDX-License-Identifier: AGPL-3.0-or-later */
// WA-09: a drop on another conversation's row ends with a result and is not added twice.
// WA-14: blocked 新对话/切换 and a failed 在系统文件夹中显示 say why on the page in view.
// WA-18: Enter during a running answer keeps the typed text instead of stopping the answer.
// WA-01: the waiting folder switch is a notice on its own line with one action.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {mountConversationFiles,mountConversationFileDetail} from '../../chrome/content/zotero/research/shared/conversation-files.mjs';
import {RESEARCH_MESSAGE_MIME} from '../../chrome/content/zotero/research/shared/message-transfer.mjs';
import {CHAT_ATTACHMENT_MIME} from '../../chrome/content/zotero/research/shared/chat-attachments.mjs';

class Node extends EventTarget{
	constructor(doc,tag){super();this.ownerDocument=doc;this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this._text='';this.className='';this.value='';}
	get isConnected(){return this.root||!!this.parentElement?.isConnected;}
	get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}set textContent(value){this.replaceChildren();this._text=String(value??'');}
	get classList(){return {add:(...names)=>{this.className=[...new Set([...this.className.split(' '),...names])].filter(Boolean).join(' ');},remove:(...names)=>{this.className=this.className.split(' ').filter(name=>!names.includes(name)).join(' ');}};}
	append(...children){for(let child of children){child.remove();child.parentElement=this;this.children.push(child);}}
	after(...children){let parent=this.parentElement;if(!parent)return;let index=parent.children.indexOf(this);for(let child of children){child.remove();child.parentElement=parent;parent.children.splice(++index,0,child);}}
	replaceChildren(...children){for(let child of this.children)child.parentElement=null;this.children=[];this._text='';this.append(...children);}
	remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}}
	setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key];}removeAttribute(key){delete this.attributes[key];}
	matches(selector){return selector==='*'||selector.startsWith('.')&&this.className.split(' ').includes(selector.slice(1))||selector===this.tagName;}
	querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
function documentFixture(){
	let win=new EventTarget();Object.assign(win,{AbortController,setTimeout,clearTimeout,innerWidth:1000,innerHeight:800});
	let doc={defaultView:win,createElementNS:(_ns,tag)=>new Node(doc,tag)};doc.documentElement=new Node(doc,'html');doc.documentElement.root=true;doc.head=new Node(doc,'head');doc.body=new Node(doc,'body');doc.documentElement.append(doc.head,doc.body);doc.querySelector=selector=>doc.documentElement.querySelector(selector);doc.addEventListener=()=>{};doc.removeEventListener=()=>{};
	let host=new Node(doc,'aside');doc.body.append(host);return {doc,host};
}
let flush=async()=>{for(let index=0;index<20;index++)await Promise.resolve();};
let status=rail=>rail.root.querySelector('.conversation-files-status').textContent;
let row=(rail,id)=>rail.root.querySelectorAll('button').find(button=>button.dataset.sessionID===id);
let dropEvent=dataTransfer=>({dataTransfer,preventDefault(){},stopPropagation(){}});

test('dropping an answer on another conversation row ends with a named result and is not copied twice',async()=>{
	let {host}=documentFixture(),sessions=new Map([['from',{id:'from',title:'来源',messages:[{id:'q',role:'user',text:'实验怎样划分？'},{id:'a',role:'assistant',text:'按设备划分。',sources:[]}]}],['to',{id:'to',title:'方法对比',messages:[]}]]),appended=[];
	let E={workbenchConversations:{get:id=>structuredClone(sessions.get(id)||null),append:async(id,message)=>{appended.push(id);sessions.get(id).messages.push(message);}},chatAttachments:{get:()=>[]}};
	let rail=mountConversationFiles({host,E,getSessionID:()=>'from',getSessions:()=>[...sessions.values()]});
	let answer={types:[RESEARCH_MESSAGE_MIME],getData:type=>type===RESEARCH_MESSAGE_MIME?JSON.stringify({sessionID:'from',messageID:'a'}):''};
	row(rail,'to').ondrop(dropEvent(answer));await flush();
	assert.equal(status(rail),'「方法对比」：已复制问题、回答和来源到目标对话；尚未提交新任务。');
	row(rail,'to').ondrop(dropEvent(answer));await flush();
	assert.deepEqual(appended,['to'],'the second drop of the same answer adds nothing');
	assert.match(status(rail),/^「方法对比」：这条回答已复制到目标对话，未重复添加/);
	rail.destroy();
});

test('a file drop on another conversation row reports its result or failure with that conversation name',async()=>{
	let {host}=documentFixture(),attached=[],fail=false;
	let E={workbenchConversations:{get:id=>({id,title:id==='other'?'另一段对话':'当前',messages:[]})},chatAttachments:{get:()=>[],attach:async(id,payload)=>{if(fail)throw Error('拖动的资料已移除，请重新选择。');attached.push([id,payload]);}}};
	let rail=mountConversationFiles({host,E,getSessionID:()=>'current',getSessions:()=>[{id:'current',title:'当前'},{id:'other',title:'另一段对话'}]});
	let file={types:[CHAT_ATTACHMENT_MIME],files:[],getData:type=>type===CHAT_ATTACHMENT_MIME?JSON.stringify({sessionID:'current',attachmentID:'attachment:9'}):''};
	row(rail,'other').ondrop(dropEvent(file));await flush();
	assert.equal(attached[0][0],'other');assert.equal(status(rail),'「另一段对话」：已保存到本次资料。');
	fail=true;row(rail,'other').ondrop(dropEvent(file));await flush();
	assert.equal(status(rail),'「另一段对话」：拖动的资料已移除，请重新选择。');
	rail.destroy();
});

test('the rail shows why 新对话 did nothing, and a notice clears only its own text',async()=>{
	let {host}=documentFixture(),E={workbenchConversations:{get:()=>null},chatAttachments:{get:()=>[]}};
	let rail=mountConversationFiles({host,E,getSessionID:()=>'s',onNew:async()=>{throw Error('请先停止当前任务，再新建对话');}});
	await rail.root.querySelector('.conversation-files-new').onclick();await flush();
	assert.equal(status(rail),'请先停止当前任务，再新建对话');
	let notice=rail.root.querySelectorAll('.conversation-files-status')[1];assert.equal(notice.hidden,true);
	rail.notify('等待切换','');assert.equal(notice.textContent,'等待切换');assert.equal(notice.hidden,false);
	assert.equal(status(rail),'请先停止当前任务，再新建对话','the notice has its own line');
	rail.notify('','另一条提示');assert.equal(notice.textContent,'等待切换','clearing a different notice keeps this one');
	rail.notify('','等待切换');assert.equal(notice.textContent,'');assert.equal(notice.hidden,true);
	rail.destroy();
});

test('a rail notice can offer one action; its result or failure appears in the status line and the notice survives other results',async()=>{
	let {host}=documentFixture(),E={workbenchConversations:{get:()=>null},chatAttachments:{get:()=>[]}},runs=0;
	let rail=mountConversationFiles({host,E,getSessionID:()=>'s'}),notice=rail.root.querySelectorAll('.conversation-files-status')[1];
	rail.notify('这段对话仍属于「文件夹 A」；已选择「文件夹 B」。','',{label:'切换到该文件夹的对话',run:async()=>{runs++;return '已切换到「文件夹 B」的对话';}});
	let button=notice.querySelectorAll('button')[0];assert.equal(button?.textContent,'切换到该文件夹的对话');
	assert.equal(notice.textContent,'这段对话仍属于「文件夹 A」；已选择「文件夹 B」。切换到该文件夹的对话');
	rail.root.querySelector('.conversation-files-status').textContent='已保存到本次资料。';
	assert.match(notice.textContent,/^这段对话仍属于/,'a later result in the status line does not hide the notice');
	await button.onclick();await flush();
	assert.equal(runs,1);assert.equal(status(rail),'已切换到「文件夹 B」的对话');assert.equal(button.disabled,false);
	rail.notify('已选择「文件夹 C」。','这段对话仍属于「文件夹 A」；已选择「文件夹 B」。',{label:'切换到该文件夹的对话',run:async()=>{throw Error('未能切换到「文件夹 C」的对话（读取失败）；当前对话已保留。');}});
	assert.equal(notice.querySelectorAll('button').length,1,'a replaced notice keeps one action');
	await notice.querySelectorAll('button')[0].onclick();await flush();
	assert.equal(status(rail),'未能切换到「文件夹 C」的对话（读取失败）；当前对话已保留。');
	rail.notify('已选择「文件夹 D」。','');assert.equal(notice.querySelectorAll('button').length,0,'a notice without an action shows no button');
	rail.destroy();
});

test('a failed 在系统文件夹中显示 shows its reason inside the detail',async()=>{
	let {host}=documentFixture(),errors=[],file={id:'attachment:7',title:'数据.csv',kind:'text'};
	let E={chatAttachments:{get:()=>[file],location:async()=>({path:'/lib/数据.csv',folders:['课题']}),reveal:async()=>{throw Error('本机找不到这个文件（尚未下载、已移动或已删除）');},preview:async()=>({rows:[],warnings:[]})},workbenchConversations:{subscribe:()=>()=>{}},renderContent:(target,text)=>{target.textContent=text;}};
	let detail=mountConversationFileDetail({host,E,getSessionID:()=>'s',onError:error=>errors.push(error.message)});
	await detail.open(file,'s');await flush();
	let reveal=host.querySelectorAll('button').find(button=>button.textContent==='在系统文件夹中显示');assert.ok(reveal);
	reveal.onclick();await flush();
	assert.match(host.querySelector('.conversation-file-location').textContent,/本机找不到这个文件/);assert.equal(errors.length,1);
	detail.destroy();
});

async function workbench(){
	let ui={};vm.runInContext(await readFile(new URL('../../chrome/content/zotero/research/ui/agent-workbench.js',import.meta.url),'utf8'),vm.createContext({EasySchUI:ui,setTimeout,clearTimeout,AbortController,Event}));
	ui.agentRunStatus={textContent:''};ui.agentData={activeSessionID:'a',sessions:[{id:'a'},{id:'b'}]};return ui;
}

test('while an answer runs, Enter keeps the typed follow-up instead of stopping the answer',async()=>{
	let ui=await workbench(),submits=0,composer={requestSubmit(){submits++;}},key=()=>({key:'Enter',shiftKey:false,isComposing:false,keyCode:13,preventDefault(){}});
	ui.agentRunning=true;ui.agentInputKeydown(key(),composer);
	assert.equal(submits,0,'Enter does not reach the submit that would stop the answer');assert.match(ui.agentRunStatus.textContent,/当前回答完成后再发送/);
	ui.agentRunning=false;ui.agentInputKeydown(key(),composer);assert.equal(submits,1,'Enter still sends when nothing runs');
});

test('while an answer runs, 新对话 and switching are refused with a reason the clicked rail can show',async()=>{
	let ui=await workbench();ui.agentRunning=true;
	await assert.rejects(()=>ui.createAgentSession(),/请先停止当前任务，再新建对话/);
	await assert.rejects(()=>ui.switchAgentSession('b'),/请先停止当前任务，再切换对话/);
});
