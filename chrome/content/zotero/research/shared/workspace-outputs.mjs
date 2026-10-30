/* SPDX-License-Identifier: AGPL-3.0-or-later */
// A result row is not a downloaded file. Resolve only known attachments (or
// children of the selected collection), and verify the local file before use.
const abort=signal=>{if(signal?.aborted)throw Error('已取消文件读取');};
const id=value=>Number(value)||null;
const unique=rows=>[...new Map(rows.map(row=>[row.id,row])).values()];
export function outputMatches(row,query=''){
 const text=[row.title,row.folder,row.path,row.subtitle].filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase();
 return String(query).normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/u).every(word=>text.includes(word));
}
export function pptOutputCandidates(drafts={},scope={}){
 return Object.values(drafts).filter(draft=>!scope.projectID||draft.projectID===scope.projectID)
  .filter(draft=>!scope.collectionID||id(draft.paperCollectionID)===id(scope.collectionID))
  .sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))).flatMap(draft=>{
   const rows=[],pages=draft.slides?.length||0;
   if(pages||draft.materialsReady||draft.outlineCustomized)rows.push({id:'ppt-project:'+draft.id,kind:'ppt-project',draftID:draft.id,title:draft.title||'组会 PPT',subtitle:pages?pages+' 页 · 已保存项目':'已保存项目',updatedAt:draft.updatedAt,canRestore:true});
   for(const result of unique([...(draft.exports||[]),...(draft.lastExport?[draft.lastExport]:[])].filter(row=>row?.path).map(row=>({...row,id:row.path})))){
    rows.push({id:'pptx:'+result.path,kind:'pptx',draftID:draft.id,title:draft.title||'组会 PPT',path:result.path,subtitle:(result.slides||pages)+' 页 · PPTX',updatedAt:result.at||draft.updatedAt,canOpen:true,canRestore:true,canReveal:true});
   }
   return rows;
  });
}
export function installWorkspaceOutputs(E,{Zotero,IOUtils}={}){
 if(E.workspaceOutputs)return E.workspaceOutputs;
 let downloadsRevision=-1,downloadRows=[],draftsRevision=-1,draftRows={},writeQueue=Promise.resolve();
 const revision=branch=>E.store.branchRevision?.(branch)??E.store.revision??-1;
 // Rows are read-only here; newest first is applied when reading, so a new
 // download writes one entry instead of re-sorting and replacing the branch.
 function downloads(){const current=revision('workspaceDownloads');if(current!==downloadsRevision||current===-1){downloadsRevision=current;let saved=E.store.peek?E.store.peek('workspaceDownloads'):E.store.get('workspaceDownloads');downloadRows=Object.values(saved||{}).sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt)));}return downloadRows;}
 function drafts(){const current=revision('pptDrafts');if(current!==draftsRevision||current===-1){draftsRevision=current;draftRows=E.studio?.all?.()||E.store.get('pptDrafts')||{};}return draftRows;}
 const fileStat=async path=>{if(!path)return null;try{const stat=await IOUtils.stat(path);return stat.type==='directory'||stat.size<=0?null:stat;}catch{return null;}};
 const parentOf=async item=>item?.parentID?await Zotero.Items.getAsync(item.parentID):item;
 const folderName=async(collectionID,fallback='我的文库')=>{const collection=collectionID&&await Zotero.Collections.getAsync(id(collectionID));return collection&&!collection.deleted?collection.name:fallback;};
 async function pdf(itemID,scope={},signal){
  abort(signal);const attachment=await E.library.localPDF(id(itemID));abort(signal);if(!attachment)return null;
  const parent=await parentOf(attachment);abort(signal);if(!parent||parent.deleted||scope.libraryID&&id(parent.libraryID)!==id(scope.libraryID)||scope.collectionID&&!parent.getCollections?.().includes(id(scope.collectionID)))return null;
  const path=await attachment.getFilePathAsync(),stat=await fileStat(path);abort(signal);if(!stat)return null;
  return {id:'download:'+attachment.id,kind:'pdf',attachmentID:attachment.id,itemID:parent.id,libraryID:parent.libraryID,title:parent.getField?.('title')||attachment.getField?.('title')||'已下载论文',path,bytes:stat.size,canOpen:true,canReveal:true};
 }
 async function bounded(rows,fn,signal){const result=Array(rows.length);let cursor=0;await Promise.all(Array.from({length:Math.min(4,rows.length)},async()=>{while(cursor<rows.length){abort(signal);const index=cursor++;result[index]=await fn(rows[index]);}}));return result.filter(Boolean);}
 const api={
  downloadKey(scope={}){return JSON.stringify([scope,downloads().map(row=>[row.attachmentID,row.collectionID,row.savedAt])]);},
  // Rows change with a title, page count, export or order, not with every autosave.
  pptKey(scope={}){return JSON.stringify(pptOutputCandidates(drafts(),scope).map(row=>[row.id,row.title,row.subtitle,row.path]));},
  rememberDownload(record,result){
   const task=writeQueue.then(async()=>{const local=await pdf(result.attachmentID,result);if(!local)throw Error('PDF 未保存到本机，未加入已下载列表');const key=local.attachmentID+':'+(result.collectionID||''),row={...local,collectionID:result.collectionID||null,folder:result.collectionName||await folderName(result.collectionID),title:record.titleZh||record.translatedTitle||record.title||local.title,savedAt:new Date().toISOString()};
    await E.store.update(state=>{let rows=state.workspaceDownloads||={};rows[key]=row;let keys=Object.keys(rows);if(keys.length>2000)for(let old of keys.sort((a,b)=>String(rows[a].savedAt).localeCompare(String(rows[b].savedAt))).slice(0,keys.length-2000))delete rows[old];});downloadsRevision=-1;return row;
   });writeQueue=task.catch(()=>{});return task;
  },
  async listDownloads(scope={}, {signal,references=[]}={}){
   abort(signal);const saved=downloads().filter(row=>(!scope.libraryID||id(row.libraryID)===id(scope.libraryID))&&(!scope.collectionID||id(row.collectionID)===id(scope.collectionID))),candidateIDs=new Set([...saved.map(row=>row.attachmentID),...references.filter(row=>['pdf','paper'].includes(row.kind)).map(row=>row.attachmentID||row.paperItemID)].map(id).filter(Boolean));
   if(scope.collectionID){const collection=await Zotero.Collections.getAsync(id(scope.collectionID));abort(signal);if(collection&&!collection.deleted){await collection.loadDataType('childItems');for(const itemID of collection.getChildItems(true)||[])candidateIDs.add(itemID);}}
   const folder=await folderName(scope.collectionID),rows=await bounded([...candidateIDs],itemID=>pdf(itemID,scope,signal),signal),savedByAttachment=new Map(saved.map(row=>[id(row.attachmentID),row]));
   return {folder,rows:unique(rows).map(row=>{const previous=savedByAttachment.get(row.attachmentID);return {...row,title:previous?.title||row.title,folder:scope.collectionID?folder:previous?.folder||folder,subtitle:scope.collectionID?folder:previous?.folder||folder};})};
  },
  async listPPT(scope={}, {signal}={}){
   const rows=await bounded(pptOutputCandidates(drafts(),scope),async row=>{abort(signal);return row.path&&!await fileStat(row.path)?null:row;},signal);return {rows};
  },
  async open(row){
   if(row.kind==='pdf'){const local=await pdf(row.attachmentID);if(!local)throw Error('PDF 已移动或尚未下载，请重新下载');return E.library.openSource({attachmentID:local.attachmentID});}
   if(row.kind==='ppt-project')return api.restore(row);
   if(row.kind!=='pptx'||!await fileStat(row.path))throw Error('PPT 文件已移动或不存在，请重新导出');return Zotero.launchFile(row.path);
  },
  async restore(row){if(!row.draftID||!E.studio?.get(row.draftID))throw Error('PPT 项目已不存在');return E.studio.open({draftID:row.draftID});},
  async reveal(row){if(row.kind==='pdf')return E.library.revealPDF(row.attachmentID);if(row.kind!=='pptx'||!await fileStat(row.path))throw Error('PPT 文件已移动或不存在，请重新导出');return E.reveal(row.path);},
  async rememberPPTExport(draftID,result){
   if(!result?.path||!await fileStat(result.path))throw Error('导出未生成可用的 PPTX 文件');const bytes=await IOUtils.read(result.path,{maxBytes:4});if(bytes[0]!==80||bytes[1]!==75)throw Error('导出文件不是有效的 PPTX，请重新导出');
   const saved={...result,at:new Date().toISOString()};await E.studio.patch(draftID,draft=>{draft.lastExport=saved;draft.exports=[saved,...(draft.exports||[]).filter(row=>row.path!==saved.path)].slice(0,30);});draftsRevision=-1;return saved;
  }
 };
 E.workspaceOutputs=api;return api;
}
