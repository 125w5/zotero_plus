/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as tools from '../../chrome/content/zotero/research/shared/agent-workbench.mjs';
import * as conversations from '../../chrome/content/zotero/research/shared/conversation-store.mjs';
import * as attachments from '../../chrome/content/zotero/research/shared/chat-attachments.mjs';

const copy=value=>JSON.parse(JSON.stringify(value));
async function fixture({existingPaper=false,unified=false}={}){
 const original={id:'current',title:'Current conversation',mode:'organize',projectID:'project-1',messages:[],draft:''};
 const paper={id:'paper-existing',title:'Earlier paper discussion',paperID:7,mode:'organize',modelID:'earlier-model',thinkingLevel:'low',executionMode:'ask',projectID:'project-1',messages:[{id:'earlier-user',role:'user',text:'Previous question'},{id:'earlier-answer',role:'assistant',text:'Previous answer',sources:[{stableID:'material:earlier',anchor:{pageIndex:3}}]}],draft:''};
 const state={researchWorkbench:{version:2,activeSessionID:original.id,scopeSessions:{workbench:original.id,...(existingPaper?{'paper:7':paper.id}:{})},sessions:[original,...(existingPaper?[paper]:[])]}},calls={search:[],unrelated:0,tasks:[]};let counter=0;
 const E={store:{get:key=>state[key],update:async fn=>fn(state)},library:{},notebook:{suggestTopics:async()=>{calls.unrelated++;return {groups:[]};}}};
 const ui={E},context=vm.createContext({EasySchUI:ui,Zotero:{Research:E,Utilities:{randomString:()=>String(++counter)},logError:error=>{throw error;}},ChromeUtils:{importESModule:url=>url.includes('conversation-store')?conversations:attachments},AbortController,clearTimeout,setTimeout});
 vm.runInContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/conversations.js',import.meta.url),'utf8'),context);
 vm.runInContext(await readFile(new URL('../../chrome/content/zotero/research/ui/agent-workbench.js',import.meta.url),'utf8'),context);
 ui.agentTools=tools;ui.agentData=E.workbenchConversations.snapshot();ui.restoreAgentSession(ui.agentData.activeSessionID);
 const control=value=>({value,focus(){},setAttribute(){},removeAttribute(){}});
 ui.agentSelected={id:7,kind:'paper',stableID:'paper:7',title:'Selected paper'};
 ui.agentInput=control('查找跨设备调制识别的论文');ui.agentMode=control('search');ui.agentModel=control('selected-model');ui.agentModel.options=[{value:'selected-model'}];ui.agentThinking=control('high');ui.agentExecution=control('auto');ui.agentSearch=control('');ui.agentSend=control('');ui.agentRunStatus={};
 ui.agentDraftDirty=true;ui.agentData.draft=ui.agentInput.value;
 for(const name of ['refreshAgentProjects','renderAgentSessions','renderAgentMessages','renderAgentSources','resetAgentPreview','renderEmptyAgentPreview','queueAgentInputSize'])ui[name]=()=>{};
 ui.previewAgentSource=source=>{ui.agentSelected=source;};ui.agentMaterials=()=>[];
 E.workbenchConversations.subscribe(value=>ui.receiveSharedAgentState(value),{summary:true,sessionID:()=>ui.agentData.activeSessionID});
 E.searchPaperPage=async(query,options)=>{calls.search.push({query,options});return {records:[{id:'controlled-paper',title:'Controlled result',doi:'10.1000/controlled',abstract:'Controlled abstract'}],provider:'controlled',page:1,hasMore:false};};
 if(unified)E.runWorkbenchTask=async request=>{calls.tasks.push(request);return {text:'Controlled research answer',sources:[]};};
 return {E,ui,state,calls};
}

test('a paper-scoped session transition keeps the selected search operation and saves its complete result',async()=>{
 const {E,ui,state,calls}=await fixture();
 await ui.runAgentTask();
 assert.equal(calls.search.length,1,'search remains a public search after opening the paper discussion');assert.equal(calls.unrelated,0,'opening a paper discussion does not replace the requested operation with its old mode');
 assert.equal(calls.search[0].query,'查找跨设备调制识别的论文');assert.equal(ui.agentData.messages.length,2);assert.equal(ui.agentData.messages[0].role,'user');assert.match(ui.agentData.messages[1].text,/公开文献候选/);assert.equal(ui.agentWebSources[0].stableID,'web:10.1000/controlled');
 const saved=E.workbenchConversations.get(ui.agentData.activeSessionID);assert.equal(saved.paperID,7);assert.equal(saved.mode,'search');assert.equal(saved.modelID,'selected-model');assert.equal(saved.thinkingLevel,'high');assert.equal(saved.executionMode,'auto');assert.deepEqual(copy(saved.messages),copy(ui.agentData.messages));
 assert.equal(state.researchWorkbench.sessions.find(session=>session.id==='current').draft,'查找跨设备调制识别的论文','the earlier unsent draft survives changing paper context');
 const searches=calls.search.length,history=copy(ui.agentData.messages);ui.receiveSharedAgentState(E.workbenchConversations.snapshot());assert.equal(calls.search.length,searches);assert.deepEqual(copy(ui.agentData.messages),history,'restoring shared state does not send or remove a turn');
});

test('resuming an existing paper discussion preserves earlier evidence and the model choices for the current send',async()=>{
 const {E,ui,calls}=await fixture({existingPaper:true,unified:true});ui.agentMode.value='auto';
 await ui.runAgentTask();
 assert.equal(calls.tasks.length,1);assert.equal(calls.unrelated,0);const request=calls.tasks[0];
 assert.equal(request.mode,'search');assert.equal(request.modelID,'selected-model');assert.equal(request.thinkingLevel,'high');assert.equal(request.executionMode,'auto');assert.equal(request.selectedSource.stableID,'paper:7');assert.equal(request.history.length,3);assert.equal(request.history[0].text,'Previous question');assert.equal(request.history[1].sources[0].anchor.pageIndex,3);
 const saved=E.workbenchConversations.get('paper-existing');assert.equal(saved.messages.length,4);assert.equal(saved.messages[3].text,'Controlled research answer');assert.equal(saved.mode,'auto');assert.equal(saved.modelID,'selected-model');assert.equal(saved.thinkingLevel,'high');assert.equal(saved.executionMode,'auto');
});

test('new conversation blocks typing and duplicate creation until its new draft is ready, then promotes that exact session into history',async()=>{
 const {E,ui,calls}=await fixture({unified:true}),originalID=ui.agentData.activeSessionID,originalInput=ui.agentInput.value;
 ui.agentNewSession={disabled:false,setAttribute(){},removeAttribute(){}};
 const create=E.workbenchConversations.create;let release,entered=0;const delayed=new Promise(resolve=>release=resolve);
 E.workbenchConversations.create=async(...args)=>{entered++;await delayed;return create(...args);};
 const creating=ui.createAgentSession();assert.equal(ui.agentCreatingSession,true);assert.equal(ui.agentInput.disabled,true);assert.equal(ui.agentSend.disabled,true);assert.equal(ui.agentNewSession.disabled,true);
 for(let n=0;n<20&&!entered;n++)await new Promise(resolve=>setTimeout(resolve,1));assert.equal(entered,1);
 await ui.createAgentSession();await ui.runAgentTask();assert.equal(entered,1,'a pending create cannot create another session');assert.equal(calls.tasks.length,0,'send cannot run against the previous session while switching');
 release();const newSession=await creating;assert.notEqual(newSession.id,originalID);assert.equal(ui.agentData.activeSessionID,newSession.id);assert.equal(ui.agentCreatingSession,false);assert.equal(ui.agentInput.disabled,false);assert.equal(ui.agentSend.disabled,false);assert.equal(ui.agentNewSession.disabled,false);
 assert.equal(E.workbenchConversations.get(originalID).draft,originalInput,'previous draft is preserved');assert.equal(E.workbenchConversations.get(newSession.id).isDraft,true);assert.ok(!E.workbenchConversations.list().some(session=>session.id===newSession.id),'the empty session is absent from saved history');
 await E.workbenchConversations.append(newSession.id,{role:'user',text:'Question in the newly created conversation'});assert.ok(E.workbenchConversations.list().some(session=>session.id===newSession.id));assert.equal(ui.agentData.messages[0].text,'Question in the newly created conversation');assert.equal(ui.agentData.modelID,'selected-model');assert.equal(ui.agentData.thinkingLevel,'high');
});

test('saving an unchanged conversation skips redundant transcript and home writes',async()=>{
 const {E,ui}=await fixture(),calls={update:[],home:0},update=E.workbenchConversations.update,home=E.workbenchConversations.updateHome;
 E.workbenchConversations.update=async(id,patch,...rest)=>{calls.update.push(copy(patch));return update(id,patch,...rest);};E.workbenchConversations.updateHome=async(...args)=>{calls.home++;return home(...args);};
 await ui.flushAgentDraft();assert.equal(calls.update.length,1);assert.equal(calls.home,0);assert.equal(Object.hasOwn(calls.update[0],'messages'),false,'a draft save does not clone and merge the entire transcript');
 await ui.saveAgentState();await ui.saveAgentState();assert.equal(calls.update.length,1);assert.equal(calls.home,0);
 ui.agentData.messages.push({id:'new-answer',role:'assistant',text:'A newly completed answer'});await ui.saveAgentState();assert.equal(calls.update.length,2);assert.equal(calls.update[1].messages.at(-1).id,'new-answer');assert.equal(E.workbenchConversations.get('current').messages.at(-1).id,'new-answer');
 ui.agentData.home={...ui.agentData.home,query:'changed topic'};await ui.saveAgentState();assert.equal(calls.update.length,2);assert.equal(calls.home,1);await ui.saveAgentState();assert.equal(calls.home,1);
});

test('rapid conversation clicks keep the last selection and retain the outgoing unsent draft',async()=>{
 const {E,ui}=await fixture({existingPaper:true}),originalDraft=ui.agentInput.value,select=E.workbenchConversations.select;let release,entered=false;const delayed=new Promise(resolve=>release=resolve);
 E.workbenchConversations.select=async(id,options)=>{if(id==='paper-existing'){entered=true;await delayed;}return select(id,options);};ui.restoreAgentPreview=async()=>new Promise(()=>{});
 const first=ui.switchAgentSession('paper-existing');for(let n=0;n<30&&!entered;n++)await new Promise(resolve=>setTimeout(resolve,1));assert.equal(entered,true);assert.equal(ui.agentInput.disabled,true);assert.equal(ui.agentSend.disabled,true);
 await ui.switchAgentSession('current');assert.equal(ui.agentData.activeSessionID,'current');assert.equal(ui.agentInput.disabled,false);assert.equal(ui.agentSend.disabled,false);release();await first;
 assert.equal(ui.agentData.activeSessionID,'current');assert.equal(E.workbenchConversations.getActive().id,'current');assert.equal(ui.agentInput.value,originalDraft);assert.equal(E.workbenchConversations.get('current').draft,originalDraft);assert.equal(ui.agentSwitchController,null);
});

test('generated image outcomes remain on the saved answer and do not become cited sources',async()=>{
 const {E,ui}=await fixture({unified:true});ui.agentMode.value='auto';E.runWorkbenchTask=async()=>({text:'已生成研究流程示意图。',sources:[],generatedImages:[{kind:'image',sourceType:'ai-illustration',imagePath:'E:/workspace/test-writing-images/concept.png',title:'研究流程',model:'image-model'}]});await ui.runAgentTask();const answer=E.workbenchConversations.get(ui.agentData.activeSessionID).messages.at(-1);assert.equal(answer.generatedImages[0].title,'研究流程');assert.equal(answer.generatedImages[0].imagePath,'E:/workspace/test-writing-images/concept.png');assert.deepEqual(copy(answer.sources),[]);
});

test('plan-edit preview metadata survives the actual research send and shared conversation save',async()=>{
 const {E,ui}=await fixture({unified:true}),proposal={id:'candidate-1',kind:'research-plan-edit',projectID:'project-1',versionID:'plan-1',path:'feasibility',status:'pending',before:'计划比较',selectedBefore:'计划',selectedAfter:'拟',selectedStart:0,selectedEnd:2,value:'拟比较'};ui.agentMode.value='auto';E.runWorkbenchTask=async()=>({text:'方案修改候选待采用。',sources:[],projectID:'project-1',planEditProposal:copy(proposal)});await ui.runAgentTask();const answer=E.workbenchConversations.get(ui.agentData.activeSessionID).messages.at(-1);assert.deepEqual(copy(answer.planEditProposal),proposal);assert.equal(answer.projectID,'project-1');
});
