/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {crossrefFeedRecord} from './discovery-providers.mjs';
export const TRACKED_JOURNALS=Object.freeze([
 ['nature-physics','Nature Physics','1745-2473'],['prl','Physical Review Letters','0031-9007'],['prx','Physical Review X','2160-3308'],
 ['pra','Physical Review A','2469-9926'],['prb','Physical Review B','2469-9950'],['prc','Physical Review C','2469-9985'],
 ['prd','Physical Review D','2470-0010'],['pre','Physical Review E','2470-0045'],['prresearch','Physical Review Research','2643-1564'],
 ['prapplied','Physical Review Applied','2331-7019'],['rmp','Reviews of Modern Physics','0034-6861']
].map(([id,name,issn])=>({id,name,issn})));
export function journalSubscription(value={}){
 return {enabled:value.enabled===true,journalIDs:[...new Set((value.journalIDs||[]).filter(id=>TRACKED_JOURNALS.some(row=>row.id===id)))],collectionID:Number(value.collectionID)||null,libraryID:Number(value.libraryID)||null,includeMetadata:value.includeMetadata===true,intervalHours:Math.max(6,Math.min(168,Number(value.intervalHours)||24)),lastChecked:Number(value.lastChecked)||0};
}
export function journalMetadataRecord(row){
 const direct=crossrefFeedRecord(row);if(direct)return direct;
 if(!row.DOI||!row.title?.[0])return null;
 return {id:'https://doi.org/'+row.DOI,doi:row.DOI,title:String(row.title[0]).replace(/<[^>]+>/g,' ').trim(),abstract:String(row.abstract||'').replace(/<[^>]+>/g,' ').trim(),url:row.URL||'https://doi.org/'+row.DOI,pdf:'',oa:false,metadataOnly:true,source:'Crossref',sourceType:'journal',journal:row['container-title']?.[0]||'',issn:row.ISSN?.[0]||'',date:(row.published?.['date-parts']?.[0]||[]).map((part,index)=>String(part).padStart(index?2:4,'0')).join('-'),authors:(row.author||[]).map(author=>({lastName:author.family||author.name||'',firstName:author.given||'',fieldMode:author.family?0:1}))};
}
export function journalUpdateURL(journal,{from,page=0}={}){
 const params=new URLSearchParams({filter:'type:journal-article,from-pub-date:'+from,rows:'50',offset:String(page*50),sort:'published',order:'desc'});
 return 'https://api.crossref.org/journals/'+journal.issn+'/works?'+params;
}
// The application owns this subscription. A checkpoint advances only after a
// successful retrieval/import; failed items remain retryable on the next run.
export function installJournalSubscriptions(E){
 let running;
 E.saveJournalSubscription=async value=>{const config=journalSubscription({...E.store.get().settings.journalSubscription,...value});if(config.enabled&&!config.journalIDs.length)throw Error('请选择要追踪的期刊');if(config.enabled&&!config.collectionID)throw Error('请选择论文保存文件夹');if(config.collectionID)await E.resolveAcademicTarget(config);await E.store.update(s=>s.settings.journalSubscription=config);return config;};
 E.refreshJournalSubscriptions=async({dueOnly=false,signal}={})=>{
  if(running)return running;const config=journalSubscription(E.store.get().settings.journalSubscription),now=Date.now();
  if(!config.enabled||dueOnly&&now-config.lastChecked<config.intervalHours*3600000)return{skipped:true,records:[]};
  running=(async()=>{const target=await E.resolveAcademicTarget(config),previous=E.store.get().journalSubscriptionState||{},done=new Set(previous.importedDOIs||[]),records=[],errors=[];let imported=0,pdf=0,metadata=0;
   const from=new Date(Math.max(now-31*86400000,config.lastChecked?config.lastChecked-2*86400000:now-7*86400000)).toISOString().slice(0,10);
   for(const journal of TRACKED_JOURNALS.filter(row=>config.journalIDs.includes(row.id))){try{for(let page=0;page<6;page++){
    if(signal?.aborted)throw Object.assign(Error('已取消期刊更新'),{name:'AbortError'});
    const payload=JSON.parse(await E.requestProvider(journalUpdateURL(journal,{from,page}),{signal},12000));if(signal?.aborted)throw Object.assign(Error('已取消期刊更新'),{name:'AbortError'});if(!Array.isArray(payload.message?.items))throw Error('期刊来源返回格式不正确');
    for(const item of payload.message.items){if(signal?.aborted)throw Object.assign(Error('已取消期刊更新'),{name:'AbortError'});const record=journalMetadataRecord(item);if(!record)continue;records.push(record);const key=record.doi.toLowerCase();if(done.has(key))continue;
     try{if(record.pdf){await E.obtainPaper(record,{...target,open:false,signal});pdf++;}else if(config.includeMetadata){await E.importAcademic(record,{...target,select:false});metadata++;}else continue;done.add(key);imported++;}
     catch(error){if(signal?.aborted)throw error;errors.push({journal:journal.name,title:record.title,message:error.message});}
    }
    if(payload.message.items.length<50)break;if(page===5)errors.push({journal:journal.name,message:'本次更新达到 300 篇，未推进检查时间；再次刷新继续核对。'});
   }}catch(error){if(signal?.aborted)throw error;errors.push({journal:journal.name,message:error.message});}}
   if(signal?.aborted)throw Object.assign(Error('已取消期刊更新'),{name:'AbortError'});const result={at:now,from,imported,pdf,metadata,records:records.slice(0,300),errors};await E.store.update(s=>{s.journalSubscriptionState={...result,importedDOIs:[...done].slice(-10000)};if(!errors.length)s.settings.journalSubscription={...config,lastChecked:now};});return result;
  })();try{return await running;}finally{running=null;}
 };
}
// Install before app.start supplies its timer APIs; start only once afterward.
export function installJournalSubscriptionTimer(E,{createController=()=>new AbortController(),onError=()=>{}}={}){
 let timer,controller,running,started=false,stopped=false;
 const schedule=delay=>{timer=E.setTimeout(check,delay);};
 const check=async()=>{timer=undefined;if(stopped)return;controller=createController();running=Promise.resolve().then(()=>E.refreshJournalSubscriptions({dueOnly:true,signal:controller.signal}));try{await running;}catch(error){if(!controller.signal.aborted)onError(error);}finally{running=null;controller=null;if(!stopped)schedule(6*3600000);}};
 E.startJournalSubscriptions=()=>{if(started||stopped||!E.setTimeout)return false;started=true;schedule(20000);return true;};
 E.stopJournalSubscriptions=async()=>{stopped=true;if(timer!==undefined)E.clearTimeout?.(timer);timer=undefined;controller?.abort();if(running)await Promise.allSettled([running]);};
}
