/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function fixture(){
 const ui={},calls={render:0,dispose:0},node=(tag,text='',className='')=>({tag,textContent:text,className,dataset:{},children:[],append(...rows){this.children.push(...rows);},replaceChildren(...rows){this.children=rows;this.replacements=(this.replacements||0)+1;},setAttribute(name,value){this[name]=value;}});
 vm.runInContext(await readFile(new URL('../../chrome/content/zotero/research/ui/agent-workbench.js',import.meta.url),'utf8'),vm.createContext({EasySchUI:ui,clearTimeout,setTimeout}));
 ui.el=node;ui.agentMessages={...node('div'),scrollHeight:1000,clientHeight:300,scrollTop:700};ui.agentInput={value:''};ui.agentWelcome={};ui.agentChatLabel={};ui.agentRunStatus={};ui.renderAgentAttachments=()=>{};
 ui.E={renderContent:(host,text)=>{calls.render++;host.textContent=text;}};ui.agentEvidence={citedSources:()=>[],sourceGroups:()=>[],answerWithQuestion:(_,message)=>message};ui.agentMessageTransfer={installMessageDrag:()=>()=>calls.dispose++};ui.agentData={activeSessionID:'a',projectID:'',sessions:[{id:'a',title:'First'},{id:'b',title:'Second'}],messages:[{id:'q',role:'user',text:'Question'},{id:'a1',role:'assistant',text:'First answer'},{id:'a2',role:'assistant',text:'Second answer'}]};
 return {ui,calls};
}

test('draft and file notifications retain existing rendered messages, expanded details and scroll position',async()=>{
 const {ui,calls}=await fixture();ui.renderAgentMessages();assert.equal(calls.render,2);const answer=ui.agentMessages.children[1];answer.expanded=true;ui.agentMessages.scrollTop=180;
 ui.agentData.messages=JSON.parse(JSON.stringify(ui.agentData.messages));ui.renderAgentMessages();assert.equal(calls.render,2);assert.equal(ui.agentMessages.replacements,1);assert.equal(ui.agentMessages.children[1],answer);assert.equal(answer.expanded,true);assert.equal(ui.agentMessages.scrollTop,180);
 ui.agentData.messages[2].text='Updated second answer';ui.renderAgentMessages();assert.equal(calls.render,3);assert.equal(calls.dispose,1);assert.equal(ui.agentMessages.children[1],answer);assert.equal(ui.agentMessages.scrollTop,180);ui.clearAgentTranscriptCache();assert.equal(calls.dispose,3);
});

test('returning to a recent conversation restores its rendered nodes and scroll without reformatting Markdown',async()=>{
 const {ui,calls}=await fixture(),messages=ui.agentData.messages;ui.renderAgentMessages();const answer=ui.agentMessages.children[1];ui.agentMessages.scrollTop=220;
 ui.agentData.activeSessionID='b';ui.agentData.messages=[{id:'b-answer',role:'assistant',text:'Different discussion'}];ui.renderAgentMessages();assert.equal(calls.render,3);
 ui.agentData.activeSessionID='a';ui.agentData.messages=JSON.parse(JSON.stringify(messages));ui.renderAgentMessages();assert.equal(calls.render,3);assert.equal(ui.agentMessages.children[1],answer);assert.equal(ui.agentMessages.scrollTop,220);
 for(const id of ['c','d','e']){ui.agentData.activeSessionID=id;ui.agentData.messages=[{id,role:'assistant',text:id}];ui.renderAgentMessages();}assert.equal(ui.agentTranscriptCaches.size,4);assert.equal(ui.agentTranscriptCaches.has('b'),false);assert.equal(calls.dispose,1);ui.clearAgentTranscriptCache();assert.equal(ui.agentTranscriptCaches.size,0);
});

test('generated images render inline with an explicit origin label and retained previews are disposed with the message cache',async()=>{
 const {ui}=await fixture();let previews=0,disposed=0;ui.E.previewImage=async path=>{assert.equal(path,'E:/saved/concept.png');return 'data:image/png;base64,controlled';};ui.agentDiscoveryMedia={installMediaPreview:(image,options)=>{previews++;assert.match(options.alt,/AI 构想，非原文证据/);return()=>disposed++;}};ui.agentData.messages=[{id:'image-answer',role:'assistant',text:'研究示意图',sources:[],generatedImages:[{imagePath:'E:/saved/concept.png',title:'实验流程'}]}];ui.renderAgentMessages();await new Promise(resolve=>setTimeout(resolve,0));const gallery=ui.agentMessages.children[0].children.find(row=>row.className==='agent-generated-images'),figure=gallery.children[0];assert.equal(figure.children[0].src,'data:image/png;base64,controlled');assert.match(figure.children[1].textContent,/AI 构想 · 非原文证据/);assert.equal(previews,1);ui.renderAgentMessages();assert.equal(previews,1);ui.clearAgentTranscriptCache();assert.equal(disposed,1);
});

test('middle conversation accepts remote recommendations and retained answers through the same shared receiver as the file rail',async()=>{
 const {ui}=await fixture();ui.agentAttachmentTools={chatAttachmentDropPayload:()=>null};ui.agentMessageTransfer.RESEARCH_MESSAGE_MIME='application/x-retained-answer';ui.agentAttach={disabled:false};const dropped={types:['application/x-easysch-discovery-paper']};assert.equal(ui.acceptsAgentConversationDrop(dropped),true);assert.equal(ui.acceptsAgentConversationDrop({types:['application/x-retained-answer']}),true);assert.equal(ui.acceptsAgentConversationDrop({types:['text/plain']}),false);let render=0;
 ui.renderAgentMessages=ui.renderAgentAttachments=ui.renderAgentSources=()=>render++;ui.agentFilesTools={receiveConversationDrop:async({dataTransfer,sessionID,onProgress})=>{assert.equal(dataTransfer,dropped);assert.equal(sessionID,'a');assert.equal(ui.agentAttach.disabled,true);onProgress('正在下载 PDF…');return '已下载并加入资料';}};
 await ui.receiveAgentConversationDrop(dropped);assert.equal(render,3);assert.equal(ui.agentRunStatus.textContent,'已下载并加入资料');assert.equal(ui.agentAttach.disabled,false);
 let release;ui.agentFilesTools.receiveConversationDrop=async({sessionID,onProgress})=>{assert.equal(sessionID,'a');await new Promise(resolve=>release=resolve);onProgress('旧对话完成');return '旧对话完成';};const pending=ui.receiveAgentConversationDrop(dropped);ui.agentData.activeSessionID='b';ui.agentRunStatus.textContent='新对话状态';release();await pending;assert.equal(ui.agentRunStatus.textContent,'新对话状态');assert.equal(render,3,'finishing a prior import cannot rerender the newly selected conversation');
});
