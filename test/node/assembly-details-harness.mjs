/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Runs the real assembly material details, title editor, highlight save and
// canvas render (main.mjs, editor.mjs, canvas-display.mjs) against the real
// services (storage.js, manuscript.js, manuscript-writing.js, manuscript-index.js,
// academic-assistant.js) with a virtual clock, as notebook-gap-material-rename.test.mjs
// does, on the notebook page's DOM (notebook-page-dom.mjs). Focus follows Gecko:
// a script that puts the selection into an editable paragraph focuses that
// paragraph and blurs the field that had focus; removing a focused field fires no blur.
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
import * as Catalog from '../../chrome/content/zotero/research/shared/material-catalog.mjs';
import * as Journal from '../../chrome/content/zotero/research/shared/journal-context.mjs';
import * as MetricLabel from '../../chrome/content/zotero/research/shared/journal-metric-label.mjs';
import {referencedAssetsChanged,rememberAssetViewDefaults,assetViewProjectSnapshot} from '../../chrome/content/zotero/research/manuscript/assembly-asset-view.mjs';
import {descriptionOnlyChange,refreshMaterialDescriptions} from '../../chrome/content/zotero/research/shared/material-description-refresh.mjs';
import {libraryAsset} from '../../chrome/content/zotero/research/shared/material-access.mjs';
import {materialAnchors} from '../../chrome/content/zotero/research/shared/material-clues.mjs';
import {assemblyCanvasMode} from '../../chrome/content/zotero/research/shared/assembly-direction.mjs';
import {materialSearchScope} from '../../chrome/content/zotero/research/manuscript/material-research-filters.mjs';
import {Document,Element,FakeEvent,parseHTML,createWindow,handlerFailures} from './notebook-page-dom.mjs';

const read=async path=>(await readFile(new URL('../../chrome/content/zotero/'+path,import.meta.url),'utf8')).replace(/\r/g,'');
const sources={storage:await read('xpcom/research/storage.js'),services:await Promise.all(['manuscript.js','manuscript-writing.js','manuscript-index.js','academic-assistant.js'].map(file=>read('xpcom/research/'+file))),main:await read('research/manuscript/main.mjs'),editor:await read('research/manuscript/editor.mjs'),canvas:await read('research/manuscript/canvas-display.mjs'),coalesced:await read('research/shared/coalesced-save.mjs')};
const cut=(source,from,to)=>{const start=source.indexOf(from),end=to?source.indexOf(to,start+from.length):source.length;if(start<0||end<=start)throw Error('Missing source region '+from);return source.slice(start,end).replace(/^export /gm,'');};
const between=(source,from,to)=>{const start=source.indexOf(from)+from.length,end=source.indexOf(to,start);if(start<from.length||end<=start)throw Error('Missing source region '+from);return source.slice(start,end);};
const assembly=[
	cut(sources.coalesced,'export function createCoalescedSave('),
	cut(sources.main,'export function status(','\nexport function field('),
	cut(sources.main,'export function snapshot(','\nexport function reconcileMaterialSections('),
	cut(sources.main,'let saveQueue,catalogSignature;','\nexport function selected('),
	cut(sources.main,'export function selected(','\nfunction openCoauthor('),
	cut(sources.main,'function assetDetailSignature(','\nexport function insertMaterial('),
	cut(sources.main,'export function clearDetails(','\nexport function materialDetails('),
	cut(sources.main,'export function materialDetails(','\nexport async function openMaterial('),
	cut(sources.canvas,'const legacyDigest=','\nexport function closeWritingDigest('),
	'let formulaEditorController;',cut(sources.editor,'function captureCaret('),
	// The notebook subscription that init() installs.
	"const id='p',notebookChanged="+between(sources.main,'U.E.notebook.subscribe(',');Object.assign(U,{persist,')+';',
	'Object.assign(this,{showMaterial:materialDetails,refreshAssets:refreshAssetViews,refreshExclusions:refreshMaterialExclusionViews,renderEditor,renderDetails,selectBlock,persist,notebookChanged});'
].join('\n');
const modules={'manuscript-model.mjs':M,'research-ai-policy.mjs':Policy,'material-exclusions.mjs':Exclusions,'material-exclusion-events.mjs':ExclusionEvents,'material-content.mjs':Content,'material-project-annotations.mjs':Annotations,'material-language.mjs':Language,'article-section-materials.mjs':Sections,'topic-materials.mjs':Topics,'research-thread.mjs':Thread,'assembly-writing-preview.mjs':Writing,'writing-framework.mjs':Framework,'selection-target.mjs':Selection,'corpus-library.mjs':Corpus,'material-catalog.mjs':Catalog,'journal-context.mjs':Journal,'journal-metric-label.mjs':MetricLabel,'paper-metadata.mjs':{installPaperMetadata(){}}};
export const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
const outer=value=>(value===undefined?undefined:JSON.parse(JSON.stringify(value)));
export const key=(name,extra={})=>({key:name,preventDefault(){},stopPropagation(){},...extra});
export const asset=(id,attachmentID,extra={})=>({id,assetID:id,kind:'paragraph',revision:2,title:'原标题',summary:'这是原有的中文说明。',sourceText:'Original source paragraph for '+id+'.',anchor:{attachmentID,pageIndex:0,sourceText:'Original source paragraph for '+id+'.'},...extra});

// Gecko: removing a focused element fires no blur, so a later focus does not blur it.
class AssemblyElement extends Element{
	select(){}
	focus(){const doc=this.ownerDocument,previous=doc._active;if(previous===this)return;doc._active=this;if(previous?.isConnected)previous.dispatchEvent(new FakeEvent('blur'));this.dispatchEvent(new FakeEvent('focus'));}
}
class AssemblyDocument extends Document{
	createElement(tag){return new AssemblyElement(this,String(tag));}
	createElementNS(_namespace,tag){return this.createElement(tag);}
	createTextNode(text){const node=super.createTextNode(text);Object.defineProperty(node,'length',{get(){return this.data.length;}});return node;}
	createTreeWalker(root){const nodes=[],walk=node=>{for(const child of node.childNodes){if(child.nodeType===3)nodes.push(child);else walk(child);}};walk(root);let index=-1;return {nextNode:()=>nodes[++index]||null};}
	createRange(){return {startContainer:null,startOffset:0,endContainer:null,endOffset:0,setStart(node,offset){this.startContainer=this.endContainer=node;this.startOffset=this.endOffset=offset;},setEnd(node,offset){this.endContainer=node;this.endOffset=offset;},collapse(){this.endContainer=this.startContainer;this.endOffset=this.startOffset;},selectNodeContents(node){this.startContainer=this.endContainer=node;this.startOffset=0;},cloneRange(){return {...this};},toString:()=>''};}
	execCommand(){return false;}
}
function clock(){
	let now=Date.UTC(2026,9,30,8),serial=0;const timers=new Map();
	class FakeDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
	const setTimeout=(fn,ms=0)=>{const id=++serial;timers.set(id,{at:now+Math.max(0,Number(ms)||0),fn});return id;},clearTimeout=id=>{timers.delete(id);};
	const advance=async ms=>{const end=now+ms;await settle();for(;;){let next=null;for(const entry of timers)if(entry[1].at<=end&&(!next||entry[1].at<next[1].at))next=entry;if(!next)break;timers.delete(next[0]);now=Math.max(now,next[1].at);next[1].fn();await settle();}now=end;await settle();};
	return {Date:FakeDate,setTimeout,clearTimeout,advance};
}

// One project p (section s1) with project materials from `project`, shared
// materials `assets` and extra store branches `store`. `marks` lists the PDF
// annotations of attachments 7, 8 and 9; hold() and fail(count) stand for a
// slow or broken workspace file under a material edit.
export async function fixture({assets=[asset('m1',7),asset('m2',8,{title:'第二份素材'})],project=['m1','m2'],local=[],blocks=[],ui={},store={},parents={9:5},marks={}}={}){
	const time=clock(),errors=[],observers=[],failures=handlerFailures.length;let writes=0,gate=null,failing=0;
	const io={read:async()=>({version:1,papers:{},projects:{},settings:{},researchMaterials:Object.fromEntries(assets.map(row=>[row.id,row])),researchNotebooks:{},materialExclusionQuotes:{},...structuredClone(store),manuscripts:{p:{schemaVersion:1,id:'p',title:'研究',revision:0,sections:[{id:'s1',title:'方法',conclusion:''}],blocks:structuredClone(blocks),chat:[],proposals:[],materials:[...assets.filter(row=>project.includes(row.id)),...local].map(row=>structuredClone(row)),ui:{step:0,left:'materials',leftOpen:true,rightOpen:true,assemblyFlowVersion:3,catalog:{selection:[]},sectionID:'s1',blockID:null,caret:0,...ui}}}}),
		write:async(_next,branches)=>{if(!branches?.includes('researchMaterials'))return;writes++;if(gate)await gate.promise;if(failing>0){failing--;throw Error('存储写入失败');}}};
	const E={assets:{key:JSON.stringify},setTimeout:time.setTimeout,clearTimeout:time.clearTimeout,studio:{request:async()=>({value:{summaries:[]},model:'fixture'})}};
	vm.runInNewContext(sources.storage,{EasySch:E,Zotero:{logError:error=>errors.push(error)}});E.store=E.createStore(io);await E.store.init();
	const attachments=new Map([7,8,9].map(id=>[id,{id,parentID:parents[id]||null,deleted:false,marks:marks[id]||[],async loadDataType(){},getAnnotations(){return this.marks;}}]));
	const item=id=>attachments.get(Number(id))||[...attachments.values()].flatMap(row=>row.marks).find(mark=>mark.id===Number(id));
	const Zotero={Research:E,logError:error=>errors.push(error),debug(){},getMainWindow:()=>({AbortController}),Utilities:{randomString:()=>'fixture'},Items:{get:item,getAsync:async id=>item(id),loadDataTypes:async()=>{}},Notifier:{registerObserver:observer=>{observers.push(observer);return 'observer';},unregisterObserver(){}}};
	const context=vm.createContext({Zotero,IOUtils:{},Services:{},ChromeUtils:{importESModule:url=>{const module=modules[url.split('/').at(-1)];if(!module)throw Error('Unexpected import '+url);return module;}},URL,Date:time.Date});
	for(const code of sources.services)vm.runInContext(code,context);
	const A=E.manuscripts;A.ensureLibraryItem=async()=>{};A.applyMaterialAnnotationUpdates=()=>false;
	const N={data:{query:'',selectedMaterial:null,recentQueries:[]},listeners:new Set(),state(){return structuredClone(this.data);},catalogChanged(){},subscribe(fn){this.listeners.add(fn);return ()=>this.listeners.delete(fn);},
		async update(id,change){if(Object.entries(change).every(([name,value])=>JSON.stringify(this.data[name])===JSON.stringify(value)))return;await null;Object.assign(this.data,structuredClone(change));for(const fn of this.listeners)fn(id,change);},
		select(id,materialID){return this.update(id,{selectedMaterial:materialID});}};
	E.notebook=N;
	const doc=new AssemblyDocument();parseHTML(doc,'<html><body><div id="details"></div><div id="library"></div><div id="status"></div><div id="ai-notice"></div><span id="save-status"></span><div id="canvas"></div></body></html>');
	const editingHost=node=>{let host=null;for(let current=node;current&&current.nodeType!==9;current=current.parentNode)if(current.contentEditable==='true')host=current;return host;};
	// A script selection inside an editing host focuses that host, as in Gecko.
	const selection={ranges:[],adds:0,get rangeCount(){return this.ranges.length;},isCollapsed:true,get anchorNode(){return this.ranges[0]?.startContainer||null;},get anchorOffset(){return this.ranges[0]?.startOffset||0;},getRangeAt(index){return this.ranges[index];},removeAllRanges(){this.ranges=[];},toString:()=>'',
		addRange(range){this.ranges=[range];this.adds++;const host=editingHost(range.startContainer);if(host&&doc.activeElement!==host)host.focus();}};
	const win=createWindow(doc,{getSelection:()=>selection,getComputedStyle:()=>new Proxy({},{get:(_,name)=>(name==='getPropertyValue'?()=>'':'')})});
	const el=(tag,text,cls)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
	const U={E,A,M,ready:true,p:structuredClone(A.get('p')),undo:[],redo:[],saving:Promise.resolve(),busy:false,selectedCells:[],workflow:{closePanel(){},render(){}},assetBranches:new Set()};U.savedRevision=U.p.revision;U.materialExclusionAttachments=A.materialAttachmentIDs(U.p.materials);
	const overviews=[],explanations=[],library={renders:0},math={sources:0};
	const sandbox={U,M,$:key=>doc.getElementById(key),el,document:doc,window:win,getComputedStyle:win.getComputedStyle,NodeFilter:{SHOW_TEXT:4},Event:FakeEvent,setTimeout:time.setTimeout,clearTimeout:time.clearTimeout,Date:time.Date,
		libraryAsset,materialAnchors,mergeMaterialAsset:Annotations.mergeMaterialAsset,saveProjectMaterialHighlights:Annotations.saveProjectMaterialHighlights,referencedAssetsChanged,rememberAssetViewDefaults,assetViewProjectSnapshot,descriptionOnlyChange,refreshMaterialDescriptions,assemblyCanvasMode,materialSearchScope,
		// Collaborators these tests do not exercise.
		field(){},changed(){},verifyBlock(){},findEvidence(){},openMaterial(){},refreshMaterial(){},insertMaterial(){},attachMaterial(){},materialPreview(){},applyPanels(){},renderAssessment(){},renderChat(){},renderLibrary:()=>{library.renders++;},
		syncCanvasDisplay(){},disposeMediaPreviews(){},disposeInlineFormulas(){},disposeCanvasMedia(){},renderAssembly(){},installCanvasMedia(){},applyCanvasBlockDisplay:node=>{node.hidden=false;},placeOnPaper(){},
		paragraphAlignment:()=>'',renderEditableContent:(node,block)=>{node.append(doc.createTextNode(block.text||''));},installEditableMath:()=>({source:()=>{math.sources++;}}),readEditableRuns:node=>[{text:node.textContent}],normalizeFontSizes(){},captureRange:()=>({start:0,end:0}),sliceRuns:runs=>runs,carryParagraphFormat:()=>({}),updateNavigationLabels(){},
		renderModuleDetails:(_U,details,block)=>{const body=el('section',undefined,'module-details');body.dataset.block=block.id;details.append(body);return {body,guard:fn=>fn,isCurrent:()=>true};},
		renderMaterialOverview:(host,display,options)=>{const root=el('section',display.sourceText,'material-clues');host.append(root);overviews.push({display,root,options});return {summaryHost:el('div'),dispose:()=>root.remove()};},
		renderMaterialExplanationEditor:(_host,display,options)=>{explanations.push({display,options});return {isDirty:()=>false,dispose(){}};}};
	vm.runInNewContext(assembly,sandbox);
	U.unsubscribeMaterialExclusions=A.onMaterialExclusionsChanged(sandbox.refreshExclusions,{attachmentIDs:U.materialExclusionAttachments});
	E.store.subscribe(change=>{for(const name of change?.changedBranches||['*'])U.assetBranches.add(name);});A.onAssetsChanged(sandbox.refreshAssets);N.subscribe(sandbox.notebookChanged);
	const box=doc.getElementById('details'),advance=async ms=>{await time.advance(ms);if(errors.length)throw errors[0];};
	const show=id=>{sandbox.showMaterial(U.p.materials.find(row=>row.id===id)||A.assetLibraryView()[id]);return box.querySelector('h3');};
	const open=id=>{const heading=show(id);heading.ondblclick();return {heading,input:heading.querySelector('input')};};
	return {E,A,U,N,doc,box,selection,math,overviews,explanations,library,sandbox,show,open,advance,flush:()=>advance(2500),render:()=>sandbox.renderEditor(),
		hold(){let release;const promise=new Promise(resolve=>{release=resolve;});gate={promise};return ()=>{gate=null;release();};},fail(count){failing=count;},
		paragraph:(blockID=U.p.ui.blockID)=>doc.querySelector('#canvas [data-id="'+blockID+'"] .editable'),
		// Store reads come back as values of this realm, so deepEqual compares content only.
		edit:(id,patch)=>A.editAsset(id,patch,E.store.get('researchMaterials',id).revision),stored:id=>outer(E.store.get('researchMaterials',id)),state:(...path)=>outer(E.store.get(...path)),
		notice:()=>({text:doc.getElementById('status').textContent,error:doc.getElementById('status').classList.contains('error')}),
		get writes(){return writes;},get failures(){return handlerFailures.slice(failures);}};
}
