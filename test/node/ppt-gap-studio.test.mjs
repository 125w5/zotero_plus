/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Gap tests for the PPT studio service (X/ppt-studio.js), loaded in a VM with in-memory stubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as model from '../../chrome/content/zotero/research/shared/ppt-model.mjs';
import * as scope from '../../chrome/content/zotero/research/shared/ppt-scope.mjs';
import * as outline from '../../chrome/content/zotero/research/shared/ppt-outline.mjs';
import * as policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as outputs from '../../chrome/content/zotero/research/shared/workspace-outputs.mjs';
import {weeklyResearchEntries,weeklyPresentation} from '../../chrome/content/zotero/research/shared/weekly-research.mjs';
import {presentationReadiness} from '../../chrome/content/zotero/research/shared/ppt-readiness.mjs';

const root=new URL('../../chrome/content/zotero/xpcom/research/',import.meta.url);
async function service({items=new Map(),engine=async()=>({}),index=async()=>({assets:[]}),preview=async()=>({}),selection=[]}={}){
 let state={pptDrafts:{},settings:{}},counter=0,revision=0;const writes=[];
 const E={
  store:{get:(...path)=>structuredClone(path.reduce((value,key)=>value?.[key],state)),peek:(...path)=>path.reduce((value,key)=>value?.[key],state),update:async fn=>{const next=structuredClone(state);fn(next);state=next;revision++;writes.push(revision);},flush:async()=>{},branchRevision:()=>revision},
  library:{selection:()=>selection,describe:value=>({id:value.id,title:'Paper '+value.id}),uri:(item,page)=>'zotero://select/'+item.id+(page!==undefined?'/'+page:'')},
  chatAttachments:{read:async()=>({rows:[],warnings:[]})},
  runArtifactEngine:(...args)=>engine(...args),
  assets:{index:(...args)=>index(...args),key:value=>JSON.stringify(value)},
  previewPresentation:(...args)=>preview(...args),
  openLibraryWorkspace:async(win,page,options)=>({page,options})
 };
 const getItem=id=>items.get(id)||{id,key:'key-'+id,parentItem:null,isAttachment:()=>false,getAttachments:()=>[],getField:()=>'',isPDFAttachment:()=>false};
 const context=vm.createContext({structuredClone,console,setTimeout,clearTimeout,URL,
  ChromeUtils:{importESModule:path=>path.includes('workspace-outputs')?outputs:path.includes('ppt-model')?model:path.includes('ppt-scope')?scope:path.includes('ppt-outline')?outline:policy},
  IOUtils:{},PathUtils:{join:(...parts)=>parts.join('/')},
  Zotero:{Research:E,Utilities:{randomString:()=>'r'+(++counter)},Items:{getAsync:async id=>Array.isArray(id)?id.map(getItem):getItem(id),get:id=>items.get(id)||false},getMainWindow:()=>({AbortController})}});
 for(const name of ['ppt-studio.js','ppt-studio-ai.js'])vm.runInContext(await readFile(new URL(name,root),'utf8'),context,{filename:name});
 return {E,S:E.studio,writes,state:()=>state};
}
function pdfItem(id,pages){
 const pdf={id:id*10,key:'pdf'+id,isPDFAttachment:()=>true,getFilePathAsync:async()=>'/fake/'+id+'.pdf',getAnnotations:()=>[],isAttachment:()=>true};
 const paper={id,key:'paper'+id,parentItem:null,isAttachment:()=>false,getAttachments:()=>[pdf.id],getField:()=>'Abstract '+id};
 return {paper,pdf,pages:Array.from({length:pages},(_,i)=>({pageIndex:i,text:'Paper '+id+' page '+(i+1)+' measured result text.'}))};
}
// Mirrors E.studio.createWeekly (X/research-resources.js): the draft is created with
// scope {mode:'weekly'} and the week's saved records become its sources.
const now=Date.UTC(2026,9,28,12),inside='2026-10-27T09:00:00Z';
async function weeklyDraft(S,papers=[]){
 const report=weeklyResearchEntries({researchActivity:[{id:'read-1',title:'论文A',text:'阅读论文',at:inside,paperItemID:1}]},[{id:2,kind:'note',title:'实验记录',text:'实测精度 81.2%。',dateModified:'2026-10-27 11:00:00',paperItemID:1,uri:'zotero://n'}],{now});
 const content=weeklyPresentation(report,{minutes:15}),draft=await S.create(papers,{mode:'weekly'});
 await S.patch(draft.id,next=>{next.title='本周研究进展';next.templateID='progress';next.weeklyRange={start:report.start,end:report.end,scope:report.scope};next.sources=content.sources;next.slides=content.slides;next.outline=content.outline;next.outlineApproved=true;next.materialsReady=true;next.step=5;next.weeklyEntryIDs=report.entries.map(row=>row.id);});
 return {id:draft.id,weeklyIDs:report.entries.map(row=>row.id)};
}

test('PPT-01: re-reading a weekly report without papers keeps every weekly record and stays export-ready',async()=>{
 const {S}=await service(),{id,weeklyIDs}=await weeklyDraft(S);
 assert.equal(presentationReadiness(S.get(id)).counts.errors,0);
 await S.collect(id,()=>{},undefined);
 const after=S.get(id);
 assert.deepEqual(after.sources.map(row=>row.id).sort(),[...weeklyIDs].sort());
 assert.equal(after.materialsReady,true);
 assert.equal(presentationReadiness(after).counts.errors,0,'no page loses its saved record');
});
test('PPT-01: a weekly draft with papers re-reads under its own scope without reading PDFs',async()=>{
 const p=pdfItem(1,3),calls=[];
 const {S}=await service({items:new Map([[1,p.paper],[10,p.pdf]]),engine:async request=>{calls.push(request.operation);return {pages:p.pages,pdfHash:'h1'};}});
 const {id,weeklyIDs}=await weeklyDraft(S,[{id:1,title:'Paper 1'}]);
 await S.collect(id,()=>{},undefined);
 assert.deepEqual(calls,[],'the weekly snapshot is built from saved records');
 assert.deepEqual(S.get(id).sources.map(row=>row.id).sort(),[...weeklyIDs].sort());
 assert.deepEqual(scope.scopedPages({mode:'weekly'},p.pages,1),[]);
});
test('PPT-01: switching a weekly draft to whole papers adds paper text and keeps the weekly records',async()=>{
 const p=pdfItem(1,3);
 const {S}=await service({items:new Map([[1,p.paper],[10,p.pdf]]),engine:async()=>({pages:p.pages,pdfHash:'h1'})});
 const {id,weeklyIDs}=await weeklyDraft(S,[{id:1,title:'Paper 1'}]);
 await S.patch(id,x=>{x.scope={mode:'all'};x.materialsReady=false;x.outlineApproved=false;x.step=0;});
 await S.collect(id,()=>{},undefined);
 const after=S.get(id),ids=after.sources.map(row=>row.id);
 for(const weekly of weeklyIDs)assert.ok(ids.includes(weekly),weekly+' kept');
 assert.ok(ids.includes('pdf1-p1'),'paper pages were read');
 assert.equal(presentationReadiness(after).counts.errors,0);
});

// X/artifacts.js with stubbed Gecko services: preview rendering and image normalization.
async function artifacts({prefs={},exists=()=>true,headers={}}={}){
 const calls=[],E={assets:{key:value=>JSON.stringify(value).length.toString(16)},store:{peek:()=>({})}};
 const context=vm.createContext({console,structuredClone,EasySch:E,ChromeUtils:{importESModule:()=>({})},
  Zotero:{Prefs:{get:name=>prefs[name]},DataDirectory:{dir:'/data'},logError(){}},
  IOUtils:{exists:async path=>exists(path),read:async path=>headers[path]||new Uint8Array(12),makeDirectory:async()=>{},stat:async()=>({size:1,lastModified:1})},
  PathUtils:{join:(...parts)=>parts.join('/'),filename:path=>path.split('/').pop(),parent:path=>path.split('/').slice(0,-1).join('/')}});
 vm.runInContext(await readFile(new URL('artifacts.js',root),'utf8'),context,{filename:'artifacts.js'});
 E.runArtifactEngine=async request=>{calls.push(request.operation);return request.operation==='assets-cache-get'?{miss:true}:{path:'/cache/presentation.pptx',slides:1,warnings:[]};};
 return {E,calls};
}
test('PPT-13: preview stops with the reason when no renderer is installed, before any export runs',async()=>{
 for(const setup of [{},{prefs:{'extensions.easysch.soffice':'/missing/soffice.exe','extensions.easysch.poppler':'/missing/poppler'},exists:()=>false}]){
  const {E,calls}=await artifacts(setup);
  await assert.rejects(E.previewPresentation({plan:{slides:[]},record:{sources:[]},assets:[]},()=>{},undefined),/预览图未生成：没有找到 LibreOffice/);
  assert.equal(calls.includes('export'),false,'no blank export is produced');
 }
});
test('PPT-13: a render that returns no page image fails with its reason and stores no stale path',async()=>{
 const {S}=await service({preview:async()=>({path:'/cache/presentation.pptx',slides:1,renderStatus:'failed',warnings:['渲染工具退出码 1']})}),d=await S.create([]);
 await S.patch(d.id,x=>{x.slides=[{id:'pv',title:'预览页',layout:'text',blocks:[{kind:'my_interpretation',text:'内容',evidenceIDs:[]}],assetIDs:[],notes:'n',status:'user'}];});
 await assert.rejects(S.renderPage(d.id,'pv',()=>{},undefined),/预览图未生成：渲染工具退出码 1/);
 assert.equal(S.get(d.id).previews?.pv,undefined);
});
test('PPT-03: PNG and JPEG files are used as they are; other formats are named in the error',async()=>{
 const {E}=await artifacts({headers:{'/a.png':Uint8Array.from([0x89,0x50,0x4e,0x47,13,10,26,10,0,0,0,0]),'/b.jpg':Uint8Array.from([0xff,0xd8,0xff,0xe0,0,0,0,0,0,0,0,0]),'/c.tif':Uint8Array.from([0x49,0x49,0x2a,0,0,0,0,0,0,0,0,0])}});
 assert.equal(await E.pptImagePath('/a.png'),'/a.png');assert.equal(await E.pptImagePath('/b.jpg'),'/b.jpg');
 await assert.rejects(E.pptImagePath('/c.tif'),/c\.tif.*不是 PNG、JPG 或 WebP/);
});
test('PPT-03: a WebP page reaches the exporter as a PNG copy while the draft keeps the original',async()=>{
 const requests=[],{E,S}=await service({engine:async request=>{requests.push(request);return {path:'/out/report.pptx',slides:1};}}),d=await S.create([]);
 E.pptImagePath=async path=>path.endsWith('.webp')?'/cache/ppt-images/converted.png':path;E.workspaceOutputs.rememberPPTExport=async(id,result)=>result;
 await S.patch(d.id,x=>{x.title='WebP 导出';x.assets=[{id:'gen',kind:'user_image',sourceType:'ai-illustration',label:'构想图',path:'/images/gen.webp'}];x.slides=[{id:'p',title:'配图页',layout:'balanced',blocks:[{kind:'my_interpretation',text:'内容',evidenceIDs:[]}],assetIDs:['gen'],notes:'n',status:'user'}];});
 await S.export(d.id,'/out',()=>{},undefined);
 const sent=requests.find(row=>row.operation==='export');assert.equal(sent.assets[0].path,'/cache/ppt-images/converted.png');assert.equal(sent.plan.assets[0].path,'/cache/ppt-images/converted.png');
 assert.equal(S.get(d.id).assets[0].path,'/images/gen.webp');
});
test('PPT-08: after a scope change the deck cannot be exported or previewed from the old material',async()=>{
 const requests=[],{S}=await service({engine:async request=>{requests.push(request.operation);return {path:'/out/x.pptx'};},preview:async()=>({previews:['/p.png']})}),d=await S.create([]);
 await S.patch(d.id,x=>{x.title='范围已变化';x.materialsReady=false;x.slides=[{id:'p',title:'旧范围页',layout:'text',blocks:[{kind:'my_interpretation',text:'内容',evidenceIDs:[]}],assetIDs:[],notes:'n',status:'user'}];});
 assert.ok(presentationReadiness(S.get(d.id)).issues.some(issue=>issue.id==='materials-stale'&&issue.severity==='error'));
 await assert.rejects(S.export(d.id,'/out',()=>{},undefined),/重新读取材料/);await assert.rejects(S.renderAll(d.id,()=>{},undefined),/重新读取材料/);
 assert.deepEqual(requests,[]);
});
test('PPT-07: a failed read keeps the finished papers and the next read continues from the unfinished one',async()=>{
 const a=pdfItem(1,2),b=pdfItem(2,2),items=new Map([[1,a.paper],[10,a.pdf],[2,b.paper],[20,b.pdf]]),reads=[];let fail=true;
 const {S}=await service({items,engine:async request=>{reads.push(request.pdf);if(fail&&request.pdf==='/fake/2.pdf')throw Error('解析器退出');return {pages:request.pdf==='/fake/1.pdf'?a.pages:b.pages,pdfHash:request.pdf};}});
 const d=await S.create([{id:1,title:'Paper 1'},{id:2,title:'Paper 2'}]);
 await assert.rejects(S.collect(d.id,()=>{},undefined),/解析器退出/);
 const saved=S.get(d.id);assert.equal(saved.materialsReady,undefined);assert.equal(S.savedMaterialProgress(saved).papers.length,1,'paper 1 is saved');
 fail=false;reads.length=0;await S.collect(d.id,()=>{},undefined);
 assert.deepEqual(reads,['/fake/2.pdf'],'only the unfinished paper is read again');
 const done=S.get(d.id);assert.equal(done.materialsReady,true);assert.equal(done.materialProgress,undefined);assert.ok(done.sources.some(row=>row.id==='pdf1-p1')&&done.sources.some(row=>row.id==='pdf2-p1'));
});
test('PPT-10: collected sources carry their paper, including annotations',async()=>{
 const p=pdfItem(1,2);p.pdf.getAnnotations=()=>[{key:'ann1',annotationPosition:JSON.stringify({pageIndex:0}),annotationText:'高亮原文',annotationComment:'我的看法'}];
 const {S}=await service({items:new Map([[1,p.paper],[10,p.pdf]]),engine:async()=>({pages:p.pages,pdfHash:'h'})}),d=await S.create([{id:1,title:'Paper 1'}],{mode:'annotations'});
 await S.collect(d.id,()=>{},undefined);const row=S.get(d.id).sources.find(source=>source.id==='pdf1-ann1');
 assert.ok(row,'annotation collected');assert.equal(row.paperID,1);assert.match(row.label,/^批注/);
});
test('PPT-12: a long dropped answer becomes an exportable page and the full answer stays in the notes',async()=>{
 const {S}=await service(),d=await S.create([]),answer=Array.from({length:40},(_,i)=>'第'+(i+1)+'点分析比较两篇论文在独立批次上的实验设置与结论边界。').join('');
 await S.addContribution(d.id,{title:'研究讨论',text:answer,kind:'synthesis',summary:'来自研究对话的分析',notes:'来源：研究对话'});
 const after=S.get(d.id),page=after.slides.at(-1);
 assert.ok(page.blocks.length<=3,'a dragged answer shows at most three points');model.validateStudioSlide(page,after.sources,after.assets);
 assert.ok(page.notes.includes(answer),'the full answer is in the speaker notes');assert.ok(after.contributions[0].createdAt&&after.contributions[0].updatedAt);
 await S.patch(d.id,x=>{x.slides=Array.from({length:50},(_,i)=>({id:'p'+i,title:'第'+i+'页',layout:'text',blocks:[{kind:'my_interpretation',text:'内容',evidenceIDs:[]}],assetIDs:[],notes:'n',status:'user'}));});
 await assert.rejects(S.addContribution(d.id,{title:'实验',text:'我的实验记录',kind:'my_experiment'}),/最多 50 页/);assert.equal(S.get(d.id).slides.length,50);
});
test('PPT-11: weekly reports keep each contribution type and date; plans and AI answers are not experiments',async()=>{
 const {S}=await service(),d=await S.create([]);
 await S.addContribution(d.id,{title:'下阶段计划',text:'计划下周验证批次效应，尚未执行。',kind:'unverified'});
 await S.addContribution(d.id,{title:'研究讨论',text:'模型对两篇论文方法的比较。',kind:'synthesis'});
 await S.addContribution(d.id,{title:'复现实验',text:'复现得到 0.73。',kind:'my_experiment'});
 const draft=S.get(d.id),legacy={id:'legacy',title:'旧观察',text:'很早以前的记录',kind:'my_interpretation'};
 const report=weeklyResearchEntries({pptDrafts:{[d.id]:{...draft,contributions:[...draft.contributions,legacy]}}},[],{now:Date.now()+1000}),deck=weeklyPresentation(report);
 const type=title=>report.entries.find(row=>row.title===title)?.type;
 assert.equal(type('下阶段计划'),'plan');assert.equal(type('研究讨论'),'discussion');assert.equal(type('复现实验'),'experiment');assert.equal(type('旧观察'),undefined,'an undated entry is not counted as this week');
 const experiments=deck.slides.filter(slide=>slide.section==='实验记录').flatMap(slide=>slide.blocks);assert.equal(experiments.length,1);assert.equal(experiments[0].kind,'my_experiment');
 assert.equal(deck.slides.find(slide=>slide.section==='计划与待验证').blocks[0].kind,'unverified');assert.equal(deck.slides.find(slide=>slide.section==='研究讨论').blocks[0].kind,'synthesis');
});
test('PPT-27: the library entry keeps the 12-paper limit, and 加入汇报 leaves the choice of report to the PPT page',async()=>{
 const many=Array.from({length:30},(_,i)=>({id:i+1,title:'Paper '+(i+1)})),{S}=await service({selection:many});
 await assert.rejects(S.open({newDraft:true}),/最多选择 12 篇/);await assert.rejects(S.create(many),/最多选择 12 篇/);
 const report=await S.create([{id:1,title:'Paper 1'}]);await S.patch(report.id,x=>{x.slides=[{id:'p',title:'已有页面',layout:'text',blocks:[{kind:'my_interpretation',text:'内容',evidenceIDs:[]}],assetIDs:[],notes:'',status:'user'}];x.materialsReady=true;});
 const opened=await S.open({reader:{itemID:7},add:true});
 assert.equal(opened.options.pptOptions.add,true);assert.deepEqual([...opened.options.pptOptions.papers].map(row=>row.id),[7]);assert.equal(opened.options.pptOptions.newDraft,false);
 const after=S.get(report.id);assert.deepEqual(after.papers.map(row=>row.id),[1],'the service changes no report before the page decides');assert.equal(after.materialsReady,true);
});
test('PPT-27 review: a report with a running task refuses new papers and stays unchanged',async()=>{
 const {S}=await service(),report=await S.create([{id:1,title:'Paper 1'}]);await S.patch(report.id,x=>{x.title='方法汇报';x.materialsReady=true;x.outlineApproved=true;});
 S.taskStarted(report.id);
 await assert.rejects(S.addPapers(report.id,[{id:2,title:'Paper 2'}]),/“方法汇报”正在运行任务，论文未加入/);
 const during=S.get(report.id);assert.deepEqual(during.papers.map(row=>row.id),[1]);assert.equal(during.materialsReady,true);assert.equal(during.outlineApproved,true);
 S.taskEnded(report.id);await S.addPapers(report.id,[{id:2,title:'Paper 2'}]);assert.deepEqual(S.get(report.id).papers.map(row=>row.id),[1,2]);
});
test('PPT-07 review: a paper whose PDF was not downloaded is read in full after the download',async()=>{
 const a=pdfItem(1,2),b=pdfItem(2,2),c=pdfItem(3,1),items=new Map([[1,a.paper],[10,a.pdf],[2,b.paper],[20,b.pdf],[3,c.paper],[30,c.pdf]]),reads=[];let downloaded=false,fail=true;
 b.pdf.getFilePathAsync=async()=>downloaded?'/fake/2.pdf':null;
 const {S}=await service({items,engine:async request=>{reads.push(request.pdf);if(fail&&request.pdf==='/fake/3.pdf')throw Error('解析器退出');return {pages:request.pdf==='/fake/1.pdf'?a.pages:request.pdf==='/fake/2.pdf'?b.pages:c.pages,pdfHash:request.pdf};}});
 const d=await S.create([{id:1,title:'Paper 1'},{id:2,title:'Paper 2'},{id:3,title:'Paper 3'}]);
 await assert.rejects(S.collect(d.id,()=>{},undefined),/解析器退出/);
 assert.deepEqual(S.savedMaterialProgress(S.get(d.id)).papers.map(row=>row.paperID),[1],'only the paper whose PDF was read is saved');
 downloaded=true;fail=false;reads.length=0;await S.collect(d.id,()=>{},undefined);
 const done=S.get(d.id);
 assert.deepEqual(reads,['/fake/2.pdf','/fake/3.pdf'],'the downloaded PDF is read; the finished paper is reused');
 assert.ok(done.sources.some(row=>row.id==='pdf2-p1'),'the downloaded paper contributes its pages');
 assert.equal(done.materialWarnings.some(warning=>/PDF 未下载/.test(warning)),false,'the stale warning is gone');
});
test('PPT-08 review: a finished deck whose last material file was removed can be read again and exported',async()=>{
 const requests=[],{E,S}=await service({engine:async request=>{requests.push(request.operation);return {path:'/out/我的进展.pptx',slides:1};}}),d=await S.create([]);
 E.workspaceOutputs.rememberPPTExport=async(id,result)=>result;
 await S.patch(d.id,x=>{x.title='我的进展';x.materialsReady=true;x.outlineApproved=true;x.step=5;x.materialFiles=[{id:'f1',title:'记录.xlsx',kind:'spreadsheet',selected:true}];x.sources=[{id:'evidence:chat:f1:1',label:'记录.xlsx',text:'批次 A 0.71',conversationFileID:'f1'}];x.slides=[{id:'u1',title:'我的实验观察',layout:'text',blocks:[{kind:'my_experiment',text:'复现实验中批次差异明显，需要讨论原因。',evidenceIDs:[],quote:''}],assetIDs:[],notes:'先讲实验条件，再讲差异。',status:'user'}];});
 // 移除 in 选择材料 (R/ui/ppt-flow.js): the file goes and the material is marked stale.
 await S.patch(d.id,x=>{x.materialFiles=[];x.materialsReady=false;x.outlineApproved=false;});
 await assert.rejects(S.export(d.id,'/out',()=>{},undefined),/重新读取材料/);
 await S.collect(d.id,()=>{},undefined);
 const read=S.get(d.id);assert.equal(read.materialsReady,true,'reading again succeeds with nothing left to read');assert.deepEqual(read.sources,[],'evidence of the removed file is dropped');
 assert.equal(presentationReadiness(read).counts.errors,0);
 await S.export(d.id,'/out',()=>{},undefined);assert.deepEqual(requests,['export']);
 const {S:blank}=await service(),empty=await blank.create([]);await assert.rejects(blank.collect(empty.id,()=>{},undefined),/先选择论文/);
});
test('PPT-12 review: typed speaker notes over 3000 characters are refused, a dragged answer keeps its pointer',async()=>{
 const {S}=await service(),d=await S.create([]),notes='这是我在表单里写的讲稿，记录了复现过程与参数。'.repeat(160);
 await assert.rejects(S.addContribution(d.id,{title:'复现记录',text:'我复现了论文中的主要实验。',kind:'my_experiment',notes}),/讲者备注超过 3000 字.*未加入汇报/);
 const kept=S.get(d.id);assert.equal(kept.slides.length,0);assert.equal(kept.contributions.length,0,'nothing is half-added');
 const answer='第一点分析比较两篇论文在独立批次上的实验设置与结论边界，并指出差异来源。'.repeat(100);
 const page=(await S.addContribution(d.id,{title:'研究讨论',text:answer,kind:'synthesis',summary:'来自研究对话的分析',notes:'来源：研究对话'})).slides.at(-1);
 assert.ok(page.notes.length<=3000);assert.match(page.notes,/完整内容见研究对话）$/);
});
test('WA-05 review: only an empty draft is disposable, and a folder file list does not keep it',async()=>{
 const {E,S}=await service(),sessions=new Map();
 E.workbenchConversations={list:()=>[...sessions.values()].map(row=>({id:row.id,pptDraftID:row.pptDraftID,isDraft:true,messageCount:0,attachmentCount:(row.attachments?.length||0)+(row.libraryFiles?.length||0)})),get:id=>structuredClone(sessions.get(id)||null),remove:async id=>{sessions.delete(id);}};
 const chosen=await S.create([{id:1,title:'Paper 1'},{id:2,title:'Paper 2'}]);
 assert.equal(S.isPristine(S.get(chosen.id)),false,'a report created from chosen papers is the user\'s');
 assert.equal(await S.discardPristine(chosen.id),false);assert.ok(S.get(chosen.id));
 const empty=await S.create([]);assert.equal(S.isPristine(S.get(empty.id)),true);
 sessions.set('c1',{id:'c1',pptDraftID:empty.id,attachments:[],libraryFiles:[{id:'attachment:101',kind:'pdf'}]});
 assert.equal(await S.discardPristine(empty.id),true,'the folder catalogue is not the user\'s work');assert.equal(S.get(empty.id),undefined);assert.equal(sessions.size,0,'its empty discussion goes with it');
 const typed=await S.create([]);sessions.set('c2',{id:'c2',pptDraftID:typed.id,attachments:[],libraryFiles:[],draft:'想问的问题'});
 assert.equal(await S.discardPristine(typed.id),false,'unsent text keeps the draft');assert.ok(S.get(typed.id));
});
test('R1 review: an empty draft no open page shows is reused instead of adding another',async()=>{
 const {E,S}=await service(),left=await S.create([]);
 assert.equal(S.reuseEmpty(),null,'the creating page still shows it');
 // The page leaves it while its discussion holds unsent text: the draft is kept and no page shows it.
 E.workbenchConversations={list:()=>[{id:'c1',pptDraftID:left.id,isDraft:true,messageCount:0,attachmentCount:0}],get:()=>({id:'c1',attachments:[],draft:'还没发出的问题'}),remove:async()=>{}};
 assert.equal(await S.discardPristine(left.id),false);
 assert.equal(S.reuseEmpty({mode:'pages'}),null,'a different scope is not reused');
 const reused=S.reuseEmpty();assert.equal(reused?.id,left.id,'the next page adopts it with its discussion');assert.equal(S.reuseEmpty(),null,'a reused draft is not offered twice');
});
test('R6 review: 检查汇报 accepts every image export takes and still names the rest',()=>{
 const deck=path=>({title:'汇报',materialsReady:true,sources:[],datasets:[],assets:[{id:'img',kind:'user_image',label:'我的图片',path,thumbnail:path}],slides:[{id:'s1',title:'实验结果的图示说明',explanation:'说明',layout:'balanced',blocks:[{kind:'my_interpretation',text:'这页展示实验结果的图片，并说明需要讨论的问题。',evidenceIDs:[]}],assetIDs:['img'],notes:'讲稿',status:'user'}]});
 const format=path=>presentationReadiness(deck(path)).issues.some(issue=>issue.id.endsWith('asset-format'));
 for(const path of ['/i/photo.jfif','/i/scan.gif','/i/scan.bmp','/i/a.JPE','/i/a.png','/i/a.webp','/i/a.jpeg'])assert.equal(format(path),false,path);
 assert.equal(format('/i/scan.tif'),true,'a TIFF is still reported');
});
test('PPT-10 review: the service finds the paper of a PDF for rows read before paperID',async()=>{
 const p=pdfItem(1,1),standalone={id:40,parentID:undefined};p.pdf.parentID=1;
 const {S}=await service({items:new Map([[1,p.paper],[10,p.pdf],[40,standalone]])});
 assert.equal(S.attachmentPaper(10),1);assert.equal(S.attachmentPaper(40),40,'a PDF without a parent is its own paper');assert.equal(S.attachmentPaper(99),undefined);assert.equal(S.attachmentPaper(undefined),undefined);
});
