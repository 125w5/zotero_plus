/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {requestWithinDeadline} from './request-deadline.mjs';
// Includes query translation, provider fallback and parsing. Partial results
// stay usable when a provider ignores abort or exhausts the overall budget.
export function discoverySearchTask(work,{signal,timeout=60000,...runtime}={}){
 return requestWithinDeadline(work,{signal,timeout,...runtime});
}

// Preparation/assessment callers do not pass through the discovery page's
// UI deadline. The service owns the budget including fallback and PDF checks.
export function createDiscoverySearchRunner(runtime={}){
 return async(work,{signal,onProgress=()=>{},timeout=60000}={})=>{
  let latest,settled=false;
  const progress=value=>{if(!settled&&!signal?.aborted){if(value?.records?.length)latest=value;onProgress(value);}};
  try{return await discoverySearchTask(current=>work(current,progress),{signal,timeout,...runtime});}
  catch(error){
   if(error.name!=='TimeoutError'||!latest?.records?.length)throw error;
   return {...latest,partial:true,hasMore:latest.hasMore!==false,cacheHit:false,
    error:'本次检索已达到时间上限，已验证的 PDF 可继续使用；可加载更多或重试。',
    limitations:[...(latest.limitations||[]),'检索达到时间上限，已停止未完成的网络请求。']};
  }finally{settled=true;}
 };
}
