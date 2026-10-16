/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {providerHTTPError,providerResponseError,safeProviderError} from '../../../chrome/content/zotero/research/shared/provider-error.mjs';
test('classifies compatible API failures without displaying echoed data',()=>{
 const cases=[
  [{error:{code:'unsupported_parameter',param:'max_tokens'}},'接口不支持参数 max_tokens'],
  [{error:{message:"Unsupported parameter: 'max_completion_tokens'"}},'接口不支持参数 max_completion_tokens'],
  [{error:{code:'unsupported_value',param:'reasoning_effort'}},'参数 reasoning_effort 不符合接口要求'],
  [{error:{code:'invalid_parameter',param:'tool_choice.function.name'}},'参数 tool_choice 不符合接口要求'],
  [{error:{code:'invalid_value',param:'messages[2].content'}},'参数 messages 不符合接口要求'],
  [{error:{code:'context_length_exceeded'}},'超出模型上下文'],
  [{error:{code:'model_not_found'}},'当前配置的模型不可用'],
  [{error:{code:'invalid_json_schema'}},'应用工具的参数格式'],
  [{error:{message:'tool_call messages must be followed by tool response'}},'对话或工具消息格式'],
 ];
 for(const [body,text]of cases){body.error.message=(body.error.message||'')+' private prompt sk-test-secret https://private.invalid';const error=providerHTTPError(400,body);assert.ok(error.message.includes(text));assert.equal(safeProviderError(error),error.message);assert.ok(!error.message.includes('private'));assert.ok(!JSON.stringify(error).includes('sk-test'));}
});
test('rejects forged diagnostic text and ignores unknown parameters',()=>{
 const error=providerHTTPError(400,{error:{code:'unsupported_parameter',param:'sk-private-value',message:'secret unknown option'}});assert.equal(error.message,'服务返回 HTTP 400');error.message='服务返回 HTTP 400：sk-leak';assert.equal(safeProviderError(error),null);
 assert.equal(safeProviderError(Error('服务返回 HTTP 429')),'服务返回 HTTP 429');assert.equal(safeProviderError(Error('raw https://private.invalid')),null);
 assert.equal(providerHTTPError(400,{error:{code:'unsupported_parameter',param:'sk-private-value.tools'}}).message,'服务返回 HTTP 400');
});
test('stops reading a large HTTP failure after a small byte budget',async()=>{
 let reads=0,cancelled=0,released=0;
 const response={status:400,body:{getReader(){return {async read(){reads++;return {value:new Uint8Array(8192).fill(65),done:false};},async cancel(){cancelled++;},releaseLock(){released++;}};}}};
 assert.equal((await providerResponseError(response)).message,'服务返回 HTTP 400');assert.equal(reads,2);assert.equal(cancelled,1);assert.equal(released,1);
});

test('retains the exact local transport stage but rejects arbitrary text with a trusted error name', () => {
 for (const [name,message] of [['ProviderTransportError','无法连接服务，请检查网络或代理'],['ProviderResponseError','服务已连接，但返回内容无法读取，请重试'],['TimeoutError','服务请求超时，请重试']]) {
  assert.equal(safeProviderError(Object.assign(new Error(message),{name})),message);
  assert.equal(safeProviderError(Object.assign(new Error(message+' private key and response'),{name})),null);
 }
 assert.equal(safeProviderError(Error('服务已连接，但返回内容无法读取，请重试')),null);
});
