/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as C from '../../chrome/content/zotero/research/shared/conversation-store.mjs';
import * as A from '../../chrome/content/zotero/research/shared/chat-attachments.mjs';
import * as L from '../../chrome/content/zotero/research/shared/library-scope.mjs';
const code=await readFile(new URL('../../chrome/content/zotero/xpcom/research/conversations.js',import.meta.url),'utf8');
function fixture(initial={}){
 let data=structuredClone(initial),revision=0,index=0;
 const E={store:{get:key=>structuredClone(data[key]),branchRevision:()=>revision,async replaceBranch(key,value){data[key]=structuredClone(value);revision++;}}};
 vm.runInNewContext(code,{Zotero:{Research:E,Utilities:{randomString:()=>String(++index)},logError:error=>{throw error;}},ChromeUtils:{importESModule:uri=>uri.endsWith('conversation-store.mjs')?C:uri.endsWith('library-scope.mjs')?L:A}});
 return {E,S:E.workbenchConversations,persisted:()=>structuredClone(data.researchWorkbench)};
}
const scope=(key,files)=>({key,folder:key,collectionID:Number(key.slice(1)),libraryID:1,files:files.map((kind,index)=>({id:'attachment:'+key+'-'+index,kind,title:key+' '+kind,attachmentID:index+100,selected:false}))});

test('actual native folder scan includes PDF, image, spreadsheet and text files hidden by item-list filters',async()=>{
 const files=['paper.pdf','figure.png','measurements.xlsx','record.txt'].map((name,index)=>({id:10+index,attachmentFilename:name,isAttachment:()=>true,getField:()=>name})),paper={id:1,isRegularItem:()=>true,getAttachments:()=>[10,11],getField:()=> '文件夹中的论文'},items=new Map([paper,...files].map(item=>[item.id,item])),reads=[],options=[];
 const E={chatAttachments:{async fromItem(id){reads.push(id);return {id:'attachment:'+id,attachmentID:id,title:items.get(id).attachmentFilename,kind:A.chatAttachmentFileKind(items.get(id).attachmentFilename)};}}};
 const source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/zotero.js',import.meta.url),'utf8');
 vm.runInNewContext(source,{EasySch:E,Zotero:{Items:{getAsync:async ids=>ids.map(id=>items.get(id)),get:id=>items.get(id)}},ChromeUtils:{importESModule:()=>A}});
 const row={async getItems(settings){options.push(settings);return settings?.unfiltered?[paper,files[2],files[3]]:[paper];}},result=await E.library.workspaceScope([row]);
 assert.equal(options[0].unfiltered,true,'本次资料按文件夹成员读取，独立于原生列表的搜索和标签筛选');assert.deepEqual([...reads].sort((a,b)=>a-b),[10,11,12,13]);assert.deepEqual([...result].map(file=>file.kind).sort(),['image','pdf','spreadsheet','text']);assert.equal(result.every(file=>file.selected===false),true);
});

test('folder changes restore each conversation, imported files and unsubmitted text without copying source files',async()=>{
 const {E,S}=fixture(),a=scope('C1',['pdf','spreadsheet']),b=scope('C2',['pdf','text']);
 const first=await L.syncLibraryScopeSession(E,a);await S.update(first.id,{draft:'尚未发送的研究问题'});await S.attach(first.id,[{id:'image:kept',kind:'image',title:'原始实验图',selected:true}]);
 await S.updateAttachment(first.id,a.files[0].id,{selected:false,featured:true});
 const second=await L.syncLibraryScopeSession(E,b);assert.notEqual(second.id,first.id);assert.equal(S.getAttachments(second.id).some(row=>row.id==='image:kept'),false);
 const restored=await L.syncLibraryScopeSession(E,a);assert.equal(restored.id,first.id);assert.equal(restored.draft,'尚未发送的研究问题');assert.equal(S.getAttachments(first.id).find(row=>row.id==='image:kept').selected,true);assert.equal(S.getAttachments(first.id).find(row=>row.id===a.files[0].id).selected,false);assert.equal(S.getAttachments(first.id).find(row=>row.id===a.files[0].id).featured,true);
 const view=S.snapshot({summary:true});assert.equal(view.sessions.find(row=>row.id===second.id).libraryFiles,undefined);assert.equal(S.getAttachments(first.id,{selectedOnly:true}).some(row=>row.id===a.files[0].id),false);
});

test('queued folder refresh preserves the most recent selection, spreadsheet range and source removal',async()=>{
 const {E,S}=fixture(),a=scope('C1',['pdf','spreadsheet']),first=await L.syncLibraryScopeSession(E,a);
 const toggling=S.updateAttachment(first.id,a.files[1].id,{selected:false,featured:true,sheet:'实验表',ranges:['A1:B9']}),refreshing=L.syncLibraryScopeSession(E,a);await Promise.all([toggling,refreshing]);
 const file=S.getAttachments(first.id).find(row=>row.id===a.files[1].id);assert.equal(file.selected,false);assert.equal(file.featured,true);assert.equal(file.sheet,'实验表');assert.deepEqual(file.ranges,['A1:B9']);
 await S.detach(first.id,a.files[0].id);await L.syncLibraryScopeSession(E,a);assert.equal(S.getAttachments(first.id).some(row=>row.id===a.files[0].id),false);
});

test('same-folder reload retains an explicitly chosen saved conversation rather than its earlier empty default',async()=>{
 const {E,S}=fixture(),a=scope('C1',['pdf']),b=scope('C2',['text']),empty=await L.syncLibraryScopeSession(E,a),chosen=await S.open({paperID:31,origin:'reader'});
 await S.append(chosen.id,{role:'user',text:'保留我选择的研究问题'});await S.append(chosen.id,{role:'assistant',text:'已有的研究讨论'});await S.update(chosen.id,{mode:'organize',draft:'尚未发送的问题'});
 const retained=await L.syncLibraryScopeSession(E,a,{sessionID:chosen.id});assert.equal(retained.id,chosen.id);assert.equal(retained.messages.length,2);assert.equal(retained.mode,'organize');assert.equal(retained.draft,'尚未发送的问题');assert.equal(retained.libraryScopeKey,a.key);assert.notEqual(retained.id,empty.id);
 const other=await L.syncLibraryScopeSession(E,b);assert.notEqual(other.id,chosen.id);assert.equal((await L.syncLibraryScopeSession(E,a)).id,chosen.id,'真实切回原文件夹恢复用户最后选择的对话');
});

test('catalogue can exceed twelve while imports remain saved and AI selection stays within twelve',async()=>{
 const {E,S,persisted}=fixture(),a=scope('C1',Array(25).fill('pdf')),first=await L.syncLibraryScopeSession(E,a);assert.equal(S.getAttachments(first.id).length,25);assert.equal(S.getAttachments(first.id,{selectedOnly:true}).length,12);
 await S.attach(first.id,[{id:'image:imported',kind:'image',title:'本地实验照片',selected:true}]);assert.equal(S.getAttachments(first.id).length,26);assert.equal(S.getAttachments(first.id).find(row=>row.id==='image:imported').selected,false);assert.match(S.getAttachmentNotice(first.id),/已保存/);assert.ok(persisted().sessions.find(row=>row.id===first.id),'主动导入后重启仍能恢复对话资料');
 await S.attach(first.id,[{...a.files[20],selected:true}]);assert.equal(S.getAttachments(first.id,{selectedOnly:true}).length,12,'重新拖入未选目录文件不能突破上限');assert.equal(S.getAttachments(first.id).find(row=>row.id===a.files[20].id).selected,false);
 await assert.rejects(S.updateAttachment(first.id,'image:imported',{selected:true}),/最多选用 12/);await S.updateAttachment(first.id,a.files[0].id,{selected:false});await S.updateAttachment(first.id,'image:imported',{selected:true});assert.equal(S.getAttachments(first.id,{selectedOnly:true}).length,12);
 const external=S.getAttachments(first.id);external[1].title='外部更改';assert.notEqual(S.getAttachments(first.id)[1].title,'外部更改');
});

test('manual imports retain a thirteenth candidate and select it after a previous file is deselected',async()=>{
 const {S}=fixture(),session=await S.create({id:'manual-imports'}),files=Array.from({length:12},(_,index)=>({id:'attachment:'+index,attachmentID:index,kind:'text',title:'手动资料 '+index}));
 await S.attach(session.id,files);assert.equal(S.getAttachments(session.id,{selectedOnly:true}).length,12);
 await S.updateAttachment(session.id,files[0].id,{selected:false});const incoming={id:'attachment:13',attachmentID:13,kind:'text',title:'新增候选资料'};await S.attach(session.id,[incoming]);
 assert.equal(S.getAttachments(session.id).length,13);assert.equal(S.getAttachments(session.id,{selectedOnly:true}).length,12);assert.equal(S.getAttachments(session.id).find(row=>row.id===incoming.id).selected,true);assert.equal(S.getAttachments(session.id).find(row=>row.id===files[0].id).selected,false);assert.equal(S.getAttachmentNotice(session.id),'');
});

test('imports at the twelve-selection limit persist unselected candidates and keep the model limit after restart',async()=>{
 const {S,persisted}=fixture(),session=await S.create({id:'full-manual-imports'}),files=Array.from({length:12},(_,index)=>({id:'attachment:'+index,attachmentID:index,kind:'text',title:'已选资料 '+index})),incoming={id:'attachment:13',attachmentID:13,kind:'text',title:'待选资料'};
 await S.attach(session.id,files);await S.attach(session.id,[incoming]);
 assert.equal(S.getAttachments(session.id).length,13);assert.equal(S.getAttachments(session.id,{selectedOnly:true}).length,12);assert.equal(S.getAttachments(session.id).find(row=>row.id===incoming.id).selected,false);assert.match(S.getAttachmentNotice(session.id),/已保存.*12/u);
 await S.update(session.id,{attachments:[{...incoming,selected:true}]});assert.equal(S.getAttachments(session.id).find(row=>row.id===incoming.id).selected,false,'旧界面的附件快照不能恢复未选来源');
 const restored=fixture({researchWorkbench:persisted()}).S;assert.equal(restored.getAttachments(session.id).length,13);assert.equal(restored.getAttachments(session.id,{selectedOnly:true}).length,12);assert.equal(restored.getAttachments(session.id).find(row=>row.id===incoming.id).selected,false);
 await assert.rejects(restored.updateAttachment(session.id,incoming.id,{selected:true}),/最多选用 12/u);assert.throws(()=>A.mergeChatAttachments(files,[incoming]),/最多选用 12/u,'共享合并入口仍拒绝十三份同时选用');
});

test('PPT folders keep independent discussions within the same draft and cancellation cannot activate an old scope',async()=>{
 const {E,S}=fixture(),a=scope('C1',['pdf']),b=scope('C2',['spreadsheet']),first=await L.syncLibraryScopeSession(E,a,{pptDraftID:'draft',origin:'ppt'}),second=await L.syncLibraryScopeSession(E,b,{pptDraftID:'draft',origin:'ppt'});assert.notEqual(first.id,second.id);assert.equal(second.pptDraftID,'draft');
 const controller=new AbortController();controller.abort();assert.equal(await L.syncLibraryScopeSession(E,a,{pptDraftID:'draft',signal:controller.signal}),null);assert.equal(S.snapshot().activeSessionID,second.id);assert.equal((await L.syncLibraryScopeSession(E,a,{pptDraftID:'draft'})).id,first.id);
});

test('folder file exclusions also constrain prior AI evidence and signatures',()=>{
 const old={id:'attachment:1',selected:false,attachmentID:1,paperItemID:101},current={id:'attachment:2',selected:true,attachmentID:2,paperItemID:102},session={libraryScopeKey:'C1',libraryFiles:[old,current]},context=A.conversationChatFileContext(session,[{role:'assistant',text:'旧论文答案',sources:[{attachmentID:1,paperItemID:101}]}]);
 assert.equal(context.allowsSource({attachmentID:1}),false);assert.equal(context.allowsSource({attachmentID:2}),true);assert.match(context.history[0].text,/取消选择/);assert.notEqual(A.chatFileScopeSignature(session),A.chatFileScopeSignature({libraryFiles:[{...old,selected:true},current]}));
 assert.equal(context.allowsSource({attachmentID:999,paperItemID:999}),false,'工具不能从其它文件夹引入本地文件');assert.equal(context.allowsSource({kind:'material',id:'not-in-folder'}),false);assert.equal(context.allowsSource({kind:'web',stableID:'web:search-result'}),true,'主动联网搜索不受本地文件夹限制');
});

test('the actual workbench task reaches the file reader with only selected folder references',async()=>{
 const names=['research-ai-policy','material-catalog','agent-workbench','chat-evidence','assembly-pages','chat-attachments'],modules=new Map(await Promise.all(names.map(async name=>[name,await import('../../chrome/content/zotero/research/shared/'+name+'.mjs')]))),{E,S}=fixture(),folder=scope('C1',Array(25).fill('text')),session=await L.syncLibraryScopeSession(E,folder),readStop=Error('actual-file-reader-reached');let read;
 E.settings=()=>({endpoint:'http://localhost:1/v1',model:'fixture'});E.core={endpoint:value=>value};E.credentials={get:async()=>''};E.chatAttachments={read:async(refs,options)=>{read={refs,options};throw readStop;}};
 const source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/workbench-agent.js',import.meta.url),'utf8');vm.runInNewContext(source,{Zotero:{Research:E},URL,ChromeUtils:{importESModule:uri=>modules.get(uri.match(/([^/]+)\.mjs$/)?.[1])||{}}});
 await assert.rejects(E.runWorkbenchTask({prompt:'讨论当前文件夹中的研究资料',mode:'discuss',sessionID:session.id,modelID:'fixture',attachments:[{id:'attachment:stale',kind:'text'}]}),error=>error===readStop);
 assert.equal(read.options.sessionID,session.id);assert.equal(read.refs.length,12);assert.deepEqual(read.refs.map(row=>row.id),folder.files.slice(0,12).map(row=>row.id));assert.equal(read.refs.some(row=>row.selected===false||row.id==='attachment:stale'),false);
});
