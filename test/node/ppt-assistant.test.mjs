/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {pptConversationSessions,pptConversationRefresh,pptAssistantIntent,pptDiscussionContext,pptDroppedFiles} from '../../chrome/content/zotero/research/ui/ppt-assistant.mjs';

test('PPT discussions retain their own draft history rather than adopting another active paper or assembly session',()=>{
 const rows=[{id:'other-draft',pptDraftID:'B',updatedAt:'2026-10-15T12:00:00Z'},{id:'paper',paperID:1,updatedAt:'2026-10-15T13:00:00Z'},{id:'first',pptDraftID:'A',createdAt:'2026-10-15T10:00:00Z'},{id:'second',pptDraftID:'A',updatedAt:'2026-10-15T11:00:00Z'}];
 assert.deepEqual(pptConversationSessions(rows,'A').map(row=>row.id),['second','first']);assert.equal(rows[0].id,'other-draft');
});

test('PPT history follows the current discussion source scope, including an explicit paper set without a native folder',()=>{
 const rows=[{id:'explicit',pptDraftID:'A',updatedAt:'2026-10-15T10:00:00Z'},{id:'folder-a',pptDraftID:'A',libraryScopeKey:'collection:A',updatedAt:'2026-10-15T12:00:00Z'},{id:'folder-b',pptDraftID:'A',libraryScopeKey:'collection:B',updatedAt:'2026-10-15T13:00:00Z'},{id:'other',pptDraftID:'B',libraryScopeKey:'collection:A',updatedAt:'2026-10-15T14:00:00Z'}];
 assert.deepEqual(pptConversationSessions(rows,'A',{libraryScopeKey:''}).map(row=>row.id),['explicit']);
 assert.deepEqual(pptConversationSessions(rows,'A',{libraryScopeKey:'collection:A'}).map(row=>row.id),['folder-a']);
 assert.deepEqual(pptConversationSessions(rows,'A',{libraryScopeKey:'collection:B'}).map(row=>row.id),['folder-b']);
});

test('PPT refreshes only its current transcript or affected history without reading unrelated messages',()=>{
 const row=(id,pptDraftID)=>({id,pptDraftID,get messages(){throw Error('Refresh routing must not inspect transcripts');}}),current=row('current','A'),peer=row('peer','A'),paper=row('paper',undefined),other=row('other','B'),state={sessions:[current,peer,paper,other]},scope={draftID:'A',sessionID:'current',knownSessionIDs:new Set(['current','peer'])};
 for(const action of ['update','attach','detach','attachment-state','select'])assert.equal(pptConversationRefresh(state,{action,sessionID:'paper'},scope),'none',action);
 assert.equal(pptConversationRefresh(state,{action:'update',sessionID:'other',fields:['title']},scope),'none');
 assert.equal(pptConversationRefresh(state,{action:'update',sessionID:'current',fields:['draft']},scope),'current');
 assert.equal(pptConversationRefresh(state,{action:'attachment-state',sessionID:'current'},scope),'current');
 assert.equal(pptConversationRefresh(state,{action:'update',sessionID:'peer',fields:['title']},scope),'rail');
 assert.equal(pptConversationRefresh({...state,sessions:state.sessions.filter(value=>value.id!=='peer')},{action:'remove',sessionID:'peer'},scope),'rail');
 assert.equal(pptConversationRefresh({...state,sessions:[current,row('peer','B'),paper,other]},{action:'update',sessionID:'peer',fields:['pptDraftID']},scope),'rail');
 assert.equal(pptConversationRefresh(state,{action:'create-draft'},scope),'none');
 assert.equal(pptConversationRefresh({...state,sessions:[...state.sessions,row('new','A')]},{action:'create-draft'},scope),'rail');
 assert.equal(pptConversationRefresh(state,{action:'home'},scope),'none');
 assert.equal(pptConversationRefresh(state,undefined,scope),'current','legacy notifications retain their conservative refresh');
});

test('PPT notifications from another source folder do not refresh the current discussion files',()=>{
 const current={id:'current',pptDraftID:'A'},peer={id:'peer',pptDraftID:'A'},foreign={id:'foreign',pptDraftID:'A',libraryScopeKey:'collection:B'},state={sessions:[current,peer,foreign]},scope={draftID:'A',sessionID:'current',libraryScopeKey:'',knownSessionIDs:new Set(['current','peer'])};
 assert.equal(pptConversationRefresh(state,{action:'update',sessionID:'foreign',fields:['title']},scope),'none');
 assert.equal(pptConversationRefresh(state,{action:'create-draft'},scope),'none');
 assert.equal(pptConversationRefresh(state,{action:'update',sessionID:'peer',fields:['title']},scope),'rail');
 const moved={sessions:[current,{...peer,libraryScopeKey:'collection:B'},foreign]};
 assert.equal(pptConversationRefresh(moved,{action:'update',sessionID:'peer',fields:['libraryScopeKey']},scope),'rail','a peer moved out of this source set must disappear');
 assert.equal(pptConversationRefresh({...state,sessions:[...state.sessions,{id:'new',pptDraftID:'A'}]},{action:'create-draft'},scope),'rail');
});
test('explicit PPT commands reach real operations, while questions and negative instructions remain discussion',()=>{
 for(const [prompt,intent]of [['请读取当前论文材料','collect'],['帮我优化汇报大纲','outline'],['请新增一个实验对比板块','outline'],['把结构中的第三节改为结果讨论','outline'],['撤销刚才的结构修改','undo'],['重做大纲修改','redo'],['补齐所有未完成页面','generate'],['预览整套PPT','preview'],['导出可编辑 PPTX','export']])assert.equal(pptAssistantIntent(prompt),intent,prompt);
 for(const prompt of ['不要导出 PPT，先讨论结果','如何生成全部页面？','怎么优化大纲才有重点？','如何新增结构板块？','如何撤销大纲修改？','解释一下预览和导出的区别','我想比较这两篇论文的方法'])assert.equal(pptAssistantIntent(prompt),'discuss',prompt);
});
const draft={title:'独立批次汇报',step:3,minutes:15,papers:[{id:1,title:'Controlled paper A',year:2025},{id:2,title:'Controlled paper B',year:2026}],sources:[{id:'A',label:'Controlled paper A · PDF 第 1 页',text:'Measured batches use independent acquisition.'},{id:'B',label:'Controlled paper B · PDF 第 2 页',text:'Unselected source must not enter the model context.'}],outline:[{title:'研究问题',purpose:'解释独立批次'}],slides:[{id:'s',title:'批次比较',explanation:'人工设置',status:'user',assetIDs:['figure-a'],blocks:[{text:'完整人工正文保留在草稿'}]}],contributions:[{title:'人工实验',text:'明确标记自己的观察。'}]};
test('unchecking a paper removes its sources from model evidence and preserves the editable PPT',()=>{
 const before=structuredClone(draft),context=pptDiscussionContext(draft,{paperIDs:[1]});assert.deepEqual(context.papers.map(row=>row.id),[1]);assert.deepEqual(context.sources.map(row=>row.id),['A']);assert.equal(JSON.stringify(context).includes('Unselected source'),false);assert.deepEqual(draft,before);assert.equal(context.slides[0].explanation,'人工设置');assert.deepEqual(context.contributions,draft.contributions);
});
test('an explicit empty paper choice remains empty; attachment text is separate readable evidence with its actual ID',()=>{
 const context=pptDiscussionContext(draft,{paperIDs:[],attachments:[{id:'attachment:9'}],attachmentRows:[{id:'cell-9',stableID:'evidence:sheet9',title:'实验工作表',sourceText:'Batch 1: 0.73',coverage:'工作表 Sheet1 的选区 A1:B2'}]});
 assert.deepEqual(context.papers,[]);assert.deepEqual(context.attachmentIDs,['attachment:9']);assert.equal(context.sources.length,1);assert.equal(context.sources[0].id,'evidence:sheet9');assert.equal(context.sources[0].coverage,'工作表 Sheet1 的选区 A1:B2');assert.equal(context.sources[0].text,'Batch 1: 0.73');
});
test('default PPT evidence retains per-source bounds and a discussion excludes large slide edit payloads',()=>{
 const context=pptDiscussionContext({...draft,sources:[{id:'large',label:'large',text:'x'.repeat(15000)}]});assert.equal(context.sources[0].text.length,2600);assert.equal(context.slides[0].blocks,undefined);assert.deepEqual(context.outline,[{title:'研究问题',purpose:'解释独立批次'}]);
});
test('ambiguous truncated paper labels cannot silently leak an unchecked source into a subset discussion',()=>{
 const prefix='A'.repeat(45),context=pptDiscussionContext({...draft,papers:[{id:1,title:prefix+' first paper'},{id:2,title:prefix+' second paper'}],sources:[{id:'ambiguous',label:prefix+' · PDF 第 1 页',text:'Unknown ownership.'}]},{paperIDs:[1]});assert.deepEqual(context.sources,[]);assert.deepEqual(context.papers.map(row=>row.id),[1]);
});

test('page-linked spreadsheet evidence follows the current file selection even while all report papers are selected',()=>{
 const linked={...draft,sources:[...draft.sources,{id:'cells',label:'测量表',text:'B2 = 0.73',conversationFileID:'file-9'}]};
 assert.deepEqual(pptDiscussionContext(linked).sources.map(row=>row.id),['A','B']);
 assert.deepEqual(pptDiscussionContext(linked,{attachments:[{id:'file-9',selected:false}]}).sources.map(row=>row.id),['A','B']);
 assert.deepEqual(pptDiscussionContext(linked,{attachments:[{id:'file-9'}]}).sources.map(row=>row.id),['A','B','cells']);
 assert.equal(linked.sources.at(-1).text,'B2 = 0.73');
});

test('an active folder never inherits unowned evidence from the presentation previous material set',()=>{
 const prior={...draft,papers:[],sources:[{id:'old-file',label:'旧实验表',text:'以前的资料不能进入当前文件夹'}]},context=pptDiscussionContext(prior,{paperIDs:[],attachments:[{id:'attachment:now',selected:true}],attachmentRows:[{id:'now',text:'当前文件夹选用的数据'}],strictScope:true});
 assert.deepEqual(context.sources.map(row=>row.id),['now']);assert.equal(JSON.stringify(context).includes('以前的资料'),false);
});

test('dropping an already imported file still resolves that exact reference for a page association',()=>{
 const files=[{id:'file-9',attachmentID:9},{id:'file-10',attachmentID:10}];
 assert.deepEqual(pptDroppedFiles(files,files,{items:[{sessionID:'other',attachmentID:'file-9'}]}),[files[0]]);
 assert.deepEqual(pptDroppedFiles(files,files,{items:[10]}),[files[1]]);
 assert.deepEqual(pptDroppedFiles(files,files,{items:[]}),[]);
});
