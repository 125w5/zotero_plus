/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Conversations from '../../../chrome/content/zotero/research/shared/conversation-store.mjs';
import * as Attachments from '../../../chrome/content/zotero/research/shared/chat-attachments.mjs';
import * as Policy from '../../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Catalog from '../../../chrome/content/zotero/research/shared/material-catalog.mjs';
import * as Metadata from '../../../chrome/content/zotero/research/shared/paper-metadata.mjs';
const root=new URL('../../../chrome/content/zotero/xpcom/research/',import.meta.url),storeSource=await readFile(new URL('conversations.js',root),'utf8'),academicSource=await readFile(new URL('academic-assistant.js',root),'utf8');
function setup(initial={}){
 const data=structuredClone(initial),calls=[],E={store:{get:(key,id)=>id===undefined?data[key]:data[key]?.[id],async update(fn){await Promise.resolve();fn(data);}},library:{describe:item=>({id:item.id,title:'论文 '+item.id})},core:{resultMarkdown:record=>record.text},async runWorkbenchTask(request){calls.push(request);return {text:'$x_i^2$ 中的 $i$ 是原文下标。',model:'controlled-pi-model',sources:[{id:'paper:'+request.selectedSource.paperItemID,paperItemID:request.selectedSource.paperItemID,attachmentID:4,position:{pageIndex:2}}]};}};
 let sequence=0;const context={IOUtils:{},Zotero:{Research:E,Utilities:{randomString:()=>String(++sequence)},logError:error=>{throw error;}},ChromeUtils:{importESModule:uri=>uri.endsWith('conversation-store.mjs')?Conversations:uri.endsWith('chat-attachments.mjs')?Attachments:uri.endsWith('research-ai-policy.mjs')?Policy:uri.endsWith('material-catalog.mjs')?Catalog:uri.endsWith('paper-metadata.mjs')?Metadata:{}}};
 vm.runInNewContext(storeSource,context);vm.runInNewContext(academicSource,context);return {E,S:E.workbenchConversations,calls,data};
}
test('academic submit reuses the paper logo session, preserves attachments and settings, and publishes the same Pi answer',async()=>{
 const {E,S,calls,data}=setup(),paper={id:23},draft=await E.openPaperConversation(paper,{activate:false});
 assert.equal(data.researchWorkbench,undefined);await S.update(draft.id,{modelID:'chosen-model',thinkingLevel:'high'});await S.attach(draft.id,[{id:'material:eq3',kind:'material',materialID:'eq3',title:'原论文式(3)'}]);
 const message=await E.askPaperShared(paper,'解释这条公式');assert.equal(calls.length,1);assert.equal(calls[0].modelID,'chosen-model');assert.equal(calls[0].thinkingLevel,'high');assert.equal(calls[0].attachments[0].materialID,'eq3');
 assert.equal(calls[0].sessionID,draft.id,'原生论文调用携带所属会话以核验文件范围');assert.equal(S.getForScope({paperID:23}).id,draft.id);assert.equal(S.getActive().id,draft.id);assert.equal(S.get(draft.id).messages.at(-1).id,message.id);assert.equal(message.text,'$x_i^2$ 中的 $i$ 是原文下标。');assert.equal(data.paperConversations,undefined,'没有另存一份隔离的聊天历史');
 const legacyCaller=await E.askPaper(paper,'继续解释假设');assert.equal(legacyCaller.sharedMessage.id,S.get(draft.id).messages.at(-1).id);assert.equal(calls[1].history.length,2);assert.equal(S.list().length,1);
});
test('academic bridge forwards the shared execution policy and real interaction callbacks without changing source/model/strength',async()=>{
 const {E,S,calls}=setup(),paper={id:23},session=await E.openPaperConversation(paper);await S.update(session.id,{executionMode:'ask',modelID:'chosen',thinkingLevel:'medium'});
 const permission=async()=>true,question=async()=>({action:'regenerate'});await E.askPaperShared(paper,'  讨论这条公式 $x_i$  ',()=>{},{onToolPermission:permission,onResearchQuestion:question});
 assert.equal(calls[0].executionMode,'ask');assert.strictEqual(calls[0].onToolPermission,permission);assert.strictEqual(calls[0].onResearchQuestion,question);assert.equal(calls[0].modelID,'chosen');assert.equal(calls[0].thinkingLevel,'medium');assert.equal(calls[0].prompt,'  讨论这条公式 $x_i$  ');assert.equal(calls[0].selectedSource.paperItemID,23);assert.equal(S.get(session.id).executionMode,'ask');
});
test('paper reopening and late legacy migration preserve an explicitly inherited conversation and first send does not duplicate history',async()=>{
 const {E,S,calls,data}=setup({paperConversations:{24:{turns:[{id:'old',question:'旧问题',record:{text:'旧回答',sources:[{attachmentID:5}]}}],decisions:[],questions:[]}}}),a=await S.open({paperID:23});await S.append(a.id,{role:'user',text:'已有的研究问题'});await S.append(a.id,{role:'assistant',text:'已有的依据'});
 await S.select(a.id,{scope:{paperID:24}});await E.openPaperConversation({id:24},{activate:false});assert.equal(S.getForScope({paperID:24}).id,a.id);
 await E.askPaperShared({id:24},'比较这篇论文');assert.equal(calls[0].history.length,2);assert.equal(calls[0].selectedSource.paperItemID,24);assert.equal(S.get(a.id).messages.length,4);assert.equal(data.paperConversations[24].turns.length,1,'迁移不改写旧历史');
});

test('fresh academic conversations retain their paper settings and remain an unsaved draft before the first question',async()=>{
 const {E,S,data}=setup(),paper={id:23},first=await E.openPaperConversation(paper);await S.update(first.id,{modelID:'chosen',thinkingLevel:'high',executionMode:'ask'});await S.append(first.id,{role:'user',text:'此前真实的问题'});
 const other=await E.openPaperConversation({id:24});await S.update(other.id,{modelID:'another',thinkingLevel:'low',executionMode:'auto'});
 const fresh=await E.openPaperConversation(paper,{fresh:true});assert.notEqual(fresh.id,first.id);assert.equal(fresh.modelID,'chosen');assert.equal(fresh.thinkingLevel,'high');assert.equal(fresh.executionMode,'ask');assert.equal(fresh.messages.length,0);assert.equal(fresh.isDraft,true);assert.equal(data.researchWorkbench.sessions.length,1);assert.equal(S.get(first.id).messages[0].text,'此前真实的问题');
});
