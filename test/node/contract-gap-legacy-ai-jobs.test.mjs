/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const root=new URL('../../chrome/content/zotero/',import.meta.url);
const source=path=>readFile(new URL(path,root),'utf8');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let i=0;i<100;i++){if(check())return;await turn();}throw Error('condition not reached');}
const settle=promise=>promise.then(value=>({value}),error=>({error:error.message}));

// The real xpcom/research/ai.js with stub policy, model and fetch. No network.
async function engine({store}={}){
 const E={assertPaperInstructions:skill=>skill,getPaperSkill:()=>({id:'skill',title:'Skill',version:1}),paperSystemPrompt:()=>'system',core:{endpoint:value=>value,paperKey:paper=>'paper-'+paper.id,resultMarkdown:record=>record.prompt,validateResult:()=>({sections:[],questions:[],keywords:[]})}};
 const timers=[];E.setTimeout=(fn,delay)=>{timers.push({fn,delay,cleared:false});return timers.length;};E.clearTimeout=id=>{if(timers[id-1])timers[id-1].cleared=true;};
 const modules={'research-ai-policy':{assertAIAction(){},assertResearchPrompt(){}},'chat-completion':{chatRequiresStreaming:()=>false,readChatCompletion:async()=>({text:'{}',finishReason:'stop'})},'academic-evidence':{academicExcerpts:()=>[],bindAcademicQuotes:raw=>raw}};
 vm.runInNewContext(await source('xpcom/research/ai.js'),{EasySch:E,URL,ChromeUtils:{importESModule:url=>modules[url.split('/').at(-1).replace('.mjs','')]}});
 const requests=[],state={papers:{}};let hold=true,controllers=0;
 const fetch=(url,options)=>{const request={body:JSON.parse(options.body),signal:options.signal};requests.push(request);if(!hold)return Promise.resolve({ok:true,status:200});return new Promise((resolve,reject)=>{request.resolve=()=>resolve({ok:true,status:200});options.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})),{once:true});});};
 const ai=E.createAI({fetch,controller:()=>{controllers++;return new AbortController();},settings:()=>({endpoint:'https://model.invalid/v1',model:'stub-model'}),credential:async()=>'',store:store||{get:(...path)=>structuredClone(path.reduce((value,key)=>value?.[key],state)),update:async fn=>fn(state)},collect:async()=>({sources:[{id:'S1',label:'选段',text:'selected words'}],warnings:[]})});
 return {ai,state,requests,timers,release:()=>{hold=false;},get controllers(){return controllers;}};
}
async function realStore(){const E={};vm.runInNewContext(await source('xpcom/research/storage.js'),{EasySch:E});const store=E.createStore({read:async()=>({version:1,papers:{},projects:{},settings:{}}),write:async()=>{}});await store.init();return store;}

test('DC-04: stopping one legacy AI job leaves a job another page started running',async()=>{
 const f=await engine(),docx=new AbortController(),other=new AbortController();
 const first=settle(f.ai.run({mode:'selection_explain',papers:[{id:1}],selection:{text:'first'},signal:docx.signal}));await until(()=>f.requests.length===1);
 const second=settle(f.ai.run({mode:'selection_terms',papers:[{id:2}],selection:{text:'second'},signal:other.signal}));await until(()=>f.requests.length===2);
 assert.equal(f.controllers,2,'each job owns its own controller');
 other.abort();assert.match((await second).error,/已停止本次分析/);assert.equal(f.requests[0].signal.aborted,false,'the first page keeps its request');
 f.requests[0].resolve();const done=await first;assert.equal(done.error,undefined);assert.equal(done.value.mode,'selection_explain');
});

test('DC-04: the old app-wide cancel used by the workbench Stop cannot end a DOCX job',async()=>{
 const f=await engine(),docx=new AbortController();
 const job=settle(f.ai.run({mode:'selection_explain',papers:[{id:1}],selection:{text:'words'},signal:docx.signal}));await until(()=>f.requests.length===1);
 f.ai.cancel();await turn();assert.equal(f.requests[0].signal.aborted,false);
 docx.abort();assert.match((await job).error,/已停止本次分析/);assert.equal(Object.keys(f.state.papers).length,0,'nothing incomplete is saved');
});

test('DC-04: a caller that already stopped sends nothing, and a finished job detaches from its caller',async()=>{
 const f=await engine();f.release();
 const listeners=new Set(),signal={aborted:false,addEventListener:(type,fn)=>listeners.add(fn),removeEventListener:(type,fn)=>listeners.delete(fn)};
 await f.ai.run({mode:'selection_explain',papers:[{id:1}],selection:{text:'words'},signal});assert.equal(listeners.size,0);
 const stopped=new AbortController();stopped.abort();
 assert.match((await settle(f.ai.run({mode:'selection_explain',papers:[{id:1}],selection:{text:'words'},signal:stopped.signal}))).error,/已停止本次分析/);assert.equal(f.requests.length,1);
});

test('DC-04: the 120 s model limit is reported as a timeout, not as a cancel',async()=>{
 const f=await engine(),job=settle(f.ai.run({mode:'selection_explain',papers:[{id:1}],selection:{text:'words'}}));await until(()=>f.requests.length===1);
 const timer=f.timers.find(row=>row.delay===120000);assert.ok(timer);timer.fn();
 const result=await job;assert.match(result.error,/120 秒内未完成/);assert.doesNotMatch(result.error,/已停止/);assert.equal(timer.cleared,true);
});

test('DC-04: application shutdown stops every legacy job through cancelAll',async()=>{
 const f=await engine();
 const one=settle(f.ai.run({mode:'selection_explain',papers:[{id:1}],selection:{text:'a'}})),two=settle(f.ai.run({mode:'selection_terms',papers:[{id:2}],selection:{text:'b'},signal:new AbortController().signal}));await until(()=>f.requests.length===2);
 f.ai.cancelAll();assert.match((await one).error,/已停止本次分析/);assert.match((await two).error,/已停止本次分析/);
 const calls=[],E={store:{flush:async()=>{}},ai:{cancel:()=>calls.push('cancel'),cancelAll:()=>calls.push('cancelAll')}};
 vm.runInNewContext(await source('xpcom/research/app.js'),{EasySch:E,Zotero:{closing:true,Reader:{unregisterEventListener(){}}},Map,Set,Promise});
 await E.stop();assert.deepEqual(calls,['cancelAll']);
});

test('DC-04: meeting outline and questions forward their caller signal',async()=>{
 const sent=[],R={store:{get:()=>({m:{id:'m',title:'组会',paperIDs:[1],turns:[],tasks:[]}}),update:async()=>{}},library:{describe:item=>({id:item.id})},ai:{run:async options=>{sent.push(options.signal);return {result:{}};}}};
 vm.runInNewContext(await source('xpcom/research/meetings.js'),{Zotero:{Research:R,Items:{getAsync:async()=>[{id:1,isRegularItem:()=>true}]}}});
 const signal=new AbortController().signal;await R.meetings.outline('m',()=>{},signal);await R.meetings.ask('m','',()=>{},signal);
 assert.equal(sent.length,2);assert.ok(sent.every(value=>value===signal));
});

test('DC-04: the research view 取消 stops only the job that view started',async()=>{
 const text=await source('research/ui/main.js'),context={window:{addEventListener(){}},document:{},AbortController};vm.runInNewContext(text,context);
 const ui=context.EasySchUI,signal=ui.legacyJobSignal();ui.cancelLegacyJob();assert.equal(signal.aborted,true);assert.equal(ui.legacyJobSignal().aborted,false);
 assert.doesNotMatch(text,/\.ai\??\.cancel\(/,'no app-wide legacy cancel from this page');
});

test('DC-01: every saved legacy analysis is kept; only the prompt memory is limited to the last three',async()=>{
 const store=await realStore(),f=await engine({store});f.release();const ids=[];
 for(let i=0;i<31;i++)ids.push((await f.ai.run({mode:'analyze',papers:[{id:7}],prompt:'问题 '+i})).id);
 const kept=store.get('papers','paper-7','records').map(row=>row.id);assert.equal(kept.length,31);assert.equal(kept[0],ids[0]);assert.equal(kept.at(-1),ids[30]);
 const memory=JSON.parse(f.requests.at(-1).body.messages[1].content).memory[0].previousAnalysis.map(row=>row.question);assert.deepEqual(memory,['问题 27','问题 28','问题 29']);
});
