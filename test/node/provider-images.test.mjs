/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import * as Images from '../../chrome/content/zotero/research/shared/image-generation.mjs';
import * as Policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
const source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/providers.js',import.meta.url),'utf8');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WL6fB8AAAAASUVORK5CYII=';
function fixture(){
 const settings={endpoint:'https://chat.example/v1',model:'gpt-6-luna',imageEndpoint:'https://images.example/v1'},keys=new Map([['https://chat.example/v1','sk-'+'fixture-provider-credential-not-a-real-key-1'],['https://images.example/v1/images','sk-'+'fixture-provider-credential-not-a-real-key-2']]),calls=[],files=new Map(),lifecycle=[];
 const E={settings:()=>({...settings}),core:{endpoint:value=>{const url=new URL(value);if(url.hostname==='openai.goldgom.top'&&url.pathname==='/')url.pathname='/v1';return url.href.replace(/\/$/,'');}},credentials:{get:async scope=>keys.get(scope)||'',set:async(scope,key)=>keys.set(scope,key)},store:{update:async fn=>fn({settings})},importWritingImage:async(file,{signal})=>{assert.equal(signal.aborted,false);assert.ok(files.has(file));return {path:'/library/image.png',fingerprint:'controlled-image-hash',width:1,height:1,finishImport:()=>lifecycle.push('finished'),rollbackImport:async()=>lifecycle.push('rollback')};}};
 const IOUtils={write:async(file,bytes)=>files.set(file,bytes),remove:async file=>files.delete(file)};
 vm.runInNewContext(source,{Zotero:{Research:E,getMainWindow:()=>({AbortController}),getTempDirectory:()=>({path:'/tmp'}),Utilities:{randomString:()=> 'controlled-only'}},URL,PathUtils:{join:path.join},IOUtils,ChromeUtils:{importESModule:uri=>uri.endsWith('/image-generation.mjs')?Images:{}},Cu:{Sandbox:()=>({AbortController})},Services:{scriptSecurityManager:{getSystemPrincipal(){}}}});
 E.requestProvider=async(url,options)=>{calls.push({url,options});return JSON.stringify(url.endsWith('/models')?{data:[{id:'gpt-6-luna'},{id:'gpt-image-1'}]}:{data:[{b64_json:png}]});};
 return {E,settings,keys,calls,files,lifecycle};
}
test('translation credentials use separate services and never replace the research chat model',async()=>{
 const {E,settings,keys}=fixture();const endpoint=settings.endpoint;
 await E.configureProviders({deepseek:'controlled-deepseek-credential',azure:{region:'eastasia',key:'controlled-azure-credential'}});
 assert.equal(settings.endpoint,endpoint);assert.equal(settings.model,'gpt-6-luna');assert.equal(settings.translationModel,'deepseek-flash');assert.equal(settings.azureTranslatorRegion,'eastasia');
 assert.equal(keys.get('https://api.cognitive.microsofttranslator.com'),'controlled-azure-credential');assert.equal(JSON.stringify(settings).includes('credential'),false);
 await assert.rejects(E.configureProviders({azure:{region:'invalid / region',key:'bad'}}),/资源区域/);
});

test('Azure uses the documented text API with protected math and a cancellable request',async()=>{
 const {E,settings,keys}=fixture();settings.azureTranslatorRegion='eastasia';keys.set('https://api.cognitive.microsofttranslator.com','controlled-azure-credential');let request;
 E.requestProvider=async(url,options,timeout)=>{request={url,options,timeout};return JSON.stringify([{translations:[{to:'zh-Hans',text:'阈值 <span class="notranslate">$x&gt;0$</span> 与 ZXQMATH0ZXQ 保持不变。'}]}]);};
 const controller=new AbortController(),result=await E.translateAzure('Threshold $x>0$ and ZXQMATH0ZXQ remain.',undefined,{signal:controller.signal});
 assert.equal(result.text,'阈值 $x>0$ 与 ZXQMATH0ZXQ 保持不变。');assert.match(request.url,/api-version=3.0&textType=html&to=zh-Hans/);assert.equal(request.options.signal,controller.signal);assert.equal(request.options.headers['Ocp-Apim-Subscription-Region'],'eastasia');assert.match(JSON.parse(request.options.body)[0].Text,/<span class="notranslate">\$x&gt;0\$<\/span>/);
 controller.abort();await assert.rejects(E.translateAzure('Cancelled',undefined,{signal:controller.signal}),/取消/);
});

test('Azure rejects replies which lose native formula identity',async()=>{
 const {E,settings,keys}=fixture();settings.azureTranslatorRegion='eastasia';keys.set('https://api.cognitive.microsofttranslator.com','controlled-azure-credential');E.requestProvider=async()=>JSON.stringify([{translations:[{to:'zh-Hans',text:'错误译文'}]}]);
 await assert.rejects(E.translateAzure('Native ZXQMATH0ZXQ formula.'),/公式位置/);
});

test('TokenNest image import uses its own credential realm and model-only Luna selection preserves the chat credential',async()=>{
 const {E,settings,keys}=fixture(),chat=keys.get(settings.endpoint);
 await E.configureProviders({ai:{endpoint:settings.endpoint,model:'gpt6luna'},image:{_type:'tokennest_channel_conn',url:'https://openai.goldgom.top',key:'sk-'+'fixture-provider-credential-not-a-real-key-3'}});
 assert.equal(settings.model,'gpt-6-luna');assert.equal(keys.get(settings.endpoint),chat);
 assert.equal(settings.imageEndpoint,'https://openai.goldgom.top/v1');assert.equal(keys.get(settings.imageEndpoint+'/images'),'sk-'+'fixture-provider-credential-not-a-real-key-3');
 assert.equal(Object.values(settings).includes('sk-'+'fixture-provider-credential-not-a-real-key-3'),false);
});
test('image discovery filters chat models, generation sends one paid request and stores validated local bytes',async()=>{
 const {E,calls,files,lifecycle}=fixture();const result=await E.generateResearchImage('一张说明数据处理阶段的构想图',{signal:new AbortController().signal});
 assert.equal(result.model,'gpt-image-1');assert.equal(result.path,'/library/image.png');assert.deepEqual(lifecycle,['finished']);assert.equal(files.size,0);
 assert.equal(calls.length,2);assert.match(calls[0].url,/\/models$/);assert.match(calls[1].url,/\/images\/generations$/);
 const body=JSON.parse(calls[1].options.body);assert.equal(body.model,'gpt-image-1');assert.equal(body.n,1);assert.equal(body.response_format,undefined);assert.equal(body.prompt,'一张说明数据处理阶段的构想图');
 assert.equal(calls[1].options.headers.Authorization,'Bearer sk-'+'fixture-provider-credential-not-a-real-key-2');
 assert.equal(JSON.stringify(result).includes('sk-controlled'),false);
 await E.imageModels();assert.equal(calls.length,2,'catalog reused without another request');
});
test('missing/retired configured models cannot silently trigger a different paid image model',async()=>{
 const {E,settings,calls}=fixture();settings.imageModel='retired-model';
 await assert.rejects(E.generateResearchImage('说明图',{signal:new AbortController().signal}),/不在接口提供/);assert.equal(calls.length,1);
 assert.throws(()=>Images.selectImageModel([],''),/没有列出生图模型/);
 assert.deepEqual(Images.imageModelsFromCatalog({data:[{id:'gpt-6-luna'},{id:'gpt-image-1'},{id:'gpt-image-1'},null]}),['gpt-image-1']);
});
test('the configured TokenNest catalog variants are submitted verbatim instead of a guessed base model',async()=>{
 const {E,calls}=fixture(),request=E.requestProvider;
 E.requestProvider=async(url,options)=>url.endsWith('/models')?JSON.stringify({data:[{id:'gpt-image-2.5-flare'},{id:'gpt-image-2.5-sunburst'}]}):request(url,options);
 const result=await E.generateResearchImage('构想示意图');assert.equal(result.model,'gpt-image-2.5-flare');assert.equal(JSON.parse(calls[0].options.body).model,'gpt-image-2.5-flare');
});
test('a provider without model discovery retains an explicitly configured image model',async()=>{
 const {E,settings,calls}=fixture();settings.imageModel='gpt-image-1';const request=E.requestProvider;
 E.requestProvider=async(url,options)=>{if(url.endsWith('/models'))throw Error('not available');return request(url,options);};
 await E.generateResearchImage('说明图',{signal:new AbortController().signal});assert.equal(calls.length,1);assert.match(calls[0].url,/images\/generations$/);
});
test('cancel and invalid descriptions stop before credentials/network; invalid image bytes never reach import',async()=>{
 const {E,calls,files}=fixture(),controller=new AbortController();controller.abort();
 await assert.rejects(E.generateResearchImage('说明图',{signal:controller.signal}),/已取消/);await assert.rejects(E.generateResearchImage('  '),/请描述/);assert.equal(calls.length,0);
 E.requestProvider=async url=>JSON.stringify(url.endsWith('/models')?{data:[{id:'gpt-image-1'}]}:{data:[{b64_json:Buffer.from('<html>bad reply</html>').toString('base64')}]});
 E.importWritingImage=async()=>assert.fail('invalid bytes must not be imported');await assert.rejects(E.generateResearchImage('说明图',{signal:new AbortController().signal}),/不是可读取/);assert.equal(files.size,0);
});
test('a failed long-term image import clears temporary bytes and never reports a saved result',async()=>{
 const {E,files}=fixture();E.importWritingImage=async()=>{throw Error('disk full');};await assert.rejects(E.generateResearchImage('说明图',{signal:new AbortController().signal}),/disk full/);assert.equal(files.size,0);
});
test('explicit image tool permission does not enable authorship or automatic image calls from evidence',()=>{
 assert.equal(Policy.assertAIAction('image_generate'),'image_generate');assert.throws(()=>Policy.assertAIAction('manuscript_write'),/AI 不代写/);
 assert.throws(()=>Policy.assertResearchPrompt('生成图片'),/AI 不生成/);assert.equal(Policy.assertResearchPrompt('生成图片',{allowImageGeneration:true}),'生成图片');assert.throws(()=>Policy.assertResearchPrompt('帮我写论文',{allowImageGeneration:true}),/AI 不代写/);
});
