/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as C from '../../../chrome/content/zotero/research/shared/conversation-store.mjs';
import * as A from '../../../chrome/content/zotero/research/shared/chat-attachments.mjs';
const source=await readFile(new URL('../../../chrome/content/zotero/xpcom/research/conversations.js',import.meta.url),'utf8');
function setup(initial={}){let data=structuredClone(initial),sequence=0,writes=0;const E={store:{get:key=>key?data[key]:data,async update(fn){await Promise.resolve();writes++;fn(data);}}};vm.runInNewContext(source,{Zotero:{Research:E,Utilities:{randomString:()=>String(++sequence)},logError:error=>{throw error;}},ChromeUtils:{importESModule:uri=>uri.endsWith('chat-attachments.mjs')?A:C}});return {S:E.workbenchConversations,get data(){return data;},get writes(){return writes;}};}
test('legacy normalization gives stable IDs while retaining Unicode, formulas, sources and model settings',()=>{
 const prior={messages:[{role:'assistant',text:'$x_i^2$ 与中文解释',sources:[{attachmentID:31,position:{rects:[[1,2,3,4]]}}]}],draft:'中文组词草稿',modelID:'configured-model',thinkingLevel:'low',executionMode:'ask'};
 const first=C.normalizeConversations(prior),second=C.normalizeConversations(prior);
 assert.equal(first.sessions[0].messages[0].id,second.sessions[0].messages[0].id);
 assert.equal(first.sessions[0].draft,prior.draft);assert.equal(first.sessions[0].messages[0].text,prior.messages[0].text);assert.deepEqual(first.sessions[0].messages[0].sources,prior.messages[0].sources);
 assert.equal(first.sessions[0].modelID,prior.modelID);assert.equal(first.sessions[0].thinkingLevel,prior.thinkingLevel);assert.equal(first.sessions[0].executionMode,'ask');
 assert.equal(prior.messages[0].id,undefined,'迁移不会改写来源数据');
});

test('fresh scoped conversations and explicit inheritance preserve the chosen model, strength and execution mode without copying content',async()=>{
 const {S}=setup(),a=await S.open({paperID:1,origin:'reader'});await S.update(a.id,{mode:'auto',modelID:'paper-model',thinkingLevel:'high',executionMode:'ask'});await S.append(a.id,{role:'user',text:'论文一的已有问题'});
 const b=await S.open({paperID:2,origin:'reader'});await S.update(b.id,{modelID:'other-model',thinkingLevel:'low',executionMode:'auto'});
 const fresh=await S.open({paperID:1,origin:'academic'},{fresh:true});assert.equal(fresh.modelID,'paper-model');assert.equal(fresh.thinkingLevel,'high');assert.equal(fresh.executionMode,'ask');assert.equal(fresh.messages.length,0);assert.equal(fresh.attachments.length,0);assert.equal(fresh.isDraft,true);assert.equal(S.list().length,1);
 const copy=await S.inherit(a.id,{paperID:3,origin:'reader'});assert.equal(copy.modelID,'paper-model');assert.equal(copy.thinkingLevel,'high');assert.equal(copy.executionMode,'ask');assert.equal(copy.messages[0].text,'论文一的已有问题');
 const changed=await S.create({paperID:1,modelID:'deliberately-changed',thinkingLevel:'medium',executionMode:'auto'});assert.equal(changed.modelID,'deliberately-changed');assert.equal(changed.thinkingLevel,'medium');assert.equal(changed.executionMode,'auto');
});
test('two UI surfaces append serially and a stale snapshot cannot remove newer research messages',async()=>{
 const {S}=setup();const active=S.getActive(),events=[];const off=S.subscribe((state,meta)=>events.push([state,meta]));
 await Promise.all([S.append(active.id,{id:'assembly',role:'user',text:'核对防泄漏'}),S.append(active.id,{id:'reader',role:'assistant',text:'先划分独立采集批次。',sources:[{attachmentID:9}]})]);
 const stale={messages:[{id:'assembly',role:'user',text:'核对防泄漏'}],draft:'未发送'};await S.update(active.id,stale);
 assert.deepEqual(S.getActive().messages.map(message=>message.id),['assembly','reader']);assert.equal(S.getActive().messages[1].sources[0].attachmentID,9);assert.equal(events.length,3);off();
 const external=S.snapshot();external.sessions[0].messages.length=0;assert.equal(S.getActive().messages.length,2,'读取返回副本而不是可被其他页删除的数组');
});
test('assembly legacy import is idempotent and session CRUD never alters source papers or assets',async()=>{
 const fixture=setup({researchMaterials:{source:{id:'source',summary:'用户修改'}},papers:{paper:{title:'原论文'}}}),{S}=fixture;
 const legacy=[{role:'user',text:'旧研究问题'},{role:'assistant',text:'旧回答',sources:[{id:'source'}]}];
 const active=S.getActive();await S.update(active.id,{draft:'当前未发送思路'});
 const imported=await S.importLegacy('assembly:p1',legacy,{origin:'assembly',projectID:'p1',title:'原装配对话'});
 await S.importLegacy('assembly:p1',legacy,{origin:'assembly'});assert.equal(S.list().filter(session=>session.origin==='assembly').length,1);assert.equal(S.getActive().id,active.id);assert.equal(S.getActive().draft,'当前未发送思路');assert.equal(S.get(imported.id).messages.length,2);
 const next=await S.create({title:'新问题',origin:'reader'});await S.select(imported.id);assert.equal(S.getActive().id,imported.id);await S.remove(next.id);
 assert.equal(fixture.data.researchMaterials.source.summary,'用户修改');assert.equal(fixture.data.papers.paper.title,'原论文');assert.equal(legacy[0].id,undefined);
 await S.updateHome({query:'卷积神经网络'});assert.equal(S.snapshot().home.query,'卷积神经网络');
});
test('opening, typing, configuring or attaching to an empty conversation never creates a saved history row',async()=>{
 const fixture=setup(),{S}=fixture;S.getActive();assert.equal(fixture.writes,0);
 const draft=await S.open({paperID:12,origin:'reader',title:'原论文'});await S.update(draft.id,{draft:'尚未发送',modelID:'chosen-model',thinkingLevel:'high'});
 await S.attach(draft.id,[{id:'material:m1',materialID:'m1',kind:'material',title:'已有素材'}]);
 assert.equal(S.get(draft.id).isDraft,true);assert.equal(S.list().length,0);assert.equal(fixture.writes,0);assert.equal(fixture.data.researchWorkbench,undefined);
 const again=await S.open({paperID:12,origin:'academic'});assert.equal(again.id,draft.id);assert.equal(again.draft,'尚未发送');
 await S.append(draft.id,{id:'first-question',role:'user',text:'请解释式(3)中的下标'});
 assert.equal(S.list().length,1);assert.equal(S.get(draft.id).isDraft,undefined);assert.equal(fixture.data.researchWorkbench.sessions.length,1);
 assert.equal(S.get(draft.id).attachments[0].materialID,'m1');assert.equal(S.get(draft.id).modelID,'chosen-model');
});
test('paper scopes share across academic and logo surfaces, stay separate by default, and retain explicit inheritance',async()=>{
 const fixture=setup(),{S}=fixture,a=await S.open({paperID:1,origin:'reader'});await S.append(a.id,{role:'user',text:'论文一的研究问题'});await S.append(a.id,{role:'assistant',text:'$E_{\\mathrm{F}}$ 是给定的量',sources:[{paperItemID:1,attachmentID:3,position:{pageIndex:4}}]});
 const b=await S.open({paperID:2,origin:'reader'});assert.notEqual(b.id,a.id);assert.equal(b.messages.length,0);assert.equal((await S.open({paperID:1,origin:'academic'})).id,a.id);
 await S.select(a.id,{scope:{paperID:2}});assert.equal(S.getForScope({paperID:2}).id,a.id,'用户明确继承时两个入口引用同一实际历史');
 const reloaded=setup(fixture.data);assert.equal(reloaded.S.getForScope({paperID:2}).id,a.id);assert.equal(reloaded.S.getForScope({paperID:1}).messages[1].sources[0].attachmentID,3);
 const copy=await S.inherit(a.id,{paperID:3,origin:'reader'});assert.equal(copy.isDraft,true);assert.equal(S.list().length,1,'复制上下文不算用户开始新对话');
 await S.update(copy.id,{messages:copy.messages,draft:'继续问'});assert.equal(S.list().length,1);
 await S.append(copy.id,{role:'user',text:'将这项证据与论文三比较'});assert.equal(S.list().length,2);assert.equal(S.get(a.id).messages.length,2);assert.equal(S.get(copy.id).inheritedFrom,a.id);
});
test('simultaneous paper opens converge before first-send appends and background legacy cannot replace inherited scope',async()=>{
 const fixture=setup(),{S}=fixture,[reader,academic]=await Promise.all([S.open({paperID:8,origin:'reader'}),S.open({paperID:8,origin:'academic'})]);assert.equal(reader.id,academic.id);assert.equal(S.list().length,0);assert.equal(fixture.writes,0);
 await Promise.all([S.append(reader.id,{id:'reader-q',role:'user',text:'解释模型假设'}),S.append(academic.id,{id:'academic-q',role:'user',text:'解释式(2)的变量'}),S.attach(reader.id,[{id:'material:source',kind:'material',materialID:'source',title:'完整原式'}])]);
 assert.equal(S.list().length,1);assert.deepEqual(S.getForScope({paperID:8}).messages.map(message=>message.id),['reader-q','academic-q']);assert.equal(S.get(reader.id).attachments[0].materialID,'source');
 const alias=await S.inherit(reader.id,{paperID:9,origin:'reader'});await S.importLegacy('reader-paper:9',[{role:'user',text:'旧论文的已保存问题'}],{paperID:9,origin:'reader'});assert.equal(S.getForScope({paperID:9}).id,alias.id);
 await S.open({paperID:9,origin:'academic'},{activate:false});assert.equal(S.getForScope({paperID:9}).id,alias.id);assert.equal(S.get(alias.id).messages[0].id,'reader-q');
});
test('file selection, featured state and spreadsheet ranges persist per conversation and stale snapshots cannot restore detached sources',async()=>{
 const fixture=setup(),{S}=fixture,a=await S.create({id:'files-a'}),b=await S.create({id:'files-b'}),file={id:'attachment:31',attachmentID:31,kind:'spreadsheet',title:'实验数据.xlsx'};
 await S.append(a.id,{role:'user',text:'比较实验结果'});await S.append(b.id,{role:'user',text:'另一项研究'});await S.attach(a.id,[file]);await S.attach(b.id,[file]);
 const stale=S.get(a.id);await S.updateAttachment(a.id,file.id,{selected:false,featured:true,sheet:'测量',ranges:['b2:f40']});
 await S.update(a.id,{attachments:stale.attachments,messages:stale.messages});
 const saved=S.get(a.id).attachments[0];assert.equal(saved.selected,false);assert.equal(saved.featured,true);assert.equal(saved.sheet,'测量');assert.deepEqual(saved.ranges,['B2:F40']);
 assert.equal(S.get(b.id).attachments[0].selected,true);assert.equal(S.get(b.id).attachments[0].featured,false);
 const reload=setup(fixture.data).S;assert.equal(reload.get(a.id).attachments[0].selected,false);assert.equal(reload.get(a.id).attachments[0].featured,true);
 await S.detach(a.id,file.id);await S.update(a.id,{attachments:stale.attachments});assert.equal(S.get(a.id).attachments.length,0);
 await assert.rejects(()=>S.updateAttachment(a.id,file.id,{selected:true}),/移除/);
 await S.attach(a.id,[file]);assert.equal(S.get(a.id).attachments.length,1);assert.equal(S.get(a.id).attachments[0].selected,true);
 await assert.rejects(()=>S.updateAttachment(a.id,file.id,{ranges:['A0:F40']}),/单元格范围/);
});
test('PPT drafts retain separate conversation scopes without falling through to a project conversation',async()=>{
 const {S}=setup(),a=await S.open({pptDraftID:'ppt-1',projectID:'p1',origin:'ppt'}),b=await S.open({pptDraftID:'ppt-2',projectID:'p1',origin:'ppt'}),project=await S.open({projectID:'p1'});
 assert.notEqual(a.id,b.id);assert.notEqual(a.id,project.id);assert.equal(S.getForScope({pptDraftID:'ppt-1',projectID:'p1'}).id,a.id);assert.equal(S.get(a.id).pptDraftID,'ppt-1');
});
