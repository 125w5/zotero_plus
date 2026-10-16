/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Defer the expensive snapshot until a quiet interval, with a bounded wait.
// A second edit during IO always gets its own subsequent snapshot.
export function createCoalescedSave({read,write,onState=()=>{},delay=350,maxWait=1500}) {
 let dirty=false,running=null,timer=null,wake=null,firstAt=0,disposed=false,urgent=false;
 const release=()=>{if(timer!==null)clearTimeout(timer);timer=null;const resolve=wake;wake=null;resolve?.();};
 const schedule=()=>{if(!wake)return;if(timer!==null)clearTimeout(timer);timer=setTimeout(release,Math.max(0,Math.min(delay,maxWait-(Date.now()-firstAt))));};
 async function drain(){
  try {
   while(dirty&&!disposed){
    await new Promise(resolve=>{wake=resolve;if(urgent)release();else schedule();});
    if(disposed)break;
    dirty=false;urgent=false;firstAt=0;const value=read();if(value===null)continue;
    onState('saving');await write(value);
   }
   if(!disposed)onState('saved');
  }catch(error){dirty=true;if(!disposed)onState('error',error);throw error;}
  finally{release();running=null;}
 }
 return {
  request({flush=false}={}){
   if(disposed)return Promise.resolve();
   dirty=true;urgent||=flush;if(!firstAt)firstAt=Date.now();onState('dirty');
   if(!running)running=drain();else schedule();
   if(flush)release();return running;
  },
  dispose(){disposed=true;dirty=false;release();},
  get pending(){return dirty||!!running;}
 };
}
