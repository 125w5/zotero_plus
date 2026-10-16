/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Covers preparation as well as transport. A stalled credential, signer or
// response reader must settle without waiting for it to honour cancellation.
export async function requestWithinDeadline(work,{signal,timeout=30000,AbortController:Controller=globalThis.AbortController,setTimeout:later=globalThis.setTimeout,clearTimeout:clear=globalThis.clearTimeout}={}){
 const controller=new Controller();let reason,timer,rejectStopped;
 const stopped=new Promise((_,reject)=>{rejectStopped=reject;});
 const stopError=()=>Object.assign(new Error(reason==='cancel'?'请求已取消':'请求超时，请重试'),{name:reason==='cancel'?'AbortError':'TimeoutError'});
 const stop=cause=>{if(reason)return;reason=cause;if(timer!==undefined){clear(timer);timer=undefined;}controller.abort();rejectStopped(stopError());};
 const abort=()=>stop('cancel');signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 if(!reason)timer=later(()=>stop('timeout'),Math.max(1,Number(timeout)||30000));
 try{
  const running=(async()=>{if(reason)throw stopError();return work(controller.signal);})();
  const result=await Promise.race([running,stopped]);if(reason)throw stopError();return result;
 }finally{if(timer!==undefined)clear(timer);signal?.removeEventListener('abort',abort);}
}
