/* SPDX-License-Identifier: AGPL-3.0-or-later */
const stoppedError=()=>Object.assign(Error('已停止准备论文，已完成内容已保留'),{name:'AbortError'});
const aborted=signal=>{if(signal?.aborted)throw stoppedError();};

// One bounded worker prepares open papers. A pane and an open tab are separate
// consumers: leaving either cannot cancel the other. Results live only in a
// small memory cache; the actual text, images and readings use their existing
// durable stores and are not copied or removed here.
export function createReaderPreparationQueue({identify,prepare,createController=()=>new AbortController(),onState=()=>{},maxQueuedImports=8,maxResults=4}={}){
 const jobs=new Map(),queue=[],results=new Map(),states=new Map(),pending=new Set();let active,stopped=false;
 const track=promise=>{pending.add(promise);promise.then(()=>pending.delete(promise),()=>pending.delete(promise));return promise;};
 const publish=(job,patch)=>{job.state={...job.state,...patch};states.set(job.identity.id,job.state);while(states.size>32)states.delete(states.keys().next().value);try{onState({...job.state});}catch{}for(const consumer of job.consumers)try{consumer.status?.(job.state.detail||job.state.status);}catch{}};
 const pump=()=>{
  if(stopped||active)return;let job;while(queue.length){job=queue.shift();if(jobs.get(job.identity.key)===job&&!job.controller.signal.aborted&&job.consumers.size)break;job=null;}
  if(!job)return;active=job;publish(job,{status:'running',detail:'正在准备论文正文、图表与速读…'});
  job.work=track(Promise.resolve().then(()=>{aborted(job.controller.signal);return prepare(job.identity,{signal:job.controller.signal,status:detail=>{if(!job.controller.signal.aborted&&jobs.get(job.identity.key)===job)publish(job,{detail});},fresh:job.fresh});}).then(value=>{
   aborted(job.controller.signal);if(stopped)throw stoppedError();results.delete(job.identity.key);results.set(job.identity.key,value);while(results.size>maxResults)results.delete(results.keys().next().value);publish(job,value?.preparationWarnings?.length?{status:'partial',detail:'速读已准备好，部分图片说明未完成'}:{status:'ready',detail:'论文阅读已准备好'});job.resolve(value);
  },error=>{throw error;}).catch(error=>{publish(job,{status:job.controller.signal.aborted?'cancelled':'error',detail:error.message});job.reject(error);}).finally(()=>{if(jobs.get(job.identity.key)===job)jobs.delete(job.identity.key);if(active===job)active=null;pump();}));
 };
 const cancelJob=job=>{job.controller.abort();if(active!==job){const at=queue.indexOf(job);if(at>=0)queue.splice(at,1);if(jobs.get(job.identity.key)===job)jobs.delete(job.identity.key);publish(job,{status:'cancelled',detail:stoppedError().message});job.reject(stoppedError());}pump();};
 const consume=(job,{signal,status}={})=>new Promise((resolve,reject)=>{
  let done=false;const consumer={status},finish=(fn,value)=>{if(done)return;done=true;signal?.removeEventListener('abort',cancel);job.consumers.delete(consumer);fn(value);},cancel=()=>{finish(reject,stoppedError());if(!job.consumers.size)cancelJob(job);};
  job.consumers.add(consumer);signal?.addEventListener('abort',cancel,{once:true});job.promise.then(value=>finish(resolve,value),error=>finish(reject,error));if(signal?.aborted)cancel();else if(status)try{status(job.state.detail);}catch{}
 });
 const acquire=(input,{signal,status,priority=false,fresh=false}={})=>track((async()=>{
  if(stopped)throw stoppedError();aborted(signal);const identity=await identify(input);aborted(signal);if(stopped)throw stoppedError();if(!identity?.key||identity.id==null)throw Error('未找到可准备的本地论文');
  if(fresh)results.delete(identity.key);else if(results.has(identity.key))return results.get(identity.key);
  let job=jobs.get(identity.key);if(job?.controller.signal.aborted)job=null;
  if(!job){
   if(!priority&&queue.filter(row=>!row.priority).length>=maxQueuedImports)throw Object.assign(Error('论文准备队列已满，打开论文时会优先准备'),{name:'PreparationQueueFull'});
   job={identity,priority,fresh,controller:createController(),consumers:new Set(),state:{id:identity.id,key:identity.key,status:'queued',detail:'论文阅读准备已排队'}};job.promise=new Promise((resolve,reject)=>{job.resolve=resolve;job.reject=reject;});job.promise.catch(()=>{});jobs.set(identity.key,job);priority?queue.unshift(job):queue.push(job);publish(job,{});
  }else if(priority&&!job.priority){job.priority=true;const at=queue.indexOf(job);if(at>=0){queue.splice(at,1);queue.unshift(job);}}
  const result=consume(job,{signal,status});pump();return result;
 })());
 return {acquire,state:id=>states.get(Number(id))||null,async stop(){if(!stopped){stopped=true;for(const job of [...jobs.values()])cancelJob(job);results.clear();}await Promise.allSettled([...pending]);},snapshot:()=>({active:active?.identity.key||null,queued:queue.length,jobs:jobs.size,cached:results.size})};
}
