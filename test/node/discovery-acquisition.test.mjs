/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as tools from '../../chrome/content/zotero/research/shared/agent-workbench.mjs';
import * as references from '../../chrome/content/zotero/research/shared/reference-matcher.mjs';

async function loadUI(E={}) {
 const ui={E},context=vm.createContext({EasySchUI:ui,console,clearTimeout,setTimeout});
 vm.runInContext(await readFile(new URL('../../chrome/content/zotero/research/ui/agent-workbench.js',import.meta.url),'utf8'),context);
 ui.agentTools=tools;return ui;
}
const control=value=>({value,textContent:'',dataset:{},setAttribute(key,value){this[key]=value;}});

test('PDF acquisition keeps progress through card rerender and never navigates or downloads twice',async()=>{
 const row={id:'paper-1',doi:'10.1000/progress',title:'Measured paper'},id=tools.workbenchSourceIdentity(row),first=control(''),second=control('');first.dataset.discoveryDownload=second.dataset.discoveryDownload=id;
 let current=first,release,progress,calls=0,enriched=0;const gate=new Promise(resolve=>release=resolve);
 const opened=[],ui=await loadUI({library:{openSource:async source=>opened.push(source)},obtainPaper:async(_row,options)=>{calls++;assert.equal(options.open,false);progress=options.onProgress;await gate;return{attachmentID:27};}});
 ui.agentHomeStatus={};ui.agentHomeList={querySelectorAll:selector=>selector==='[data-discovery-download]'?[current]:[{dataset:{discoverySource:id},_discoveryEnrich(){enriched++;}}]};
 const pending=ui.acquireDiscoveryPDF(row);assert.equal(first.disabled,true);assert.equal(first.textContent,'正在获取 PDF…');assert.equal(first['aria-busy'],'true');
 progress({stage:'download',text:'正在下载 PDF…'});assert.equal(first.textContent,'正在下载 PDF…');
 current=second;ui.updateDiscoveryDownload(row,ui.agentDiscoveryDownloads.get(id));assert.equal(second.textContent,'正在下载 PDF…');assert.equal(second.disabled,true);
 const duplicate=ui.acquireDiscoveryPDF(row);assert.equal(calls,1);progress({stage:'save',text:'正在保存 PDF…'});assert.equal(second.textContent,'正在保存 PDF…');release();await Promise.all([pending,duplicate]);
 assert.equal(second.textContent,'打开 PDF');assert.equal(second['aria-busy'],'false');assert.equal(second.disabled,false);assert.equal(enriched,1);assert.equal(calls,1);assert.equal(opened.length,0,'首次点击只下载');await ui.acquireDiscoveryPDF(row);assert.equal(opened[0].attachmentID,27);assert.equal(calls,1,'再次点击直接打开已保存附件');
});

test('a failed direct PDF acquisition offers a real retry without discarding metadata',async()=>{
 const row={id:'failed-paper',title:'Unavailable open paper'},id=tools.workbenchSourceIdentity(row),button=control('');button.dataset.discoveryDownload=id;let calls=0;
 const ui=await loadUI({obtainPaper:async()=>{calls++;if(calls===1)throw Error('未找到公开 PDF；题录与摘要已保留');return{attachmentID:28};}});ui.agentHomeStatus={};ui.agentHomeList={querySelectorAll:selector=>selector==='[data-discovery-download]'?[button]:[]};
 await ui.acquireDiscoveryPDF(row);assert.equal(button.disabled,false);assert.equal(button.textContent,'重试 PDF');assert.match(button.title,/题录与摘要已保留/);assert.equal(ui.agentHomeStatus.textContent,button.title);
 await ui.acquireDiscoveryPDF(row);assert.equal(calls,2);assert.equal(button.textContent,'打开 PDF');assert.equal(ui.agentDiscoveryDownloads.get(id).excluded,undefined);
});

test('background model discovery retains the live model, reasoning and permission choices without saving defaults',async()=>{
 let writes=0;const ui=await loadUI({store:{update(){writes++;}}});ui.agentData={modelID:'earlier-model',thinkingLevel:'off',executionMode:'auto'};
 ui.agentModel={value:'chosen-live-model',options:[{value:'chosen-live-model',textContent:'Chosen'}],replaceChildren(...options){this.options=options;}};ui.agentThinking={hidden:false,value:'high'};ui.agentExecution={value:'ask'};ui.agentOption=(value,textContent)=>({value,textContent});
 ui.fillAgentModels([{id:'background-default',label:'Another model'}]);assert.equal(ui.agentModel.value,'chosen-live-model');assert.ok(ui.agentModel.options.some(option=>option.value==='background-default'));assert.equal(ui.agentThinking.value,'high');assert.equal(ui.agentExecution.value,'ask');assert.equal(writes,0);
});

test('the embedded workspace opens only its requested page rather than preparing recommendations and writing first',async()=>{
 const calls=[],window={frameElement:{researchLibraryMode:true,researchLibraryView:'agent',researchOverlayMode:'embedded'},addEventListener(){}},context=vm.createContext({window,document:{body:{classList:{add(){}}}}});
 vm.runInContext(await readFile(new URL('../../chrome/content/zotero/research/ui/main.js',import.meta.url),'utf8'),context);const ui=context.EasySchUI;
 Object.defineProperty(ui,'E',{value:{library:{selection:()=>[]}}});ui.show=page=>calls.push(page);ui.openAgentWorkbench=()=>calls.push('agent');
 await ui.openInitialSelection();assert.deepEqual(calls,['agent']);calls.length=0;window.frameElement.researchLibraryView='search';await ui.openInitialSelection();assert.deepEqual(calls,['search']);calls.length=0;window.frameElement.researchLibraryView='local';await ui.openInitialSelection();assert.deepEqual(calls,[]);
});

test('the public acquisition API reports actual resolve/download/save stages and opens only when requested',async()=>{
 const stages=[],opened=[],item={id:11},attachment={id:27,getFilePathAsync:async()=>'/actual/local.pdf'};
 const E={store:{get:()=>({})},library:{localPDF:async value=>value===27?attachment:null},importAcademic:async()=>({id:item.id}),requestProvider:async()=>JSON.stringify({best_oa_location:{is_oa:true,pdf_url:'https://example.org/actual.pdf'}})};
 const context=vm.createContext({Zotero:{Research:E,addShutdownListener(){},Items:{getAsync:async()=>item},Reader:{open:async id=>opened.push(id)}},ChromeUtils:{importESModule:url=>url.includes('reference-matcher')?references:{installDiscoveryFeed(){}}}});
 vm.runInContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/discovery.js',import.meta.url),'utf8'),context);
 E.obtainOpenPaper=async(record,options)=>{assert.equal(record.pdf,'https://example.org/actual.pdf');options.onProgress({stage:'download',text:'正在下载 PDF…'});options.onProgress({stage:'save',text:'正在保存 PDF…'});return{itemID:11,attachmentID:27};};
 const result=await E.obtainPaper({id:'remote',doi:'10.1000/stages'},{open:false,onProgress:value=>stages.push(value.stage)});assert.deepEqual(stages,['lookup','resolve','download','save','saved']);assert.deepEqual(opened,[]);assert.equal(result.path,'/actual/local.pdf');
});
