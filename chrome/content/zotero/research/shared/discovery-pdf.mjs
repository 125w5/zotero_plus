/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {requestWithinDeadline} from './request-deadline.mjs';

export const PDF_CHECK_VERSION='pdf-byte-check-1';
export const PDF_PROBE_TIMEOUT=12000;
export const PDF_TRANSIENT_RETRY=15000;
const cancelled=()=>Object.assign(Error('已取消 PDF 获取'),{name:'AbortError'});
const check=signal=>{if(signal?.aborted)throw cancelled();};
export function discoveryBranch(E,key,id){const value=E.store?.get?.(key,...(id===undefined?[]:[id])),branch=value&&Object.hasOwn(value,key)?(id===undefined?value[key]:value[key]?.[id]):value;return id===undefined?branch||{}:branch;}
// Shared frozen view for per-batch lookups; a store without peek gets a copy.
export function discoveryView(E,key,id){if(typeof E.store?.peek!=='function')return discoveryBranch(E,key,id);const value=E.store.peek(key,...(id===undefined?[]:[id]));return id===undefined?value||{}:value;}
// Each store commit rewrites the workspace file. Cache entries produced one at
// a time (translated cards, catalog lookups, resolved references) are merged
// into one commit per burst; get() serves entries that are not written yet.
// Without the application's timers every set() is written at once.
export function createStoreBranchWriter(E,branch,{limit=0,delay=350,maxWait=2000,maxPending=Infinity,onError=()=>{}}={}){
	let pending=new Map(),writing=new Map(),timer=null,firstAt=0;
	let clock=()=>typeof E.setTimeout==='function'&&typeof E.clearTimeout==='function'?E:null;
	let cancel=()=>{if(timer!==null)clock()?.clearTimeout(timer);timer=null;firstAt=0;};
	function flush(){
		cancel();
		if(!pending.size)return Promise.resolve();
		let batch=pending;pending=new Map();
		for(let [key,value] of batch)writing.set(key,value);
		return Promise.resolve(E.store.update(state=>{
			let target=state[branch]||={};
			for(let [key,value] of batch)target[key]=value;
			if(limit)for(let old of Object.keys(target).slice(0,-limit))delete target[old];
		})).catch(error=>{
			for(let [key,value] of batch)if(!pending.has(key))pending.set(key,value);
			throw error;
		}).finally(()=>{
			for(let [key,value] of batch)if(writing.get(key)===value)writing.delete(key);
		});
	}
	function set(key,value){
		pending.set(key,value);
		let timers=clock();
		if(!timers||pending.size>=maxPending)return flush();
		if(!firstAt)firstAt=Date.now();
		if(timer!==null)timers.clearTimeout(timer);
		timer=timers.setTimeout(()=>{timer=null;flush().catch(onError);},Math.max(0,Math.min(delay,maxWait-(Date.now()-firstAt))));
		return Promise.resolve();
	}
	function get(key){
		if(pending.has(key))return pending.get(key);
		if(writing.has(key))return writing.get(key);
		return discoveryBranch(E,branch,key);
	}
	return {set,get,flush,get pending(){return pending.size;}};
}
export function pdfCandidateURLs(record){return [...new Set([record.pdf,...(record.pdfCandidates||[])].filter(url=>/^https:\/\//i.test(String(url||''))))].slice(0,4);}
const pdfHeader=bytes=>Array.from(bytes.subarray(0,1024),value=>String.fromCharCode(value)).join('').includes('%PDF-');

export async function readDiscoveryPDF(response,{probe=false,signal,onProgress=()=>{},maxBytes=80_000_000}={}){
 const rejectResponse=async message=>{try{await response.body?.cancel?.();}catch{}throw Error(message);};
 check(signal);if(!response.ok)return rejectResponse('PDF 无法获取（HTTP '+response.status+'）');
 const type=response.headers?.get('content-type')||'',total=Number(response.headers?.get('content-length'))||0;
 if(/(?:text\/html|application\/(?:json|xml)|text\/xml)/i.test(type))return rejectResponse('来源返回网页或验证页面，未提供 PDF');
 if(!probe&&total>maxBytes)return rejectResponse('PDF 超过 80 MB，请从来源页面单独下载');
 const chunks=[];let loaded=0,lastProgress=0,header=new Uint8Array();
 const append=chunk=>{const value=new Uint8Array(chunk);loaded+=value.length;if(header.length<1024){const next=new Uint8Array(Math.min(1024,header.length+value.length));next.set(header);next.set(value.subarray(0,next.length-header.length),header.length);header=next;}if(!probe)chunks.push(value);};
 const reader=response.body?.getReader?.();
 const abortRead=()=>{try{Promise.resolve(reader?.cancel()).catch(()=>{});}catch{}};
 signal?.addEventListener('abort',abortRead,{once:true});
 try{
  if(reader){while(true){check(signal);const {done,value}=await reader.read();if(done)break;append(value);if(loaded>=1024&&!pdfHeader(header))throw Error('来源返回非 PDF 内容，未保存附件');if(probe&&loaded>=1024)break;if(loaded>maxBytes)throw Error('PDF 超过 80 MB，请从来源页面单独下载');if(Date.now()-lastProgress>200){lastProgress=Date.now();onProgress({loaded,total});}}}
  else append(new Uint8Array(await response.arrayBuffer()));
  check(signal);if(loaded<100||!pdfHeader(header))throw Error('来源返回非 PDF 或空文件，未保存附件');
  if(probe)return {bytesChecked:Math.min(loaded,1024),contentType:type,finalURL:response.url||''};
  const bytes=new Uint8Array(loaded);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}onProgress({loaded,total:total||loaded});return bytes;
 }finally{signal?.removeEventListener('abort',abortRead);try{await reader?.cancel();}catch{}}
}

export function installDiscoveryPDF(E,{fetch,createController=()=>new AbortController(),setTimeout:later=globalThis.setTimeout,clearTimeout:clear=globalThis.clearTimeout}={}){
 if(E.verifyDiscoveryPDF&&E.requestDiscoveryPDF)return;
 const memory=new Map(),jobs=new Map(),controllers=new Set();let stopped=false,dirty=new Set();
 const Controller=function(){return createController();},runtime={AbortController:Controller,setTimeout:later,clearTimeout:clear};
 E.requestDiscoveryPDF||=async(url,{signal,probe=false,timeout=probe?PDF_PROBE_TIMEOUT:20000,onProgress}={})=>{
  if(!/^https:\/\//i.test(url||''))throw Error('缺少 HTTPS PDF 地址');if(stopped)throw cancelled();
  return requestWithinDeadline(async currentSignal=>{
   if(typeof fetch!=='function')throw Error('PDF 后台传输尚未准备好');
   const response=await fetch(url,{method:'GET',redirect:'follow',signal:currentSignal,headers:{Accept:'application/pdf,application/octet-stream;q=0.9,*/*;q=0.1',...(probe?{Range:'bytes=0-1023'}:{})}});
   return readDiscoveryPDF(response,{probe,signal:currentSignal,onProgress});
  },{signal,timeout,...runtime});
 };
 E.verifyDiscoveryPDF||=async(url,{signal,refresh=false}={})=>{
  check(signal);const saved=memory.get(url)||discoveryBranch(E,'discoveryPDFChecks',url),age=saved?.available?6*3600000:saved?.transient?PDF_TRANSIENT_RETRY:10*60000;
  if(!refresh&&saved?.version===PDF_CHECK_VERSION&&Date.now()-saved.checkedAt<age)return saved;
  let job=jobs.get(url);if(job?.controller.signal.aborted){jobs.delete(url);job=null;}
  if(!job){
   const controller=createController();controllers.add(controller);job={controller,consumers:new Set()};
   job.promise=(async()=>{let result;try{const value=await E.requestDiscoveryPDF(url,{probe:true,signal:controller.signal});result={...value,available:true,checkedAt:Date.now(),version:PDF_CHECK_VERSION};}catch(error){if(controller.signal.aborted)throw cancelled();result={available:false,error:error.message,transient:['TimeoutError','TypeError'].includes(error.name)||/连接|fetch|network|超时|timeout/i.test(error.message),checkedAt:Date.now(),version:PDF_CHECK_VERSION};}memory.set(url,result);dirty.add(url);return result;})();
   jobs.set(url,job);job.promise.finally(()=>{controllers.delete(controller);if(jobs.get(url)===job)jobs.delete(url);}).catch(()=>{});
  }
  const consumer={};job.consumers.add(consumer);let abort;
  try{return await Promise.race([job.promise,new Promise((_,reject)=>{abort=()=>reject(cancelled());signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();})]);}
  finally{signal?.removeEventListener('abort',abort);job.consumers.delete(consumer);if(!job.consumers.size&&jobs.get(url)===job)job.controller.abort();}
 };
 // Write only probes finished since the last flush. Results stay in memory for
 // the session; a scan answered from the cache commits nothing.
 E.flushDiscoveryPDFChecks=async()=>{
	if(!dirty.size)return;
	let urls=[...dirty];dirty=new Set();
	try{
		await E.store.update(state=>{
			let checks=state.discoveryPDFChecks||={};
			for(let url of urls)if(memory.has(url))checks[url]=memory.get(url);
			let keys=Object.keys(checks);
			if(keys.length>1000)for(let old of keys.sort((a,b)=>(checks[a]?.checkedAt||0)-(checks[b]?.checkedAt||0)).slice(0,keys.length-1000))delete checks[old];
		});
	}
	catch(error){
		for(let url of urls)dirty.add(url);
		throw error;
	}
 };
 E.stopDiscoveryPDF=()=>{stopped=true;for(const controller of controllers)controller.abort();};
}

export async function verifiedDiscoveryRecords(E,rows,{signal,refresh=false,onProgress=()=>{},concurrency=6,flush=true}={}){
 const verified=Array(rows.length),failures=[];let cursor=0,done=0,lastProgress=Date.now();
 await Promise.all(Array.from({length:Math.min(concurrency,rows.length)},async()=>{while(cursor<rows.length){check(signal);const index=cursor++,row=rows[index];
  if(row.localPDF||row.attachmentID)verified[index]=row;
  else for(const url of pdfCandidateURLs(row)){
   check(signal);const result=await E.verifyDiscoveryPDF?.(url,{signal,refresh});check(signal);
   if(result?.available){verified[index]={...row,pdf:url,pdfVerified:true,pdfVerifiedAt:result.checkedAt,pdfUnavailable:false};break;}
   failures.push({url,error:result?.error||'PDF 地址尚未验证'});
  }
  done++;if(done===rows.length||Date.now()-lastProgress>150){lastProgress=Date.now();onProgress({phase:'verify',done,total:rows.length,records:verified.filter(Boolean)});}
 }}));
 check(signal);if(flush)await E.flushDiscoveryPDFChecks?.();return {records:verified.filter(Boolean),failures};
}
