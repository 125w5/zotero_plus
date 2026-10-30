/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Native marks remain authoritative. Only open material views subscribe, and a
// notification checks their PDFs rather than rescanning folders or notebooks.
export function createMaterialExclusionEvents({snapshot,item,subscribeItems,subscribeStore,schedule,cancel,onError=()=>{}}){
 const listeners=new Set(),states=new Map(),annotationParents=new Map(),pending=new Set();
 let offItems,offStore,timer=null,running=false,generation=0;
 const ids=values=>new Set((values||[]).map(Number).filter(Number.isInteger).filter(id=>id>0));
 const watched=id=>[...listeners].some(listener=>listener.ids.has(id));
 const watchedIDs=()=>new Set([...listeners].flatMap(listener=>[...listener.ids]));
 const prune=()=>{for(const id of states.keys())if(!watched(id)){states.delete(id);for(const [annotationID,parent] of annotationParents)if(parent===id)annotationParents.delete(annotationID);}};
 const enqueue=attachmentIDs=>{
  for(const id of ids(attachmentIDs))if(watched(id))pending.add(id);
  if(pending.size&&timer===null&&!running)timer=schedule(flush,30);
 };
 const notifyItems=(event,type,values)=>{
  if(!['item','item-tag'].includes(type)||!['add','modify','trash','delete','remove'].includes(event))return;
  for(const value of values||[]){
   const id=Number(type==='item-tag'?String(value).split('-')[0]:value);
   if(!Number.isInteger(id))continue;
   // Cached identities also cover erase(), after Zotero unloads the item.
   if(annotationParents.has(id)){enqueue([annotationParents.get(id)]);continue;}
   if(type==='item'&&watched(id)){enqueue([id]);continue;}
   let record;try{record=item(id);}catch(error){onError(error);continue;}
   if(record?.isAnnotation?.()&&record.parentID&&watched(Number(record.parentID)))enqueue([record.parentID]);
  }
 };
 async function flush(){
  timer=null;if(running)return;running=true;const started=generation;
  try{
   while(pending.size&&started===generation){
    const batch=[...pending],changed=[];pending.clear();
    for(const id of batch){
     if(!watched(id))continue;
     let rows;try{rows=await snapshot(id);}catch(error){onError(error);continue;}
     if(started!==generation||!watched(id))continue;
     const signature=JSON.stringify([...rows].sort((a,b)=>String(a.annotationKey).localeCompare(String(b.annotationKey)))),prior=states.get(id);
     for(const [annotationID,parent] of annotationParents)if(parent===id)annotationParents.delete(annotationID);
     for(const row of rows)if(row.annotationID)annotationParents.set(Number(row.annotationID),id);
     states.set(id,{signature});
     // Complete the first render after native annotation data is loaded. This
     // also covers a mark erased between subscribing and this first snapshot.
     if(!prior||prior.signature!==signature)changed.push(id);
    }
    if(started!==generation)break;
    for(const listener of [...listeners]){
     const relevant=changed.filter(id=>listener.ids.has(id));if(!relevant.length)continue;
     try{listener.fn(Object.freeze({reason:'material-exclusions',attachmentIDs:Object.freeze(relevant)}));}catch(error){onError(error);}
    }
   }
  }finally{running=false;if(pending.size&&timer===null)timer=schedule(flush,30);}
 }
 function stop(){
  generation++;if(timer!==null)cancel(timer);timer=null;offItems?.();offStore?.();offItems=offStore=null;
  pending.clear();states.clear();annotationParents.clear();listeners.clear();
 }
 function subscribe(fn,{attachmentIDs=[]}={}){
  const listener={fn,ids:new Set()};listeners.add(listener);
  if(!offItems)offItems=subscribeItems(notifyItems);
  if(!offStore)offStore=subscribeStore(change=>{if(!change?.changedBranches||change.changedBranches.includes('materialExclusionQuotes'))enqueue(change?.attachmentIDs||[...watchedIDs()]);});
  const update=values=>{const next=ids(values),added=[...next].filter(id=>!listener.ids.has(id));listener.ids=next;prune();enqueue(added);};
  const unsubscribe=()=>{if(!listeners.delete(listener))return;if(!listeners.size)stop();else prune();};
  unsubscribe.update=values=>{if(listeners.has(listener))update(values);};
  update(attachmentIDs);return unsubscribe;
 }
 return {subscribe,refresh:enqueue,stop};
}
