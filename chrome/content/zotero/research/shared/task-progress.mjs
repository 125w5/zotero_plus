/* SPDX-License-Identifier: AGPL-3.0-or-later */
const knownProgress=value=>Number.isFinite(value?.done)&&Number.isFinite(value?.total)&&value.total>0&&value.done>=0&&value.done<=value.total;
const cancelled=error=>error?.name==='AbortError'||/已取消|已停止/.test(error?.message||'');
export function taskProgressUpdate(value){
 if(typeof value==='string')return {detail:value};
 if(!value||typeof value!=='object')return {};
 return {detail:value.text||value.message||value.stage||'',...(knownProgress(value)?{done:value.done,total:value.total}:{})};
}
// Leases represent actual asynchronous work. Shared keys join the same job;
// settling a route or child request cannot clear another operation's lease.
export function createTaskProgress(){
 const tasks=new Map(),listeners=new Set();let counter=0,version=0,lastOutcome=null;
 const snapshot=()=>{const rows=[...tasks.values()].map(row=>({...row,leases:row.leases.size})),active=rows.at(-1),known=rows.length>0&&rows.every(knownProgress),done=known?rows.reduce((sum,row)=>sum+row.done,0):null,total=known?rows.reduce((sum,row)=>sum+row.total,0):null;return {version,pending:rows.length,tasks:rows,title:active?.title||'就绪',detail:active?.detail||'',state:rows.length?'busy':lastOutcome?.state||'idle',determinate:known,done,total,outcome:lastOutcome};};
 const emit=()=>{version++;const value=snapshot();for(const listener of listeners)try{listener(value);}catch{/* An indicator must never interrupt the task it observes. */}};
 function begin({title='正在处理',kind='task',key,detail='',done,total}={}){
  if(!tasks.size)lastOutcome=null;let task=key&&[...tasks.values()].find(row=>row.key===key);const token=++counter;
  if(!task){task={id:'task-'+token,key,title,kind,detail,startedAt:Date.now(),leases:new Set(),...(knownProgress({done,total})?{done,total}:{})};tasks.set(task.id,task);}task.leases.add(token);emit();let closed=false;
  return {id:task.id,update(value={}){if(closed||!tasks.has(task.id))return;const patch=taskProgressUpdate(value);if(patch.detail)task.detail=String(patch.detail).slice(0,500);if(knownProgress(patch)){task.done=patch.done;task.total=patch.total;}emit();},close({error,cancelled:stopped=false}={}){if(closed)return;closed=true;if(!tasks.has(task.id))return;task.leases.delete(token);if(error&&!stopped&&!cancelled(error))lastOutcome={state:'error',title:task.title,message:String(error.message||error).slice(0,500)};else if(!lastOutcome)lastOutcome={state:stopped||cancelled(error)?'cancelled':'idle',title:task.title};if(!task.leases.size)tasks.delete(task.id);emit();}};
 }
 return {begin,snapshot,subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},clear(){tasks.clear();lastOutcome=null;emit();}};
}

export function trackAsyncMethod(target,name,registry,{title,kind=name,key,statusIndex,optionsIndex,callback='onProgress',signalIndex,when=()=>true,onlyExistingCallback=false}={}){
 const original=target?.[name];if(typeof original!=='function')return()=>{};
 function tracked(...input){
  if(!when(input))return original.apply(this,input);const lease=registry.begin({title:typeof title==='function'?title(input):title||'正在处理',kind,key:typeof key==='function'?key(input):key}),args=[...input],signal=signalIndex!==undefined?input[signalIndex]:optionsIndex!==undefined?input[optionsIndex]?.signal:undefined;
  const tap=fn=>function(...values){lease.update(values[0]);return typeof fn==='function'?fn.apply(this,values):undefined;};
  if(statusIndex!==undefined&&typeof args[statusIndex]==='function')args[statusIndex]=tap(args[statusIndex]);
  if(optionsIndex!==undefined&&args[optionsIndex]&&typeof args[optionsIndex]==='object'&&(!onlyExistingCallback||typeof args[optionsIndex][callback]==='function'))args[optionsIndex]={...args[optionsIndex],[callback]:tap(args[optionsIndex][callback])};
  let result;try{result=original.apply(this,args);}catch(error){lease.close({error,cancelled:signal?.aborted});throw error;}
  if(!result||typeof result.then!=='function'){lease.close();return result;}
  return result.then(value=>{lease.close({cancelled:signal?.aborted});return value;},error=>{lease.close({error,cancelled:signal?.aborted});throw error;});
 }
 target[name]=tracked;return()=>{if(target[name]===tracked)target[name]=original;};
}
