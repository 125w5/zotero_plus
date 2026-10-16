/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {normalizeChatAttachments} from './chat-attachments.mjs';

// Folder membership is a source catalogue. Imported files, source choices and
// unsent text still belong to the conversation and are never replaced by it.
export function libraryScopeKey(rows=[]){return rows.map(row=>String(row.id)).sort().join('|');}
export function libraryScopeSessions(rows=[],scope){return rows.filter(row=>!row.pptDraftID&&!row.isDraft&&(!scope?.key||row.libraryScopeKey===scope.key));}
export function libraryScopeReferences(session,files=[]){
 const prior=new Map(normalizeChatAttachments(session?.libraryFiles).map(row=>[row.id,row])),detached=new Set(session?.detachedAttachments||[]),imports=new Set((session?.attachments||[]).map(row=>row.id));
 const visibleIDs=new Set(files.map(row=>row.id));let selected=(session?.attachments||[]).filter(row=>row.selected!==false).length+[...prior.values()].filter(row=>row.selected!==false&&!detached.has(row.id)&&!imports.has(row.id)&&visibleIDs.has(row.id)).length;
 return normalizeChatAttachments(files).filter(row=>!detached.has(row.id)&&!imports.has(row.id)).map(row=>{
  const saved=prior.get(row.id),choose=saved?saved.selected!==false:selected<12;if(choose&&!saved)selected++;
  return {...row,...(saved?Object.fromEntries(['selected','featured','sheet','ranges','stateVersion'].filter(key=>Object.hasOwn(saved,key)).map(key=>[key,saved[key]])):{}),selected:choose};
 });
}
export async function syncLibraryScopeSession(E,scope,{pptDraftID,origin='workbench',activate=true,signal,sessionID}={}){
 const S=E.workbenchConversations;if(!S||!scope?.key||signal?.aborted)return null;
 const fields={libraryScopeKey:scope.key,...(pptDraftID?{pptDraftID}:{}),origin};
 const retained=sessionID&&S.get(sessionID),compatible=retained&&(!retained.libraryScopeKey||retained.libraryScopeKey===scope.key)&&(retained.pptDraftID||'')===(pptDraftID||'');
 let session=compatible?retained:S.getForScope(fields);
 if(!session)session=await S.open({...fields,title:'新研究对话'},{activate:false});
 if(signal?.aborted)return null;
 if(S.syncLibraryScope)session=await S.syncLibraryScope(session.id,scope,{signal});
 else {const libraryFiles=libraryScopeReferences(session,scope.files),patch={libraryScopeKey:scope.key,libraryFolder:scope.folder,libraryCollectionID:scope.collectionID||null,libraryLibraryID:scope.libraryID||null,libraryFiles};if(Object.entries(patch).some(([key,value])=>JSON.stringify(session[key])!==JSON.stringify(value)))session=await S.update(session.id,patch,{origin:'library-scope'});}
 if(signal?.aborted)return null;
 if(activate)await S.select(session.id,{scope:fields,signal,summary:true});
 return signal?.aborted?null:S.get(session.id);
}

export async function readNativeLibraryScope(E,win,{signal}={}){
 const rows=win.ZoteroPane.getCollectionTreeRows(),key=libraryScopeKey(rows);if(!key)return null;
 const labels=rows.map(row=>row.getName?.()||row.ref?.name||'我的文库'),collection=rows.length===1&&rows[0].isCollection?.()?rows[0].ref:null;
 const files=E.library.workspaceScope?await E.library.workspaceScope(rows,{signal}):[];
 return signal?.aborted?null:{key,folder:labels.join(' / '),collectionID:collection?.id||null,libraryID:collection?.libraryID||rows[0].ref?.libraryID||null,files};
}
