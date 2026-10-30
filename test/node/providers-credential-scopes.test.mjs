/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

import {boundedMapSet} from '../../chrome/content/zotero/research/shared/paper-overview-data.mjs';

let root=new URL('../../chrome/content/zotero/xpcom/research/',import.meta.url);
let sources=await Promise.all(['core.js','zotero.js','providers.js'].map(name=>readFile(new URL(name,root),'utf8')));
let reader=await readFile(new URL('reader-results.js',root),'utf8');
const D='https://api.deepseek.com',CHAT='https://chat.example/v1';
const chatKey='sk-'+'fixture-chat-credential-not-a-real-key';

// The real credential store over an in-memory login manager, with the real
// academic translation reader, so a test sees the key translation sends.
function load({settings={},logins=[]}={}){
	let state={settings:{...settings}},sent=[];
	let store=[...logins.map(([httpRealm,password])=>({hostname:'chrome://easysch',httpRealm,username:'API Key',password}))];
	let E={store:{peek:(...path)=>path.reduce((value,key)=>value?.[key],state),get:(...path)=>path.reduce((value,key)=>value?.[key],state),update:async fn=>fn(state)},settings:()=>({...state.settings}),assets:{key:parts=>JSON.stringify(parts)}};
	let Services={logins:{getAllLogins:async()=>store.slice(),removeLoginAsync:async login=>{store=store.filter(row=>row!==login);},addLoginAsync:async login=>{store.push(login);}},scriptSecurityManager:{getSystemPrincipal(){}}};
	let Cc={'@mozilla.org/login-manager/loginInfo;1':{createInstance:()=>({init(hostname,_form,httpRealm,username,password){Object.assign(this,{hostname,httpRealm,username,password});}})}};
	let context=vm.createContext({EasySch:E,Zotero:{Research:E,logError(){}},Services,Cc,Ci:{nsILoginInfo:{}},URL});
	for(let source of sources)vm.runInContext(source,context);
	E.requestProvider=async(_url,options)=>{sent.push(options.headers.Authorization.replace('Bearer ',''));return {text:'受控译文',finishReason:'stop'};};
	vm.runInNewContext(reader,{URL,Zotero:{Research:E},ChromeUtils:{importESModule:path=>path.endsWith('paper-overview-data.mjs')?{boundedMapSet}:{chatRequiresStreaming:()=>false}}});
	let translation=async()=>{try{await E.quickTranslate('The experiment includes a control group.',undefined,{purpose:'document',persist:false});return 'sent:'+sent.at(-1);}catch{return 'fails';}};
	// The status line may only say 学术翻译 has a key when translation sends one.
	let honest=async()=>{let status=await E.providerStatus(),result=await translation();assert.equal(status.deepseek,result.startsWith('sent:'),'status deepseek='+status.deepseek+' but translation '+result);return result;};
	return {E,state,translation,honest,realms:()=>store.map(row=>row.httpRealm+'='+row.password).sort()};
}

test('the chat model and translation on one address share one key, and the status line says what translation sends',async()=>{
	let f=load({settings:{endpoint:D,model:'deepseek-chat',translationEndpoint:D}});
	await f.E.configureProviders({translation:{endpoint:D,model:'deepseek-flash',key:'translation-key'}});
	await f.E.credentials.set(D,chatKey);
	assert.deepEqual(f.realms(),[D+'='+chatKey],'the address holds one key');assert.equal(await f.honest(),'sent:'+chatKey);
	await f.E.credentials.set(D,'');
	assert.equal(await f.honest(),'fails','删除当前接口密钥 removes the key translation sends, and the status line says so');
	await f.E.configureProviders({translation:{endpoint:D,model:'deepseek-flash',key:'translation-key-2'}});
	assert.equal(await f.honest(),'sent:translation-key-2','saving the translation key again repairs translation');
});

test('a key seeded at an address both services use is the key translation reads and reports',async()=>{
	let f=load();
	// As applyBundledProviders seeds: the plain address, then the settings.
	await f.E.credentials.set(D,'bundled-deepseek-key');await f.E.store.update(s=>Object.assign(s.settings,{endpoint:D,model:'deepseek-chat',translationEndpoint:D,translationModel:'deepseek-flash'}));
	assert.equal(await f.honest(),'sent:bundled-deepseek-key');
	assert.equal(await f.E.credentials.get(D,'translation'),'bundled-deepseek-key','a reader that names the translation service gets the same key');
});

test('a chat key alone on the translation address counts for translation, which sends it',async()=>{
	let f=load({settings:{endpoint:D,model:'deepseek-chat'},logins:[[D,chatKey]]});
	let status=await f.E.providerStatus();assert.equal(status.ai,true);
	assert.equal(await f.honest(),'sent:'+chatKey);
});

test('a chat model moved onto the translation address with its own key shares that one key',async()=>{
	let f=load({settings:{endpoint:CHAT,model:'gpt-6-luna',translationEndpoint:D},logins:[[CHAT,'sk-'+'fixture-old-chat-credential-000'],[D,'translation-key']]});
	await f.E.configureProviders({ai:{endpoint:D,model:'deepseek-chat',key:chatKey}});
	assert.equal(f.state.settings.endpoint,D);
	assert.deepEqual(f.realms(),[D+'='+chatKey,CHAT+'=sk-fixture-old-chat-credential-000'],'no second, unread key is kept at the address');
	assert.equal(await f.honest(),'sent:'+chatKey);
});

test('a translation key on its own address stays apart from the chat key',async()=>{
	let f=load({settings:{endpoint:CHAT,model:'gpt-6-luna',translationEndpoint:D},logins:[[CHAT,chatKey],[D,'old-translation-key']]});
	assert.equal(await f.honest(),'sent:old-translation-key');
	await f.E.configureProviders({translation:{endpoint:D,model:'deepseek-flash',key:'new-translation-key'}});
	assert.equal(await f.honest(),'sent:new-translation-key');
	assert.equal(await f.E.credentials.get(CHAT),chatKey);
});

test('replacing or deleting a key also removes the unread copy an earlier build kept at that address',async()=>{
	let f=load({settings:{endpoint:D,model:'deepseek-chat',translationEndpoint:D},logins:[[D,chatKey],[D+'#translation','stale-translation-key']]});
	await f.E.credentials.set(D,'new-shared-key');
	assert.deepEqual(f.realms(),[D+'=new-shared-key']);
	let g=load({settings:{endpoint:D,model:'deepseek-chat',translationEndpoint:D},logins:[[D,chatKey],[D+'#translation','stale-translation-key']]});
	await g.E.credentials.set(D,'');
	assert.deepEqual(g.realms(),[],'a deleted key leaves no secret behind');
});
