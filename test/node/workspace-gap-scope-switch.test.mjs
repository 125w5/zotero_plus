/* SPDX-License-Identifier: AGPL-3.0-or-later */
// WA-01: clicking another native folder while a research answer runs, on the
// dialogue, search or PPT page, must not abort it or move its result into the
// other folder's conversation. The clicked folder's conversation opens only from
// the rail notice, so a finished answer, a failure row or typed text stays shown.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as tools from '../../chrome/content/zotero/research/shared/agent-workbench.mjs';
import * as conversations from '../../chrome/content/zotero/research/shared/conversation-store.mjs';
import * as attachments from '../../chrome/content/zotero/research/shared/chat-attachments.mjs';
import * as libraryScope from '../../chrome/content/zotero/research/shared/library-scope.mjs';

let workbenchURL=new URL('../../chrome/content/zotero/research/ui/agent-workbench.js',import.meta.url);
let scopeA={key:'L1-A',folder:'文件夹 A',collectionID:1,libraryID:1,files:[]};
let scopeB={key:'L1-B',folder:'文件夹 B',collectionID:2,libraryID:1,files:[]};
let turn=()=>new Promise(resolve=>setImmediate(resolve));
let settle=async()=>{for(let index=0;index<40;index++)await turn();};
let until=async(check,label)=>{for(let index=0;index<400;index++){if(check())return;await turn();}assert.fail(label);};

async function fixture({extra=[]}={}){
	let original={id:'current',title:'A 的对话',mode:'auto',libraryScopeKey:scopeA.key,libraryFolder:scopeA.folder,messages:[],draft:''};
	let state={researchWorkbench:{version:2,activeSessionID:original.id,scopeSessions:{[conversations.conversationScope({libraryScopeKey:scopeA.key})]:original.id},sessions:[original,...extra]}};
	let counter=0,errors=[],statuses=[],tasks=[];
	let E={store:{get:key=>state[key],update:async fn=>fn(state)},library:{},notebook:{}};
	let ui={E},context=vm.createContext({EasySchUI:ui,Zotero:{Research:E,Utilities:{randomString:()=>String(++counter)},logError:error=>errors.push(error)},ChromeUtils:{importESModule:url=>url.includes('conversation-store')?conversations:url.includes('library-scope')?libraryScope:attachments},AbortController,setTimeout,clearTimeout,setInterval,clearInterval});
	vm.runInContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/conversations.js',import.meta.url),'utf8'),context);
	new vm.Script(await readFile(workbenchURL,'utf8'),{filename:workbenchURL.href,importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER}).runInContext(context);
	ui.agentTools=tools;ui.agentData=E.workbenchConversations.snapshot();ui.restoreAgentSession(ui.agentData.activeSessionID);
	let control=value=>({value,focus(){},setAttribute(){},removeAttribute(){}});
	ui.agentSelected=null;ui.agentInput=control('比较这个文件夹里两篇论文的方法');ui.agentMode=control('auto');ui.agentModel=control('');ui.agentModel.options=[];ui.agentThinking=control('off');ui.agentExecution=control('auto');ui.agentSearch=control('');ui.agentSend=control('');ui.agentRunStatus={textContent:''};
	for(let name of ['refreshAgentProjects','renderAgentSessions','renderAgentMessages','renderAgentSources','resetAgentPreview','renderEmptyAgentPreview','queueAgentInputSize','renderAgentDraft'])ui[name]=()=>{};
	ui.agentMaterials=()=>[];ui.activeView='agent';ui.libraryScope=scopeA;ui.status=(text,error)=>statuses.push({text,error});
	let rail={text:'',choice:null,renders:0,render(){this.renders++;},notify(text,previous='',choice){if(text){this.text=text;this.choice=choice||null;}else if(previous&&this.text===previous){this.text='';this.choice=null;}}};ui.agentFileRails=[rail];
	E.workbenchConversations.subscribe(value=>ui.receiveSharedAgentState(value),{summary:true,sessionID:()=>ui.agentData.activeSessionID});
	E.runWorkbenchTask=request=>new Promise((resolve,reject)=>{tasks.push({request,resolve,reject});request.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})),{once:true});});
	return {E,ui,rail,tasks,errors,statuses};
}
let click=(ui,scope,preserveActive=false)=>ui.setLibraryScope(scope,{signal:new AbortController().signal,preserveActive});

test('a folder click during a running answer keeps the answer in view and switches only from the rail notice',async()=>{
	let f=await fixture(),running=f.ui.runAgentTask();await settle();
	assert.equal(f.ui.agentRunning,true);assert.equal(f.tasks.length,1);
	await click(f.ui,scopeB);await settle();
	assert.equal(f.tasks[0].request.signal.aborted,false,'the folder click does not abort the running answer');
	assert.equal(f.ui.agentRunning,true);assert.equal(f.ui.agentData.activeSessionID,'current');
	assert.equal(f.E.workbenchConversations.snapshot().activeSessionID,'current','no other conversation is selected while the answer runs');
	assert.equal(f.ui.libraryScope,scopeB,'downloads already follow the clicked folder');
	assert.equal(f.ui.agentSessionScopeKey(),scopeA.key,'the history list stays on the running conversation folder');
	assert.match(f.rail.text,/已选择「文件夹 B」。当前回答仍保存在这段对话/);assert.equal(f.rail.choice,null,'no switch is offered while the answer runs');
	f.tasks[0].resolve({text:'两篇论文的方法比较',sources:[]});await running;await settle();
	assert.equal(f.ui.agentData.activeSessionID,'current','the finished answer stays on screen');
	let asked=f.E.workbenchConversations.get('current');
	assert.deepEqual(asked.messages.map(message=>[message.role,message.failure?.kind||'']),[['user',''],['assistant','']]);
	assert.equal(asked.messages[1].text,'两篇论文的方法比较');
	assert.equal(f.rail.text,'这段对话仍属于「文件夹 A」；已选择「文件夹 B」。');assert.equal(f.rail.choice?.label,'切换到该文件夹的对话');
	let line=await f.rail.choice.run();await settle();
	assert.notEqual(f.ui.agentData.activeSessionID,'current');
	assert.equal(f.E.workbenchConversations.get(f.ui.agentData.activeSessionID).libraryScopeKey,scopeB.key);
	assert.match(line,/^已切换到「文件夹 B」的对话；「.+」保存在「文件夹 A」中，选择该文件夹可回到它。$/);
	assert.equal(f.rail.text,'');assert.equal(f.ui.agentSessionScopeKey(),scopeB.key);assert.deepEqual(f.errors,[]);
});

test('after a failed answer the failure row and typed text stay, and the switch still waits for the user',async()=>{
	let f=await fixture(),running=f.ui.runAgentTask();await settle();
	await click(f.ui,scopeB);await settle();
	f.ui.agentInput.value='再补充比较两篇的数据集划分';f.ui.updateAgentDraft();await f.ui.flushAgentDraft();
	f.tasks[0].reject(Error('模型请求超时，请稍后重试'));await running;await settle();
	assert.equal(f.ui.agentData.activeSessionID,'current','the failure is shown where it happened');
	let asked=f.E.workbenchConversations.get('current');
	assert.equal(asked.messages.length,1);assert.ok(asked.messages[0].failure,'the failure row with its retry is saved in the asking conversation');
	assert.equal(f.ui.agentRunStatus.textContent,'回答未完成，原因见对话');
	assert.equal(f.ui.agentInput.value,'再补充比较两篇的数据集划分','the typed follow-up stays in the composer');
	assert.ok(f.rail.choice,'the switch is offered, not applied');assert.match(f.rail.text,/已选择「文件夹 B」/);
	assert.equal(f.E.workbenchConversations.list({includeDrafts:true}).some(session=>session.libraryScopeKey===scopeB.key),false);
	assert.deepEqual(f.errors,[]);
});

test('a same-folder refresh keeps the run, and returning to its folder cancels the waiting switch',async()=>{
	let f=await fixture(),running=f.ui.runAgentTask();await settle();
	await click(f.ui,scopeA,true);await settle();
	assert.equal(f.tasks[0].request.signal.aborted,false);
	await click(f.ui,scopeB);await click(f.ui,scopeA);await settle();
	assert.equal(f.tasks[0].request.signal.aborted,false);assert.equal(f.rail.text,'','the notice is withdrawn');
	f.tasks[0].resolve({text:'回答',sources:[]});await running;await settle();
	assert.equal(f.ui.agentData.activeSessionID,'current');
	assert.equal(f.E.workbenchConversations.list({includeDrafts:true}).some(session=>session.libraryScopeKey===scopeB.key),false,'no conversation is opened for the folder the user left');
	assert.deepEqual(f.errors,[]);
});

test('a send during the switch to the clicked folder is held instead of running in the conversation being left',async()=>{
	let f=await fixture(),release;f.ui.flushAgentDraft=()=>new Promise(resolve=>{release=resolve;});
	let switching=click(f.ui,scopeB);
	f.ui.runAgentTask();await settle();
	assert.equal(f.tasks.length,0,'no task starts while the conversation is switching');
	assert.match(f.ui.agentRunStatus.textContent,/正在切换/);
	release();await switching;await settle();
	assert.equal(f.E.workbenchConversations.get(f.ui.agentData.activeSessionID).libraryScopeKey,scopeB.key);
	assert.ok(!f.ui.agentScopeSwitching);assert.deepEqual(f.errors,[]);
});

// The same store calls as ppt-assistant.mjs: its discussion opens with
// activate:false, a folder change syncs a PPT-scoped conversation, and a
// different discussion is selected in the shared store.
async function installPPT(f){
	let S=f.E.workbenchConversations,session=await S.open({origin:'ppt',pptDraftID:'d1',title:'组会讨论'},{activate:false});
	f.ui.pptAssistant={
		get sessionID(){return session.id;},
		async select(id){session=S.get(id);await S.select(id,{scope:{pptDraftID:'d1',libraryScopeKey:session.libraryScopeKey},summary:true});},
		async setLibraryScope(scope,{signal,preserveActive=false}={}){
			let next=await libraryScope.syncLibraryScopeSession(f.E,scope,{pptDraftID:'d1',origin:'ppt',activate:false,signal,sessionID:preserveActive?session.id:undefined});
			if(!next||signal?.aborted||next.id===session.id)return;await this.select(next.id);
		}
	};
	f.ui.agentInput.value='比较这个文件夹里两篇论文的方法';
	return f.ui.pptAssistant;
}

test('on the PPT page a folder click or a PPT discussion click does not stop a running research answer',async()=>{
	let f=await fixture(),ppt=await installPPT(f),running=f.ui.runAgentTask();await settle();
	assert.equal(f.tasks.length,1);
	f.ui.activeView='ppt';await click(f.ui,scopeA,true);await settle();
	let pptA=ppt.sessionID;
	await click(f.ui,scopeB);await settle();
	assert.notEqual(ppt.sessionID,pptA,'the PPT page follows the clicked folder with its own discussion');
	assert.equal(f.E.workbenchConversations.snapshot().activeSessionID,ppt.sessionID);
	await ppt.select(pptA);await settle();
	assert.equal(f.tasks[0].request.signal.aborted,false,'neither click stops the research answer');
	assert.equal(f.ui.agentData.activeSessionID,'current');
	f.tasks[0].resolve({text:'两篇论文的方法比较',sources:[]});await running;await settle();
	let asked=f.E.workbenchConversations.get('current');
	assert.deepEqual(asked.messages.map(message=>[message.role,message.failure?.kind||'',message.text]),[['user','','比较这个文件夹里两篇论文的方法'],['assistant','','两篇论文的方法比较']]);
	assert.equal(f.ui.agentData.activeSessionID,'current','the research page keeps its own conversation, not the PPT discussion');
	assert.equal(f.E.workbenchConversations.get(pptA).messages.length,0,'nothing is written into the PPT discussion');
	assert.deepEqual(f.errors,[]);
});

test('back on the dialogue after a PPT-page folder click, the answer stays and the notice opens that folder research conversation',async()=>{
	let f=await fixture(),ppt=await installPPT(f),running=f.ui.runAgentTask();await settle();
	f.ui.activeView='ppt';await click(f.ui,scopeA,true);await click(f.ui,scopeB);await settle();
	f.tasks[0].resolve({text:'两篇论文的方法比较',sources:[]});await running;await settle();
	// library-workspace.mjs refreshScope applies the folder again when the page changes.
	f.ui.activeView='agent';await click(f.ui,scopeB,true);await settle();
	assert.equal(f.ui.agentData.activeSessionID,'current','returning keeps the conversation with the finished answer');
	assert.equal(f.rail.choice?.label,'切换到该文件夹的对话');
	await f.rail.choice.run();await settle();
	let shown=f.E.workbenchConversations.get(f.ui.agentData.activeSessionID);
	assert.equal(shown.libraryScopeKey,scopeB.key);assert.equal(shown.pptDraftID,undefined,'the folder research conversation opens, not the PPT discussion');
	assert.notEqual(shown.id,ppt.sessionID);assert.deepEqual(f.errors,[]);
});

test('a conversation removed while it answers stops that answer without rewriting the other conversations',async()=>{
	let other={id:'other',title:'B 的对话',mode:'auto',messages:[{id:'o1',role:'user',text:'旧问题'}],draft:''};
	let third={id:'third',title:'C 的对话',mode:'auto',messages:[{id:'t1',role:'user',text:'第三段对话的问题'},{id:'t2',role:'assistant',text:'第三段对话的回答'}],draft:''};
	let f=await fixture({extra:[other,third]}),running=f.ui.runAgentTask();await settle();
	await f.E.workbenchConversations.remove('current');await settle();
	assert.equal(f.tasks[0].request.signal.aborted,true,'only removing the asking conversation ends the answer');
	await running;await settle();
	assert.equal(f.E.workbenchConversations.get('current'),null);
	assert.deepEqual(f.E.workbenchConversations.get('third').messages.map(message=>message.text),['第三段对话的问题','第三段对话的回答'],'the other conversations keep their messages');
});
