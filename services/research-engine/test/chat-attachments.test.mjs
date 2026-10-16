/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Real fixture bytes/filesystem, controlled Zotero import and session adapters.
// This is neither real-model nor native-frontend acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as H from '../../../chrome/content/zotero/research/shared/chat-attachments.mjs';
import * as C from '../../../chrome/content/zotero/research/shared/conversation-store.mjs';
const root=new URL('../../../',import.meta.url),source=await fs.readFile(new URL('chrome/content/zotero/xpcom/research/chat-attachments.js',root),'utf8'),conversationSource=await fs.readFile(new URL('chrome/content/zotero/xpcom/research/conversations.js',root),'utf8');
const md5=async file=>createHash('md5').update(await fs.readFile(file)).digest('hex');
const spreadsheetPython=process.env.EASYSCH_TEST_PYTHON||path.resolve(fileURLToPath(root),'..','.tools','pdf-assets-env',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const hasSpreadsheetPython=await fs.access(spreadsheetPython).then(()=>true,()=>false);
async function parseRealSpreadsheet(request,cacheRoot){
 return new Promise((resolve,reject)=>{
  const child=spawn(spreadsheetPython,['-X','utf8',fileURLToPath(new URL('services/research-engine/pdf/assets.py',root))],{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',diagnostic='';
  child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>diagnostic+=chunk);child.on('error',reject);child.on('close',code=>{
   try{const event=output.trim().split('\n').map(line=>JSON.parse(line)).find(value=>value.type==='result'||value.type==='error');if(code||!event||event.type==='error')reject(Error(event?.message||diagnostic||'Spreadsheet engine failed'));else resolve(event.value);}catch(error){reject(error);}
  });child.stdin.end(JSON.stringify({...request,cacheRoot}));
 });
}
async function fixture(){
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'easysch-attachments-test-'));let data={researchMaterials:{'m-existing':{id:'m-existing',title:'卷积方法',summary:'人工修改',sourceText:'CNN preprocessing occurs after disjoint device splitting.'}},writingImages:{}},counter=0,imports=0;
 const items=new Map(),makeItem=(id,file,kind,title)=>({id,libraryID:1,deleted:false,parentID:null,isAttachment:()=>true,isPDFAttachment:()=>kind==='pdf',getFilePathAsync:async()=>file,getField:()=>title||path.basename(file)});
 const E={store:{get:(key,id)=>key?id?data[key]?.[id]:structuredClone(data[key]):structuredClone(data),async update(fn){fn(data);}},
  manuscripts:{assetLibrary:()=>data.researchMaterials,all:()=>({}),summaryFor:row=>row.summary,summaryReader:()=>row=>row.summary,titleFor:row=>row.title,queueArticle:async()=>{}},
  library:{localPDF:async()=>null,describe:item=>({id:item.id,title:item.getField('title')}),uri:item=>'zotero://select/library/items/test-'+item.id,async sources(){return {sources:[{id:'d1',text:'Actual controlled document excerpt.',attachmentID:1}],warnings:['受控文档片段，不代表逐页阅读']};}},
  async importWritingImage(file){const fingerprint=await md5(file),target=path.join(folder,fingerprint+'.png');await fs.copyFile(file,target);data.writingImages[target]={fingerprint};return {path:target,fingerprint};},
  previewImage:async file=>'data:image/png;base64,'+(await fs.readFile(file)).toString('base64'),pick:async()=>null};
 const Zotero={Research:E,logError:error=>{throw error;},getMainWindow:()=>({}),getActiveZoteroPane:()=>({getSelectedLibraryIDs:()=>[1]}),getTempDirectory:()=>({path:folder}),Utilities:{randomString:()=>String(++counter),Internal:{md5Async:md5}},Libraries:{userLibraryID:1,get:()=>({editable:true})},Items:{getAsync:async id=>items.get(id),getAll:async()=>[...items.values()]},File:{pathToFile:file=>({path:file}),pathToFileURI:file=>'file:///'+file.replaceAll('\\','/')},Attachments:{async importFromFile({file,title,contentType}){imports++;const id=100+imports,target=path.join(folder,id+path.extname(file.path));await fs.copyFile(file.path,target);const item=makeItem(id,target,contentType==='application/pdf'?'pdf':'docx',title);items.set(id,item);return item;}}};
 const IOUtils={stat:fs.stat,exists:async file=>{try{await fs.access(file);return true;}catch{return false;}},read:async(file,options)=>{const data=await fs.readFile(file);return options?.maxBytes?data.subarray(0,options.maxBytes):data;},readUTF8:file=>fs.readFile(file,'utf8'),write:fs.writeFile,remove:async file=>fs.rm(file,{force:true})};
 const context={Zotero,ChromeUtils:{importESModule:uri=>uri.endsWith('chat-attachments.mjs')?H:C},IOUtils,PathUtils:{join:path.join,filename:path.basename},Uint8Array,Map,Set,JSON,Date,Promise};
 vm.runInNewContext(conversationSource,context);vm.runInNewContext(source,context);const session=await E.workbenchConversations.create({id:'fixture-chat',title:'隔离附件测试'});
 return {E,Zotero,folder,session,items,makeItem,get imports(){return imports;},get data(){return data;},cleanup:()=>fs.rm(folder,{recursive:true,force:true})};
}
test('protected dragover accepts MIME while message dragging remains separate',()=>{
 assert.ok(H.chatAttachmentDropPayload({types:['Files'],files:[],getData:()=>''}));
 assert.equal(H.chatAttachmentDropPayload({types:['application/x-easysch-research-message','Files'],files:[],getData:()=>''}),null);
 assert.deepEqual(H.chatAttachmentDropPayload({types:['application/x-manuscript-material'],files:[],getData:()=> 'm-existing'}).materialIDs,['m-existing']);
});

test('an explicit file drop reselects the existing source and links its project folder without copying the file',async()=>{
 const h=await fixture();try{
  const file=fileURLToPath(new URL('test/tests/data/test.pdf',root));await h.E.chatAttachments.attach(h.session.id,{files:[file]});const ref=h.E.chatAttachments.get(h.session.id)[0],item=h.items.get(ref.attachmentID),collections=new Set();let saves=0;
  item.getCollections=()=>[...collections];item.inCollection=id=>collections.has(id);item.addToCollection=id=>collections.add(id);item.saveTx=async()=>saves++;
  h.Zotero.Collections={get:id=>id===77?{id,libraryID:1,name:'核心论文'}:null};h.E.manuscripts.get=id=>id==='project'?{id,paperCollectionID:77}:null;await h.E.workbenchConversations.update(h.session.id,{projectID:'project'});
  await h.E.chatAttachments.setState(h.session.id,ref.id,{selected:false,featured:true});await h.E.chatAttachments.attach(h.session.id,{items:[{sessionID:h.session.id,attachmentID:ref.id}]},{source:'drop'});
  assert.equal(h.imports,1);assert.equal(h.E.chatAttachments.get(h.session.id).length,1);assert.equal(h.E.chatAttachments.get(h.session.id)[0].selected,true);assert.equal(h.E.chatAttachments.get(h.session.id)[0].featured,true);assert.deepEqual([...collections],[77]);assert.equal(saves,1);
  const location=await h.E.chatAttachments.location(h.session.id,ref.id);assert.equal(location.path,await item.getFilePathAsync());assert.deepEqual(Array.from(location.folders),['核心论文']);let revealed;h.Zotero.File.reveal=path=>revealed=path;await h.E.chatAttachments.reveal(h.session.id,ref.id);assert.equal(revealed,location.path);
  await h.E.chatAttachments.remove(h.session.id,ref.id);await assert.rejects(()=>h.E.chatAttachments.location(h.session.id,ref.id),/移除/);
 }finally{await h.cleanup();}
});
test('portable Windows image keys are normalized at actual resolve/read boundaries without mutating saved records',async()=>{
 const key='E:/研究/图片.png',expected='E:\\研究\\图片.png',calls=[],data={writingImages:{[key]:{fingerprint:'stable-image'}},researchMaterials:{'portable-material':{id:'portable-material',title:'已有图片',summary:'人工说明',imagePath:key}}};
 const E={store:{get:(branch,id)=>id?data[branch]?.[id]:data[branch]},manuscripts:{summaryFor:row=>row.summary,all:()=>({})},previewImage:async file=>{calls.push(['pixels',file]);assert.equal(file,expected);return 'data:image/png;base64,aW1hZ2U=';}};
 vm.runInNewContext(source,{Zotero:{Research:E,isWin:true,File:{pathToFileURI:file=>{calls.push(['uri',file]);assert.equal(file,expected);return 'file:///E:/研究/图片.png';}}},ChromeUtils:{importESModule:()=>H},IOUtils:{exists:async file=>{calls.push(['exists',file]);assert.equal(file,expected);return true;}},Map,Set,JSON,Date,Promise});
 const legacy={id:'image:stable-image',kind:'image',fingerprint:'stable-image',title:'旧图片'};const resolved=await E.chatAttachments.resolve(legacy);assert.equal(resolved.imagePath,expected);const legacyRead=await E.chatAttachments.read([legacy]);assert.equal(legacyRead.images.length,1);
 const materialRead=await E.chatAttachments.read([{id:'material:portable-material',materialID:'portable-material',kind:'image'}]);assert.equal(materialRead.images.length,1);assert.ok(materialRead.rows.every(row=>row.imagePath===expected));assert.equal(data.researchMaterials['portable-material'].imagePath,key);assert.ok(data.writingImages[key]);assert.ok(calls.some(([kind])=>kind==='exists'));assert.ok(calls.some(([kind])=>kind==='pixels'));
 assert.equal(H.nativeChatFilePath('//server/share/研究.png',true),'\\\\server\\share\\研究.png');assert.equal(H.nativeChatFilePath('/home/user/image.png',false),'/home/user/image.png');
});
test('shared surfaces add stable references atomically, remove only association and preserve manual materials',async()=>{
 const h=await fixture();try{const original=structuredClone(h.data.researchMaterials);await Promise.all([h.E.chatAttachments.attach(h.session.id,{materialIDs:['m-existing']}),h.E.chatAttachments.attach(h.session.id,{materialIDs:['m-existing']})]);assert.equal(h.E.chatAttachments.get(h.session.id).length,1);
  const other=await h.E.workbenchConversations.create({title:'另一个界面'});await h.E.chatAttachments.attach(other.id,{items:[{sessionID:h.session.id,attachmentID:'material:m-existing'}]});assert.equal(h.E.chatAttachments.get(other.id)[0].id,'material:m-existing');
  const read=await h.E.chatAttachments.read(h.E.chatAttachments.get(other.id));assert.match(read.rows[0].text,/preprocessing/);
  await h.E.chatAttachments.remove(h.session.id,'material:m-existing');assert.equal(h.E.chatAttachments.get(other.id).length,1);assert.deepEqual(h.data.researchMaterials,original);assert.equal(h.imports,0);
 }finally{await h.cleanup();}
});
test('real PDF bytes are fingerprint-deduplicated before controlled native import and concurrent transfers share one task',async()=>{
 const h=await fixture();try{const file=fileURLToPath(new URL('test/tests/data/test.pdf',root)),before=await md5(file);await Promise.all([h.E.chatAttachments.attach(h.session.id,{files:[file]}),h.E.chatAttachments.attach(h.session.id,{files:[file]})]);assert.equal(h.imports,1);assert.equal(h.E.chatAttachments.get(h.session.id).length,1);assert.equal(await md5(file),before);
  await h.E.chatAttachments.remove(h.session.id,h.E.chatAttachments.get(h.session.id)[0].id);await h.E.chatAttachments.attach(h.session.id,{files:[file]});assert.equal(h.imports,1);assert.equal(h.items.size,1);
 }finally{await h.cleanup();}
});
test('existing local Zotero attachment is reused even before the conversation fingerprint cache exists',async()=>{
 const h=await fixture();try{const file=fileURLToPath(new URL('test/tests/data/test.pdf',root));h.items.set(77,h.makeItem(77,file,'pdf','已有论文'));await h.E.chatAttachments.attach(h.session.id,{files:[file]});assert.equal(h.imports,0);assert.equal(h.E.chatAttachments.get(h.session.id)[0].attachmentID,77);
 }finally{await h.cleanup();}
});
test('a file modified after caching cannot be incorrectly reused under its old fingerprint',async()=>{
 const h=await fixture();try{const file=fileURLToPath(new URL('test/tests/data/test.pdf',root));await h.E.chatAttachments.attach(h.session.id,{files:[file]});const ref=h.E.chatAttachments.get(h.session.id)[0],item=h.items.get(ref.attachmentID),local=await item.getFilePathAsync(),bytes=await fs.readFile(local);bytes[bytes.length-1]^=1;await fs.writeFile(local,bytes);
  await h.E.chatAttachments.remove(h.session.id,ref.id);await h.E.chatAttachments.attach(h.session.id,{files:[file]});assert.equal(h.imports,2);assert.notEqual(h.E.chatAttachments.get(h.session.id)[0].attachmentID,ref.attachmentID);assert.equal((await fs.readFile(local)).at(-1),bytes.at(-1),'用户修改的旧附件保留');
 }finally{await h.cleanup();}
});
test('UTF-8 text and actual image bytes are read, and binary image data never enters the saved session',async()=>{
 const h=await fixture();try{const file=path.join(h.folder,'研究原句.txt');await fs.writeFile(file,'按采集批次划分后才拟合归一化参数。','utf8');const picture=fileURLToPath(new URL('test/tests/data/test.png',root));await h.E.chatAttachments.attach(h.session.id,{files:[file,picture]});const refs=h.E.chatAttachments.get(h.session.id),read=await h.E.chatAttachments.read(refs);assert.ok(read.rows.some(row=>row.text.includes('按采集批次')));assert.equal(read.images.length,1);assert.equal(read.images[0].data,(await fs.readFile(picture)).toString('base64'));assert.doesNotMatch(JSON.stringify(h.E.workbenchConversations.get(h.session.id)),/base64/);
  await h.E.chatAttachments.remove(h.session.id,refs.find(row=>row.kind==='image').id);assert.ok(Object.keys(h.data.writingImages).length);assert.equal(h.items.size,1);
 }finally{await h.cleanup();}
});
test('error webpages disguised as PDF, unsupported files and cancelled imports never create a Zotero attachment',async()=>{
 const h=await fixture();try{const file=path.join(h.folder,'error.pdf');await fs.writeFile(file,'<html>not a paper</html>');await assert.rejects(()=>h.E.chatAttachments.attach(h.session.id,{files:[file]}),/不是有效的 PDF/);await assert.rejects(()=>h.E.chatAttachments.attach(h.session.id,{files:[path.join(h.folder,'tool.exe')]}),/请选择/);const signal=new AbortController().signal;Object.defineProperty(signal,'aborted',{value:true});await assert.rejects(()=>h.E.chatAttachments.attach(h.session.id,{files:[file]},{signal}),/取消/);assert.equal(h.imports,0);assert.equal(h.E.chatAttachments.get(h.session.id).length,0);
 }finally{await h.cleanup();}
});
test('selected and featured sources belong to one conversation; unselected files are never read',async()=>{
 const h=await fixture();try{
  await h.E.chatAttachments.attach(h.session.id,{materialIDs:['m-existing']});const other=await h.E.workbenchConversations.create({id:'independent'});await h.E.chatAttachments.attach(other.id,{materialIDs:['m-existing']});
  await h.E.chatAttachments.setState(h.session.id,'material:m-existing',{selected:false,featured:true});
  assert.equal(h.E.chatAttachments.selected(h.session.id).length,0);assert.equal(h.E.chatAttachments.selected(other.id).length,1);assert.equal(h.E.chatAttachments.selected(other.id,{featuredOnly:true}).length,0);
  assert.equal((await h.E.chatAttachments.readSession(h.session.id)).rows.length,0);assert.equal((await h.E.chatAttachments.readSession(other.id)).rows.length,1);
  await h.E.chatAttachments.remove(h.session.id,'material:m-existing');await assert.rejects(()=>h.E.chatAttachments.preview(h.session.id,'material:m-existing'),/移除/);
 }finally{await h.cleanup();}
});
test('a source detached while native document reading is pending cannot escape into model evidence',async()=>{
 const h=await fixture();try{
  const file=fileURLToPath(new URL('test/tests/data/test.pdf',root));await h.E.chatAttachments.attach(h.session.id,{files:[file]});
  let release,entered;const started=new Promise(resolve=>entered=resolve);h.E.library.sources=async()=>{entered();await new Promise(resolve=>release=resolve);return {sources:[{id:'pending',text:'Read before detachment',attachmentID:101}],warnings:[]};};
  const pending=h.E.chatAttachments.readSession(h.session.id);await started;await h.E.chatAttachments.remove(h.session.id,'attachment:101');release();await assert.rejects(()=>pending,/资料选择已变化/);
 }finally{await h.cleanup();}
});
test('spreadsheet evidence keeps cell locations, source hash and quoted actual values instead of filenames',()=>{
 for(const name of ['数据.xlsx','历史数据.XLS','measurements.csv'])assert.equal(H.chatAttachmentFileKind(name),'spreadsheet');
 const evidence=H.chatSpreadsheetEvidence({selectedSheet:'实验一',hash:'actual-file-hash',version:'parser-1',sections:[{startColumn:2,cells:[{row:7,values:['波段\t名称','0.85','=A1+B1','']}]}]},{title:'统计数据.xlsx'});
 assert.equal(evidence.length,1);assert.equal(evidence[0].cellRange,'B7:D7');assert.equal(evidence[0].sourceVersion,'actual-file-hash');assert.match(evidence[0].text,/B7 = "波段\\t名称"/);assert.match(evidence[0].text,/D7 = "=A1\+B1"/);assert.doesNotMatch(evidence[0].text,/E7/);
});
test('excluded conversation files cannot reappear through old answers or paper previews, while separately selected material remains available',()=>{
 const file={id:'attachment:9',attachmentID:9,paperItemID:3,kind:'pdf',selected:false},material={id:'material:m1',materialID:'m1',attachmentID:9,paperItemID:3,selected:true},history=[{role:'user',text:'先前的问题',attachments:[file]},{role:'assistant',text:'旧回答中的取消范围事实',sources:[{stableID:'evidence:chat:attachment:9:page-2',attachmentID:9,paperItemID:3,sourceText:'旧事实'}]}],before=JSON.stringify(history);
 const context=H.conversationChatFileContext({attachments:[file,material]},history);
 assert.equal(context.allowsSource({kind:'paper',id:3}),false);assert.equal(context.allowsSource({id:'m1',kind:'paragraph',attachmentID:9,paperItemID:3}),true);assert.equal(context.allowsSource({id:'m3',kind:'paragraph',attachmentID:9,paperItemID:3}),false);
 assert.equal(context.history[0].text,'先前的问题');assert.doesNotMatch(context.history[1].text,/旧回答中的取消范围事实/);assert.deepEqual(context.history[1].sources,[]);assert.equal(JSON.stringify(history),before,'只过滤本轮模型上下文，不修改已保存的消息');
 const noFiles=H.conversationChatFileContext({},[{role:'assistant',text:'旧版普通论文讨论',sources:[{stableID:'paper:77',paperItemID:77}]}]);assert.equal(noFiles.hasExclusions,false);assert.equal(noFiles.history[0].text,'旧版普通论文讨论');assert.equal(noFiles.history[0].sources.length,1);
 const detached=H.conversationChatFileContext({attachments:[],detachedAttachments:['attachment:9']},history);assert.equal(detached.allowsSource({attachmentID:9}),false);
 const localOnly=H.conversationChatFileContext({attachments:[{...file,selected:true},{...material,selected:false}]},[]);assert.equal(localOnly.allowsSource({id:'m1',attachmentID:9,paperItemID:3}),false);assert.equal(localOnly.allowsSource({id:'another-paragraph',attachmentID:9,paperItemID:3}),true,'取消某个局部素材不排除整篇仍选中的PDF');
});
test('actual CSV import, scoped preview and model evidence follow selected ranges and changed file bytes',{skip:!hasSpreadsheetPython},async()=>{
 const h=await fixture();try{
  h.E.runArtifactEngine=request=>parseRealSpreadsheet(request,path.join(h.folder,'parser-cache'));
  const file=path.join(h.folder,'试验统计.csv');await fs.writeFile(file,'处理,平均含水率,重复数\n对照,12.5,4\n改良,18.75,4\n','utf8');
  await h.E.chatAttachments.attach(h.session.id,{files:[file]});const ref=h.E.chatAttachments.get(h.session.id)[0];assert.equal(ref.kind,'spreadsheet');assert.equal(h.imports,1);
  const preview=await h.E.chatAttachments.preview(h.session.id,ref.id);assert.equal(preview.workbook.selectedSheet,'CSV');assert.equal(preview.workbook.cells[1].values[1],'12.5');assert.match(preview.rows[0].text,/B3 = "18.75"/);
  const initial=await h.E.chatAttachments.readSession(h.session.id);assert.match(initial.rows[0].text,/A2 = "对照"/);assert.equal(initial.rows[0].sourceVersion.length,64);assert.match(initial.rows[0].id,/evidence:chat:attachment:101:/);
  await h.E.chatAttachments.setState(h.session.id,ref.id,{ranges:['B2:B2'],featured:true});const narrowed=await h.E.chatAttachments.readSession(h.session.id);assert.equal(narrowed.rows[0].cellRange,'B2');assert.match(narrowed.rows[0].text,/12.5/);assert.doesNotMatch(narrowed.rows[0].text,/18.75|A2 =/);
  const native=await h.items.get(ref.attachmentID).getFilePathAsync();await fs.writeFile(native,'处理,平均含水率,重复数\n对照,13.6,4\n改良,18.75,4\n','utf8');
  const changed=await h.E.chatAttachments.readSession(h.session.id);assert.match(changed.rows[0].text,/13.6/);assert.notEqual(changed.rows[0].sourceVersion,initial.rows[0].sourceVersion);
  assert.equal(h.E.chatAttachments.selected(h.session.id,{featuredOnly:true}).length,1);await h.E.chatAttachments.setState(h.session.id,ref.id,{selected:false});assert.equal((await h.E.chatAttachments.readSession(h.session.id)).rows.length,0);
 }finally{await h.cleanup();}
});
