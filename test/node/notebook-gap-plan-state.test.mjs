/* SPDX-License-Identifier: AGPL-3.0-or-later */
// WSB-12: a paper without a readable PDF is a recorded failure. WSB-13: online
// evaluation adds up to 18 papers per run even after a 60-paper search.
// WSB-18: a Zotero metadata edit marks the confirmed plan for review.
// WSB-19: the home card status is derived, not read from stale flags.
import test from 'node:test';
import assert from 'node:assert/strict';
import {notebookFixture,clone} from './notebook-gap-fixture.mjs';

test('papers without a readable local PDF are recorded as failures with the reason',async()=>{
	let f=await notebookFixture();
	f.pdfs.clear();
	f.attachments.set(1,[51]);f.attachments.set('item:51',{id:51,deleted:false,isPDFAttachment:()=>true});
	let result=await f.N.collectProjectMaterials('study');
	assert.deepEqual(clone(result.failures.map(row=>[row.paperID,row.attachmentID])),[[1,51],[2,null]]);
	assert.match(result.failures[0].error,/PDF 附件的文件不在本机/);
	assert.match(result.failures[1].error,/没有本地 PDF/);
	assert.deepEqual(f.N.state('study').materialCollectionFailures.map(row=>row.paperID),[1,2],'the failures are saved for the page');
});

test('online evaluation adds new close papers even when the search saved 60',async()=>{
	let f=await notebookFixture();f.A.summaryReader=()=>m=>m.summary||'';
	await f.N.update('study',{recommendedPapers:Array.from({length:60},(_,i)=>({recommendationID:'paper-old-'+i,title:'Earlier recommendation '+i,pdf:'https://example.invalid/'+i+'.pdf'}))});
	f.E.searchPaperPage=async()=>({records:Array.from({length:25},(_,i)=>({id:'new-'+i,title:'Image measurement study '+i,abstract:'Image measurement comparison.',pdf:'https://example.invalid/new-'+i+'.pdf',url:'https://example.invalid/new-'+i})),provider:'controlled'});
	f.E.discoverySearch=async()=>[];
	f.E.studio.request=async(_rules,input)=>input.local?{value:{queries:['image measurement']}}:{value:{...clone(f.version.plan),closest:[]},model:'controlled'};
	let version=await f.N.evaluate('study',f.project.researchGoal,()=>{},undefined,{online:true});
	let saved=f.N.state('study').recommendedPapers;
	assert.equal(version.recommendedPapers.length,18,'the 18-paper budget counts this run');
	assert.equal(saved.length,60);
	assert.ok(saved.slice(0,18).every(row=>row.title.startsWith('Image measurement study')),'new papers are listed first');
	assert.ok(saved.some(row=>row.recommendationID==='paper-old-0'),'earlier recommendations stay after them');
});

async function confirmedThenEdited(){
	let f=await notebookFixture();
	await f.N.update('study',{versions:[{...f.version,status:'draft',sourceItemVersions:{1:'2026-10-26'}}],selectedVersion:f.version.id,artifacts:[]});
	await f.N.confirm('study',f.version.id);
	f.papers.get(1).dateModified='2026-10-28';
	return f;
}

test('the item:<id> entries N.stale reports invalidate the confirmed plan',async()=>{
	let f=await confirmedThenEdited(),stale=f.N.stale(f.N.state('study').versions[0]);
	assert.deepEqual(clone(stale),['item:1']);
	let marked=await f.N.invalidateArtifacts('study',[],stale);
	assert.equal(marked.length,1);
	assert.deepEqual(f.N.state('study').artifacts.map(row=>row.status),['needs-review']);
});

test('opening the notebook re-checks confirmed plans after a metadata edit',async()=>{
	let f=await confirmedThenEdited();
	let marked=await f.N.reviewArtifacts('study');
	assert.equal(marked.length,1);
	assert.deepEqual(f.N.state('study').artifacts.map(row=>row.status),['needs-review']);
	assert.equal(f.assets[marked[0]].verification,'stale','the published plan material is marked stale');
	assert.equal((await f.N.reviewArtifacts('study')).length,0,'a second check changes nothing');
});

test('card states follow the live job and the plan inputs, not stored flags',async()=>{
	let f=await notebookFixture();f.A.summaryReader=()=>m=>m.summary||'';
	assert.equal(f.N.planCardStatuses(['study']).study,'ready');
	await f.N.update('study',{assessment:{status:'running',message:'正在比较'}});
	assert.equal(f.N.planCardStatuses(['study']).study,'ready','a run the app quit during is not shown as running');
	await f.N.update('study',{constraints:'资源条件已改变'});
	assert.equal(f.N.planCardStatuses(['study']).study,'needs-review','a stale plan reads 方案待更新 before any resume');
	f.assets['local-whole']={id:'local-whole',kind:'semantic',revision:1,paperItemID:1,sourceText:'完整章节原文。',summary:'人工挑选的证据'};
	let release,gate=new Promise(resolve=>release=resolve);
	f.E.studio.request=async()=>{await gate;return {value:{...clone(f.version.plan),closest:[]},model:'controlled'};};
	let run=f.N.evaluate('study',f.project.researchGoal);
	assert.equal(f.N.planCardStatuses(['study']).study,'running','re-evaluating a project with versions shows 正在评估');
	release();await run;
	assert.equal(f.N.planCardStatuses(['study']).study,'ready');
	assert.equal(f.N.planCardStatuses(['missing']).missing,'none');
});

test('the home card reads 方案待更新 for a stale plan that was never resumed',async()=>{
	let {readFile}=await import('node:fs/promises'),vm=await import('node:vm');
	let f=await notebookFixture();
	await f.N.update('study',{constraints:'资源条件已改变'});
	class Node{constructor(tag,text){this.tagName=tag;this.children=[];this.dataset={};this.attributes=new Map();this.className='';this._text=text===undefined?'':String(text);this.isConnected=true;this.classList={toggle(){},contains:()=>false};}
		get textContent(){return this._text+this.children.map(row=>row.textContent).join('');}set textContent(value){this._text=String(value);this.children=[];}
		append(...nodes){for(let node of nodes){node.parentElement=this;this.children.push(node);}}prepend(...nodes){this.children.unshift(...nodes);}replaceChildren(...nodes){this._text='';this.children=[];this.append(...nodes);}before(){}remove(){}
		matches(selector){return selector[0]==='.'?this.className.split(' ').includes(selector.slice(1)):selector[0]==='#'?this.id===selector.slice(1):this.tagName===selector;}
		querySelector(selector){return this.querySelectorAll(selector)[0]||null;}querySelectorAll(selector){return this.children.flatMap(row=>[...(row.matches(selector)?[row]:[]),...row.querySelectorAll(selector)]);}
		setAttribute(key,value){this.attributes.set(key,String(value));}addEventListener(){}removeEventListener(){}contains(){return false;}getClientRects(){return [{}];}focus(){}}
	let body=new Node('body'),host=new Node('div');body.append(host);
	let doc={hidden:false,activeElement:null,addEventListener(){},removeEventListener(){},querySelector:selector=>body.querySelector(selector)};
	let el=(tag,text,cls)=>{let node=new Node(tag,text);if(cls)node.className=cls;return node;};
	let ui={activeView:'writing',el,$:id=>id==='view-writing'?host:doc.querySelector('#'+id),status(){},E:{store:{subscribe:()=>()=>{},peek:()=>undefined},manuscripts:{all:()=>({study:f.project})},notebook:f.N}};
	let code=await readFile(new URL('../../chrome/content/zotero/research/ui/manuscript-projects.js',import.meta.url),'utf8');
	vm.runInNewContext(code,{EasySchUI:ui,document:doc,window:{addEventListener(){},removeEventListener(){}},setTimeout:()=>0,clearTimeout(){}});
	ui.initManuscriptProjects();
	let footer=host.querySelector('.project-card').querySelector('footer');
	assert.equal(footer.children[0].textContent,'方案待更新');
});
