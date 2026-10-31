/* SPDX-License-Identifier: AGPL-3.0-or-later */
// 复制项目 and the records in p.proposals that the editor still acts on: a
// pending rewrite candidate, a pending layout proposal and selection edits.
// Each names the project, and the candidate and the selection also hash its
// title, so project-copy.mjs moves them to the copy and recomputes what is
// current for the original; a record stale in the original stays stale, with
// the original's message. The real manuscript, writing, assessment, direction,
// automation and notebook services run on one in-memory store, with the real
// 装配结果 panel (assembly-writing-result.mjs) and selection-target.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Model from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import * as Writing from '../../chrome/content/zotero/research/shared/assembly-writing-preview.mjs';
import * as Layout from '../../chrome/content/zotero/research/shared/manuscript-layout.mjs';
import * as Selection from '../../chrome/content/zotero/research/manuscript/selection-target.mjs';
import {renderAssemblyWritingResult} from '../../chrome/content/zotero/research/manuscript/assembly-writing-result.mjs';
import {deepFreeze} from './fixtures/chapter-read-project.mjs';

const research=new URL('../../chrome/content/zotero/research/',import.meta.url),xpcom=new URL('../../chrome/content/zotero/xpcom/research/',import.meta.url);
const services=await Promise.all(['manuscript.js','manuscript-writing.js','manuscript-assessment.js','manuscript-direction.js','manuscript-automation.js','notebook.js'].map(file=>readFile(new URL(file,xpcom),'utf8')));
// Every module the services import, keyed by file name as ChromeUtils resolves them here.
const modules={};
for(let path of new Set(services.join('\n').match(/(?<=chrome:\/\/zotero\/content\/research\/)(?:shared|manuscript)\/[\w.-]+\.mjs/g)))modules[path.split('/').at(-1)]=await import(new URL(path,research).href);
let plain=value=>(value===undefined?undefined:JSON.parse(JSON.stringify(value)));
let outcome=fn=>{try{fn();return 'ok';}catch(error){return error.message;}};

// The services on a store that freezes peeks and JSON-clones every committed
// write, as storage.js does. The library row is not under test here.
function world(){
	let state={manuscripts:{},researchNotebooks:{},researchMaterials:{},projectReadings:{},projectTaskPlans:{}},errors=[];
	let at=path=>path.reduce((value,key)=>value?.[key],state);
	let store={get:(...path)=>structuredClone(at(path)),peek:(...path)=>deepFreeze(structuredClone(at(path))),update:async fn=>{let draft=structuredClone(state);await fn(draft);state=JSON.parse(JSON.stringify(draft));}};
	let E={store,assets:{key:value=>JSON.stringify(value)},settings:()=>({}),studio:{}};
	let Zotero={Research:E,Utilities:{randomString:()=>'fixture'},getMainWindow:()=>null,Items:{get:()=>null,getAsync:async ids=>(Array.isArray(ids)?[]:null)},logError:error=>errors.push(String(error?.message||error))};
	let context=vm.createContext({Zotero,ChromeUtils:{importESModule:url=>{let module=modules[url.split('/').at(-1)];if(!module)throw Error('Unexpected import '+url);return module;}},URL,AbortController});
	for(let code of services.slice(0,5))vm.runInContext(code,context);
	let A=E.manuscripts;A.ensureLibraryItem=async()=>{};A.onAssetsChanged=()=>()=>{};A.notifyAssetsChanged=()=>{};
	vm.runInContext(services[5],context);
	// put stores a project as the editor saved it; copy runs 复制项目 on it.
	return {A,errors,get state(){return state;},put:p=>{state.manuscripts[p.id]=Model.clone(p);},copy:async id=>(await A.copy(id)).id};
}
// One section: paragraph b1 linked to material m1, and paragraph b2.
let project=()=>{
	let p=Model.createProject('低温输运'),[s1]=p.sections;
	p.materials.push(Model.material({id:'m1',kind:'semantic',title:'低温测量',anchor:{paperItemID:11,pageIndex:2,sourceText:'Four-probe measurements show a clear change at low temperature.'}}));
	p.blocks.push(Model.block('paragraph',s1.id,{id:'b1',text:'低温下自旋输运存在差异，现有测量尚未比较两种方法。',materials:[{id:'m1',role:'primary',revision:1}]}),Model.block('paragraph',s1.id,{id:'b2',text:'第二段正文。',materials:[]}));
	Object.assign(p.ui,{sectionID:s1.id,blockID:'b1',assemblyFlowVersion:2});
	return p;
};
const REWRITE='现有测量尚未比较两种方法，而低温下自旋输运存在差异。';
// A rewrite candidate for b1 as validateWritingPreview stores it.
let rewrite=p=>{let capture=Writing.captureWritingPreview(p,{blockID:'b1'}),quoteID=Writing.writingEvidenceExcerpts(capture).find(row=>row.sourceID==='m1').quoteID;return Writing.validateWritingPreview(capture,{variants:[{label:'调整语序',text:REWRITE,quoteIDs:[quoteID]}]},{id:'writing-fixture',model:'fixture',minVariants:1});};
// A layout proposal that puts b2 before b1, as A.organize stores it.
let layout=p=>({...Layout.validateLayoutProposal(p,{sectionOrder:p.sections.map(row=>row.id),blockOrder:['b2','b1'],materialOrder:['m1'],reasons:[]}),id:'layout-fixture',model:'fixture'});

// The 装配结果 panel of b1, with el and button as main.mjs defines them and
// persist through the real A.save. It reads createElement, getElementById,
// head and defaultView of the document.
function fakeDocument(){
	let byID=new Map(),doc;
	let make=tag=>{
		let node={tagName:tag,children:[],dataset:{},attributes:{},classList:{toggle(){},add(){}},isConnected:true,textContent:'',disabled:false,title:'',className:'',value:''};
		node.append=(...items)=>{for(let item of items)if(item&&typeof item==='object')node.children.push(item);};
		node.replaceChildren=(...items)=>{node.children=[];node.append(...items);};
		node.setAttribute=(key,value)=>{node.attributes[key]=String(value);};
		node.focus=()=>{};
		Object.defineProperty(node,'ownerDocument',{get:()=>doc});
		return node;
	};
	doc={createElement:make,getElementById:id=>byID.get(id)||null,defaultView:{AbortController}};
	doc.head=make('head');let append=doc.head.append;doc.head.append=(...items)=>{for(let item of items)if(item.id)byID.set(item.id,item);append(...items);};
	return doc;
}
let walk=(node,out=[])=>{out.push(node);for(let child of node.children||[])walk(child,out);return out;};
function writingPanel(f,id){
	let doc=fakeDocument(),statuses=[],p=Model.clone(f.A.get(id)),U={p,A:f.A,M:Model,savedRevision:p.revision,E:{renderContent:(node,text)=>{node.textContent=String(text);}}};
	let el=(tag,text,cls)=>{let node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
	let button=(text,fn,host,cls)=>{let node=el('button',text,cls);node.onclick=async event=>{try{await fn(event);}catch(error){statuses.push(error.message);}};host?.append(node);return node;};
	let persist=async()=>{U.savedRevision=(await f.A.save({...U.p,revision:U.savedRevision})).revision;};
	let host=doc.createElement('div');
	renderAssemblyWritingResult(U,host,p.blocks.find(row=>row.id==='b1'),{el,button,snapshot(){},changed(){},persist,status:text=>statuses.push(text),materialDetails(){}});
	let nodes=walk(host),action=name=>nodes.find(node=>node.dataset.action===name);
	return {notice:nodes.find(node=>node.className==='writing-result-notice')?.textContent,adjust:action('edit-writing-candidate')?.disabled,accept:action('accept-writing-candidate')?.disabled,
		click:async name=>{await action(name).onclick();return statuses.at(-1);}};
}
// 应用顺序 (assembly-tools.mjs) on the pending proposal that opening the project
// shows (main.mjs init): the new block order, or the message shown.
let applyOrder=(f,id)=>{let current=Model.clone(f.A.get(id)),pending=current.proposals.findLast(row=>row.kind==='layout'&&row.status==='pending'),next,result=outcome(()=>{next=f.A.applyLayout(current,pending);});return result==='ok'?next.blocks.map(row=>row.id).join(','):result;};
// 保留更改 and 撤回修改 (selection-assistant.mjs) on the latest selection edit,
// with the project's chapter reads as readingOptions() passes them.
let latestSelection=p=>[...(p.proposals||[])].reverse().find(row=>row.kind==='assembly-selection-preview');
let keep=(f,id)=>{let p=Model.clone(f.A.get(id)),preview=latestSelection(p),readings=plain(f.A.readingsView(id));return outcome(()=>{Selection.assertSelectionTargetCurrent(p,preview.target,{readings});Selection.applySelectionPreview(p,preview,preview.variants[0].id,{confirmed:true,readings});});};
let takeBack=(f,id)=>{let p=Model.clone(f.A.get(id));return outcome(()=>Selection.revertSelectionPreview(p,latestSelection(p),{confirmed:true,readings:plain(f.A.readingsView(id))}));};

test('a pending rewrite candidate is current in the copy, and adopting it there changes only the copy',async()=>{
	let f=world(),p=project();p.proposals.push(rewrite(p));f.put(p);
	let copyID=await f.copy(p.id),original=writingPanel(f,p.id),copied=writingPanel(f,copyID);
	assert.deepEqual([original.adjust,original.accept],[false,false],'the original offers 调整候选 and 采用此版');
	assert.deepEqual([copied.notice,copied.adjust,copied.accept],[original.notice,false,false],'so does the copy, with the same notice');
	assert.equal(await copied.click('accept-writing-candidate'),'已采用所选版本，来源保留；可撤销。');
	assert.equal(f.A.get(copyID).blocks.find(row=>row.id==='b1').text,REWRITE);
	assert.equal(f.A.get(p.id).blocks.find(row=>row.id==='b1').text,p.blocks[0].text,'the original keeps its text');
	assert.equal(await original.click('accept-writing-candidate'),'已采用所选版本，来源保留；可撤销。','and still adopts its own candidate');
	assert.deepEqual(f.errors,[]);
});

test('a pending layout proposal applies in the copy',async()=>{
	let f=world(),p=project();p.proposals.push(layout(p));f.put(p);
	let copyID=await f.copy(p.id);
	assert.equal(applyOrder(f,p.id),'b2,b1');
	assert.equal(applyOrder(f,copyID),'b2,b1','应用顺序 in the copy puts b2 first');
	assert.deepEqual(f.errors,[]);
});

test('a pending layout proposal applies in the copy when the copy renames the plan card it orders',async()=>{
	let f=world(),p=project();
	// A confirmed plan card on the page: the copy republishes it under a new id,
	// so the material order and the document the proposal was made on name another id.
	let card=Model.material({id:'card1',assetID:'card1',kind:'idea',title:'研究方案',sourceText:'先完成四探针测量。',sourceRecordID:'artifact-plan-v1',artifactID:'artifact-plan-v1',anchor:{sourceText:'先完成四探针测量。'}});
	p.materials.push(card);
	p.proposals.push({...Layout.validateLayoutProposal(p,{sectionOrder:p.sections.map(row=>row.id),blockOrder:['b2','b1'],materialOrder:['card1','m1'],reasons:[]}),id:'layout-fixture',model:'fixture'});
	f.put(p);f.state.researchMaterials.card1=Model.clone(card);
	f.state.researchNotebooks[p.id]={query:'',selectedMaterial:null,messages:[],decisions:[],selectedVersion:'plan-v1',versions:[{id:'plan-v1',number:1,status:'draft'}],artifacts:[{id:'artifact-plan-v1',type:'experiment-plan',versionID:'plan-v1',materialID:'card1',status:'confirmed'}]};
	let copyID=await f.copy(p.id),copied=f.A.get(copyID);
	assert.ok(!copied.materials.some(row=>row.id==='card1'),'the copy names its own plan card');
	assert.equal(applyOrder(f,p.id),'b2,b1');
	assert.equal(applyOrder(f,copyID),'b2,b1','应用顺序 in the copy puts b2 first');
	assert.deepEqual(plain(f.A.applyLayout(Model.clone(copied),copied.proposals.at(-1)).materials.map(row=>row.kind)),['idea','semantic'],'and the copy plan card first');
	assert.deepEqual(f.errors,[]);
});

test('a selection edit adopted in the original is taken back in the copy, and a pending one is kept there',async()=>{
	let target=p=>Selection.captureSelectionTarget(p,{kind:'block',sectionID:p.sections[0].id,blockID:'b1',start:0,end:11}),variants={variants:[{label:'改写',text:'低温条件下自旋输运有差异'}]};
	let f=world(),p=project(),adopted=Selection.validateSelectionPreview(target(p),variants,{id:'selection-adopted',minVariants:1});
	p.proposals.push(adopted);Selection.applySelectionPreview(p,adopted,adopted.variants[0].id,{confirmed:true});f.put(p);
	let copyID=await f.copy(p.id);
	assert.deepEqual([takeBack(f,p.id),takeBack(f,copyID)],['ok','ok'],'撤回修改 works in the original and in the copy');
	let g=world(),q=project();q.proposals.push(Selection.validateSelectionPreview(target(q),variants,{id:'selection-pending',minVariants:1}));g.put(q);
	let pendingCopyID=await g.copy(q.id);
	assert.deepEqual([keep(g,q.id),keep(g,pendingCopyID)],['ok','ok'],'保留更改 works in the original and in the copy');
	assert.deepEqual([...f.errors,...g.errors],[]);
});

test('a pending rewrite of a read point is kept in the copy, checked with the copy chapter reads',async()=>{
	let f=world(),p=project(),sectionID=p.sections[0].id,narrative='低温下自旋输运存在明显差异';
	p.writingWorkflow={};
	let readings={chapters:{[sectionID]:{nodes:[{id:'n1',role:'evidence',status:'supported',claim:'低温下输运存在差异',narrative,evidence:[{quoteID:'W1',materialID:'m1',quote:'Four-probe measurements show a clear change at low temperature.'}]}]}}};
	let target=Selection.captureSelectionTarget(p,{kind:'read-node',sectionID,nodeID:'n1',start:0,end:narrative.length},{readings});
	assert.notEqual(Selection.selectionContextVersion(p,target,{readings}),Selection.selectionContextVersion(p,target,{}),'with a writing plan the chapter reads decide the context version');
	p.proposals.push(Selection.validateReadSelectionPreview(target,{variants:[{label:'忠实改写',text:'低温条件下自旋输运差异明显'}]},{id:'read-selection-fixture'}));
	f.put(p);f.state.projectReadings[p.id]=readings;
	let copyID=await f.copy(p.id);
	assert.ok(f.state.projectReadings[copyID],'the copy has its chapter reads');
	assert.deepEqual([keep(f,p.id),keep(f,copyID)],['ok','ok'],'保留更改 works in the original and in the copy');
	assert.deepEqual(f.errors,[]);
});

test('a candidate and a layout proposal stale in the original stay stale in the copy, with the same message',async()=>{
	let f=world(),p=project();p.proposals.push(rewrite(p),layout(p));p.blocks.find(row=>row.id==='b1').text+='补充一句。';f.put(p);
	let copyID=await f.copy(p.id),original=writingPanel(f,p.id),copied=writingPanel(f,copyID);
	assert.equal(original.accept,true,'the original no longer offers 采用此版');
	assert.deepEqual([copied.notice,copied.accept],[original.notice,true],'the copy shows the original stale notice');
	assert.equal(applyOrder(f,p.id),'正文、来源或顺序已变化，请重新整理布局');
	assert.equal(applyOrder(f,copyID),applyOrder(f,p.id),'应用顺序 in the copy gives the original reason');
	assert.deepEqual(f.errors,[],'a record stale in the original is no recompute failure');
});
