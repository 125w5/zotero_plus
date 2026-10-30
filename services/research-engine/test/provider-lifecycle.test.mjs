/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as providerErrors from '../../../chrome/content/zotero/research/shared/provider-error.mjs';

const source=await readFile(new URL('../../../chrome/content/zotero/xpcom/research/providers.js',import.meta.url),'utf8');
const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

function setup(fetch,{applicationTimers=true}={}){
 const activeTimers=new Map(),timerStarts=[],timerClears=[],controllers=[],requests=[];
 let nextTimer=0,now=0,uiReads=0,hiddenReads=0,moduleImports=0,sandboxCreates=0;
 const timers={setTimeout(callback,delay){const id=nextTimer++;timerStarts.push(id);activeTimers.set(id,{at:now+delay,callback});return id;},clearTimeout(id){timerClears.push(id);activeTimers.delete(id);}};
 const win={AbortController:class extends AbortController{constructor(){super();controllers.push(this);}},fetch(url,options){requests.push({url,options,owner:this});return fetch(url,options);}};
 const E=applicationTimers?{...timers}:{};
 const Zotero={Research:E,getMainWindow(){uiReads++;throw Error('已关闭的调用窗口不得用于后台网络');}};
 const principal={type:'controlled-system-principal'};
 const Services={scriptSecurityManager:{getSystemPrincipal:()=>principal},appShell:{get hiddenDOMWindow(){hiddenReads++;throw Error('Windows Zotero 不提供 hiddenDOMWindow');}}};
 const Cu={Sandbox:function(owner,options){sandboxCreates++;assert.equal(owner,principal);assert.equal(options.sandboxName,'EasySch background provider transport');assert.deepEqual([...options.wantGlobalProperties],['fetch','AbortController']);return win;}};
 vm.runInNewContext(source,{Zotero,Services,Cu,ChromeUtils:{importESModule(path){moduleImports++;if(path==='chrome://zotero/content/research/shared/provider-error.mjs')return providerErrors;assert.equal(path,'resource://gre/modules/Timer.sys.mjs');return timers;}}});
 const external=()=>{
  let aborted=false;const listeners=new Map(),adds=[],removes=[];
  const signal={get aborted(){return aborted;},addEventListener(name,fn,options){assert.equal(name,'abort');adds.push(fn);listeners.set(fn,options);},removeEventListener(name,fn){assert.equal(name,'abort');removes.push(fn);listeners.delete(fn);}};
  return {signal,adds,removes,listeners,abort(){if(aborted)return;aborted=true;for(const [fn,options] of [...listeners]){if(options?.once)listeners.delete(fn);fn();}}};
 };
 return {E,win,requests,controllers,activeTimers,timerStarts,timerClears,external,get sandboxCreates(){return sandboxCreates;},get uiReads(){return uiReads;},get moduleImports(){return moduleImports;},advance(ms){now+=ms;for(const [id,timer] of [...activeTimers])if(timer.at<=now){activeTimers.delete(id);timer.callback();}},assertClean(signal){assert.equal(activeTimers.size,0,'请求结束后无遗留应用计时器');assert.deepEqual([...timerClears].sort(),[...timerStarts].sort(),'包括编号 0 在内的计时器均清理');if(signal){assert.equal(signal.listeners.size,0,'外部取消监听不遗留');assert.deepEqual(signal.removes,signal.adds,'每个外部监听均解除');}assert.equal(uiReads,0,'不依赖调用者的 UI 窗口');assert.equal(hiddenReads,0,'Windows 不可用的 hiddenDOMWindow 不能被访问');}};
}

async function settledBeforeNextTurn(task){
 const pending=Symbol('pending');
 const result=await Promise.race([task.then(value=>({value}),error=>({error})),nextTurn().then(()=>pending)]);
 assert.notEqual(result,pending,'取消必须直接结束等待，不能等待停滞的 fetch 或 reader');
 return result;
}
function assertStopped(error,name){assert.equal(error?.name,name);assert.equal(error?.message,name==='AbortError'?'服务请求已取消':'服务请求超时，请重试');}

test('uses a stable system-principal sandbox, reads UTF-8 text and cleans its application timer',async()=>{
 const h=setup(async()=>new Response('已确认的中文正文：H₂O、x²')),cancel=h.external();
 const options={method:'POST',body:'原始请求',signal:cancel.signal,redirect:'follow'};
 assert.equal(await h.E.requestProvider('https://controlled.invalid/utf8',options,50),'已确认的中文正文：H₂O、x²');
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].owner,h.win);assert.equal(h.requests[0].options.signal,h.controllers[0].signal);
 assert.equal(h.requests[0].options.redirect,'error');assert.equal(options.redirect,'follow','不得修改调用方 options');
 assert.equal(options.signal,cancel.signal);h.assertClean(cancel);
});

test('custom streaming readResponse consumes actual UTF-8 chunks without corrupting symbols',async()=>{
 const bytes=new TextEncoder().encode('中文公式：σₘᵢₙ(J)>0，x′∈R²。');
 const body=new ReadableStream({start(controller){controller.enqueue(bytes.slice(0,4));controller.enqueue(bytes.slice(4,11));controller.enqueue(bytes.slice(11));controller.close();}});
 const h=setup(async()=>new Response(body)),cancel=h.external();let readCalls=0;
 const result=await h.E.requestProvider('https://controlled.invalid/stream',{signal:cancel.signal},50,async response=>{
  readCalls++;const reader=response.body.getReader(),decoder=new TextDecoder();let text='';
  try{while(true){const {value,done}=await reader.read();if(done)break;text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}finally{reader.releaseLock();}
 });
 assert.equal(result,'中文公式：σₘᵢₙ(J)>0，x′∈R²。');assert.equal(readCalls,1);h.assertClean(cancel);
});

test('non-success HTTP responses retain the stage error and never invoke a body reader',async()=>{
 const h=setup(async()=>new Response('not an answer',{status:429})),cancel=h.external();let reads=0;
 await assert.rejects(h.E.requestProvider('https://controlled.invalid/http',{signal:cancel.signal},50,()=>{reads++;}),{message:'服务返回 HTTP 429'});
 assert.equal(reads,0);h.assertClean(cancel);
});
test('an unsupported chat parameter yields actionable HTTP 400 diagnostics without provider prose',async()=>{
 const sensitive='sk-controlled-secret-must-never-appear';
 const h=setup(async()=>new Response(JSON.stringify({error:{code:'unsupported_parameter',param:'max_tokens',message:'Unsupported parameter max_tokens. Echoed '+sensitive+' at https://private.invalid'}}),{status:400})),cancel=h.external();
 const result=await h.E.requestProvider('https://controlled.invalid/http',{signal:cancel.signal},50).then(()=>null,error=>error);
 assert.equal(result.message,'服务返回 HTTP 400：接口不支持参数 max_tokens，请换用兼容的模型或接口');assert.equal(result.providerCode,'unsupported_parameter');assert.equal(result.providerParam,'max_tokens');assert.ok(!JSON.stringify(result).includes(sensitive));assert.ok(!result.message.includes('private.invalid'));h.assertClean(cancel);
});
test('provider errors with unknown payload details retain only HTTP status',async()=>{
 const h=setup(async()=>new Response(JSON.stringify({error:{code:'custom-private-error',message:'https://private.invalid sk-controlled-secret'}}),{status:400}));
 await assert.rejects(h.E.requestProvider('https://controlled.invalid/http',{},50),{message:'服务返回 HTTP 400'});h.assertClean();
});

test('transport failures are sanitized and clean timers and listeners',async()=>{
 const h=setup(async()=>{throw Error('internal transport detail must not appear in UI');}),cancel=h.external();
 await assert.rejects(h.E.requestProvider('https://controlled.invalid/fail',{signal:cancel.signal},50),{message:'无法连接服务，请检查网络或代理'});
 h.assertClean(cancel);
});
test('a connected service with an invalid response is not misreported as network or proxy failure',async()=>{
 const h=setup(async()=>new Response('connected')),cancel=h.external();
 const error=await h.E.requestProvider('https://controlled.invalid/parse',{signal:cancel.signal},50,()=>{throw TypeError('private response payload sk-controlled-secret');}).then(()=>null,error=>error);
 assert.equal(error.name,'ProviderResponseError');assert.equal(error.message,'服务已连接，但返回内容无法读取，请重试');assert.ok(!error.message.includes('sk-controlled'));h.assertClean(cancel);
});

test('external cancellation settles while response headers ignore abort',async()=>{
 const headers=deferred(),h=setup(()=>headers.promise),cancel=h.external();
 const task=h.E.requestProvider('https://controlled.invalid/held-headers',{signal:cancel.signal},50);assert.equal(h.requests.length,1);
 cancel.abort();const result=await settledBeforeNextTurn(task);assertStopped(result.error,'AbortError');assert.equal(h.controllers[0].signal.aborted,true);h.assertClean(cancel);
 // The race must also observe a transport rejection arriving after cancellation.
 headers.reject(Error('late network rejection'));await nextTurn();h.assertClean(cancel);
});

test('external cancellation settles while the default response.text reader stalls',async()=>{
 const body=deferred(),entered=deferred(),h=setup(async()=>({ok:true,text(){entered.resolve();return body.promise;}})),cancel=h.external();
 const task=h.E.requestProvider('https://controlled.invalid/held-text',{signal:cancel.signal},50);await entered.promise;
 cancel.abort();assertStopped((await settledBeforeNextTurn(task)).error,'AbortError');h.assertClean(cancel);
 body.resolve('过期译文不得重新变成成功结果');await nextTurn();h.assertClean(cancel);
});

test('external cancellation settles while a custom streaming reader awaits a stalled chunk',async()=>{
 const chunk=deferred(),entered=deferred(),h=setup(async()=>({ok:true})),cancel=h.external();
 const task=h.E.requestProvider('https://controlled.invalid/held-stream',{signal:cancel.signal},50,async()=>{entered.resolve();await chunk.promise;return 'late stream result';});
 await entered.promise;cancel.abort();assertStopped((await settledBeforeNextTurn(task)).error,'AbortError');h.assertClean(cancel);
 chunk.reject(Error('模型流式响应在取消后断开'));await nextTurn();h.assertClean(cancel);
});

test('an already aborted external signal never starts fetch or a timeout',async()=>{
 const h=setup(async()=>{throw Error('must not fetch');}),cancel=h.external();cancel.abort();
 assertStopped((await settledBeforeNextTurn(h.E.requestProvider('https://controlled.invalid/pre-aborted',{signal:cancel.signal},50))).error,'AbortError');
 assert.equal(h.requests.length,0);assert.equal(h.timerStarts.length,0);h.assertClean(cancel);
});

test('headers timeout is distinct from external cancellation and aborts the transport',async()=>{
 const headers=deferred(),h=setup(()=>headers.promise),cancel=h.external();
 const task=h.E.requestProvider('https://controlled.invalid/header-timeout',{signal:cancel.signal},50);h.advance(50);
 assertStopped((await settledBeforeNextTurn(task)).error,'TimeoutError');assert.equal(h.controllers[0].signal.aborted,true);h.assertClean(cancel);
 cancel.abort();headers.resolve(new Response('late headers'));await nextTurn();h.assertClean(cancel);
});

test('a custom response reader timeout settles without waiting for its reader',async()=>{
 const body=deferred(),entered=deferred(),h=setup(async()=>({ok:true})),cancel=h.external();
 const task=h.E.requestProvider('https://controlled.invalid/reader-timeout',{signal:cancel.signal},50,async()=>{entered.resolve();return await body.promise;});
 await entered.promise;h.advance(50);assertStopped((await settledBeforeNextTurn(task)).error,'TimeoutError');h.assertClean(cancel);
 body.resolve('late reader result');await nextTurn();h.assertClean(cancel);
});

test('the first cancellation reason wins and later deadlines cannot become timeout errors',async()=>{
 const headers=deferred(),h=setup(()=>headers.promise),cancel=h.external();
 const task=h.E.requestProvider('https://controlled.invalid/cancel-first',{signal:cancel.signal},50);cancel.abort();h.advance(50);
 assertStopped((await settledBeforeNextTurn(task)).error,'AbortError');h.assertClean(cancel);
 headers.resolve(new Response('late response'));await nextTurn();h.assertClean(cancel);
});

test('the application timer module fallback also outlives a destroyed caller UI window',async()=>{
 const h=setup(async()=>new Response('独立于已关闭窗口的结果'),{applicationTimers:false});
 assert.equal(await h.E.requestProvider('https://controlled.invalid/no-caller',{},50),'独立于已关闭窗口的结果');
 assert.equal(h.moduleImports,1);assert.equal(h.requests[0].owner,h.win);h.assertClean();
});

test('reuses one persistent application sandbox while isolating concurrent request cancellation',async()=>{
 const held=deferred(),h=setup(url=>url.endsWith('/held')?held.promise:Promise.resolve(new Response('另一请求正常完成'))),cancel=h.external();
 const first=h.E.requestProvider('https://controlled.invalid/held',{signal:cancel.signal},50),outcome=first.then(value=>({value}),error=>({error}));
 assert.equal(await h.E.requestProvider('https://controlled.invalid/other',{},50),'另一请求正常完成');
 cancel.abort();assertStopped((await outcome).error,'AbortError');assert.equal(h.sandboxCreates,1,'所有请求共享应用 transport，不创建新窗口');
 assert.equal(h.controllers[0].signal.aborted,true);assert.equal(h.controllers[1].signal.aborted,false,'一处取消不能中断另一个请求');
 held.resolve(new Response('迟到回复'));await nextTurn();h.assertClean(cancel);
});
