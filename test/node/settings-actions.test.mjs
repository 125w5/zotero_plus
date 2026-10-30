/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

let source=await readFile(new URL('../../chrome/content/zotero/research/ui/settings.js',import.meta.url),'utf8');
const D='https://api.deepseek.com',CHAT='https://chat.example/v1';

function element(id,{tag='button',value='',text=''}={}){
	let node={id,tagName:tag.toUpperCase(),value,textContent:text,disabled:false,dataset:{},attributes:{},listeners:{},children:[],
		addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);},
		setAttribute(key,value){this.attributes[key]=String(value);},removeAttribute(key){delete this.attributes[key];},getAttribute(key){return this.attributes[key]??null;},
		append(...nodes){this.children.push(...nodes);},after(...nodes){this.afterNodes=(this.afterNodes||[]).concat(nodes);},before(...nodes){this.beforeNodes=(this.beforeNodes||[]).concat(nodes);},remove(){},
		click(){let run=[...(this.listeners.click||[])].map(fn=>fn());if(this.onclick)run.push(this.onclick());return Promise.all(run);}};
	return node;
}

// settings.js on a fake page: every control it reads exists, and every label is visible text.
function load({settings={},confirm=()=>true,platform='Win32',bundled=null,flags={},keys={}}={}){
	let ids=['save-azure','azure-region','azure-key','save-translation','translation-endpoint','translation-model','translation-key','save-youdao','youdao-app-id','youdao-secret','test-providers','stop-provider-test','metrics-save-key','metrics-remove-key','metrics-key','save-settings','endpoint','model','api-key','image-key','image-endpoint','image-model','template','pandoc','csl','referenceDoc','latexTemplate','documentLanguage','forget-key','forget-image-key','save-metric','metric-value','metric-year','metric-source','metric-top','provider-status','status','compatibility'];
	let nodes=new Map(ids.map(id=>[id,element(id)]));
	let labels={pandoc:'Pandoc 可执行文件',csl:'期刊 CSL 文件',referenceDoc:'Word 参考样式 reference.docx',latexTemplate:'Pandoc LaTeX 模板'};
	let pickers=Object.keys(labels).map(name=>{let button=element('');button.dataset.pick=name;return button;});
	let calls=[],state={settings:{...settings}},statuses=[],picks=[];
	let E={
		settings:()=>({...state.settings}),
		core:{endpoint:value=>{let url=new URL(String(value).trim());return url.href.replace(/\/$/,'');}},
		store:{update:async fn=>fn(state)},
		credentials:{set:async(endpoint,key,service)=>calls.push(['set',endpoint,key,service||'']),get:async endpoint=>keys[endpoint]||''},
		providerStatus:async()=>{calls.push(['status']);return {...flags};},
		pick:async(win,title,mode,extension)=>{picks.push({title,extension});return null;},
		configureProviders:async data=>calls.push(['configure',data]),
		saveMetricsKey:async()=>{},
		compatibility:async()=>'',
		...(bundled?{hasBundledProviders:true,applyBundledProviders:async options=>{calls.push(['restore',options.reset]);await bundled(state);}}:{})
	};
	let ui={E,$:id=>nodes.get(id)||null,status(message,error=false){statuses.push({message,error});},bind(id,action){nodes.get(id).addEventListener('click',async()=>{try{await action();}catch(error){ui.status(error.message,true);}});}};
	let document={
		querySelectorAll:selector=>selector==='[data-pick]'?pickers:[],
		querySelector:selector=>{let match=/^label\[for="?([^"\]]+)"?\]$/.exec(selector);return match&&labels[match[1]]?{textContent:labels[match[1]]}:null;},
		createElement:tag=>element('',{tag}),getElementById:id=>nodes.get(id)||null
	};
	let context=vm.createContext({EasySchUI:ui,document,window:{confirm:message=>{calls.push(['confirm',message]);return confirm(message);}},navigator:{platform},URL,Promise,AbortController});
	vm.runInContext(source,context);
	ui.initSettings();
	return {ui,E,nodes,pickers,calls,state,statuses,picks};
}

test('测试已配置服务 starts one test at a time and shows that it is running',async()=>{
	let f=load(),release,runs=0;
	f.E.testProviders=()=>{runs++;return new Promise(resolve=>release=()=>resolve({ai:'对话成功'}));};
	let button=f.nodes.get('test-providers'),first=button.click();
	await Promise.resolve();
	assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'true');
	assert.equal(f.nodes.get('stop-provider-test').hidden,false,'停止测试 is offered while the test runs');
	await button.click();assert.equal(runs,1,'a second click while the test runs starts nothing');
	release();await first;
	assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-busy'),'false');assert.equal(f.nodes.get('stop-provider-test').hidden,true);
	assert.match(f.nodes.get('provider-status').textContent,/对话成功/);
});

// Settles with the promise, or rejects after `ms` so a missing stop fails instead of hanging.
let within=(promise,ms)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('still running after '+ms+' ms')),ms))]).finally(()=>clearTimeout(timer));};

test('停止测试 aborts the running probes and ends the test at once, without new results',async()=>{
	let f=load({flags:{ai:true}}),signal;
	f.E.testProviders=options=>{signal=options?.signal;return new Promise(()=>{});};
	let button=f.nodes.get('test-providers'),run=button.click();
	await Promise.resolve();
	f.nodes.get('provider-status').textContent='学术 AI：已保存凭据';
	f.nodes.get('stop-provider-test').click();
	await within(run,500);
	assert.equal(signal?.aborted,true,'the probes receive the abort');
	assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-busy'),'false');assert.equal(f.nodes.get('stop-provider-test').hidden,true);
	assert.equal(f.nodes.get('provider-status').textContent,'学术 AI：已保存凭据','no partial result replaces the status line');
	assert.deepEqual(f.statuses.at(-1),{message:'已停止连接测试，各服务结果未更新',error:false});
});

test('删除当前接口密钥 uses the saved address when the field is empty, names it and refreshes the status',async()=>{
	let f=load({settings:{endpoint:CHAT,translationEndpoint:D}});
	f.nodes.get('endpoint').value='';
	await f.nodes.get('forget-key').click();
	assert.deepEqual(f.calls.filter(row=>row[0]==='set'),[['set',CHAT,'','']]);
	assert.ok(f.calls.some(row=>row[0]==='confirm'&&row[1].includes(CHAT)),'the confirmation names the address');
	assert.ok(f.calls.some(row=>row[0]==='status'),'the status line is refreshed');
	assert.equal(f.statuses.at(-1).error,false);
});

test('删除当前接口密钥 does nothing when the confirmation is declined or the address is the translation address',async()=>{
	let f=load({settings:{endpoint:CHAT,translationEndpoint:D},confirm:()=>false});
	f.nodes.get('endpoint').value=CHAT;await f.nodes.get('forget-key').click();
	assert.equal(f.calls.filter(row=>row[0]==='set').length,0);
	let g=load({settings:{endpoint:CHAT,translationEndpoint:D}});
	g.nodes.get('endpoint').value=D;await g.nodes.get('forget-key').click();
	assert.equal(g.calls.filter(row=>row[0]==='set').length,0,'the translation key is not deleted from the chat form');
	assert.match(g.statuses.at(-1).message,/学术翻译/);assert.equal(g.statuses.at(-1).error,true);
});

test('删除当前接口密钥 on an address translation shares says that translation loses the key too',async()=>{
	let f=load({settings:{endpoint:D,translationEndpoint:D}});
	f.nodes.get('endpoint').value=D;await f.nodes.get('forget-key').click();
	assert.deepEqual(f.calls.filter(row=>row[0]==='set'),[['set',D,'','']]);
	let message=f.calls.find(row=>row[0]==='confirm')[1];
	assert.match(message,/对话模型与学术翻译共用/);assert.doesNotMatch(message,/学术翻译、生图与期刊指标的密钥不受影响/);
	assert.match(f.statuses.at(-1).message,/对话模型与学术翻译都需要重新保存/);
});

test('an invalid model entry does not block saving template paths',async()=>{
	let f=load({settings:{endpoint:CHAT,model:'gpt-6-luna'}});
	f.nodes.get('endpoint').value=CHAT;f.nodes.get('model').value='bad model name';f.nodes.get('csl').value='C:/styles/journal.csl';f.nodes.get('latexTemplate').value='C:/styles/template.tex';
	await f.nodes.get('save-settings').click();
	assert.equal(f.state.settings.csl,'C:/styles/journal.csl');assert.equal(f.state.settings.latexTemplate,'C:/styles/template.tex');
	assert.equal(f.state.settings.model,'gpt-6-luna','the invalid model name is not saved');
	assert.equal(f.statuses.at(-1).error,true);assert.match(f.statuses.at(-1).message,/模型名称/);
});

test('a new chat key on academic translation’s address asks first, because translation uses that key too',async()=>{
	let fill=f=>{f.nodes.get('endpoint').value=D;f.nodes.get('model').value='deepseek-chat';f.nodes.get('api-key').value='sk-'+'fixture-chat-credential-not-a-real-key';};
	let declined=load({settings:{endpoint:CHAT,model:'gpt-6-luna',translationEndpoint:D},keys:{[D]:'translation-key'},confirm:()=>false});fill(declined);
	await declined.nodes.get('save-settings').click();
	assert.match(declined.calls.find(row=>row[0]==='confirm')?.[1]||'',/学术翻译正在使用 https:\/\/api\.deepseek\.com 的密钥/);
	assert.equal(declined.calls.filter(row=>row[0]==='set').length,0,'translation keeps its key');assert.equal(declined.state.settings.endpoint,CHAT);
	assert.equal(declined.statuses.at(-1).error,true);assert.match(declined.statuses.at(-1).message,/对话模型未保存，学术翻译的密钥没有改变/);
	let accepted=load({settings:{endpoint:CHAT,model:'gpt-6-luna',translationEndpoint:D},keys:{[D]:'translation-key'}});fill(accepted);
	await accepted.nodes.get('save-settings').click();
	assert.deepEqual(accepted.calls.filter(row=>row[0]==='set').map(row=>row[1]),[D]);assert.equal(accepted.state.settings.endpoint,D);
	assert.deepEqual(accepted.statuses.at(-1),{message:'设置已保存；对话模型与学术翻译共用 '+D+' 的密钥',error:false});
	let rotating=load({settings:{endpoint:D,model:'deepseek-chat',translationEndpoint:D},keys:{[D]:'old-key'}});fill(rotating);
	await rotating.nodes.get('save-settings').click();
	assert.equal(rotating.calls.filter(row=>row[0]==='confirm').length,0,'replacing the key the address already shares needs no question');
	assert.match(rotating.statuses.at(-1).message,/共用/);
});

test('保存学术翻译 with a key on the chat model’s address asks first and then says the key is shared',async()=>{
	let fill=f=>{f.nodes.get('translation-endpoint').value=D;f.nodes.get('translation-model').value='deepseek-flash';f.nodes.get('translation-key').value='translation-key';};
	let declined=load({settings:{endpoint:D,translationEndpoint:D},confirm:()=>false});fill(declined);
	await declined.nodes.get('save-translation').click();
	assert.match(declined.calls.find(row=>row[0]==='confirm')?.[1]||'',/对话模型也使用 https:\/\/api\.deepseek\.com 的密钥/);
	assert.equal(declined.calls.filter(row=>row[0]==='configure').length,0,'nothing is saved');
	assert.match(declined.statuses.at(-1).message,/未保存学术翻译/);
	let accepted=load({settings:{endpoint:D,translationEndpoint:D}});fill(accepted);
	await accepted.nodes.get('save-translation').click();
	assert.equal(accepted.calls.filter(row=>row[0]==='configure').length,1);
	assert.equal(accepted.statuses.at(-1).message,'学术翻译已保存；与对话模型共用 '+D+' 的密钥');
	let apart=load({settings:{endpoint:CHAT,translationEndpoint:D}});fill(apart);
	await apart.nodes.get('save-translation').click();
	assert.equal(apart.calls.filter(row=>row[0]==='confirm').length,0);assert.equal(apart.statuses.at(-1).message,'学术翻译已保存，对话模型保持原设置');
});

test('the status line marks the translation key the chat model shares',async()=>{
	let shared=load({settings:{endpoint:D,translationEndpoint:D},flags:{ai:true,deepseek:true}});
	await shared.ui.loadProviderStatus();
	assert.equal(shared.nodes.get('provider-status').textContent,'学术 AI：已保存凭据；DeepSeek：已保存凭据（与对话模型共用）');
	let apart=load({settings:{endpoint:CHAT,translationEndpoint:D},flags:{ai:true,deepseek:true}});
	await apart.ui.loadProviderStatus();
	assert.equal(apart.nodes.get('provider-status').textContent,'学术 AI：已保存凭据；DeepSeek：已保存凭据');
});

test('file pickers are titled with the visible labels and the Pandoc picker filters executables',async()=>{
	let f=load();
	for(let button of f.pickers)await button.click();
	// A space follows 选择 only before a Latin word, as in the other pickers.
	assert.deepEqual(f.picks.map(row=>row.title),['选择 Pandoc 可执行文件','选择期刊 CSL 文件','选择 Word 参考样式 reference.docx','选择 Pandoc LaTeX 模板']);
	assert.deepEqual(f.picks.map(row=>row.extension),['exe','csl','docx','tex']);
	let mac=load({platform:'MacIntel'});await mac.pickers[0].click();assert.equal(mac.picks[0].extension,undefined,'Pandoc has no file extension outside Windows');
});

test('恢复内置接口 restores the bundled keys and writes no second copy',async()=>{
	let f=load({bundled:async state=>{state.settings={endpoint:CHAT,translationEndpoint:D};},keys:{[D]:'bundled-translation-key'}});f.ui.loadSettings=()=>{};
	let restore=f.nodes.get('provider-status').beforeNodes[0].children.find(node=>node.textContent==='恢复内置接口');
	await restore.click();
	assert.deepEqual(f.calls.filter(row=>row[0]==='restore'||row[0]==='set'),[['restore',true]],'translation reads the restored key at its address');
	assert.equal(f.statuses.at(-1).message,'已恢复安装包内置接口');
	let failed=load({bundled:async()=>{throw Error('broken bundle');}});failed.ui.loadSettings=()=>{};
	await failed.nodes.get('provider-status').beforeNodes[0].children.find(node=>node.textContent==='恢复内置接口').click();
	assert.deepEqual(failed.statuses.at(-1),{message:'恢复失败，请重新安装完整安装包。',error:true});
});
