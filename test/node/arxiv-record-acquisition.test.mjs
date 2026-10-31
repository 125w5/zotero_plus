/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// The real search.js, discovery.js, arxiv.js and reader-panes.js, loaded in the order of
// service.js over an in-memory library. Only the network is controlled.
let root=new URL('../../chrome/content/zotero/',import.meta.url),modules={'paper-overview-data.mjs':{}},sources={};
for(let name of ['paper-screening.mjs','reference-matcher.mjs','reference-metadata.mjs','discovery-feed.mjs','discovery-dates.mjs','arxiv.mjs','workspace-outputs.mjs','reader-reference-detail.mjs'])modules[name]=await import(new URL('research/shared/'+name,root));
for(let name of ['search.js','discovery.js','arxiv.js','reader-panes.js'])sources[name]=await readFile(new URL('xpcom/research/'+name,root),'utf8');
let Feed=modules['discovery-feed.mjs'],Metadata=modules['reference-metadata.mjs'],Matcher=modules['reference-matcher.mjs'];
let encode=text=>new TextEncoder().encode(text),pdfBytes=()=>encode('%PDF-1.7\n'+'controlled content '.repeat(80));
// Real WHATWG Response objects, as the background PDF transport returns them.
let reply=({status=200,type='application/pdf',length,body=status===200?pdfBytes():''}={})=>new Response(body,{status,headers:{...(type?{'content-type':type}:{}),...(length?{'content-length':String(length)}:{})}});
let notFound=()=>{throw Object.assign(Error('服务返回 HTTP 404'),{providerStatus:404});};

async function fixture({pdf=()=>reply(),provider=notFound}={}){
	let items=new Map(),state={},downloads=[],probes=[],lookups=[],next=100;
	class Item{
		constructor(type){this.itemType=type;this.fields={};this.creators=[];this.collections=[];this.attachments=[];this.libraryID=1;}
		isRegularItem(){return this.itemType!=='attachment';}isPDFAttachment(){return this.itemType==='attachment';}getField(key){return this.fields[key]||'';}setField(key,value){this.fields[key]=value;}setCreators(value){this.creators=value;}setCollections(value){this.collections=[...value];}getCollections(){return [...this.collections];}addToCollection(id){if(!this.collections.includes(id))this.collections.push(id);}getAttachments(){return [...this.attachments];}async getFilePathAsync(){return this.path||null;}async getBestAttachment(){return items.get(this.attachments[0])||null;}
		async saveTx(){this.id??=next++;items.set(this.id,this);}
	}
	let pane={getSelectedLibraryIDs:()=>[1],getSelectedCollections:()=>[],selectItem:async()=>{}},view=(branch,id)=>branch?id===undefined?state[branch]:state[branch]?.[id]:state;
	let Zotero={Item,
		Search:class{addCondition(field,operator,value){this.condition={field,operator,value};}async search(){let {field,operator,value}=this.condition,key=field==='DOI'?'DOI':'url';return [...items.values()].filter(item=>item.libraryID===this.libraryID&&item.isRegularItem()&&(operator==='contains'?item.getField(key).includes(value):item.getField(key)===value)).map(item=>item.id);}},
		Items:{getAsync:async value=>Array.isArray(value)?value.map(id=>items.get(id)).filter(Boolean):items.get(value),get:id=>items.get(id),getAll:async()=>[...items.values()]},
		Libraries:{userLibraryID:1,get:()=>({editable:true,filesEditable:true})},Collections:{get:()=>null,getAsync:async()=>null,getByLibrary:()=>[]},
		getActiveZoteroPane:()=>pane,getMainWindow:()=>({AbortController}),addShutdownListener(){},logError(){},
		Reader:{open:async()=>{}},Promise:{delay:async()=>{}},Utilities:{randomString:()=>String(next)},getTempDirectory:()=>({path:'/temporary'}),File:{pathToFile:path=>path},
		HTTP:{request:async()=>{throw Error('PDFs use the background transport');}},
		Attachments:{importFromFile:async({parentItemID})=>{let item=new Item('attachment');item.parentID=parentItemID;item.path='/storage/'+parentItemID+'-'+next+'.pdf';await item.saveTx();items.get(parentItemID).attachments.push(item.id);return item;}}
	};
	let E={
		fetchDiscoveryPDF:async(url,options)=>{let probe=!!options?.headers?.Range;(probe?probes:downloads).push(url);return pdf(url,{probe,signal:options?.signal});},
		requestProvider:async(url,...rest)=>{lookups.push(url);return provider(url,...rest);},
		store:{get:view,peek:view,update:async fn=>fn(state)},
		library:{localPDF:async value=>{let item=typeof value==='number'?items.get(value):value;return item?.isPDFAttachment()?item:items.get(item?.attachments?.[0])||null;}},
		manuscripts:{queueArticle(){}}
	};
	Zotero.Research=E;
	let context=vm.createContext({Zotero,Cu:{},ChromeUtils:{importESModule:url=>{let value=modules[url.split('/').at(-1)];if(!value)throw Error('unexpected module '+url);return value;}},IOUtils:{exists:async()=>true,stat:async()=>({type:'regular',size:1024,lastModified:1}),write:async()=>{},remove:async()=>{}},PathUtils:{join:(...parts)=>parts.join('/')},URL,Uint8Array,AbortController});
	for(let name of ['search.js','discovery.js','arxiv.js','reader-panes.js'])vm.runInContext(sources[name],context);
	return {E,items,state,downloads,probes,lookups,regular:()=>[...items.values()].filter(item=>item.isRegularItem())};
}
let failures=f=>f.state.discoveryPDFFailures||{};
// What the search pages do with a cached row: enrich it, then keep it only if it is offered as a download.
let offered=(f,row)=>Feed.applyDiscoveryFilters([Feed.enrichDiscoveryRecord(row,f.E)]).length===1;
// The arXiv provider row of a paper; arxivSearchPage rows carry no DOI.
let arxivRow=(id,extra={})=>({id,source:'arXiv',title:'An arXiv only preprint',abstract:'',date:'2024-01-20',url:'https://arxiv.org/abs/'+id,pdf:'https://arxiv.org/pdf/'+id,authors:[{lastName:'Ada Lovelace',fieldMode:1}],oa:true,retracted:null,citationCount:null,sourceType:'repository',...extra});
// A Semantic Scholar discovery row of an arXiv-only preprint: the id and url are Semantic
// Scholar's, the pdf is on arxiv.org, and the DOI is empty or arXiv's own.
let s2Preprint=doi=>({source:'Semantic Scholar',id:'0123456789abcdef0123456789abcdef01234567',title:'An arXiv only preprint',abstract:'',date:'2024-01-20',doi,url:'https://www.semanticscholar.org/paper/0123456789abcdef0123456789abcdef01234567',journal:'arXiv.org',pdf:'https://arxiv.org/pdf/2401.54321',authors:[{lastName:'Ada Lovelace',firstName:'',fieldMode:1}],oa:true,citationCount:3,retracted:null});

test('a Semantic Scholar row of an arXiv-only preprint is filed as that preprint, and its arXiv row reuses it',async()=>{
	for(let doi of ['','10.48550/arXiv.2401.54321']){
		let f=await fixture(),saved=await f.E.obtainPaper(s2Preprint(doi),{open:false}),item=f.items.get(saved.itemID);
		assert.equal(item.itemType,'preprint','DOI '+JSON.stringify(doi));assert.equal(item.getField('publicationTitle'),'','arXiv.org is not a journal');
		assert.equal(item.getField('url'),'https://arxiv.org/abs/2401.54321');assert.equal(item.getField('repository'),'arXiv');assert.equal(item.getField('archiveID'),'2401.54321','the arXiv number, not the Semantic Scholar paperId');
		let again=await f.E.obtainPaper(arxivRow('2401.54321'),{open:false});
		assert.equal(again.itemID,saved.itemID,'the arXiv provider row finds the same item');assert.equal(f.regular().length,1);assert.equal(f.downloads.length,1,'the PDF is downloaded once');
		let direct=await fixture(),open=await direct.E.obtainOpenPaper(s2Preprint(doi),{});
		assert.equal(direct.items.get(open.itemID).itemType,'preprint','obtainOpenPaper uses the same rule');
	}
});

test('a reference matched on OpenAlex by its arXiv DataCite DOI is filed as that preprint, and its arXiv row reuses it',async()=>{
	let ref={title:'Instruction following with human preference feedback',quote:'L. Ouyang et al., Instruction following with human preference feedback, CoRR abs/2401.24680 (2024).',date:'2024',author:'Ouyang'};
	let location={is_oa:true,landing_page_url:'https://arxiv.org/abs/2401.24680',pdf_url:'https://arxiv.org/pdf/2401.24680',version:'submittedVersion',source:{display_name:'arXiv (Cornell University)',type:'repository'}};
	let work={id:'https://openalex.org/W4400000009',doi:'https://doi.org/10.48550/arxiv.2401.24680',title:ref.title,publication_date:'2024-01-25',publication_year:2024,primary_location:location,best_oa_location:location,locations:[location],open_access:{is_oa:true,oa_status:'green',oa_url:location.landing_page_url},authorships:[{author:{display_name:'L. Ouyang'}}]};
	let provider=async url=>url.includes('api.crossref.org')?JSON.stringify({message:{items:[]}}):url.includes('api.openalex.org/works?')?JSON.stringify({results:[work]}):url.startsWith('https://api.openalex.org/works/')?JSON.stringify(work):notFound();
	let record=(await Metadata.lookupReferenceMetadata({requestProvider:provider},ref)).find(row=>Matcher.matchesReference(ref,row));
	assert.equal(record.url,'https://doi.org/10.48550/arxiv.2401.24680','the OpenAlex record: its url is the DOI address');
	let f=await fixture({provider}),saved=await f.E.obtainReferencePaper(record,{open:false}),item=f.items.get(saved.itemID);
	assert.equal(item.itemType,'preprint');assert.equal(item.getField('publicationTitle'),'');assert.equal(item.getField('url'),'https://arxiv.org/abs/2401.24680');assert.equal(item.getField('archiveID'),'2401.24680','the arXiv number, not the OpenAlex work');
	assert.deepEqual(f.lookups,[],'an arXiv record needs no open-access lookup');
	let again=await f.E.obtainPaper(arxivRow('2401.24680'),{open:false});
	assert.equal(again.itemID,saved.itemID);assert.equal(f.regular().length,1);assert.equal(f.downloads.length,1);
});

test('an OpenAlex row of a journal article whose open copy is on arXiv is filed as that journal article',async()=>{
	let copy={is_oa:true,landing_page_url:'https://arxiv.org/abs/2401.12345',pdf_url:'https://arxiv.org/pdf/2401.12345',version:'submittedVersion',source:{id:'https://openalex.org/S4306400194',display_name:'arXiv (Cornell University)',type:'repository'}};
	let publisher={is_oa:false,landing_page_url:'https://doi.org/10.1103/physrevlett.132.000001',pdf_url:null,version:'publishedVersion',source:{id:'https://openalex.org/S24807848',display_name:'Physical Review Letters',issn_l:'0031-9007',type:'journal'}};
	let work={id:'https://openalex.org/W4400000001',doi:'https://doi.org/10.1103/physrevlett.132.000001',title:'Measured quantum spin transport',publication_date:'2024-03-01',publication_year:2024,primary_location:publisher,best_oa_location:copy,locations:[publisher,copy],open_access:{is_oa:true,oa_status:'green',oa_url:copy.landing_page_url},authorships:[{author:{display_name:'A. Author'}}]};
	let row=Feed.openAlexFeedRecord(work);assert.equal(row.url,'https://arxiv.org/abs/2401.12345','the feed row takes the arXiv landing page as its url');
	for(let obtain of ['obtainPaper','obtainOpenPaper']){
		let f=await fixture(),saved=await f.E[obtain](row,{open:false}),item=f.items.get(saved.itemID);
		assert.equal(item.itemType,'journalArticle',obtain);assert.equal(item.getField('publicationTitle'),'Physical Review Letters');assert.equal(item.getField('ISSN'),'0031-9007');assert.equal(item.getField('DOI'),'10.1103/physrevlett.132.000001');assert.equal(item.getField('archiveID'),'');
	}
});

test('a reference matched only on Semantic Scholar keeps its journal, with or without a paperId',async()=>{
	let ref={title:'Measured quantum spin transport in layered magnets',quote:'A. Author, Measured quantum spin transport in layered magnets, Phys. Rev. Lett. 132, 1 (2024).',date:'2024',author:'Author'};
	// Without a paperId, semanticRecord takes the ArXiv external id as the record's id.
	for(let paperId of ['fedcba9876543210fedcba9876543210fedcba98','']){
		let work={paperId,title:ref.title,abstract:'',externalIds:{DOI:'10.1103/PhysRevLett.132.000001',ArXiv:'2401.67890'},url:'https://www.semanticscholar.org/paper/fedcba9876543210fedcba9876543210fedcba98',year:2024,venue:'Physical Review Letters',authors:[{name:'A. Author'}],openAccessPdf:{url:'https://arxiv.org/pdf/2401.67890'}};
		let provider=async url=>url.includes('api.crossref.org')?JSON.stringify({message:{items:[]}}):url.includes('api.openalex.org/works?')?JSON.stringify({results:[]}):url.includes('api.semanticscholar.org')?JSON.stringify({data:[work]}):notFound();
		let record=(await Metadata.lookupReferenceMetadata({requestProvider:provider},ref)).find(row=>Matcher.matchesReference(ref,row));
		assert.equal(record.url,'https://arxiv.org/abs/2401.67890','semanticRecord links the arXiv copy');assert.equal(record.id,paperId||'2401.67890');
		let f=await fixture({provider}),saved=await f.E.obtainReferencePaper(record,{open:false}),item=f.items.get(saved.itemID);
		assert.equal(item.itemType,'journalArticle','paperId '+JSON.stringify(paperId));assert.equal(item.getField('publicationTitle'),'Physical Review Letters');assert.equal(item.getField('DOI'),'10.1103/physrevlett.132.000001');
		assert.deepEqual(f.probes,['https://arxiv.org/pdf/2401.67890'],'the open copy is probed like any other public PDF');
	}
});

test('an arXiv record that names its journal DOI still takes the arXiv preprint import',async()=>{
	// arxivMetadata takes doi from the page's citation_doi, which is the journal version's DOI.
	let f=await fixture(),record={source:'arXiv',id:'1002.3895',title:'Topological insulators',abstract:'',date:'2010/02/20',doi:'10.1103/RevModPhys.82.3045',url:'https://arxiv.org/abs/1002.3895',pdf:'https://arxiv.org/pdf/1002.3895',authors:[{lastName:'Hasan',firstName:'',fieldMode:1}]};
	let saved=await f.E.obtainReferencePaper(record,{open:false}),item=f.items.get(saved.itemID);
	assert.equal(item.itemType,'preprint');assert.equal(item.getField('archiveID'),'1002.3895');assert.equal(item.getField('DOI'),'10.1103/RevModPhys.82.3045');
	assert.deepEqual(f.lookups,[],'no open-access lookup');assert.deepEqual(f.probes,[],'no probe');assert.deepEqual(f.downloads,['https://arxiv.org/pdf/1002.3895']);
});

test('arxivRecordID: arXiv records, and arxiv.org addresses whose only DOI is arXiv\'s',()=>{
	let {arxivRecordID}=modules['arxiv.mjs'];
	for(let [record,expected] of [
		[{source:'arXiv',id:'1002.3895',doi:'10.1103/RevModPhys.82.3045'},'1002.3895'],
		[{id:'2401.12345'},'2401.12345'],
		[{source:'Semantic Scholar',id:'0123',url:'https://www.semanticscholar.org/paper/0123',doi:'',pdf:'https://arxiv.org/pdf/2401.54321v2'},'2401.54321v2'],
		[{source:'Semantic Scholar',id:'0123',doi:'10.48550/arXiv.2401.54321',pdf:'https://arxiv.org/pdf/2401.54321'},'2401.54321'],
		[{source:'OpenAlex',id:'https://openalex.org/W9',doi:'https://doi.org/10.48550/ARXIV.2401.24680',url:'https://doi.org/10.48550/arxiv.2401.24680',pdf:'https://arxiv.org/pdf/2401.24680'},'2401.24680'],
		[{source:'OpenAlex',id:'https://openalex.org/W1',doi:'10.1103/physrevlett.132.000001',url:'https://arxiv.org/abs/2401.12345',pdf:'https://arxiv.org/pdf/2401.12345'},null],
		[{source:'Semantic Scholar',id:'2401.67890',doi:'10.1103/physrevlett.132.000001',url:'https://arxiv.org/abs/2401.67890'},null],
		[{source:'Crossref',id:'10.1000/x',doi:'10.1000/x',url:'https://doi.org/10.1000/x',pdf:'https://example.org/x.pdf'},null],
		[{},null]
	])assert.equal(arxivRecordID(record),expected,JSON.stringify(record));
});

test('an arXiv download that fails for good is recorded, and the row is no longer offered',async()=>{
	for(let [id,response,reason] of [
		['2401.10001',reply({type:'text/html; charset=utf-8',body:'<html>Human verification</html>'}),'来源返回网页或验证页面，未提供 PDF'],
		['2401.10002',reply({type:'application/octet-stream',body:'not a pdf at all'}),'来源返回非 PDF 或空文件'],
		['2401.10003',reply({length:90000000}),'PDF 超过 80 MB，请从来源页面单独下载'],
		['2401.10004',reply({status:404}),'PDF 无法获取（HTTP 404）']
	]){
		let f=await fixture({pdf:()=>response}),row=arxivRow(id);
		await assert.rejects(f.E.obtainPaper(row,{open:false}),{message:reason+'；文库没有变化'});
		assert.ok(failures(f)[row.pdf],'recorded: '+reason);assert.equal(f.regular().length,0,'nothing is filed');assert.equal(offered(f,row),false,'the cached row is no longer offered: '+reason);
	}
});

test('an arXiv download that can succeed later, or a cancelled one, is not recorded',async()=>{
	for(let [id,pdf,reason] of [
		['2401.20001',()=>reply({status:429}),'PDF 无法获取（HTTP 429）'],
		['2401.20002',()=>reply({status:503}),'PDF 无法获取（HTTP 503）'],
		['2401.20003',()=>reply({status:403}),'PDF 无法获取（HTTP 403）'],
		['2401.20004',()=>{throw new TypeError('NetworkError when attempting to fetch resource.');},'来源暂时无法访问']
	]){
		let f=await fixture({pdf}),row=arxivRow(id);
		await assert.rejects(f.E.obtainPaper(row,{open:false}),{message:'公开 PDF 暂不可用：'+reason+'；文库没有变化，可稍后重试'});
		assert.equal(failures(f)[row.pdf],undefined,'not recorded: '+reason);assert.equal(offered(f,row),true,'still offered: '+reason);
	}
	let controller=new AbortController(),f=await fixture({pdf:(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})),{once:true}))});
	let pending=f.E.obtainPaper(arxivRow('2401.20005'),{open:false,signal:controller.signal});controller.abort();
	await assert.rejects(pending,{name:'AbortError'});assert.deepEqual(failures(f),{},'a cancelled download is not a failure');assert.equal(f.regular().length,0);
});

test('a later arXiv download clears the failure recorded for its address',async()=>{
	let f=await fixture(),row=arxivRow('2401.30001');
	f.state.discoveryPDFFailures={[row.pdf]:{at:Date.now(),reason:'PDF 无法获取（HTTP 404）'}};assert.equal(offered(f,row),false);
	await f.E.obtainPaper(row,{open:false});
	assert.equal(failures(f)[row.pdf],undefined,'the address has delivered a PDF');assert.equal(offered(f,row),true);
});

test('a failure that will repeat does not say it can be retried, on the open-access and the arXiv path alike',async()=>{
	let oversized=()=>reply({length:90000000}),open={id:'https://openalex.org/W1',source:'OpenAlex',title:'Large open paper',doi:'10.1000/large',url:'https://doi.org/10.1000/large',pdf:'https://repository.example/large.pdf',oa:true,authors:[]};
	await assert.rejects((await fixture({pdf:oversized})).E.obtainPaper(open,{open:false}),{message:'PDF 超过 80 MB，请从来源页面单独下载'});
	await assert.rejects((await fixture({pdf:oversized})).E.obtainPaper(arxivRow('2401.40001'),{open:false}),{message:'PDF 超过 80 MB，请从来源页面单独下载；文库没有变化'});
	let kept=await fixture({pdf:oversized});await kept.E.importAcademic(arxivRow('2401.40002'),{select:false});
	await assert.rejects(kept.E.obtainPaper(arxivRow('2401.40002'),{open:false}),{message:'PDF 超过 80 MB，请从来源页面单独下载；文库中的这条题录没有改动'});
	// A missing file: the open-access probe, the reference pane's probe and the arXiv download say the same.
	let gone=()=>reply({status:404}),expected={message:'PDF 无法获取（HTTP 404）；文库没有变化'};
	await assert.rejects((await fixture({pdf:gone})).E.obtainPaper({...open,id:'https://openalex.org/W2',doi:'10.1000/gone',url:'https://doi.org/10.1000/gone',pdf:'https://repository.example/gone.pdf'},{open:false}),expected);
	await assert.rejects((await fixture({pdf:gone})).E.obtainReferencePaper({source:'Semantic Scholar',id:'abc',title:'Gone',doi:'10.1000/gone-ref',url:'https://www.semanticscholar.org/paper/abc',pdf:'https://repository.example/gone-ref.pdf'},{open:false}),expected);
	await assert.rejects((await fixture({pdf:gone})).E.obtainPaper(arxivRow('2401.40003'),{open:false}),expected);
});

test('a failure that can pass still says it can be retried, on every path',async()=>{
	let limited=()=>reply({status:429}),expected={message:'公开 PDF 暂不可用：PDF 无法获取（HTTP 429）；文库没有变化，可稍后重试'};
	await assert.rejects((await fixture({pdf:limited})).E.obtainPaper({id:'https://openalex.org/W3',source:'OpenAlex',title:'Busy',doi:'10.1000/busy',url:'https://doi.org/10.1000/busy',pdf:'https://repository.example/busy.pdf',oa:true,authors:[]},{open:false}),expected);
	await assert.rejects((await fixture({pdf:limited})).E.obtainReferencePaper({source:'Semantic Scholar',id:'def',title:'Busy',doi:'10.1000/busy-ref',url:'https://www.semanticscholar.org/paper/def',pdf:'https://repository.example/busy-ref.pdf'},{open:false}),expected);
	await assert.rejects((await fixture({pdf:limited})).E.obtainPaper(arxivRow('2401.50001'),{open:false}),expected);
});
