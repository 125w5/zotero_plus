/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Safe diagnostic helpers from the native probe; controlled exceptions only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as Errors from '../../../chrome/content/zotero/research/shared/provider-error.mjs';

const source = await readFile(new URL('../../../test/tests/researchProviderProbeTest.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(0, source.indexOf('\ndescribe(')), context);
const plain = value => JSON.parse(JSON.stringify(value));

test('probe records only known error stages and trusted bundled frame filenames', () => {
 const sensitive = 'private-content sk-private-key https://private.invalid C:\\Users\\private';
 const error = Object.assign(new Error('服务已连接，但返回内容无法读取，请重试'), {name:'ProviderResponseError'});
 error.stack = 'privateFunction@chrome://zotero/content/xpcom/research/providers.js:39:44\n'+sensitive+'\nwrong@https://private.invalid/providers.js:2:4\nasync@resource://gre/modules/Timer.sys.mjs:88:2';
 const result = plain(context.researchProviderProbeFailure(error, Errors, 1));
 assert.equal(result.errorName,'ProviderResponseError'); assert.equal(result.message,error.message);
 assert.deepEqual(result.frames,[{file:'providers.js',line:39,column:44},{file:'Timer.sys.mjs',line:88,column:2}]);
 assert.equal(result.requestIndex,1); assert.doesNotMatch(JSON.stringify(result),/private|chrome:|resource:|https:|sk-/);
 const forged = Object.assign(new Error(sensitive), {name:sensitive,providerCode:sensitive,providerParam:sensitive,stack:sensitive});
 const rejected = plain(context.researchProviderProbeFailure(forged,Errors));
 assert.equal(rejected.errorName,'UnknownError'); assert.equal(rejected.code,''); assert.equal(rejected.param,''); assert.deepEqual(rejected.frames,[]);
 assert.doesNotMatch(JSON.stringify(rejected),/private|sk-/);
});

test('probe response metadata retains status and readable-body flags without raw headers or response content', () => {
 const body = {getReader(){throw Error('diagnostics must not read pixels or model prose');}};
 for (const [raw,expected] of [['text/event-stream; charset=utf-8','text/event-stream'],['application/json; charset=utf-8','application/json'],['text/html; private-secret-key','other']]) {
  const result = plain(context.researchProviderProbeResponse({status:200,headers:{get:() => raw},body,extra:'private-secret'}));
  assert.deepEqual(result,{status:200,contentType:expected,bodyPresent:true,bodyReadable:true}); assert.doesNotMatch(JSON.stringify(result),/private|secret|charset|html/);
 }
 assert.deepEqual(plain(context.researchProviderProbeResponse({status:200,headers:{get:()=>''}})),{status:200,contentType:'other',bodyPresent:false,bodyReadable:false});
 assert.deepEqual(plain(context.researchProviderProbeResponse({status:200,headers:{get:()=>''},body:{}})),{status:200,contentType:'other',bodyPresent:true,bodyReadable:false});
});

test('the original reader error preserves its local class and decoder line without private prose', () => {
 for (const name of ['TypeError','ReferenceError','SecurityError','EncodingError']) {
  const error = Object.assign(new Error('private response bytes sk-private-key https://private.invalid'), {name});
  error.stack = 'privateCallback@chrome://zotero/content/research/shared/pi-chat-transport.mjs:265:29\nhttps://private.invalid/reader:1:2';
  const result = plain(context.researchProviderProbeFailure(error,Errors,1));
  assert.equal(result.errorName,name); assert.deepEqual(result.frames,[{file:'pi-chat-transport.mjs',line:265,column:29}]);
  assert.equal(result.message,'请求未完成，安全阶段诊断已保留'); assert.doesNotMatch(JSON.stringify(result),/private|sk-|https:|chrome:|Callback/);
 }
});
