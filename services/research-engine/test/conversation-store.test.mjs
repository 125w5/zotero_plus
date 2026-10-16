/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as C from '../../../chrome/content/zotero/research/shared/conversation-store.mjs';
import * as A from '../../../chrome/content/zotero/research/shared/chat-attachments.mjs';
const source=await readFile(new URL('../../../chrome/content/zotero/xpcom/research/conversations.js',import.meta.url),'utf8');
function setup(initial={},withRevision=false){let data=structuredClone(initial),sequence=0,writes=0,revision=1,reads=0,normalizations=0;const tracked={...C,normalizeConversations(value){normalizations++;return C.normalizeConversations(value);}},E={store:{get revision(){return withRevision?revision:undefined;},get(key){reads++;return key?data[key]:data;},async update(fn){await Promise.resolve();writes++;fn(data);revision++;}}};vm.runInNewContext(source,{Zotero:{Research:E,Utilities:{randomString:()=>String(++sequence)},logError:error=>{throw error;}},ChromeUtils:{importESModule:uri=>uri.endsWith('chat-attachments.mjs')?A:tracked}});return {S:E.workbenchConversations,store:E.store,get data(){return data;},get writes(){return writes;},get reads(){return reads;},get normalizations(){return normalizations;}};}
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
test('browsing stays transient while nonempty drafts and deliberately imported files survive restart',async()=>{
 const fixture=setup(),{S}=fixture;S.getActive();assert.equal(fixture.writes,0);
 const draft=await S.open({paperID:12,origin:'reader',title:'原论文'});await S.update(draft.id,{draft:'  ',modelID:'chosen-model',thinkingLevel:'high'});
 assert.equal(S.get(draft.id).isDraft,true);assert.equal(S.list().length,0);assert.equal(fixture.writes,0);assert.equal(fixture.data.researchWorkbench,undefined);
 await S.update(draft.id,{draft:'尚未发送'});assert.equal(S.get(draft.id).isDraft,undefined);assert.equal(S.list().length,1);
 const reloaded=setup(fixture.data).S;assert.equal(reloaded.get(draft.id).draft,'尚未发送');assert.equal(reloaded.get(draft.id).modelID,'chosen-model');assert.equal(reloaded.get(draft.id).thinkingLevel,'high');
 const imported=await S.open({paperID:13,origin:'reader',title:'导入资料'});await S.attach(imported.id,[{id:'material:m1',materialID:'m1',kind:'material',title:'已有素材'}]);
 assert.equal(S.get(imported.id).isDraft,undefined);assert.equal(S.list().length,2);assert.equal(setup(fixture.data).S.get(imported.id).attachments[0].materialID,'m1');
 const again=await S.open({paperID:12,origin:'academic'});assert.equal(again.id,draft.id);assert.equal(again.draft,'尚未发送');
 await S.append(draft.id,{id:'first-question',role:'user',text:'请解释式(3)中的下标'});
 assert.equal(S.list().length,2);assert.equal(S.get(draft.id).isDraft,undefined);assert.equal(fixture.data.researchWorkbench.sessions.length,2);assert.equal(S.get(draft.id).modelID,'chosen-model');
});
test('paper scopes share across academic and logo surfaces, stay separate by default, and retain explicit inheritance',async()=>{
 const fixture=setup(),{S}=fixture,a=await S.open({paperID:1,origin:'reader'});await S.append(a.id,{role:'user',text:'论文一的研究问题'});await S.append(a.id,{role:'assistant',text:'$E_{\\mathrm{F}}$ 是给定的量',sources:[{paperItemID:1,attachmentID:3,position:{pageIndex:4}}]});
 const b=await S.open({paperID:2,origin:'reader'});assert.notEqual(b.id,a.id);assert.equal(b.messages.length,0);assert.equal((await S.open({paperID:1,origin:'academic'})).id,a.id);
 await S.select(a.id,{scope:{paperID:2}});assert.equal(S.getForScope({paperID:2}).id,a.id,'用户明确继承时两个入口引用同一实际历史');
 const reloaded=setup(fixture.data);assert.equal(reloaded.S.getForScope({paperID:2}).id,a.id);assert.equal(reloaded.S.getForScope({paperID:1}).messages[1].sources[0].attachmentID,3);
 const copy=await S.inherit(a.id,{paperID:3,origin:'reader'});assert.equal(copy.isDraft,true);assert.equal(S.list().length,1,'复制上下文不算用户开始新对话');
 await S.update(copy.id,{messages:copy.messages,draft:'继续问'});assert.equal(S.list().length,2,'用户编写的未发送问题也会保留');
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

test('revision caching avoids library-wide normalization for repeated session reads while returned values remain detached',async()=>{
 const sessions=Array.from({length:60},(_,index)=>({id:'session-'+index,title:'Discussion '+index,messages:[{id:'message-'+index,role:'assistant',text:'完整研究上下文'.repeat(100),sources:[{anchor:{pageIndex:index}}]}],attachments:[]})),fixture=setup({researchWorkbench:{version:2,activeSessionID:sessions[0].id,sessions}},true),{S}=fixture;
 const snapshot=S.snapshot(),reads=fixture.reads,normalizations=fixture.normalizations;snapshot.sessions[0].messages[0].sources[0].anchor.pageIndex=-1;
 for(let index=0;index<60;index++){const row=S.get('session-'+index);row.messages[0].text='temporary local edit';}
 assert.equal(fixture.reads,reads);assert.equal(fixture.normalizations,normalizations);assert.equal(S.get(sessions[0].id).messages[0].sources[0].anchor.pageIndex,0);assert.notEqual(S.get(sessions[1].id).messages[0].text,'temporary local edit');
 await fixture.store.update(data=>{data.researchWorkbench={...data.researchWorkbench,sessions:data.researchWorkbench.sessions.map(session=>session.id==='session-1'?{...session,title:'Externally changed'}:session)};});assert.equal(S.get('session-1').title,'Externally changed');assert.equal(fixture.normalizations,normalizations+1);
});

test('failed persisted writes cannot mutate the cached transcript and the queued next write still succeeds',async()=>{
 const fixture=setup({researchWorkbench:{version:2,activeSessionID:'saved',sessions:[{id:'saved',title:'Saved',messages:[{id:'original',role:'user',text:'Keep this question'}]}]}},true),{S}=fixture,write=fixture.store.update;let fail=true;
 fixture.store.update=async fn=>{if(fail){fail=false;throw Error('Controlled persistence failure');}return write(fn);};
 await assert.rejects(()=>S.append('saved',{id:'failed',role:'assistant',text:'Do not save this answer'}),/persistence/);assert.deepEqual(S.get('saved').messages.map(message=>message.id),['original']);
 await S.append('saved',{id:'success',role:'assistant',text:'The next answer'});assert.deepEqual(S.get('saved').messages.map(message=>message.id),['original','success']);
});

test('a superseded queued session selection respects cancellation without changing saved paper scopes',async()=>{
 const {S}=setup(),first=await S.open({paperID:11}),second=await S.open({paperID:22}),controller=new AbortController();const pending=S.select(first.id,{scope:{paperID:22},signal:controller.signal});controller.abort();await pending;assert.equal(S.getActive().id,second.id);assert.equal(S.getForScope({paperID:22}).id,second.id);
});

test('history summaries retain routing and counts without copying full transcripts or file content',async()=>{
 const fixture=setup({},true),{S}=fixture,session=await S.open({id:'ppt-history',title:'组会讨论',projectID:'project-1',pptDraftID:'draft-1',origin:'ppt',modelID:'chosen-model',currentTask:'比较方法',sourceID:'paper:31'});
 await S.attach(session.id,[{id:'attachment:31',attachmentID:31,kind:'spreadsheet',title:'实验数据.xlsx'}]);await S.append(session.id,{role:'user',text:'保留完整研究问题'.repeat(1000)});const draft=await S.open({id:'empty-draft',paperID:11});
 const reads=fixture.reads,normalizations=fixture.normalizations,rows=S.list({summary:true});assert.equal(rows.length,1);assert.equal(rows[0].id,session.id);assert.equal(rows[0].title,'组会讨论');assert.equal(rows[0].pptDraftID,'draft-1');assert.equal(rows[0].projectID,'project-1');assert.equal(rows[0].modelID,'chosen-model');assert.equal(rows[0].messageCount,1);assert.equal(rows[0].attachmentCount,1);
 assert.equal(rows[0].currentTask,'比较方法');assert.equal(rows[0].sourceID,'paper:31');for(const key of ['messages','attachments','draft','detachedAttachments'])assert.equal(Object.hasOwn(rows[0],key),false,key+' stays out of lightweight history');rows[0].title='Local title';rows.push({id:'external'});assert.equal(S.get(session.id).title,'组会讨论');
 const withDrafts=S.list({includeDrafts:true,summary:true});assert.equal(withDrafts.find(row=>row.id===draft.id).isDraft,true);assert.equal(withDrafts.find(row=>row.id===draft.id).messageCount,0);assert.equal(S.list()[0].messages[0].text,'保留完整研究问题'.repeat(1000),'existing full list remains available');assert.equal(fixture.reads,reads);assert.equal(fixture.normalizations,normalizations);
 await S.append(session.id,{role:'assistant',text:'新回答'});assert.equal(S.list({summary:true})[0].messageCount,2);
 const attachments=S.getAttachments(session.id);assert.equal(attachments[0].attachmentID,31);attachments[0].title='Local edit';attachments.push({id:'external'});assert.equal(S.getAttachments(session.id).length,1);assert.equal(S.getAttachments(session.id)[0].title,'实验数据.xlsx');assert.deepEqual(S.getAttachments('missing'),[]);
});

test('conversation cache ignores unrelated branch revisions and observes a changed conversation branch',async()=>{
 const fixture=setup({researchWorkbench:{version:2,activeSessionID:'saved',sessions:[{id:'saved',title:'Saved',messages:[{id:'q',role:'user',text:'Original'}]}]}},true),{S,store}=fixture;let branchRevision=1;store.branchRevision=key=>{assert.equal(key,'researchWorkbench');return branchRevision;};S.get('saved');const reads=fixture.reads,normalizations=fixture.normalizations;
 await store.update(data=>data.researchMaterials={m:{summary:'New material'}});assert.equal(S.get('saved').title,'Saved');assert.equal(fixture.reads,reads);assert.equal(fixture.normalizations,normalizations);
 await store.update(data=>data.researchWorkbench.sessions[0].title='Renamed');branchRevision++;assert.equal(S.get('saved').title,'Renamed');assert.equal(fixture.reads,reads+1);assert.equal(fixture.normalizations,normalizations+1);
});

test('projected snapshots and subscriptions preserve active and requested scopes without exposing other transcripts',async()=>{
 const {S}=setup({},true),a=await S.open({id:'paper-a',paperID:1}),b=await S.open({id:'paper-b',paperID:2}),draft=await S.open({id:'draft-c',paperID:3});await S.append(a.id,{role:'user',text:'论文一完整问题'});await S.attach(a.id,[{id:'attachment:31',attachmentID:31,title:'论文一.pdf',kind:'pdf'}]);await S.append(b.id,{role:'user',text:'论文二完整问题'});await S.update(draft.id,{draft:'未发送的问题'});await S.select(b.id);
 let retained=a.id,projected,full;const off=S.subscribe(state=>{projected=state;},{summary:true,sessionID:()=>retained}),offFull=S.subscribe(state=>{full=state;});await S.updateHome({query:'研究方向'});
 assert.equal(projected.sessions.find(row=>row.id===a.id).messages[0].text,'论文一完整问题');assert.equal(projected.sessions.find(row=>row.id===b.id).messages[0].text,'论文二完整问题');const omitted=projected.sessions.find(row=>row.id===draft.id);assert.equal(omitted.isDraft,undefined);assert.equal(omitted.messageCount,0);assert.equal(Object.hasOwn(omitted,'messages'),false);assert.equal(Object.hasOwn(omitted,'draft'),false);assert.equal(full.sessions.find(row=>row.id===draft.id).draft,'未发送的问题','default subscription still returns complete sessions');
 projected.sessions.find(row=>row.id===a.id).attachments[0].title='本地更改';projected.sessions.find(row=>row.id===draft.id).title='外部标题';assert.equal(S.getAttachments(a.id)[0].title,'论文一.pdf');assert.notEqual(S.get(draft.id).title,'外部标题');
 retained=draft.id;await S.updateHome({query:'不同方向'});assert.equal(projected.sessions.find(row=>row.id===draft.id).draft,'未发送的问题');assert.equal(Object.hasOwn(projected.sessions.find(row=>row.id===a.id),'messages'),false);
 const selected=await S.select(draft.id,{scope:{paperID:3},summary:true});assert.equal(selected.activeSessionID,draft.id);assert.equal(selected.sessions.find(row=>row.id===draft.id).draft,'未发送的问题');assert.equal(Object.hasOwn(selected.sessions.find(row=>row.id===b.id),'messages'),false);assert.equal(S.getForScope({paperID:3}).id,draft.id);assert.equal(S.getForScope({paperID:1}).id,a.id);
 const snapshot=S.snapshot({summary:true,sessionID:a.id});assert.equal(snapshot.sessions.find(row=>row.id===a.id).attachments[0].attachmentID,31);assert.equal(snapshot.sessions.find(row=>row.id===draft.id).draft,'未发送的问题');snapshot.sessions.find(row=>row.id===draft.id).draft='临时修改';assert.equal(S.get(draft.id).draft,'未发送的问题');assert.equal(S.snapshot().sessions.find(row=>row.id===b.id).messages[0].text,'论文二完整问题');off();offFull();
});
