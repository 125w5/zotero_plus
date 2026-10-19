/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/distribution.js',import.meta.url),'utf8');
const core=await readFile(new URL('../../chrome/content/zotero/xpcom/research/core.js',import.meta.url),'utf8');
const seed={version:1,settings:{endpoint:'https://chat.example/v1',model:'gpt-6-luna',imageEndpoint:'https://image.example/v1',imageModel:'image-fixture',translationEndpoint:'https://translation.example/v1',translationModel:'deepseek-flash',azureTranslatorRegion:'eastasia',youdaoAppID:'fixture-app',language:'简体中文',documentLanguage:'en-US',pandoc:'C:/publisher/private.exe',privatePath:'C:/publisher/research'},credentials:[{endpoint:'https://chat.example/v1',key:'fixture-chat'},{endpoint:'https://image.example/v1/images',key:'fixture-image'},{endpoint:'https://translation.example/v1',key:'fixture-translation'},{endpoint:'https://api.cognitive.microsofttranslator.com',key:'fixture-azure'}]};
function fixture({settings={},data=seed,bundled=true}={}){
 const prefs=new Map(),keys=new Map(),writes=[],state={settings:{...settings}};
 const E={store:{update:async fn=>fn(state)},credentials:{get:async endpoint=>keys.get(endpoint)||'',set:async(endpoint,value)=>{keys.set(endpoint,value);writes.push(endpoint);}}};
 const manifest={version:1,release:'test-only',runtime:{node:'runtime/node/node.exe',engine:'runtime/engine/cli.mjs',python:'runtime/python/python.exe',pandoc:'runtime/pandoc/pandoc.exe',soffice:'runtime/office/soffice.exe',poppler:'runtime/poppler'}};
 vm.runInNewContext(core,{EasySch:E,URL});
 vm.runInNewContext(source,{EasySch:E,Services:{dirsvc:{get:()=>({parent:{path:'/relocated/client'}})}},Ci:{nsIFile:{}},PathUtils:{join:path.posix.join,parent:path.posix.dirname},IOUtils:{exists:async file=>!file.endsWith('easysch-provider-defaults.json')||bundled,readUTF8:async file=>JSON.stringify(file.endsWith('easysch-distribution.json')?manifest:data)},Zotero:{Prefs:{get:key=>prefs.get(key),set:(key,value)=>prefs.set(key,value)}}});
 return {E,state,prefs,keys,writes};
}
test('a relocated preconfigured install seeds all three independent services and keeps keys outside workspace settings',async()=>{
 const {E,state,prefs,keys}=fixture();await E.initDistribution();
 for(const name of ['endpoint','model','imageEndpoint','imageModel','translationEndpoint','translationModel','azureTranslatorRegion','youdaoAppID'])assert.equal(state.settings[name],seed.settings[name]);
 assert.equal(keys.size,4);assert.equal(state.settings.privatePath,undefined);assert.equal(state.settings.pandoc,'/relocated/runtime/pandoc/pandoc.exe');assert.equal(JSON.stringify(state).includes('fixture-chat'),false);assert.equal(prefs.get('extensions.easysch.engineNode'),'/relocated/runtime/node/node.exe');
 keys.clear();await E.initDistribution();assert.equal(keys.size,0,'a user removal survives later startup, without reimporting bundled keys');
});
test('bundle restore preserves independently selected endpoints and models until explicitly reset',async()=>{
 const settings={endpoint:'https://mine.example/v1',imageEndpoint:'https://my-images.example/v1',translationEndpoint:'https://my-translation.example/v1'};
 const {E,state,keys}=fixture({settings});await E.initDistribution();
 assert.equal(state.settings.model,undefined);assert.equal(state.settings.imageModel,undefined);assert.equal(state.settings.translationModel,undefined);assert.equal(state.settings.endpoint,settings.endpoint);
 keys.set(seed.settings.endpoint,'user-replacement');await E.applyBundledProviders();assert.equal(keys.get(seed.settings.endpoint),'user-replacement');
 await E.applyBundledProviders({reset:true});assert.equal(state.settings.model,'gpt-6-luna');assert.equal(state.settings.imageModel,'image-fixture');assert.equal(state.settings.translationModel,'deepseek-flash');assert.equal(keys.get(seed.settings.endpoint),'fixture-chat');
});
test('an invalid private bundle is rejected before changing any provider credential',async()=>{
 const data=structuredClone(seed);data.credentials.push({endpoint:'https://invalid.example/?secret=fixture',key:'fixture-rejected'});
 const {E,writes}=fixture({data});await assert.rejects(E.initDistribution(),/查询参数/);assert.equal(writes.length,0);
});
test('standard installations resolve their own runtime without containing or seeding any provider configuration',async()=>{
 const {E,keys}=fixture({bundled:false});await E.initDistribution();assert.equal(E.hasBundledProviders,false);assert.equal(keys.size,0);assert.equal(E.distribution.bundledProviders,false);
});
