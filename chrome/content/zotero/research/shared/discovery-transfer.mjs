/* SPDX-License-Identifier: AGPL-3.0-or-later */
export const DISCOVERY_PAPER_MIME='application/x-easysch-discovery-paper';
const fields=['id','doi','title','pdf','url','source','sourceID','journal','year','date','abstract','authors','oa','retracted','attachmentID'];
export function setDiscoveryPaperDragData(event,record,{destination={}}={}){
 const transfer=event.dataTransfer;if(!transfer||!record?.title)return;
 const paper=Object.fromEntries(fields.filter(key=>record[key]!==undefined).map(key=>[key,record[key]]));
 transfer.effectAllowed='copy';transfer.setData(DISCOVERY_PAPER_MIME,JSON.stringify({paper,destination:{collectionID:destination.collectionID,libraryID:destination.libraryID,projectID:destination.projectID,...(destination.native===true?{native:true}:{})}}));
 if(Number.isInteger(record.attachmentID))transfer.setData('zotero/item',String(record.attachmentID));
 transfer.setData('text/plain',record.title);
}
export function discoveryPaperDrop(transfer){
 if(!Array.from(transfer?.types||[]).includes(DISCOVERY_PAPER_MIME))return null;
 const raw=transfer.getData(DISCOVERY_PAPER_MIME);if(!raw)return {pending:true};
 if(raw.length>100000)throw Error('论文资料过大，请重新检索后拖入。');
 let value;try{value=JSON.parse(raw);}catch{throw Error('论文资料无效，请重新拖入。');}
 if(!value?.paper?.title||typeof value.paper.title!=='string'||!['id','doi','pdf','attachmentID'].some(key=>value.paper[key]))throw Error('论文资料不完整，请重新检索后拖入。');
 return {paper:Object.fromEntries(fields.filter(key=>value.paper[key]!==undefined).map(key=>[key,value.paper[key]])),destination:value.destination||{}};
}
// The same order as a click on the result (resolveDiscoveryDestination): the
// native folder (sent by the drag source, else the one the target conversation
// is bound to) wins over the dropdown and the project folder.
async function discoveryDropTarget(E,session,drop){
 const sent=drop.destination||{};if(sent.native===true&&(sent.collectionID||sent.libraryID))return {...(sent.collectionID?{collectionID:sent.collectionID}:{}),...(sent.libraryID?{libraryID:sent.libraryID}:{})};
 if(session.libraryScopeKey&&(session.libraryCollectionID||session.libraryLibraryID))return {...(session.libraryCollectionID?{collectionID:session.libraryCollectionID}:{}),...(session.libraryLibraryID?{libraryID:session.libraryLibraryID}:{})};
 const draft=session.pptDraftID&&E.studio?.get?.(session.pptDraftID),project=E.manuscripts?.get?.(session.projectID||draft?.projectID);
 const stored=(E.store?.peek?E.store.peek('settings','discoveryDestination'):E.store?.get?.('settings','discoveryDestination'))||{},target={...stored,...drop.destination};
 if(project?.paperCollectionID||draft?.paperCollectionID)target.collectionID=project?.paperCollectionID||draft?.paperCollectionID;
 if(!target.collectionID&&target.projectID&&E.notebook?.ensureProjectCollection){const owner=await E.notebook.ensureProjectCollection(target.projectID,{});target.collectionID=owner.collectionID;target.libraryID=owner.libraryID;}
 if(!target.collectionID){const folder=await E.createDiscoveryCollection('论文搜集',{libraryID:target.libraryID});target.collectionID=folder.id;target.libraryID=folder.libraryID;await E.store.update(state=>state.settings.discoveryDestination={...stored,...target});}
 return target;
}
export async function receiveDiscoveryPaper({E,sessionID,drop,onProgress=()=>{},onReferences}){
 if(!drop||drop.pending)throw Error('未收到论文资料，请重新拖入。');
 const session=E.workbenchConversations?.get(sessionID);if(!session)throw Error('请先选择目标对话。');
 const attached=async attachmentID=>{const rows=await E.chatAttachments.attach(sessionID,{items:[attachmentID]},{source:'drop'});if(onReferences)onReferences((rows||E.chatAttachments.get?.(sessionID)||[]).filter(row=>row.attachmentID===attachmentID));};
 if(drop.paper.attachmentID){await attached(drop.paper.attachmentID);return '已关联已下载的论文，原文件保留。';}
 const target=await discoveryDropTarget(E,session,drop);
 onProgress('正在下载 PDF 并加入资料…');
 const saved=await E.obtainPaper(drop.paper,{collectionID:target.collectionID,libraryID:target.libraryID,open:false,onProgress:progress=>onProgress(progress.text||'正在获取 PDF…')});
 try{await attached(saved.attachmentID);}catch(error){throw Error('PDF 已保存在所选文件夹；关联到对话失败：'+error.message);}
 return 'PDF 已保存在所选文件夹并加入这次对话；可继续拖到装配或 PPT。';
}
