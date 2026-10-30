/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Chat from '../../chrome/content/zotero/research/shared/chat-completion.mjs';
const root=new URL('../../chrome/content/zotero/xpcom/research/',import.meta.url);
const [models,studio]=await Promise.all(['model-service.js','ppt-studio-ai.js'].map(name=>readFile(new URL(name,root),'utf8')));
function fixture(){
 const settings={endpoint:'https://openai.goldgom.top/v1',model:'gpt-6-luna'},requests=[],writes=[];
 const E={settings:()=>({...settings}),core:{endpoint:value=>value},credentials:{get:async()=> 'fixture-only'},studio:{model:{}},assets:{key:JSON.stringify},store:{update:async fn=>fn({settings})},aiProgress:(_,stage)=>stage,setTimeout,clearTimeout,
  runArtifactEngine:async input=>{if(input.operation==='assets-cache-get')return {miss:true};writes.push(input);return {};},
  requestProvider:async(_url,options,_timeout,read)=>{requests.push(JSON.parse(options.body));return read({body:new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:'{"text":"controlled"}'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'));controller.close();}})});}
 };
 const context={Zotero:{Research:E,getMainWindow:()=>({AbortController})},URL,ChromeUtils:{importESModule:url=>url.endsWith('/research-ai-policy.mjs')?Policy:Chat}};
 vm.runInNewContext(models,context);vm.runInNewContext(studio,context);return {E,settings,requests,writes};
}
test('plan defaults to Sol/high and final writing to Sol/high without rewriting provider settings',async()=>{
 const f=fixture();await f.E.studio.request('Return JSON',{idea:'研究模型对独立批次的泛化能力'},()=>{},undefined,{modelPurpose:'plan'});
 await f.E.studio.request('Return JSON',{instruction:'精炼已经提供的段落'},()=>{},undefined,{aiAction:'manuscript_preview'});
 assert.equal(f.requests[0].model,'gpt-6.1-sol');assert.equal(f.requests[0].reasoning_effort,'high');
 assert.equal(f.requests[1].model,'gpt-6.1-sol');assert.equal(f.requests[1].reasoning_effort,'high');
 assert.equal(f.settings.model,'gpt-6-luna');assert.equal(f.writes[1].value.thinkingLevel,'high');
});
test('explicit Luna/off and Sol/high choices survive task routing exactly',async()=>{
 const f=fixture();for(const [model,thinkingLevel]of [['gpt-6-luna','off'],['gpt-6.1-sol','high']])await f.E.studio.request('Return JSON',{},()=>{},undefined,{modelPurpose:'plan',modelConfig:{...f.settings,model,thinkingLevel,selectedModel:true}});
 assert.equal(f.requests[0].model,'gpt-6-luna');assert.equal(f.requests[0].reasoning_effort,undefined);assert.equal(f.requests[1].model,'gpt-6.1-sol');assert.equal(f.requests[1].reasoning_effort,'high');
});
test('ordinary image and low cost translation requests keep their configured model and reasoning',async()=>{
 const f=fixture();await f.E.studio.request('Return JSON',{task:'说明原图'},()=>{},undefined,{images:['data:image/png;base64,fixture']});
 assert.equal(f.requests[0].model,'gpt-6-luna');assert.equal(f.requests[0].reasoning_effort,undefined);
 const translated=await f.E.resolveModel({endpoint:'https://custom.example/v1',model:'deepseek-flash',thinkingLevel:'off'},{purpose:'default'});assert.equal(translated.model,'deepseek-flash');assert.equal(translated.thinkingLevel,'off');
});
test('custom research providers are preserved and configured higher reasoning is not downgraded',async()=>{
 const f=fixture(),config=await f.E.resolveModel({endpoint:'https://custom.example/v1',model:'research-pro',thinkingLevel:'xhigh',reasoningParameter:'reasoning_effort'},{purpose:'plan'});
 assert.equal(config.model,'research-pro');assert.equal(config.thinkingLevel,'xhigh');assert.equal(config.reasoningParameter,'reasoning_effort');
});
