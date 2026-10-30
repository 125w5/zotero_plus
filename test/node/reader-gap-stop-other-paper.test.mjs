/* SPDX-License-Identifier: AGPL-3.0-or-later */
// One reader conversation surface follows the selected paper. While another
// conversation's answer still runs (another paper's, or a second conversation
// on this paper), Enter, Esc and the send button here must not stop it, and a
// stop request names the conversation it is meant for.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let read=path=>fs.readFileSync(new URL('../../chrome/content/zotero/'+path,import.meta.url),'utf8');
let surfaceSource=read('research/shared/conversation-surface.mjs'),orbSource=read('xpcom/research/reader-ai-orb.js');
let lines=surfaceSource.split(/\r?\n/),line=prefix=>{let index=lines.findIndex(value=>value.startsWith(prefix));assert.ok(index>=0,'missing '+prefix);return index;};
let after=index=>{let rows=[];for(let i=index+1;lines[i].startsWith(' let ownBusy')||lines[i].startsWith(' let paintSend');i++)rows.push(lines[i]);return rows;};

function surface(presentation='reader-bottom'){
	let stops=[],statuses=[],collapsed=[],icons=[],handlers={};
	let send={title:'',replaceChildren:value=>icons.push(value),setAttribute(){}};
	let context={busy:false,session:{id:'b'},composing:false,attachBusy:false,drag:null,locked:false,presentation,preferenceAnchor:null,docked:null,iconDock:null,restoreDock:null,doc:{},send,
		input:{value:'追问另一篇'},modeMenu:{hidden:true},more:{hidden:true},executionMenu:{hidden:true},sessionMenu:{hidden:true},
		root:{addEventListener:(name,fn)=>{handlers[name]=fn;},dispatchEvent(){}},preferencePopover:{addEventListener(){}},footer:{},
		icon:(_doc,name)=>name,hideControls(){},focusPreferencesInput(){},restorePane(){},save(){},hide(){},setExpanded:value=>collapsed.push(value),
		setStatus:text=>statuses.push(text),onSend:(prompt,request)=>{if(request?.stop)stops.push(request);},runSend:()=>{throw Error('no new question while another paper runs');}};
	let streamLine=line(' let streamDraft=null'),escapeLine=line(' const onEscape=');
	let script=[lines[streamLine],...after(streamLine),lines[escapeLine],lines[line(' footer.onsubmit=')],
		'globalThis.__stream=value=>{streamSessionID=value;};',
		'if(typeof ownBusy==="function")globalThis.__ownBusy=ownBusy;if(typeof paintSend==="function")globalThis.__paintSend=paintSend;'].join('\n');
	vm.runInNewContext(script,context);
	let key=()=>handlers.keydown({key:'Escape',isComposing:false,keyCode:27,preventDefault(){},stopPropagation(){}});
	let submit=()=>context.footer.onsubmit({preventDefault(){}});
	return {context,stops,statuses,collapsed,icons,key,submit,send};
}

test('another paper or another conversation of this paper still answering: Enter and Esc here do not stop it',()=>{
	let f=surface();f.context.busy=true;f.context.__stream('a');f.context.session={id:'b'};
	f.submit();
	assert.deepEqual(f.stops,[],'Enter in paper B leaves paper A running');
	assert.equal(f.context.input.value,'追问另一篇','the typed question stays in the input');
	assert.equal(f.statuses.at(-1),'另一段对话的回答仍在生成，可稍后发送或回到该对话停止','the running answer can be a second conversation on the same paper, so no other paper is named');
	f.key();
	assert.deepEqual(f.stops,[],'Esc in paper B collapses instead of stopping paper A');
	assert.deepEqual(f.collapsed,[false]);
	let assembly=surface('floating');assembly.context.busy=true;assembly.context.__stream('a');assembly.submit();
	assert.deepEqual(assembly.stops,[]);
	assert.equal(assembly.statuses.at(-1),'另一段对话的回答仍在生成，可稍后发送或回到该对话停止','the assembly chat uses the same wording');
});

test('the paper that runs is stopped by its own Enter and Esc, and the request names it',()=>{
	let f=surface();f.context.busy=true;f.context.__stream('a');f.context.session={id:'a'};
	f.submit();f.key();
	assert.equal(f.stops.length,2);
	assert.deepEqual(f.stops.map(request=>request.sessionID),['a','a']);
	assert.deepEqual(f.collapsed,[]);
});

test('the send button shows stop only for the paper whose answer runs',()=>{
	let f=surface();
	assert.equal(typeof f.context.__paintSend,'function');
	f.context.busy=true;f.context.__stream('a');f.context.session={id:'b'};f.context.__paintSend();
	assert.equal(f.icons.at(-1),'send');assert.equal(f.send.title,'发送研究问题 · Enter');
	f.context.session={id:'a'};f.context.__paintSend();
	assert.equal(f.icons.at(-1),'stop');assert.equal(f.send.title,'停止当前研究任务');
	let render=lines[line(' const render=')+1];
	assert.match(render,/if\(switched\)\{[^}]*paintSend\(\)/,'switching papers repaints the button');
});

function orb(){
	let signals=[],rejects=[];
	let sessions=new Map([['a',{id:'a',messages:[],mode:'auto'}],['b',{id:'b',messages:[],mode:'auto'}]]);
	let start=orbSource.indexOf('   onSend:async('),end=orbSource.indexOf('   onSave:async');
	assert.ok(start>0&&end>start);
	let onSend=orbSource.slice(start,end).trim().replace(/^onSend:/,'').replace(/,\s*$/,'');
	let context={taskController:undefined,taskSessionID:undefined,focusedAsset:undefined,activeReader:()=>({itemID:9}),sourceFor:()=>({paperItemID:4,kind:'paper'}),clone:value=>JSON.parse(JSON.stringify(value)),
		win:{AbortController},conversations:{get:id=>sessions.get(id),select:async()=>{},append:async(_id,value)=>({id:'q-'+Math.random(),...value}),update:async()=>{}},
		E:{settings:()=>({model:''}),runWorkbenchTask:({signal})=>new Promise((_resolve,reject)=>{signals.push(signal);rejects.push(reject);signal.addEventListener('abort',()=>reject(Error('已停止，本次未完成内容不会写入')));})},
		ChromeUtils:{importESModule:()=>({workbenchFailure:()=>({kind:'stopped',message:'已停止'})})},Zotero:{logError(){}}};
	vm.runInNewContext('globalThis.onSend='+onSend+';',context);
	return {context,signals};
}
let settle=()=>new Promise(resolve=>setImmediate(resolve));

test('a stop request from another paper does not abort the running answer',async()=>{
	let f=orb(),running=f.context.onSend('解释方法',{sessionID:'a'});running.catch(()=>{});await settle();
	assert.equal(f.signals.length,1);
	await f.context.onSend(null,{stop:true,sessionID:'b'});
	assert.equal(f.signals[0].aborted,false,'paper B cannot stop paper A');
	await f.context.onSend(null,{stop:true,sessionID:'a'});
	assert.equal(f.signals[0].aborted,true);
	await assert.rejects(running,/已停止/);
});

test('a stop request without a paper still stops the running answer',async()=>{
	let f=orb(),running=f.context.onSend('解释方法',{sessionID:'a'});running.catch(()=>{});await settle();
	await f.context.onSend(null,{stop:true});
	assert.equal(f.signals[0].aborted,true,'hosts that send no sessionID keep working');
	await assert.rejects(running,/已停止/);
});
