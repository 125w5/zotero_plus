/* SPDX-License-Identifier: AGPL-3.0-or-later */
// WA-03: a research page that fails or times out while opening returns to the
// native list and says so; the 设置 button reports its failure the same way.
// Only the latest open reports, so one failed load never shows two alerts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

let source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/sidebar.js',import.meta.url),'utf8');
class Element{
	constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.className='';this.classList={toggle(){},add(){}};}
	append(...nodes){this.children.push(...nodes);}
	prepend(...nodes){this.children.unshift(...nodes);}
	before(){}
	setAttribute(key,value){this.attributes[key]=String(value);}
	querySelectorAll(selector){let match=selector==='[data-page]'?node=>node.dataset.page!==undefined:()=>false,visit=node=>[...(match(node)?[node]:[]),...node.children.flatMap(visit)];return this.children.flatMap(visit);}
}
function fixture(){
	let alerts=[],logged=[],shown=[],workflows=[],next={show:async()=>{},workflow:async()=>{}};
	let host=new Element('div'),doc={documentElement:new Element('html'),getElementById:id=>id==='zotero-collections-pane'?host:null,createElementNS:(_ns,tag)=>new Element(tag)};
	let win={document:doc,ZoteroPane:{},addEventListener(){}};
	let workspace={show:page=>{shown.push(page);return next.show(page);},subscribe:fn=>{fn('local');return()=>{};}};
	let calendar={},modules={'library-workspace.mjs':{installLibraryWorkspace:()=>workspace},'compact-ui.mjs':{mountCalendar:(_host,_R,options)=>{calendar.options=options;return {};}},'paper-overview.mjs':{installPaperOverview(){}}};
	let R={};
	vm.runInNewContext(source,{IOUtils:{},Services:{prompt:{alert:(_win,title,text)=>alerts.push({title,text})}},Zotero:{Research:R,logError:error=>logged.push(error)},ChromeUtils:{importESModule:url=>modules[url.split('/').at(-1)]}});
	R.openWorkflow=page=>{workflows.push(page);return next.workflow(page);};
	R.installNavigation(win);
	let nav=host.children[0],bottom=host.children.at(-1);
	let button=page=>nav.children[0].children.find(child=>child.dataset.page===page),settings=bottom.children.find(child=>child.className==='compact-settings');
	return {alerts,logged,shown,workflows,next,button,settings,calendar};
}

test('a research page that times out says it failed and that the native list is shown again',async()=>{
	let f=fixture();f.next.show=async()=>{throw Error('科研工作区加载超时，请重试');};
	await f.button('agent').onclick();
	assert.deepEqual(f.shown,['agent']);assert.equal(f.alerts.length,1);
	assert.equal(f.alerts[0].text,'研究对话未能打开：科研工作区加载超时。已回到文库列表，请再点击一次“研究对话”重试。');
	assert.equal(f.logged.length,1,'the cause is still logged');
});

test('closing the workspace while it opens is not reported as a failure, and a successful open shows nothing',async()=>{
	let f=fixture();f.next.show=async()=>{throw Object.assign(Error('已关闭文献工作区'),{name:'AbortError'});};
	await f.button('search').onclick();assert.equal(f.alerts.length,0);
	f.next.show=async()=>{};await f.button('ppt').onclick();assert.equal(f.alerts.length,0);assert.deepEqual(f.shown,['search','ppt']);
});

test('the 设置 button reports a failed open instead of leaving an unhandled rejection',async()=>{
	let f=fixture();f.next.workflow=async()=>{throw Error('设置页面加载失败');};
	await f.settings.onclick();
	assert.deepEqual(f.workflows,['settings']);assert.equal(f.alerts.length,1);
	assert.match(f.alerts[0].text,/^设置未能打开：设置页面加载失败。已回到文库列表/);
	await f.calendar.options.openSchedule();
	assert.deepEqual(f.workflows,['settings','schedule']);assert.match(f.alerts[1].text,/^日程未能打开：设置页面加载失败/);
});

test('two clicks that wait on one timed-out load show one alert, for the latest click',async()=>{
	// library-workspace.mjs returns the same pending load to every click made while it loads.
	let f=fixture(),fail,pending;f.next.show=()=>pending||=new Promise((_resolve,reject)=>{fail=reject;});
	let first=f.button('agent').onclick(),second=f.button('search').onclick();await new Promise(resolve=>setImmediate(resolve));
	fail(Error('科研工作区加载超时，请重试'));await Promise.all([first,second]);
	assert.deepEqual(f.shown,['agent','search']);assert.equal(f.alerts.length,1,'one load failure is reported once');
	assert.equal(f.alerts[0].text,'文献检索未能打开：科研工作区加载超时。已回到文库列表，请再点击一次“文献检索”重试。');
	assert.equal(f.logged.length,2,'each failed click is still logged');
});

test('a failure that arrives after a newer open is logged without an alert; 设置 and 日程 share the counter',async()=>{
	let f=fixture(),fail;f.next.show=page=>(page==='agent'?new Promise((_resolve,reject)=>{fail=reject;}):Promise.resolve());
	let first=f.button('agent').onclick();await f.button('ppt').onclick();
	fail(Error('科研工作区加载超时，请重试'));await first;
	assert.equal(f.alerts.length,0,'the user has already moved on to the page that opened');assert.equal(f.logged.length,1);
	f.next.workflow=async()=>{throw Error('设置页面加载失败');};
	await Promise.all([f.settings.onclick(),f.calendar.options.openSchedule()]);
	assert.equal(f.alerts.length,1);assert.match(f.alerts[0].text,/^日程未能打开/);
});
