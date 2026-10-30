/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Gap tests for PPT page behavior (R/ui/ppt-main.js and the stage files) with a small
// fake DOM, backed by the real studio service (X/ppt-studio.js) in a VM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as model from '../../chrome/content/zotero/research/shared/ppt-model.mjs';
import * as scope from '../../chrome/content/zotero/research/shared/ppt-scope.mjs';
import * as outline from '../../chrome/content/zotero/research/shared/ppt-outline.mjs';
import * as policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as outputs from '../../chrome/content/zotero/research/shared/workspace-outputs.mjs';
import * as readiness from '../../chrome/content/zotero/research/shared/ppt-readiness.mjs';
import {mountWorkspaceOutputList} from '../../chrome/content/zotero/research/shared/workspace-output-list.mjs';

const xpcom=new URL('../../chrome/content/zotero/xpcom/research/',import.meta.url),uiDir=new URL('../../chrome/content/zotero/research/ui/',import.meta.url);
// saved: the store an earlier app session left (a restart); seed keeps new IDs distinct from it.
async function studio({saved,selection=[],seed=0}={}){
 let state=saved?structuredClone(saved):{pptDrafts:{},settings:{}},counter=seed;
 const E={store:{get:(...path)=>structuredClone(path.reduce((value,key)=>value?.[key],state)),peek:(...path)=>path.reduce((value,key)=>value?.[key],state),update:async fn=>{const next=structuredClone(state);fn(next);state=next;},flush:async()=>{},snapshot:()=>structuredClone(state)},library:{selection:()=>selection,describe:value=>({id:value.id,title:'Paper '+value.id}),uri:()=>''},assets:{key:value=>JSON.stringify(value),index:async()=>({assets:[]})}};
 const context=vm.createContext({structuredClone,console,URL,ChromeUtils:{importESModule:path=>path.includes('workspace-outputs')?outputs:path.includes('ppt-model')?model:path.includes('ppt-scope')?scope:path.includes('ppt-outline')?outline:policy},IOUtils:{},PathUtils:{join:(...parts)=>parts.join('/')},Zotero:{Research:E,Utilities:{randomString:()=>'r'+(++counter)},Items:{getAsync:async()=>null},getMainWindow:()=>({AbortController})}});
 for(const name of ['ppt-studio.js','ppt-studio-ai.js'])vm.runInContext(await readFile(new URL(name,xpcom),'utf8'),context,{filename:name});
 return E;
}
const matches=(node,selector)=>selector.startsWith('#')?node.id===selector.slice(1):selector.startsWith('.')?String(node.className).split(/\s+/).includes(selector.slice(1)):node.tag===selector;
const descendants=(node,found=[])=>{for(const child of node.children||[])if(child&&typeof child==='object'){found.push(child);descendants(child,found);}return found;};
function element(tag,text,className){
 return {tag,textContent:text??'',className:className||'',id:'',children:[],dataset:{},style:{},attributes:{},hidden:false,disabled:false,value:'',isConnected:true,parentElement:null,
  classList:{add(){},remove(){},toggle(){}},
  setAttribute(name,value){this.attributes[name]=String(value);},getAttribute(name){return this.attributes[name]??null;},removeAttribute(name){delete this.attributes[name];},
  append(...rows){for(const row of rows){if(row&&typeof row==='object')row.parentElement=this;this.children.push(row);}},
  prepend(...rows){for(const row of rows)if(row&&typeof row==='object')row.parentElement=this;this.children.unshift(...rows);},
  replaceChildren(...rows){this.children=[];this.append(...rows);},
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);},
  querySelectorAll(selector){const parts=selector.split(',').map(part=>part.trim());return descendants(this).filter(child=>parts.some(part=>matches(child,part)));},
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;},
  closest(selector){const parts=selector.split(',').map(part=>part.trim());for(let current=this;current;current=current.parentElement)if(parts.some(part=>matches(current,part)))return current;return null;},
  get lastElementChild(){return this.children.filter(child=>child&&typeof child==='object').at(-1)||null;},
  cloneNode(){const copy=element(this.tag,this.textContent,this.className);copy.value=this.value;return copy;},
  focus(){},select(){},scrollIntoView(){},addEventListener(){},removeEventListener(){}};
}
const walk=root=>[root,...descendants(root)];
const button=(root,text)=>walk(root).find(node=>node.tag==='button'&&(node.textContent===text||descendants(node).some(child=>child.textContent===text)));
const field=(root,tag,label)=>walk(root).find(node=>node.tag===tag&&node.parentElement?.textContent===label);
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function screen(E,{real=false,fallback=false}={}){
 const view=element('section'),listeners=[];view.id='view-ppt';
 const page={E,status(){},show(){},el:(tag,text,className)=>element(tag,text,className),$:id=>id==='view-ppt'?view:descendants(view).find(node=>node.id===id)||(fallback?element('div'):null)};
 const context=vm.createContext({EasySchUI:page,structuredClone,console,setTimeout,clearTimeout,AbortController,window:{frameElement:{researchOverlayMode:'embedded'},addEventListener:(type,fn)=>listeners.push([type,fn])},document:{querySelector:()=>element('div')}});
 for(const name of ['ppt-main.js','ppt-flow.js','ppt-editor.js','ppt-contributions.js','ppt-crop.js'])vm.runInContext(await readFile(new URL(name,uiDir),'utf8'),context,{filename:name});
 page.pptAssistantModule=Promise.resolve({mountPPTAssistant:async()=>null});page.pptReadinessModule=Promise.resolve(readiness);
 if(!real){page.renderPPT=()=>{};page.renderPPTTask=()=>{};}
 return {ui:page,view,listeners};
}
const textPage=(id,extra={})=>({id,title:'页面 '+id,layout:'text',blocks:[{kind:'my_interpretation',text:'内容',evidenceIDs:[]}],assetIDs:[],notes:'n',status:'user',...extra});
test('DC-05 / PPT-26: a re-render during a task keeps the draft switcher and document buttons locked',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([{id:1,title:'Paper 1'}]),other=await S.create([{id:2,title:'Paper 2'}]);await S.patch(other.id,x=>{x.slides=[textPage('o1')];});
 const {ui,view}=await screen(E,{real:true});ui.pptDraft=S.get(d.id);ui.renderPPT();
 let release;const task=ui.pptTask(async()=>{ui.renderPPT();await new Promise(resolve=>release=resolve);});await tick();
 const live=view.querySelectorAll('button,input,select,textarea').filter(control=>!control.disabled&&!control.closest('#ppt-task'));
 assert.deepEqual(live.map(control=>control.tag+':'+(control.textContent||control.getAttribute('aria-label'))),[],'only the task bar stays usable');
 assert.ok(button(view.querySelector('#ppt-task'),'取消任务'),'the task bar keeps its cancel button');
 await ui.openPPTStudio({draftID:other.id});assert.equal(ui.pptDraft.id,d.id,'another draft cannot be opened while the task runs');
 release();await task;assert.equal(view.querySelector('select').disabled,false,'controls return after the task');
});
test('DC-06: closing the PPT page aborts its running task and keeps the reason with the draft',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([]);const {ui,listeners}=await screen(E,{fallback:true});ui.initPPTStudio();ui.pptDraft=S.get(d.id);
 assert.ok(listeners.some(([type])=>type==='pagehide'),'the page listens for its own unload');
 let seen;const task=ui.pptTask(async(status,signal)=>{seen=signal;await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('已取消，本次未完成内容不会写入')),{once:true}));});await tick();
 for(const [type,fn] of listeners)if(type==='pagehide')fn();await task;
 assert.equal(seen.aborted,true,'the model call receives the abort');assert.match(S.get(d.id).lastTaskError?.message||'',/已取消/);
});
test('PPT-26: 本周研究汇报 in the PPT page runs as a task with progress and 取消任务',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([]);let signalSeen;
 S.createWeekly=async(status,signal)=>{signalSeen=signal;status('正在汇总过去七天的阅读、批注和研究记录…');await new Promise((resolve,reject)=>signal?.addEventListener('abort',()=>reject(Error('已取消本周汇报生成')),{once:true}));};
 const {ui}=await screen(E,{real:true});ui.pptDraft=S.get(d.id);ui.renderPPT();
 const run=ui.createWeeklyPPT();await tick();
 assert.ok(ui.pptAbort,'the weekly report runs as a cancellable task');assert.equal(signalSeen,ui.pptAbort.signal);
 ui.pptAbort.abort();await run;assert.equal(ui.pptDraft.id,d.id,'nothing new opens after a cancel');assert.match(ui.pptTaskText,/已取消本周汇报生成/);
});
test('WA-05: an empty draft a page created is removed when the page leaves it unused; worked drafts stay',async()=>{
 const E=await studio(),S=E.studio,worked=await S.create([]);await S.patch(worked.id,x=>{x.slides=[textPage('w1')];x.materialsReady=true;});
 const {ui,listeners}=await screen(E,{fallback:true});ui.initPPTStudio();
 await ui.openPPTStudio({newDraft:true});const fresh=ui.pptDraft.id;assert.notEqual(fresh,worked.id);
 await ui.openPPTStudio({draftID:worked.id});await tick();assert.equal(S.get(fresh),undefined,'leaving an unused new draft removes it');
 await ui.openPPTStudio({newDraft:true});const kept=ui.pptDraft.id;await ui.pptPatch(x=>{x.title='已经命名的汇报';});
 await ui.openPPTStudio({draftID:worked.id});await tick();assert.ok(S.get(kept),'an edited draft stays');
 const other=await S.create([]),second=(await screen(E)).ui;await second.openPPTStudio({});assert.notEqual(second.pptDraft.id,other.id,'another page does not reopen an untouched draft');
 await ui.openPPTStudio({newDraft:true});const closing=ui.pptDraft.id;for(const [type,fn] of listeners)if(type==='pagehide')fn();await tick();assert.equal(S.get(closing),undefined,'closing the page removes its unused draft');
});
test('PPT-07: a failed task keeps its reason on the draft, a reopened page shows it, and success clears it',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([]);const {ui}=await screen(E);ui.pptDraft=S.get(d.id);
 await ui.pptTask(async()=>{throw Error('第 2 篇论文读取失败：解析器退出');});
 assert.equal(S.get(d.id).lastTaskError.message,'第 2 篇论文读取失败：解析器退出');
 const reopened=await screen(E,{real:true});reopened.ui.pptDraft=S.get(d.id);reopened.ui.renderPPT();
 assert.match(reopened.view.querySelector('#ppt-task').children[0].textContent,/上次任务未完成：第 2 篇论文读取失败/);
 await reopened.ui.pptTask(async()=>{});assert.equal(S.get(d.id).lastTaskError,undefined);
});
test('PPT-18: export keeps its own final message, reports export warnings, and a cancelled folder choice says so',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([]);await S.patch(d.id,x=>{x.title='导出验收';x.materialsReady=true;x.slides=[textPage('e1')];});
 E.runArtifactEngine=async()=>({path:'/out/导出验收.pptx',slides:1,warnings:['第 1 页 图 可能模糊']});E.workspaceOutputs.rememberPPTExport=async(id,result)=>{await S.patch(id,x=>{x.lastExport={...result,at:'t'};});return result;};E.reveal=async()=>{};
 const {ui}=await screen(E);ui.pptDraft=S.get(d.id);
 E.pick=async()=>null;await ui.pptTask((status,signal)=>ui.pptExportCurrent(status,signal));assert.match(ui.pptTaskText,/已取消导出，没有生成文件/);
 E.pick=async()=>'/out';await ui.pptTask((status,signal)=>ui.pptExportCurrent(status,signal));
 assert.match(ui.pptTaskText,/已导出：\/out\/导出验收\.pptx/);assert.match(ui.pptTaskText,/1 条导出提醒/);
 const body=element('div');await ui.pptRenderReadiness(body);assert.match(walk(body).map(node=>node.textContent).join(' '),/上次导出提醒.*可能模糊|可能模糊/);
});
test('PPT-17: thumbnails and page cards show a render only while it matches the page',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([]),slide=textPage('pv',{status:'user_edited'});E.previewImage=async path=>'data:'+path;
 await S.patch(d.id,x=>{x.slides=[slide];x.previews={pv:{hash:S.pageKey(x,slide),path:'/render/page-1.png'}};});
 const {ui}=await screen(E);ui.pptDraft=S.get(d.id);
 let body=element('div');ui.pptVisuals(body);assert.ok(walk(body).some(node=>node.tag==='img'&&node.alt?.includes('幻灯片')),'a current render is shown');
 await S.patch(d.id,x=>{x.slides[0].blocks[0].text='修改后的内容';});ui.pptDraft=S.get(d.id);
 body=element('div');ui.pptVisuals(body);assert.equal(walk(body).some(node=>node.tag==='img'&&node.alt?.includes('幻灯片')),false,'an edited page shows its content, not the old render');
 assert.ok(walk(body).some(node=>node.textContent==='修改后的内容'));
});
test('PPT-22: clearing a section title is flagged and blocks confirmation instead of silently reverting',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([{id:1,title:'Paper 1'}]);let prepared=0;S.prepareSlides=async()=>{prepared++;};
 await S.patch(d.id,x=>{x.materialsReady=true;x.step=2;});const {ui}=await screen(E);ui.pptDraft=S.get(d.id);
 const body=element('div');ui.pptOutline(body);const title=field(body,'input','板块标题'),before=S.get(d.id).outline[0].title;
 title.value='  ';await title.onchange();
 assert.equal(title.getAttribute('aria-invalid'),'true');assert.equal(S.get(d.id).outline[0].title,before,'the blank is not saved');
 await button(body,'确认结构并编排页面').onclick();assert.equal(prepared,0,'confirmation waits for the field');assert.match(ui.pptTaskText,/标题或讲述任务为空/);
 title.value='新的封面';await title.onchange();assert.equal(title.getAttribute('aria-invalid'),'false');assert.equal(S.get(d.id).outline[0].title,'新的封面');
});
test('PPT-24: a pasted table with an empty or long category or column name is refused at once',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([]);await S.patch(d.id,x=>{x.step=4;});const {ui}=await screen(E);ui.pptDraft=S.get(d.id);let message='';ui.status=text=>message=text;
 for(const table of ['类别\t准确率\nA\t0.7\n\t0.8','类别\t'+'很长的列名'.repeat(12)+'\nA\t0.7']){
  const body=element('div');ui.pptContributions(body);field(body,'textarea','粘贴表格数据').value=table;message='';
  await button(body,'使用这份数据').onclick();assert.match(message,/数据未加入/);assert.equal(S.get(d.id).datasets.length,0);
 }
});
test('PPT-25: only a located paper figure can be cropped, and a crop keeps the comparison image',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([]),fig={id:'fig',kind:'figure',label:'Figure 2',attachmentID:10,bbox:[0,0,100,100],path:'/f.png',page:2},mat={id:'mat',kind:'user_image',label:'附件图片',attachmentID:11,path:'/m.png'};
 await S.patch(d.id,x=>{x.assets=[fig,mat,{...fig,id:'second',label:'Figure 3'}];x.slides=[textPage('c1',{layout:'comparison',assetIDs:['mat','second']})];});
 const {ui}=await screen(E);ui.pptDraft=S.get(d.id);const crops=[];let message='';ui.status=text=>message=text;ui.pptCrop=async(parent,slide,asset)=>{crops.push(asset.id);};
 const props=element('aside');ui.pptProperties(props,ui.pptDraft.slides[0],ui.pptDraft);
 await button(props,'裁切当前论文原图').onclick();assert.deepEqual(crops,[],'a material image is not cropped');assert.match(message,/只能裁切从论文 PDF 中识别/);
 field(props,'select','替换原图或我的实验图片').value='fig';await button(props,'裁切当前论文原图').onclick();assert.deepEqual(crops,['fig']);
 assert.deepEqual([...ui.pptCroppedAssets({assetIDs:['fig','second'],comparisonAssetID:'second'},'fig','crop-1').assetIDs],['crop-1','second']);
});
test('PPT-12: a single point can be removed from a page, and the last point stays',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([]);await S.patch(d.id,x=>{x.slides=[textPage('b1',{blocks:[{kind:'my_interpretation',text:'第一条',evidenceIDs:[]},{kind:'my_interpretation',text:'第二条',evidenceIDs:[]}]})];});
 const {ui}=await screen(E);ui.pptDraft=S.get(d.id);const props=element('aside');ui.pptProperties(props,ui.pptDraft.slides[0],ui.pptDraft);
 const removes=walk(props).filter(node=>node.tag==='button'&&node.textContent==='删除这条');assert.equal(removes.length,2);
 await removes[0].onclick();assert.deepEqual(S.get(d.id).slides[0].blocks.map(block=>block.text),['第二条']);
 const again=element('aside');ui.pptProperties(again,S.get(d.id).slides[0],S.get(d.id));assert.equal(walk(again).find(node=>node.textContent==='删除这条').disabled,true);
});
test('PPT-14: typing in 我的内容 saves once after a pause, and actions, blur and re-render save at once',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([]);await S.patch(d.id,x=>{x.step=4;});
 let writes=0;const update=E.store.update;E.store.update=async fn=>{writes++;return update(fn);};
 const {ui}=await screen(E);ui.pptDraft=S.get(d.id);const body=element('div');ui.pptContributions(body);const text=field(body,'textarea','想在组会上讲什么？');
 for(const value of ['复','复现','复现实','复现实验发现批次差异']){text.value=value;text.oninput();}
 await tick();assert.equal(writes,0,'no save per keystroke');
 await new Promise(resolve=>setTimeout(resolve,800));assert.equal(writes,1,'one save after the pause');assert.equal(S.get(d.id).contributionForm.text,'复现实验发现批次差异');
 text.value='复现实验发现批次差异，需要讨论';text.oninput();await ui.pptFlushEdits();assert.equal(writes,2,'an action saves the pending text first');assert.equal(S.get(d.id).contributionForm.text,'复现实验发现批次差异，需要讨论');
 text.value='最后一句';text.onchange();await tick();assert.equal(writes,3,'blur or change saves at once');
 text.value='切换前的文字';text.oninput();await ui.pptReleaseContributionForm();assert.equal(ui.pptDraft.contributionForm.text,'切换前的文字','a re-render reads the latest text');assert.equal(S.get(d.id).contributionForm.text,'切换前的文字');
 await new Promise(resolve=>setTimeout(resolve,800));assert.equal(writes,4,'no late save after release');
});
test('PPT-15: autosave neither changes the saved-PPT key nor clears the rows while they reload',async()=>{
 let state={pptDrafts:{a:{id:'a',title:'组会',slides:[{}],updatedAt:'2026-10-28T01:00:00Z'}}},revision=0;
 const E={store:{get:(...path)=>structuredClone(path.reduce((value,key)=>value?.[key],state)),peek:(...path)=>path.reduce((value,key)=>value?.[key],state),branchRevision:()=>revision}};
 const api=outputs.installWorkspaceOutputs(E,{Zotero:{},IOUtils:{stat:async()=>({size:1,type:'regular'})}}),key=api.pptKey();
 state.pptDrafts.a.updatedAt='2026-10-28T01:05:00Z';revision++;assert.equal(api.pptKey(),key,'an autosave keeps the key');
 state.pptDrafts.a.title='组会（改名）';revision++;assert.notEqual(api.pptKey(),key,'a new title changes the key');
 const host=element('div');host.ownerDocument={defaultView:{AbortController},createElementNS:(ns,tag)=>element(tag)};let loads=0,current='k1';
 const list=mountWorkspaceOutputList({host,E:{workspaceOutputs:api},config:{title:'已保存的 PPT',getScope:()=>'draft-a',getKey:()=>current,load:async()=>{loads++;return {rows:[{id:'ppt-project:a',kind:'ppt-project',draftID:'a',title:'组会',subtitle:'1 页 · 已保存项目'}]};}}});
 await tick();await tick();const rows=walk(host).filter(node=>node.className==='workspace-output-row');assert.equal(rows.length,1);
 current='k2';list.render();assert.ok(walk(host).includes(rows[0]),'the shown row stays while the list reloads');assert.equal(walk(host).some(node=>node.textContent==='正在读取本地文件…'),false);
 await tick();await tick();assert.equal(loads,2);list.destroy();
});
test('PPT-08: after a scope change, structure steps wait until the material is read again',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([{id:1,title:'Paper 1'}]);let prepared=0;S.prepareSlides=async()=>{prepared++;};
 await S.patch(d.id,x=>{x.materialsReady=false;x.outlineCustomized=true;x.step=2;});
 const {ui}=await screen(E);ui.pptDraft=S.get(d.id);let body=element('div');ui.pptOutline(body);
 await button(body,'确认结构并编排页面').onclick();assert.equal(prepared,0);assert.match(ui.pptTaskText,/重新读取|读取材料/);
 await S.patch(d.id,x=>{x.step=1;});ui.pptDraft=S.get(d.id);body=element('div');ui.pptTemplates(body);
 await button(body,'继续编辑结构').onclick();assert.equal(S.get(d.id).step,1,'the outline step is not opened on stale material');assert.match(ui.pptTaskText,/读取材料/);
});
test('PPT-21: material warnings appear while choosing material and the template, before the outline',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([{id:1,title:'Paper 1'}]),warning='Paper 1：没有匹配的 PDF，无法读取所选范围';
 await S.patch(d.id,x=>{x.materialsReady=true;x.materialWarnings=[warning];});const {ui}=await screen(E);ui.pptDraft=S.get(d.id);
 for(const stage of ['pptMaterials','pptTemplates']){const body=element('div');ui[stage](body);assert.ok(walk(body).some(node=>node.textContent===warning),stage+' shows the warning');}
});
test('PPT-23: a page that generated after a failure no longer offers 重试 or the old error',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([]);
 await S.patch(d.id,x=>{x.slides=[textPage('g1',{status:'generated',error:'AI 请求超时，已有内容已保留'}),textPage('f1',{status:'failed',error:'内容过于简略'})];});
 const {ui}=await screen(E);ui.pptDraft=S.get(d.id);const body=element('div');ui.pptVisuals(body);
 const cards=walk(body).filter(node=>node.className==='ppt-progress-page'),retry=card=>walk(card).some(node=>node.tag==='button'&&node.textContent==='重试');
 assert.equal(retry(cards[0]),false,'a generated page has no retry');assert.equal(retry(cards[1]),true,'a failed page keeps its retry');
});
const many=count=>Array.from({length:count},(_,i)=>({id:i+1,title:'Paper '+(i+1)}));
test('R2 review: opening the PPT page with more than 12 items selected opens an empty report and says why',async()=>{
 const E=await studio({selection:many(13)}),S=E.studio,{ui}=await screen(E);
 await ui.openPPTStudio({});
 assert.ok(ui.pptDraft,'the page opens');assert.equal(ui.pptDraft.papers.length,0);
 assert.match(ui.pptTaskText,/选中了 13 篇论文，超过一次最多 12 篇，没有自动加入/);assert.equal(ui.pptTaskDraftID,ui.pptDraft.id);
 await ui.openPPTStudio({newDraft:true});assert.equal(ui.pptDraft.papers.length,0,'新建 with the same selection also opens');assert.ok(S.get(ui.pptDraft.id));
});
test('R7 review: a report created from chosen papers survives a switch and closing the page; an empty one does not',async()=>{
 const E=await studio(),S=E.studio,worked=await S.create([]);await S.patch(worked.id,x=>{x.title='上周的方法汇报';x.slides=[textPage('w1')];x.materialsReady=true;});
 const {ui,listeners}=await screen(E,{fallback:true});ui.initPPTStudio();
 await ui.openPPTStudio({newDraft:true,papers:many(3)});const chosen=ui.pptDraft.id;
 assert.equal(S.isPristine(S.get(chosen)),false);
 await ui.openPPTStudio({draftID:worked.id});await tick();await tick();assert.ok(S.get(chosen),'switching away keeps the chosen papers');
 await ui.openPPTStudio({draftID:chosen});for(const [type,fn] of listeners)if(type==='pagehide')fn();await tick();await tick();
 assert.deepEqual([...S.get(chosen).papers].map(row=>row.id),[1,2,3],'closing the page keeps them too');
});
test('R1 review: a page that opens with nothing chosen reuses an unused empty draft an earlier session left',async()=>{
 const first=await studio(),firstPage=(await screen(first)).ui;await firstPage.openPPTStudio({});const left=firstPage.pptDraft.id;
 // The app quit before pagehide removed it; the next session starts from the saved store.
 const E=await studio({saved:first.store.snapshot(),seed:100}),{ui}=await screen(E);
 await ui.openPPTStudio({});
 assert.equal(ui.pptDraft.id,left,'the leftover empty draft is reused');assert.equal(Object.keys(E.store.snapshot().pptDrafts).length,1,'no second empty draft is stored');
});
test('R9 review: opening the PPT page while a task runs keeps the task report on screen',async()=>{
 const E=await studio(),S=E.studio,x=await S.create([{id:1,title:'Paper 1'}]);await S.patch(x.id,d=>{d.title='较早的汇报 X';d.materialsReady=true;});
 await new Promise(resolve=>setTimeout(resolve,5));const y=await S.create([{id:2,title:'Paper 2'}]);await S.patch(y.id,d=>{d.title='最近的汇报 Y';d.materialsReady=true;});
 const {ui}=await screen(E);let message='';ui.status=text=>message=text;await ui.openPPTStudio({draftID:x.id});
 let release;const task=ui.pptTask(async()=>{await new Promise(resolve=>release=resolve);});await tick();
 await ui.openPPTStudio({papers:[]});
 assert.equal(ui.pptDraft.id,x.id,'the running report stays on screen');assert.equal(ui.pptTaskDraftID,ui.pptDraft.id);assert.match(message,/当前汇报任务正在进行/);
 release();await task;
});
test('PPT-27 review: 加入汇报 adds the paper to the report on screen, names it, and refuses while its task runs',async()=>{
 const E=await studio(),S=E.studio,old=await S.create([{id:1,title:'Paper 1'}]);
 await S.patch(old.id,x=>{x.title='上周的方法汇报';x.materialsReady=true;x.outlineApproved=true;x.step=5;x.slides=[textPage('p1')];});
 await new Promise(resolve=>setTimeout(resolve,5));
 const {ui}=await screen(E);await ui.openPPTStudio({newDraft:true,papers:[]});const fresh=ui.pptDraft.id;await ui.pptPatch(x=>{x.title='新的汇报';});
 await ui.openPPTStudio({papers:[{id:7,title:'Paper 7'}],add:true});
 assert.equal(ui.pptDraft.id,fresh,'the report on screen receives the paper');assert.deepEqual([...S.get(fresh).papers].map(row=>row.id),[7]);
 const older=S.get(old.id);assert.deepEqual([...older.papers].map(row=>row.id),[1]);assert.equal(older.materialsReady,true,'the finished report is not reset');
 assert.match(ui.pptTaskText,/已把“Paper 7”加入“新的汇报”；请在“选择材料”中重新读取材料后再导出/);
 let release;const task=ui.pptTask(async()=>{await new Promise(resolve=>release=resolve);});await tick();
 let message='';ui.status=text=>message=text;await ui.openPPTStudio({papers:[{id:8,title:'Paper 8'}],add:true});
 assert.deepEqual([...S.get(fresh).papers].map(row=>row.id),[7],'a running report is not changed');assert.match(message,/论文未加入，汇报未改动/);
 release();await task;
 // A task in another page (another tab) on the same report also refuses it.
 const other=(await screen(E)).ui;S.taskStarted(fresh);await other.openPPTStudio({papers:[{id:8,title:'Paper 8'}],add:true});S.taskEnded(fresh);
 assert.deepEqual([...S.get(fresh).papers].map(row=>row.id),[7]);assert.match(other.pptTaskText,/正在运行任务，论文未加入/);
});
test('R4 review: a failed 本周研究汇报 is not saved on the report on screen, and 重试 opens the weekly report',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([]);await S.patch(d.id,x=>{x.title='方法对比汇报';x.slides=[textPage('a1')];x.materialsReady=true;x.step=5;x.lastTaskError={message:'第 2 篇论文读取失败：解析器退出',at:'t'};});
 let fail=true;S.createWeekly=async()=>{if(fail)throw Error('所选范围过去七天没有研究记录。阅读、批注或保存研究笔记后可生成周报。');const w=await S.create([]);return S.patch(w.id,x=>{x.title='本周研究进展';x.weeklyRange={start:'a',end:'b',scope:{label:'课题组'}};x.slides=[textPage('w1')];x.materialsReady=true;x.outlineApproved=true;x.step=5;});};
 const {ui,view}=await screen(E,{real:true});ui.pptDraft=S.get(d.id);ui.renderPPT();
 await ui.createWeeklyPPT();
 assert.equal(S.get(d.id).lastTaskError.message,'第 2 篇论文读取失败：解析器退出','the report keeps its own saved failure');
 assert.match(view.querySelector('#ppt-task').children[0].textContent,/过去七天没有研究记录/,'the task bar shows the weekly failure');
 fail=false;await button(view.querySelector('#ppt-task'),'从未完成处重试').onclick();
 assert.equal(ui.pptDraft.title,'本周研究进展','重试 opens the new weekly report');assert.equal(S.get(d.id).lastTaskError.message,'第 2 篇论文读取失败：解析器退出');
});
test('PPT-07 review: a refused export is shown but not saved, so a reopened report does not replay it',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([]);await S.patch(d.id,x=>{x.title='';x.materialsReady=true;x.slides=[textPage('r1')];});
 const {ui,view}=await screen(E,{real:true});ui.pptDraft=S.get(d.id);ui.renderPPT();E.pick=async()=>{throw Error('不应选择文件夹');};
 await ui.pptTask((status,signal)=>ui.pptExportCurrent(status,signal));
 assert.match(ui.pptTaskText,/项内容需要处理，已打开汇报检查/);assert.equal(S.get(d.id).lastTaskError,undefined,'nothing is saved');
 assert.equal(button(view.querySelector('#ppt-task'),'从未完成处重试'),undefined,'there is nothing to retry');
 const reopened=await screen(E,{real:true});reopened.ui.pptDraft=S.get(d.id);reopened.ui.renderPPT();
 assert.doesNotMatch(reopened.view.querySelector('#ppt-task').children[0].textContent,/上次任务未完成/);
});
test('PPT-22 review: a refused confirmation keeps the blank field marked and starts no task or retry',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([{id:1,title:'Paper 1'}]);let prepared=0;S.prepareSlides=async()=>{prepared++;};
 await S.patch(d.id,x=>{x.materialsReady=true;x.step=2;});
 const {ui,view}=await screen(E,{real:true});ui.pptDraft=S.get(d.id);ui.renderPPT();
 let title=field(view,'input','板块标题');title.value='  ';await title.onchange();
 await button(view,'确认结构并编排页面').onclick();await tick();
 assert.equal(prepared,0);assert.ok(!ui.pptAbort);assert.equal(S.get(d.id).lastTaskError,undefined,'a refusal is not saved');
 title=field(view,'input','板块标题');assert.equal(title.value,'  ','the blank stays in the field');assert.equal(title.getAttribute('aria-invalid'),'true');
 assert.equal(button(view.querySelector('#ppt-task'),'从未完成处重试'),undefined);assert.match(view.querySelector('#ppt-task').children[0].textContent,/标题或讲述任务为空/);
 ui.renderPPT();title=field(view,'input','板块标题');assert.equal(title.value,'  ','a re-render keeps the blank');assert.equal(title.getAttribute('aria-invalid'),'true');
 title.value='新的封面';await title.onchange();assert.equal(S.get(d.id).outline[0].title,'新的封面');
 await button(view,'确认结构并编排页面').onclick();assert.equal(prepared,1,'a filled outline is confirmed');
});
test('PPT-08 review: reopening a deck with pages and no papers keeps its step, so export stays reachable',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([]);await S.patch(d.id,x=>{x.title='我的进展';x.slides=[textPage('u1')];x.materialsReady=true;x.outlineApproved=true;x.step=5;});
 const {ui}=await screen(E);await ui.openPPTStudio({draftID:d.id});
 const after=S.get(d.id);assert.equal(after.step,5);assert.equal(after.materialsReady,true);assert.equal(after.outlineApproved,true);
});
test('PPT-12 review: the 讲者备注 field stops at 3000 characters',async()=>{
 const E=await studio(),S=E.studio,d=await S.create([]);await S.patch(d.id,x=>{x.step=4;});const {ui}=await screen(E);ui.pptDraft=S.get(d.id);
 const body=element('div');ui.pptContributions(body);assert.equal(field(body,'textarea','讲者备注').maxLength,3000);
});
