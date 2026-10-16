/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import * as deadline from '../../../chrome/content/zotero/research/shared/request-deadline.mjs';
const source=await readFile(new URL('../../../chrome/content/zotero/xpcom/research/providers.js',import.meta.url),'utf8');
const pause=()=>new Promise(resolve=>setImmediate(resolve));
const held=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function fixture({credential=async()=> 'controlled-signing-value',digest=webcrypto.subtle.digest.bind(webcrypto.subtle)}={}){
 const timers=new Map();let next=0,windowReads=0;const requests=[];
 const E={settings:()=>({youdaoAppID:'controlled-app'}),credentials:{get:credential},setTimeout:callback=>{const id=next++;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id)};
 const win={crypto:{subtle:{digest}},TextEncoder,URLSearchParams};
 vm.runInNewContext(source,{Zotero:{Research:E,Utilities:{randomString:()=> 'controlled-salt'},getMainWindow:()=>{windowReads++;return win;}},Cu:{Sandbox:function(){return {AbortController,fetch:()=>{throw Error('stubbed transport only');}};}},Services:{scriptSecurityManager:{getSystemPrincipal:()=>({})}},ChromeUtils:{importESModule:path=>{assert.equal(path,'chrome://zotero/content/research/shared/request-deadline.mjs');return deadline;}},Uint8Array});
 E.requestProvider=async(url,options,timeout)=>{requests.push({url,options,timeout});return JSON.stringify({errorCode:'0',translation:['机器译文 ZXQFORMULA1ZXQ']});};
 return {E,requests,timers,get windowReads(){return windowReads;},expire:()=>{for(const callback of [...timers.values()])callback();}};
}
test('a credential lookup is covered by the complete machine-translation deadline',async()=>{
 const credential=held(),f=fixture({credential:()=>credential.promise});const task=f.E.translateYoudao('Source','zh-CHS',{timeout:8});f.expire();await assert.rejects(task,{name:'TimeoutError'});assert.equal(f.timers.size,0);assert.equal(f.requests.length,0);credential.resolve('late signing value');await pause();assert.equal(f.windowReads,0);assert.equal(f.requests.length,0);
});
test('cancellation settles before a credential lookup or signer honours it',async()=>{
 const signer=held(),f=fixture({digest:()=>signer.promise}),controller=new AbortController();const task=f.E.translateYoudao('Source','zh-CHS',{signal:controller.signal});await pause();controller.abort();await assert.rejects(task,{name:'AbortError'});assert.equal(f.timers.size,0);signer.resolve(new Uint8Array(32).buffer);await pause();assert.equal(f.requests.length,0);
});
test('native machine translation sends the deadline signal and restores exact original TeX',async()=>{
 const f=fixture(),tex='$E_{\\mathrm{F}}=x_i^2$';const result=await f.E.translateYoudao('Source '+tex,'zh-CHS',{timeout:42});assert.equal(result.text,'机器译文 '+tex);assert.equal(f.requests.length,1);assert.equal(f.requests[0].timeout,42);assert.equal(f.requests[0].options.signal.aborted,false);assert.equal(f.timers.size,0);assert.match(f.requests[0].options.body,/ZXQFORMULA1ZXQ/);assert.doesNotMatch(f.requests[0].options.body,/E_%/);
});
