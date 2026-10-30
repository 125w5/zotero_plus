/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {installWorkspaceOutputs,pptOutputCandidates,outputMatches} from '../../chrome/content/zotero/research/shared/workspace-outputs.mjs';

async function fixture(t){
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'research-outputs-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
 const state={workspaceDownloads:{},pptDrafts:{}},items=new Map(),opened=[],revealed=[],restored=[];let revision=0,allReads=0;
 const store={revision:0,branchRevision:()=>revision,get:(...keys)=>structuredClone(keys.reduce((value,key)=>value?.[key],state)),replaceBranch:async(key,value)=>{state[key]=structuredClone(value);revision++;},update:async fn=>{fn(state);revision++;}};
 const E={store,library:{async localPDF(id){const item=items.get(id);if(!item||item.deleted)return null;for(const candidate of item.pdf?[item]:(item.attachments||[]).map(key=>items.get(key))){if(!candidate?.pdf||candidate.deleted)continue;try{await fs.access(candidate.path);return candidate;}catch{}}return null;},openSource:async row=>opened.push(row),revealPDF:async id=>{const pdf=await E.library.localPDF(id);if(!pdf)throw Error('附件尚未下载到本机');revealed.push(pdf.path);}},studio:{all(){allReads++;return structuredClone(state.pptDrafts);},get:id=>state.pptDrafts[id],patch:async(id,fn)=>{fn(state.pptDrafts[id]);revision++;},open:async row=>restored.push(row)},reveal:async file=>revealed.push(file)};
 const collection={id:7,libraryID:1,name:'心理学论文',loadDataType:async()=>{},getChildItems:()=>[...items.values()].filter(item=>!item.pdf&&item.collections.includes(7)).map(item=>item.id)};
 const Zotero={Items:{getAsync:async id=>items.get(id)},Collections:{getAsync:async id=>id===7?collection:null},launchFile:async file=>opened.push(file)},IOUtils={stat:async file=>{const stat=await fs.stat(file);return {size:stat.size,type:stat.isDirectory()?'directory':'regular'};},read:async(file,{maxBytes}={})=>{const bytes=await fs.readFile(file);return bytes.subarray(0,maxBytes);}};
 const outputs=installWorkspaceOutputs(E,{Zotero,IOUtils});
 async function paper(itemID,attachmentID,{exists=true,collections=[7]}={}){const file=path.join(folder,attachmentID+'.pdf');if(exists)await fs.writeFile(file,'%PDF-1.7\nreal local fixture\n%%EOF');const parent={id:itemID,libraryID:1,collections,attachments:[attachmentID],getCollections:()=>collections,getField:()=> '实际论文 '+itemID},attachment={id:attachmentID,libraryID:1,parentID:itemID,pdf:true,path:file,getFilePathAsync:async()=>file,getField:()=> '附件'};items.set(itemID,parent);items.set(attachmentID,attachment);return {file,parent,attachment};}
 return {folder,state,E,Zotero,IOUtils,outputs,paper,items,opened,revealed,restored,get allReads(){return allReads;}};
}

test('only a real local PDF becomes a downloaded entry, and the current folder excludes metadata and missing files',async t=>{
 const f=await fixture(t),good=await f.paper(1,11),missing=await f.paper(2,12,{exists:false});await f.paper(3,13,{collections:[8]});f.items.set(4,{id:4,libraryID:1,collections:[7],getCollections:()=>[7],getField:()=> '只有题录'});
 await f.outputs.rememberDownload({titleZh:'中文心理学论文'},{itemID:1,attachmentID:11,libraryID:1,collectionID:7});
 await assert.rejects(f.outputs.rememberDownload({title:'失败论文'},{attachmentID:12,libraryID:1,collectionID:7}),/未保存到本机/);
 const result=await f.outputs.listDownloads({collectionID:7,libraryID:1});assert.equal(result.folder,'心理学论文');assert.equal(result.rows.length,1);assert.equal(result.rows[0].title,'中文心理学论文');assert.equal(result.rows[0].path,good.file);assert.equal(result.rows[0].attachmentID,11);assert.equal(Object.keys(f.state.workspaceDownloads).length,1);
 await f.outputs.open(result.rows[0]);await f.outputs.reveal(result.rows[0]);assert.deepEqual(f.opened,[{attachmentID:11}]);assert.deepEqual(f.revealed,[good.file]);await fs.unlink(good.file);assert.equal((await f.outputs.listDownloads({collectionID:7})).rows.length,0);await assert.rejects(f.outputs.open(result.rows[0]),/移动|尚未下载/);assert.equal(missing.attachment.id,12);
});

test('concurrent downloads retain every successful file without scanning the whole library',async t=>{
 const f=await fixture(t);await Promise.all([f.paper(1,11),f.paper(2,12)]);await Promise.all([f.outputs.rememberDownload({title:'A'},{attachmentID:11,collectionID:7}),f.outputs.rememberDownload({title:'B'},{attachmentID:12,collectionID:7})]);assert.equal(Object.keys(f.state.workspaceDownloads).length,2);assert.equal((await f.outputs.listDownloads({collectionID:7})).rows.length,2);assert.equal(f.Zotero.Items.getAll,undefined);
 const controller=new AbortController();controller.abort();await assert.rejects(f.outputs.listDownloads({collectionID:7},{signal:controller.signal}),/取消/);
});

test('PPT projects restore separately from real exported files, and empty or missing exports are never offered for opening',async t=>{
 const f=await fixture(t),file=path.join(f.folder,'report.pptx'),missing=path.join(f.folder,'missing.pptx');await fs.writeFile(file,Buffer.from('PK\x03\x04controlled-pptx-file'));
 f.state.pptDrafts={empty:{id:'empty',title:'空白',slides:[]},saved:{id:'saved',title:'心理学组会',paperCollectionID:7,slides:[{id:'slide'}],updatedAt:'2026-10-26'},other:{id:'other',title:'别的文件夹',paperCollectionID:8,slides:[{}]}};
 await f.outputs.rememberPPTExport('saved',{path:file,slides:1});f.state.pptDrafts.saved.exports.push({path:missing,slides:1});
 const rows=(await f.outputs.listPPT({collectionID:7})).rows;assert.equal(rows.length,2);assert.equal(rows[0].kind,'ppt-project');assert.equal(rows[1].kind,'pptx');assert.equal(rows[1].path,file);assert.ok(f.state.pptDrafts.saved.lastExport.at);await f.outputs.open(rows[0]);await f.outputs.open(rows[1]);await f.outputs.reveal(rows[1]);assert.deepEqual(f.restored,[{draftID:'saved'}]);assert.deepEqual(f.opened,[file]);assert.deepEqual(f.revealed,[file]);
 const blank=path.join(f.folder,'blank.pptx');await fs.writeFile(blank,'');await assert.rejects(f.outputs.rememberPPTExport('saved',{path:blank}),/未生成可用/);await fs.writeFile(blank,'not a pptx');await assert.rejects(f.outputs.rememberPPTExport('saved',{path:blank}),/不是有效的 PPTX/);await fs.unlink(file);assert.equal((await f.outputs.listPPT({collectionID:7})).rows.length,1);await assert.rejects(f.outputs.open(rows[1]),/移动|不存在/);
});

test('output keys do not repeatedly clone presentation bodies on unrelated conversation rendering',async t=>{
 const f=await fixture(t);f.state.pptDrafts={saved:{id:'saved',title:'组会',slides:[{}],updatedAt:'now'}};const key=f.outputs.pptKey();const reads=f.allReads;for(let index=0;index<20;index++)assert.equal(f.outputs.pptKey(),key);assert.equal(f.allReads,reads);assert.equal(outputMatches({title:'独立样本',folder:'心理学'},'心理 独立'),true);assert.equal(pptOutputCandidates(f.state.pptDrafts,{projectID:'other'}).length,0);
});
