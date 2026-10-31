/* SPDX-License-Identifier: AGPL-3.0-or-later */
// DC-08 and the first exclusion snapshot: when the assembly material details
// pane is rebuilt. A title editor that is open, the first native annotation
// snapshot and source updates must not rebuild it under the user, and a late
// save must not pull it back. These tests run the real assembly code (main.mjs
// persist/status/materialDetails/refresh*, editor.mjs renderEditor/renderDetails,
// canvas-display.mjs) against the real services (storage.js, manuscript.js,
// manuscript-writing.js, manuscript-index.js) on a fake DOM with a virtual
// clock. Removing a focused element fires no blur in Gecko; neither does the fake DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as M from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import * as Policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Exclusions from '../../chrome/content/zotero/research/shared/material-exclusions.mjs';
import * as ExclusionEvents from '../../chrome/content/zotero/research/shared/material-exclusion-events.mjs';
import * as Content from '../../chrome/content/zotero/research/shared/material-content.mjs';
import * as Annotations from '../../chrome/content/zotero/research/shared/material-project-annotations.mjs';
import * as Language from '../../chrome/content/zotero/research/shared/material-language.mjs';
import * as Sections from '../../chrome/content/zotero/research/shared/article-section-materials.mjs';
import * as Topics from '../../chrome/content/zotero/research/shared/topic-materials.mjs';
import * as Thread from '../../chrome/content/zotero/research/shared/research-thread.mjs';
import * as Writing from '../../chrome/content/zotero/research/shared/assembly-writing-preview.mjs';
import * as Framework from '../../chrome/content/zotero/research/shared/writing-framework.mjs';
import * as Selection from '../../chrome/content/zotero/research/manuscript/selection-target.mjs';
import * as Corpus from '../../chrome/content/zotero/research/shared/corpus-library.mjs';
import {referencedAssetsChanged,rememberAssetViewDefaults,assetViewProjectSnapshot} from '../../chrome/content/zotero/research/manuscript/assembly-asset-view.mjs';
import {descriptionOnlyChange,refreshMaterialDescriptions} from '../../chrome/content/zotero/research/shared/material-description-refresh.mjs';
import {libraryAsset} from '../../chrome/content/zotero/research/shared/material-access.mjs';
import {materialAnchors} from '../../chrome/content/zotero/research/shared/material-clues.mjs';
import {assemblyCanvasMode} from '../../chrome/content/zotero/research/shared/assembly-direction.mjs';
import {materialSearchScope} from '../../chrome/content/zotero/research/manuscript/material-research-filters.mjs';

const read=async path=>(await readFile(new URL('../../chrome/content/zotero/'+path,import.meta.url),'utf8')).replace(/\r/g,'');
const sources={storage:await read('xpcom/research/storage.js'),services:await Promise.all(['manuscript.js','manuscript-writing.js','manuscript-index.js'].map(file=>read('xpcom/research/'+file))),main:await read('research/manuscript/main.mjs'),editor:await read('research/manuscript/editor.mjs'),canvas:await read('research/manuscript/canvas-display.mjs'),coalesced:await read('research/shared/coalesced-save.mjs')};
const cut=(source,from,to)=>{const start=source.indexOf(from),end=to?source.indexOf(to,start+from.length):source.length;assert.ok(start>=0&&end>start,from);return source.slice(start,end).replace(/^export /gm,'');};
const between=(source,from,to)=>{const start=source.indexOf(from)+from.length,end=source.indexOf(to,start);assert.ok(start>=from.length&&end>start,from);return source.slice(start,end);};
const assembly=[
	cut(sources.coalesced,'export function createCoalescedSave('),
	cut(sources.main,'export function status(','\nexport function field('),
	cut(sources.main,'export function snapshot(','\nexport function reconcileMaterialSections('),
	cut(sources.main,'let saveQueue,catalogSignature;','\nexport function selectBlock('),
	cut(sources.main,'export function selected(','\nfunction openCoauthor('),
	cut(sources.main,'function assetDetailSignature(','\nexport function insertMaterial('),
	cut(sources.main,'export function clearDetails(','\nexport async function saveMaterialHighlights('),
	cut(sources.main,'export function materialDetails(','\nexport async function openMaterial('),
	cut(sources.canvas,'const legacyDigest=','\nexport function closeWritingDigest('),
	'let formulaEditorController;',cut(sources.editor,'export function renderEditor(','\nfunction paperOverflows('),cut(sources.editor,'export function renderDetails('),
	// The notebook subscription that init() installs.
	"const id='p',notebookChanged="+between(sources.main,'U.E.notebook.subscribe(',');Object.assign(U,{persist,')+';',
	'Object.assign(this,{showMaterial:materialDetails,refreshAssets:refreshAssetViews,refreshExclusions:refreshMaterialExclusionViews,renderEditor,renderDetails,notebookChanged});'
].join('\n');
const modules={'manuscript-model.mjs':M,'research-ai-policy.mjs':Policy,'material-exclusions.mjs':Exclusions,'material-exclusion-events.mjs':ExclusionEvents,'material-content.mjs':Content,'material-project-annotations.mjs':Annotations,'material-language.mjs':Language,'article-section-materials.mjs':Sections,'topic-materials.mjs':Topics,'research-thread.mjs':Thread,'assembly-writing-preview.mjs':Writing,'writing-framework.mjs':Framework,'selection-target.mjs':Selection,'corpus-library.mjs':Corpus};
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
const key=(name,extra={})=>({key:name,preventDefault(){},stopPropagation(){},...extra});
class Node{
	constructor(tag,text,cls){const classes=new Set();this.tag=tag;this.children=[];this.parent=null;this.dataset={};this.attributes=new Map();this.style={};this.className=cls||'';this._text=text===undefined?'':String(text);this.value='';this.classList={add:(...names)=>names.forEach(name=>classes.add(name)),remove:(...names)=>names.forEach(name=>classes.delete(name)),toggle:(name,on=!classes.has(name))=>{if(on)classes.add(name);else classes.delete(name);return on;},contains:name=>classes.has(name)};}
	get isConnected(){let node=this;while(node.parent)node=node.parent;return !!node.root;}
	get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
	set textContent(value){for(const child of this.children)child.parent=null;this.children=[];this._text=String(value??'');}
	append(...nodes){for(let node of nodes){if(typeof node!=='object')node=new Node('#text',node);node.remove();node.parent=this;this.children.push(node);}}
	replaceChildren(...nodes){for(const child of this.children)child.parent=null;this.children=[];this._text='';this.append(...nodes);}
	remove(){if(!this.parent)return;this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}
	querySelectorAll(selector){return this.children.flatMap(child=>[...(child.tag===selector?[child]:[]),...child.querySelectorAll(selector)]);}
	querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
	setAttribute(name,value){this.attributes.set(name,String(value));}
	getAttribute(name){return this.attributes.has(name)?this.attributes.get(name):null;}
	removeAttribute(name){this.attributes.delete(name);}
	focus(){}
	select(){}
}
// A virtual clock for both realms: notify debounce, coalesced saves, exclusion flushes.
function clock(){
	let now=Date.UTC(2026,9,30,8),serial=0;const timers=new Map();
	class FakeDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
	const setTimeout=(fn,ms=0)=>{const id=++serial;timers.set(id,{at:now+Math.max(0,Number(ms)||0),fn});return id;},clearTimeout=id=>{timers.delete(id);};
	const advance=async ms=>{const end=now+ms;await settle();for(;;){let next=null;for(const entry of timers)if(entry[1].at<=end&&(!next||entry[1].at<next[1].at))next=entry;if(!next)break;timers.delete(next[0]);now=Math.max(now,next[1].at);next[1].fn();await settle();}now=end;await settle();};
	return {Date:FakeDate,setTimeout,clearTimeout,advance};
}
const asset=(id,attachmentID,extra={})=>({id,assetID:id,kind:'paragraph',revision:2,title:'原标题',summary:'这是原有的中文说明。',sourceText:'Original source paragraph for '+id+'.',anchor:{attachmentID,pageIndex:0,sourceText:'Original source paragraph for '+id+'.'},...extra});
// One project p with materials m1 (PDF 7) and m2 (PDF 8) on the real store and services.
async function fixture({assets=[asset('m1',7),asset('m2',8,{title:'第二份素材'})],project=['m1','m2'],local=[],unloaded=[],marks={}}={}){
	const time=clock(),errors=[],observers=[];let gate=null,failures=0,writes=0,annotationSync=null;
	const io={read:async()=>({version:1,papers:{},projects:{},settings:{},researchMaterials:Object.fromEntries(assets.map(row=>[row.id,row])),researchNotebooks:{},materialExclusionQuotes:{},manuscripts:{p:{schemaVersion:1,id:'p',title:'研究',revision:0,sections:[],blocks:[],chat:[],proposals:[],materials:[...assets.filter(row=>project.includes(row.id)),...local].map(row=>structuredClone(row)),ui:{step:0,left:'materials',leftOpen:true,rightOpen:true,assemblyFlowVersion:3,catalog:{selection:[]}}}}}),
		// A held or failing write stands for a slow or broken workspace file under a material edit.
		write:async(_next,branches)=>{if(!branches?.includes('researchMaterials'))return;writes++;if(gate)await gate.promise;if(failures>0){failures--;throw Error('存储写入失败');}}};
	const E={assets:{key:JSON.stringify},setTimeout:time.setTimeout,clearTimeout:time.clearTimeout,studio:{request:async()=>({value:{summaries:[]},model:'fixture'})}};
	vm.runInNewContext(sources.storage,{EasySch:E,Zotero:{logError:error=>errors.push(error)}});E.store=E.createStore(io);await E.store.init();
	const attachments=new Map([7,8,9].map(id=>[id,{id,loaded:!unloaded.includes(id),deleted:false,marks:marks[id]||[],async loadDataType(){this.loaded=true;},getAnnotations(){if(!this.loaded)throw Object.assign(Error('childItems not loaded'),{name:'UnloadedDataException'});return this.marks;}}]));
	const item=id=>attachments.get(Number(id))||[...attachments.values()].flatMap(row=>row.marks).find(mark=>mark.id===Number(id));
	const Zotero={Research:E,logError:error=>errors.push(error),getMainWindow:()=>({AbortController}),Utilities:{randomString:()=>'fixture'},Items:{get:item,getAsync:async id=>item(id),loadDataTypes:async()=>{}},Notifier:{registerObserver:observer=>{observers.push(observer);return 'observer';},unregisterObserver(){}}};
	const context=vm.createContext({Zotero,ChromeUtils:{importESModule:url=>{const module=modules[url.split('/').at(-1)];if(!module)throw Error('Unexpected import '+url);return module;}},URL,Date:time.Date});
	for(const code of sources.services)vm.runInContext(code,context);
	const A=E.manuscripts;A.ensureLibraryItem=async()=>{};
	// Linked PDF annotation sync is a native service; a test marks one project copy as changed by it.
	A.applyMaterialAnnotationUpdates=p=>{const row=annotationSync&&p.materials.find(material=>material.id===annotationSync);annotationSync=null;if(!row)return false;row.annotationRevision=(row.annotationRevision||0)+1;return true;};
	const N={data:{query:'',selectedMaterial:null,recentQueries:[]},listeners:new Set(),state(){return structuredClone(this.data);},catalogChanged(){},subscribe(fn){this.listeners.add(fn);return ()=>this.listeners.delete(fn);},
		async update(id,change){if(Object.entries(change).every(([name,value])=>JSON.stringify(this.data[name])===JSON.stringify(value)))return;await null;Object.assign(this.data,structuredClone(change));for(const fn of this.listeners)fn(id,change);},
		select(id,materialID){return this.update(id,{selectedMaterial:materialID});}};
	E.notebook=N;
	const box=new Node('div'),nodes={details:box,library:new Node('div'),status:new Node('div'),'ai-notice':new Node('div'),'save-status':new Node('span'),canvas:new Node('div')};for(const node of Object.values(nodes))node.root=true;
	const U={E,A,M,ready:true,p:structuredClone(A.get('p')),undo:[],redo:[],saving:Promise.resolve(),busy:false,workflow:{closePanel(){}},assetBranches:new Set()};U.savedRevision=U.p.revision;U.materialExclusionAttachments=A.materialAttachmentIDs(U.p.materials);
	const overviews=[],explanations=[],library={renders:0};
	const sandbox={U,M,$:id=>nodes[id]||null,el:(tag,text,cls)=>new Node(tag,text,cls),document:{querySelector:()=>null,querySelectorAll:()=>[]},window:{addEventListener(){}},setTimeout:time.setTimeout,clearTimeout:time.clearTimeout,Date:time.Date,
		libraryAsset,materialAnchors,mergeMaterialAsset:Annotations.mergeMaterialAsset,saveProjectMaterialHighlights:Annotations.saveProjectMaterialHighlights,referencedAssetsChanged,rememberAssetViewDefaults,assetViewProjectSnapshot,descriptionOnlyChange,refreshMaterialDescriptions,assemblyCanvasMode,materialSearchScope,
		disposeMediaPreviews(){},disposeInlineFormulas(){},disposeCanvasMedia(){},syncCanvasDisplay(){},applyPanels(){},renderAssessment(){},openMaterial(){},refreshMaterial(){},insertMaterial(){},attachMaterial(){},selectBlock(){},saveMaterialHighlights(){},materialPreview(){},renderLibrary:()=>{library.renders++;},
		renderMaterialOverview:(host,display,options)=>{const root=new Node('section',display.sourceText,'material-clues');host.append(root);overviews.push({display,root,options});return {summaryHost:new Node('div'),dispose:()=>root.remove()};},
		renderMaterialExplanationEditor:(_host,display,options)=>{explanations.push({display,options});return {isDirty:()=>false,dispose(){}};}};
	vm.runInNewContext(assembly,sandbox);
	U.unsubscribeMaterialExclusions=A.onMaterialExclusionsChanged(sandbox.refreshExclusions,{attachmentIDs:U.materialExclusionAttachments});
	E.store.subscribe(change=>{for(const name of change?.changedBranches||['*'])U.assetBranches.add(name);});A.onAssetsChanged(sandbox.refreshAssets);N.subscribe(sandbox.notebookChanged);
	const advance=async ms=>{await time.advance(ms);if(errors.length)throw errors[0];};
	const show=id=>{sandbox.showMaterial(U.p.materials.find(row=>row.id===id)||A.assetLibraryView()[id]);return box.querySelector('h3');};
	const open=id=>{const heading=show(id);heading.ondblclick();return {heading,input:heading.querySelector('input')};};
	return {E,A,U,N,box,nodes,overviews,explanations,library,observers,sandbox,show,open,advance,flush:()=>advance(2500),
		hold(){let release;const promise=new Promise(resolve=>{release=resolve;});gate={promise};return ()=>{gate=null;release();};},fail(count){failures=count;},syncAnnotation(id){annotationSync=id;A.notifyAssetsChanged();},
		edit:(id,patch)=>A.editAsset(id,patch,E.store.get('researchMaterials',id).revision),stored:id=>E.store.get('researchMaterials',id),
		marks:id=>attachments.get(id).marks,notify:(event,ids)=>{for(const observer of observers)observer.notify(event,'item',ids);},
		notice:()=>({text:nodes.status.textContent,error:nodes.status.classList.contains('error')}),button:action=>box.querySelectorAll('button').find(node=>node.dataset.action===action),
		get writes(){return writes;}};
}
test('a failed rename keeps the editor and the typed title, Enter retries it, and the success replaces the error',async()=>{
	const f=await fixture(),{heading,input}=f.open('m1');
	input.value='我改的标题';f.fail(2);
	input.onkeydown(key('Enter'));await f.flush();
	assert.ok(input.isConnected,'the editor stays open after the failure');
	assert.equal(input.value,'我改的标题','the typed title is not lost');
	assert.match(heading.textContent,/标题未保存：存储写入失败/);
	assert.equal(input.getAttribute('aria-invalid'),'true');
	assert.equal(input.readOnly,false,'the field is editable again');
	assert.equal(f.writes,2,'one automatic retry');
	assert.deepEqual(f.notice(),{text:'“原标题”的新标题“我改的标题”未保存：存储写入失败。',error:true});
	input.onkeydown(key('Enter'));await f.flush();
	assert.equal(f.stored('m1').title,'我改的标题');assert.equal(f.U.p.materials[0].title,'我改的标题');
	assert.equal(input.isConnected,false);
	assert.equal(f.box.querySelector('h3').textContent,'我改的标题');
	assert.deepEqual(f.notice(),{text:'已保存新标题“我改的标题”',error:false},'the error is replaced once the title is saved');
});
test('background changes and canvas renders do not rebuild an open title editor; the details redraw with the latest record when it closes',async()=>{
	const triggers={'the same material is revised elsewhere':f=>f.edit('m1',{summary:'后台更新的说明'}),'another referenced material is revised':f=>f.edit('m2',{summary:'第二份的新说明'}),'a linked PDF annotation syncs':f=>f.syncAnnotation('m1'),'a chapter read renders the canvas':f=>f.sandbox.renderEditor()};
	for(const [name,trigger] of Object.entries(triggers)){
		const f=await fixture(),{input}=f.open('m1');input.value='我改的标题';
		await trigger(f);await f.flush();
		assert.ok(input.isConnected,name+': the open editor survives');assert.equal(input.value,'我改的标题',name);
		input.onkeydown(key('Enter'));await f.flush();
		assert.equal(f.stored('m1').title,'我改的标题',name+': the title is saved');
		assert.equal(f.box.querySelector('h3').textContent,'我改的标题',name);assert.equal(f.box.dataset.materialId,'m1',name);
		assert.equal(f.overviews.at(-1).display.revision,f.stored('m1').revision,name+': the details show the current record');
		if(name.startsWith('the same'))assert.equal(f.stored('m1').summary,'后台更新的说明','the background change is kept');
	}
});

test('a title changed elsewhere asks before it is overwritten, also when the change notification arrives after Enter',async()=>{
	const f=await fixture(),{heading,input}=f.open('m1');
	input.value='我改的标题';await f.edit('m1',{title:'别处的标题'});
	input.onkeydown(key('Enter'));await settle();
	assert.match(heading.textContent,/别处改为“别处的标题”/);
	await f.flush();
	assert.ok(input.isConnected,'the pending notification does not remove the question');assert.match(heading.textContent,/别处改为“别处的标题”/);
	const writes=f.writes;input.onblur();await f.flush();
	assert.equal(f.writes,writes,'leaving the field does not overwrite');
	input.onkeydown(key('Enter'));await f.flush();
	assert.equal(f.stored('m1').title,'我改的标题');assert.equal(f.writes,writes+1);
	assert.equal(f.box.querySelector('h3').textContent,'我改的标题');
	const again=f.open('m1');again.input.value='放弃的标题';again.input.onkeydown(key('Escape'));await f.flush();
	assert.equal(f.stored('m1').title,'我改的标题','Esc cancels');assert.equal(f.box.querySelector('h3').textContent,'我改的标题');
});

test('a save that finishes after the user moved on does not pull the details, preview or notebook selection back',async()=>{
	const moves={'opens another material':f=>f.show('m2'),'returns to the manuscript':f=>f.button('return-module').onclick(),'selects another material in the notebook':f=>f.N.select('p','m2')};
	for(const [name,move] of Object.entries(moves)){
		const f=await fixture(),{input}=f.open('m1');input.value='我改的标题';
		input.onkeydown(key('Enter'));await f.advance(320);
		assert.ok(input.isConnected&&f.U.materialRenaming?.stale,name+': the rename notification arrived while the save is pending');
		input.onblur();await move(f);await settle();
		const expected=name.startsWith('returns')?undefined:'m2';assert.equal(f.box.dataset.materialId,expected,name);
		await f.flush();
		assert.equal(f.stored('m1').title,'我改的标题',name+': the title is saved');
		assert.equal(f.box.dataset.materialId,expected,name+': the details stay where the user went');
		assert.equal(f.U.previewMaterialID,expected??null,name);assert.equal(f.N.data.selectedMaterial,expected??null,name+': the notebook selection is not changed back');
	}
});

test('a save that finishes after the right pane was collapsed does not reopen it',async()=>{
	const f=await fixture(),{heading,input}=f.open('m1');input.value='我改的标题';
	input.onkeydown(key('Enter'));await f.advance(320);assert.ok(f.U.materialRenaming?.stale);
	f.U.p.ui.rightOpen=false;await f.flush();
	assert.equal(f.U.p.ui.rightOpen,false);assert.equal(heading.textContent,'我改的标题');assert.equal(f.stored('m1').title,'我改的标题');
});
test('while a rename saves, the field is locked and Esc waits for the save; a failed save unlocks it',async()=>{
	const f=await fixture(),{heading,input}=f.open('m1'),release=f.hold();input.value='新标提';
	input.onkeydown(key('Enter'));await settle();
	assert.equal(input.readOnly,true,'the field is locked while the write is pending');assert.equal(input.getAttribute('aria-busy'),'true');assert.match(heading.textContent,/正在保存…/);
	input.onkeydown(key('Escape'));input.onblur();await settle();
	assert.ok(input.isConnected,'Esc does not close the box while the title is being written');
	release();await f.flush();
	assert.equal(f.stored('m1').title,'新标提');assert.equal(input.isConnected,false);assert.equal(f.box.querySelector('h3').textContent,'新标提');
	const again=f.open('m1');again.input.value='第二次的标题';f.fail(2);again.input.onkeydown(key('Enter'));await f.flush();
	assert.equal(again.input.readOnly,false,'a failed save unlocks the field');assert.equal(again.input.getAttribute('aria-busy'),null);assert.equal(again.input.value,'第二次的标题');
});

test('when a rename fails after its box is gone, the status bar names the material and the typed title without box instructions',async()=>{
	const f=await fixture();let opened=f.open('m1');
	opened.input.value='我改的标题';await f.edit('m1',{title:'别处的标题'});
	opened.input.onblur();await settle();f.show('m2');await f.flush();
	assert.equal(f.box.dataset.materialId,'m2');
	assert.deepEqual(f.notice(),{text:'“原标题”的新标题“我改的标题”未保存：这份素材的标题已在别处改为“别处的标题”。',error:true});
	const g=await fixture();opened=g.open('m1');g.fail(2);const release=g.hold();
	opened.input.value='我改的标题';opened.input.onblur();await settle();g.show('m2');release();await g.flush();
	assert.equal(g.box.dataset.materialId,'m2');assert.equal(g.stored('m1').title,'原标题');
	assert.deepEqual(g.notice(),{text:'“原标题”的新标题“我改的标题”未保存：存储写入失败。',error:true});
});
test('a full-text passage hit offers no rename, also after a highlight copies it into the project',async()=>{
	const f=await fixture(),text='The measurement setup uses two calibrated cameras and a fixed target.',passage={id:'passage-9-0',title:'2.1 Methods',sourceText:text,paperItemID:5,attachmentID:9,pageIndex:2,kind:'paragraph',summary:'',anchor:{paperItemID:5,attachmentID:9,pageIndex:2,sourceText:text}};
	for(const step of ['a fresh hit','after a highlight save']){
		if(step!=='a fresh hit')Annotations.saveProjectMaterialHighlights(f.U.p,passage,[{id:'h1',text:'two calibrated cameras',comment:''}]);
		f.sandbox.showMaterial({...passage});await f.flush();
		const heading=f.box.querySelector('h3');
		assert.equal(heading.ondblclick,undefined,step);assert.notEqual(heading.tabIndex,0,step);assert.notEqual(heading.title,'双击修改标题',step);
		heading.onkeydown?.(key('F2'));assert.equal(heading.querySelector('input'),null,step+': F2 opens no editor');
	}
	assert.equal(f.writes,0);
});

test('renaming a project-only corpus copy shows the typed title instead of the derived section label',async()=>{
	const text='The cameras are calibrated before each run.',copy={id:'corpus-e1',kind:'paragraph',sectionType:'方法',title:'Methods',summary:'说明测量装置与样本。',sourceText:text,paperTitle:'Camera IoT measurement study',origin:'manual',revision:1,anchor:{attachmentID:9,pageIndex:0,sourceText:text}};
	const f=await fixture({local:[copy]}),label=f.A.titleFor(copy),heading=f.show('corpus-e1');
	assert.match(label,/^方法 · /);assert.equal(heading.textContent,label);
	heading.ondblclick();const input=heading.querySelector('input');assert.equal(input.value,'Methods');
	input.value='我的方法条目';input.onkeydown(key('Enter'));await f.flush();
	const row=f.U.p.materials.find(m=>m.id==='corpus-e1');
	assert.equal(row.title,'我的方法条目');assert.equal(row.userEdited,true);
	assert.equal(f.box.querySelector('h3').textContent,'我的方法条目');assert.equal(f.A.titleFor(row),'我的方法条目','the list card uses the same label');
	assert.equal(f.writes,0,'a project-only copy writes no shared material');
});

test('a library-only rename closed after a newer revision shows that revision, and its explanation saves against it',async()=>{
	const f=await fixture({assets:[asset('m1',7),asset('lib1',9)],project:['m1']}),{heading,input}=f.open('lib1');
	input.value='我改的标题';await f.edit('lib1',{title:'别处的标题'});await f.flush();
	assert.ok(input.isConnected);input.onkeydown(key('Enter'));await settle();assert.match(heading.textContent,/或按 Esc 保留它/);
	input.onkeydown(key('Escape'));await f.flush();
	assert.equal(f.box.querySelector('h3').textContent,'别处的标题','Esc keeps the title the question named');
	assert.equal(f.overviews.at(-1).display.revision,3);
	const g=await fixture({assets:[asset('m1',7),asset('lib1',9)],project:['m1']}),other=g.open('lib1');
	other.input.value='我改的标题';await g.edit('lib1',{summary:'别处更新的说明'});await g.flush();
	other.input.onkeydown(key('Escape'));await g.flush();
	const editor=g.explanations.at(-1);assert.equal(editor.display.revision,3,'the explanation editor is bound to the current revision');
	const saved=editor.options.onSave({summary:'我写的说明'});await g.flush();await saved;
	assert.equal(g.stored('lib1').summary,'我写的说明');
});

test('after the title question, Enter compares the typed title with the stored one',async()=>{
	for(const [typed,extraWrites] of [['原标题',1],['别处的标题',0]]){
		const f=await fixture({assets:[asset('m1',7),asset('lib1',9)],project:['m1']}),{heading,input}=f.open('lib1');
		input.value='我改的标题';await f.edit('lib1',{title:'别处的标题'});await f.flush();
		input.onkeydown(key('Enter'));await settle();assert.match(heading.textContent,/别处改为“别处的标题”/);
		const writes=f.writes;input.value=typed;input.onkeydown(key('Enter'));await f.flush();
		assert.equal(f.writes-writes,extraWrites,typed);
		assert.equal(f.stored('lib1').title,typed,typed);assert.equal(f.box.querySelector('h3').textContent,typed,typed+': the heading agrees with the store');
	}
});

const excluded=()=>asset('x1',7,{title:'受控素材',sourceText:'Before OMITTED after.',anchor:{attachmentID:7,pageIndex:0,sourceText:'Before OMITTED after.'}});
const strike={id:70,key:'MARK',parentID:7,annotationType:'ink',annotationText:'OMITTED',annotationPosition:JSON.stringify({pageIndex:0}),tags:[{tag:Exclusions.MATERIAL_EXCLUSION_TAG}],isAnnotation:()=>true};

test('the first exclusion snapshot does not rebuild details that already show the same excluded text',async()=>{
	const f=await fixture({assets:[excluded()],project:['x1'],unloaded:[7]});
	f.show('x1');const clues=f.overviews.at(-1).root;
	await f.flush();
	assert.equal(f.overviews.length,1,'loading native annotations without marks keeps the open source drawer');assert.ok(clues.isConnected);
});

test('a mark that exists before native annotations load redraws the details once with the excluded text removed',async()=>{
	const f=await fixture({assets:[excluded()],project:['x1'],unloaded:[7],marks:{7:[strike]}});
	f.show('x1');assert.equal(f.overviews.at(-1).display.sourceText,'Before OMITTED after.','the first paint cannot see unloaded marks');
	await f.advance(100);
	assert.equal(f.overviews.length,2);assert.equal(f.overviews.at(-1).display.sourceText,'Before \n\n after.');
	f.sandbox.refreshExclusions({attachmentIDs:[7]});assert.equal(f.overviews.length,2,'a repeated notification with the same marks does not redraw');
	// The 说明 of the shortened text arrives later and is shown; after that the view is stable.
	await f.flush();const shown=f.overviews.length;
	f.A.notifyAssetsChanged();await f.flush();
	assert.equal(f.overviews.length,shown,'source notifications compare the excluded-text view the details show');
});

test('an exclusion change while the title editor is open waits until it closes',async()=>{
	const f=await fixture({assets:[excluded()],project:['x1']}),{input}=f.open('x1');await f.flush();
	f.marks(7).push(strike);f.notify('add',[70]);await f.flush();
	assert.ok(input.isConnected);assert.equal(f.overviews.length,1);
	input.onkeydown(key('Escape'));await f.advance(100);
	assert.equal(f.overviews.length,2);assert.equal(f.overviews.at(-1).display.sourceText,'Before \n\n after.');
});
