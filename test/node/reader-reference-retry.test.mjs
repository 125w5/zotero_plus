/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// The reference pane's 获取公开全文 control after a PDF failure. The real search.js, discovery.js,
// arxiv.js and reader-panes.js run in the order of service.js over an in-memory library and a
// minimal DOM; only the network is controlled.
let root=new URL('../../chrome/content/zotero/',import.meta.url),modules={'paper-overview-data.mjs':{}},sources={};
for(let name of ['paper-screening.mjs','reference-matcher.mjs','reference-metadata.mjs','discovery-feed.mjs','discovery-dates.mjs','arxiv.mjs','workspace-outputs.mjs','reader-reference-detail.mjs'])modules[name]=await import(new URL('research/shared/'+name,root));
// The detail stylesheet comes from chrome://; it decides nothing here.
modules['reader-reference-detail.mjs']={...modules['reader-reference-detail.mjs'],prepareReferenceDetailStyles:async()=>{}};
for(let name of ['search.js','discovery.js','arxiv.js','reader-panes.js'])sources[name]=await readFile(new URL('xpcom/research/'+name,root),'utf8');
let Metadata=modules['reference-metadata.mjs'],Matcher=modules['reference-matcher.mjs'],Arxiv=modules['arxiv.mjs'];
let tick=async(n=12)=>{for(let i=0;i<n;i++)await new Promise(resolve=>setImmediate(resolve));};

// Just enough DOM for the reference pane, as in reader-gap-references.test.mjs.
class FakeNode{
	constructor(doc,tag){this.ownerDocument=doc;this.tagName=tag;this.children=[];this.parentNode=null;this.attributes=new Map();this.dataset={};this.listeners=new Map();this.className='';this.hidden=false;this.style={setProperty(){}};this.text='';let node=this;this.classList={add(...names){node.className=[...new Set([...node.className.split(/\s+/).filter(Boolean),...names])].join(' ');},remove(...names){node.className=node.className.split(/\s+/).filter(name=>name&&!names.includes(name)).join(' ');},contains:name=>node.className.split(/\s+/).includes(name),toggle(){}};}
	get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
	set textContent(value){this.children=[];this.text=String(value??'');}
	get id(){return this.attributes.get('id')||'';}set id(value){this.attributes.set('id',value);}
	append(...nodes){for(let node of nodes){if(typeof node==='string'){this.text+=node;continue;}node.parentNode?.children.splice(node.parentNode.children.indexOf(node),1);node.parentNode=this;this.children.push(node);}}
	replaceChildren(...nodes){for(let node of this.children)node.parentNode=null;this.children=[];this.text='';this.append(...nodes);}
	remove(){if(this.parentNode){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}}
	setAttribute(name,value){this.attributes.set(name,String(value));}getAttribute(name){return this.attributes.has(name)?this.attributes.get(name):null;}removeAttribute(name){this.attributes.delete(name);}hasAttribute(name){return this.attributes.has(name);}
	addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);}removeEventListener(){}
	matches(selector){return selector.split(',').some(part=>{part=part.trim();if(part.startsWith('.'))return part.slice(1).split('.').every(name=>this.className.split(/\s+/).includes(name));if(part.startsWith('#'))return this.id===part.slice(1);return this.tagName===part;});}
	closest(selector){for(let node=this;node;node=node.parentNode)if(node.matches?.(selector))return node;return null;}
	all(predicate,found=[]){for(let child of this.children){if(predicate(child))found.push(child);child.all(predicate,found);}return found;}
	querySelectorAll(selector){return this.all(node=>node.matches(selector));}querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
	focus(){}getBoundingClientRect(){return {left:0,top:0,right:0,bottom:0,width:0,height:0};}openPopupAtScreen(){}
}
function fakeDocument(win){
	let doc={defaultView:win};doc.createElementNS=(_ns,tag)=>new FakeNode(doc,tag);doc.createXULElement=tag=>new FakeNode(doc,tag);doc.createElement=tag=>new FakeNode(doc,tag);
	doc.documentElement=new FakeNode(doc,'html');doc.querySelector=selector=>doc.documentElement.matches(selector)?doc.documentElement:doc.documentElement.querySelector(selector);doc.getElementById=id=>doc.documentElement.querySelector('#'+id);return doc;
}

// Real WHATWG Response objects, as the background PDF transport returns them.
let encode=text=>new TextEncoder().encode(text),pdfBytes=()=>encode('%PDF-1.7\n'+'controlled content '.repeat(80));
let reply=({status=200,type='application/pdf',length,body=status===200?pdfBytes():''}={})=>new Response(body,{status,headers:{...(type?{'content-type':type}:{}),...(length?{'content-length':String(length)}:{})}});
let notFound=()=>{throw Object.assign(Error('服务返回 HTTP 404'),{providerStatus:404});};

// The in-memory library of arxiv-record-acquisition.test.mjs, plus the pane's window and the open PDF (id 7).
function fixture({pdf,provider}){
	let items=new Map(),state={},next=100;
	class Item{
		constructor(type){this.itemType=type;this.fields={};this.creators=[];this.collections=[];this.attachments=[];this.libraryID=1;}
		isRegularItem(){return this.itemType!=='attachment';}isPDFAttachment(){return this.itemType==='attachment';}getField(key){return this.fields[key]||'';}setField(key,value){this.fields[key]=value;}setCreators(value){this.creators=value;}setCollections(value){this.collections=[...value];}getCollections(){return [...this.collections];}addToCollection(id){if(!this.collections.includes(id))this.collections.push(id);}getAttachments(){return [...this.attachments];}async getFilePathAsync(){return this.path||null;}async getBestAttachment(){return items.get(this.attachments[0])||null;}
		async saveTx(){this.id??=next++;items.set(this.id,this);}
	}
	let win={closed:false,AbortController,setTimeout,clearTimeout,innerWidth:900,innerHeight:700,getSelection:()=>({toString:()=>''})},doc=fakeDocument(win);win.document=doc;
	let current={id:7,parentID:null,libraryID:1,isPDFAttachment:()=>true,isRegularItem:()=>false};
	let pane={getSelectedLibraryIDs:()=>[1],getSelectedCollections:()=>[],selectItem:async()=>{}},view=(branch,id)=>branch?id===undefined?state[branch]:state[branch]?.[id]:state;
	let Zotero={Item,
		Search:class{addCondition(field,operator,value){this.condition={field,operator,value};}async search(){let {field,operator,value}=this.condition,key=field==='DOI'?'DOI':'url';return [...items.values()].filter(item=>item.libraryID===this.libraryID&&item.isRegularItem()&&(operator==='contains'?item.getField(key).includes(value):item.getField(key)===value)).map(item=>item.id);}},
		Items:{getAsync:async value=>Array.isArray(value)?value.map(id=>items.get(id)).filter(Boolean):value===7?current:items.get(value),get:id=>id===7?current:items.get(id),getAll:async()=>[...items.values()]},
		Libraries:{userLibraryID:1,get:()=>({editable:true,filesEditable:true})},Collections:{get:()=>null,getAsync:async()=>null,getByLibrary:()=>[]},
		getActiveZoteroPane:()=>pane,getMainWindow:()=>win,addShutdownListener(){},logError(){},
		Reader:{_readers:[],getByTabID:()=>null,open:async()=>{}},Promise:{delay:async()=>{}},Utilities:{randomString:()=>String(next),Internal:{copyTextToClipboard(){}}},getTempDirectory:()=>({path:'/temporary'}),File:{pathToFile:path=>path},
		HTTP:{request:async()=>{throw Error('PDFs use the background transport');}},
		Attachments:{importFromFile:async({parentItemID})=>{let item=new Item('attachment');item.parentID=parentItemID;item.path='/storage/'+parentItemID+'-'+next+'.pdf';await item.saveTx();items.get(parentItemID).attachments.push(item.id);return item;}}
	};
	let E={
		fetchDiscoveryPDF:async(url,options)=>pdf(url,{probe:!!options?.headers?.Range,signal:options?.signal}),
		requestProvider:async(url,...rest)=>provider(url,...rest),
		store:{get:view,peek:view,update:async fn=>fn(state)},
		library:{localPDF:async value=>{if(value===current||value===7)return current;let item=typeof value==='number'?items.get(value):value;return item?.isPDFAttachment?.()?item:items.get(item?.attachments?.[0])||null;},describe:item=>({id:item.id,title:'Current paper'})},
		manuscripts:{queueArticle(){}}
	};
	Zotero.Research=E;
	let context=vm.createContext({Zotero,Cu:{cloneInto:value=>value,waiveXrays:value=>value,unwaiveXrays:value=>value},ChromeUtils:{importESModule:url=>{let value=modules[url.split('/').at(-1)];if(!value)throw Error('unexpected module '+url);return value;}},IOUtils:{exists:async()=>true,stat:async()=>({type:'regular',size:1024,lastModified:1}),write:async()=>{},remove:async()=>{}},PathUtils:{join:(...parts)=>parts.join('/')},URL,Uint8Array,AbortController});
	for(let name of ['search.js','discovery.js','arxiv.js','reader-panes.js'])vm.runInContext(sources[name],context);
	return {E,doc,current,regular:()=>[...items.values()].filter(item=>item.isRegularItem())};
}
// One cited paper, matched to record, in the pane of the open PDF.
async function renderPane(f,record){
	let ref={id:'1',title:record.title,quote:record.title};
	f.E.referencesFromPDF=async()=>({records:[ref]});f.E.collectReferences=async()=>({references:[ref],records:[{...record,citationOrigins:[ref]}]});
	let details=new FakeNode(f.doc,'item-details');details.item={id:7};f.doc.documentElement.append(details);let body=new FakeNode(f.doc,'div');details.append(body);
	await f.E.renderReferencePane(body,f.current);await tick();
	let line=body.querySelector('.reference-row');return {body,line,download:line.querySelector('.reference-download')};
}
let iconPath=control=>control.querySelector('path')?.getAttribute('d');
let click=async(f,record)=>{let {line,download}=await renderPane(f,record),before=iconPath(download);await download.onclick();await tick();return {state:line.dataset.state,title:download.title,label:download.getAttribute('aria-label'),icon:iconPath(download),before};};

// A reference printed with its arXiv number and matched on Semantic Scholar without a DOI.
// semanticRecord links https://arxiv.org/abs/<number>, so it is an arXiv record.
let arxivWork={paperId:'0123456789abcdef0123456789abcdef0abcdef1',title:'Sparse attention for long protein sequences',abstract:'',externalIds:{ArXiv:'2401.77777'},url:'https://www.semanticscholar.org/paper/0123456789abcdef0123456789abcdef0abcdef1',year:2024,venue:'',authors:[{name:'Ada Lovelace'}],openAccessPdf:{url:'https://arxiv.org/pdf/2401.77777'}};
let arxivRef={title:'Sparse attention for long protein sequences',quote:'A. Lovelace, Sparse attention for long protein sequences, arXiv preprint arXiv:2401.77777 (2024).',date:'2024',author:'Lovelace'};
let s2Provider=async url=>url.includes('api.crossref.org')?JSON.stringify({message:{items:[]}}):url.includes('api.openalex.org/works?')?JSON.stringify({results:[]}):url.includes('api.semanticscholar.org')?JSON.stringify({data:[arxivWork]}):notFound();
let arxivRecord=(await Metadata.lookupReferenceMetadata({requestProvider:s2Provider},arxivRef)).find(row=>Matcher.matchesReference(arxivRef,row));
// A journal reference with a DOI and no pdf of its own: the pane asks OpenAlex for an open copy.
let doiRecord=(doi,title)=>({source:'Crossref',id:doi,doi,title,url:'https://doi.org/'+doi,journal:'Controlled Journal',pdf:'',authors:[{lastName:'Author',firstName:'A.'}]});
let openCopy=pdfURL=>async url=>url.startsWith('https://api.openalex.org/works/https://doi.org/')?JSON.stringify({best_oa_location:{is_oa:true,pdf_url:pdfURL},locations:[]}):notFound();
let closedAccess=async url=>url.startsWith('https://api.openalex.org/works/')?JSON.stringify({best_oa_location:null,locations:[{is_oa:false}]}):notFound();

test('a failure that will repeat is shown on the reference row without offering a retry',async()=>{
	assert.equal(Arxiv.arxivRecordID(arxivRecord),'2401.77777','the Semantic Scholar match is an arXiv record');assert.equal(arxivRecord.doi,'');
	for(let [name,record,provider,pdf,reason] of [
		['arXiv PDF 404',arxivRecord,s2Provider,()=>reply({status:404}),'PDF 无法获取（HTTP 404）；文库没有变化'],
		['arXiv PDF over 80 MB',arxivRecord,s2Provider,()=>reply({length:90000000}),'PDF 超过 80 MB，请从来源页面单独下载；文库没有变化'],
		['open copy probe 404',doiRecord('10.5555/gone','Gone reference'),openCopy('https://repository.example/gone.pdf'),()=>reply({status:404}),'PDF 无法获取（HTTP 404）；文库没有变化'],
		['open copy probe gets a web page',doiRecord('10.5555/landing','Landing reference'),openCopy('https://repository.example/landing'),()=>reply({type:'text/html; charset=utf-8',body:'<html>Human verification</html>'}),'来源返回网页或验证页面，未提供 PDF；文库没有变化'],
		// The probe reads 1 KB and passes; only the full download meets the size limit.
		['open copy download over 80 MB',doiRecord('10.5555/large','Large reference'),openCopy('https://repository.example/large.pdf'),(_url,{probe})=>probe?reply():reply({length:90000000}),'PDF 超过 80 MB，请从来源页面单独下载']
	]){
		let f=fixture({pdf,provider}),row=await click(f,record);
		assert.equal(row.state,'error',name);assert.equal(row.title,reason,name);assert.equal(row.label,reason,'the label says the reason only: '+name);assert.doesNotMatch(row.label,/重试/,name);
		assert.equal(row.icon,row.before,'the download icon stays, no retry arrow: '+name);assert.equal(f.regular().length,0,'nothing is filed: '+name);
	}
});

test('a failure that can pass still offers its retry on the reference row',async()=>{
	for(let [name,record,provider,pdf,reason] of [
		['no open copy',doiRecord('10.5555/closed','Closed reference'),closedAccess,()=>{throw Error('no PDF is requested');},'暂无公开 PDF'],
		['arXiv rate limit',arxivRecord,s2Provider,()=>reply({status:429}),'公开 PDF 暂不可用：PDF 无法获取（HTTP 429）；文库没有变化，可稍后重试'],
		['open copy probe refused',doiRecord('10.5555/refused','Refused reference'),openCopy('https://repository.example/refused.pdf'),()=>reply({status:403}),'公开 PDF 暂不可用：PDF 无法获取（HTTP 403）；文库没有变化，可稍后重试']
	]){
		let f=fixture({pdf,provider}),row=await click(f,record);
		assert.equal(row.state,'unavailable',name);assert.equal(row.title,reason,name);assert.equal(row.label,reason+'，重试获取全文',name);assert.notEqual(row.icon,row.before,'the retry arrow: '+name);
	}
});

test('the download control in the reference detail shows what its row shows',async()=>{
	for(let [status,state] of [[404,'error'],[429,'unavailable']]){
		let f=fixture({pdf:()=>reply({status}),provider:s2Provider}),{body,line,download}=await renderPane(f,arxivRecord);
		line.querySelector('.reference-title').onclick();await tick();
		let detail=body.querySelector('.reader-reference-detail'),control=detail.querySelectorAll('.reader-reference-action').find(node=>node.getAttribute('aria-label')==='获取公开全文');
		assert.ok(control,'the detail has its download control');await control.onclick();await tick();
		assert.equal(line.dataset.state,state,'HTTP '+status);assert.equal(control.title,download.title);assert.equal(control.getAttribute('aria-label'),download.getAttribute('aria-label'),'HTTP '+status);assert.equal(iconPath(control),iconPath(download),'HTTP '+status);
	}
});
