/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as WorkspaceOutputs from '../../chrome/content/zotero/research/shared/workspace-outputs.mjs';
import * as references from '../../chrome/content/zotero/research/shared/reference-matcher.mjs';
import {installJournalSubscriptions,installJournalSubscriptionTimer} from '../../chrome/content/zotero/research/shared/discovery-journals.mjs';
import * as Arxiv from '../../chrome/content/zotero/research/shared/arxiv.mjs';

let source=new URL('../../chrome/content/zotero/xpcom/research/discovery.js',import.meta.url);
let arxivSource=new URL('../../chrome/content/zotero/xpcom/research/arxiv.js',import.meta.url);

// obtainPaper with recorded stubs: every library write and network step is logged in order.
// withArxiv also loads arxiv.js, whose obtainPaper wrapper is what the application calls.
async function load({existing=null,lookup=null,probe=async()=>({available:true}),download=async()=>new Uint8Array([37,80,68,70,45]),withArxiv=false,filesEditable=true}={}){
	let calls=[],stages=[],files=new Map(),nextID=40;
	let item=id=>({id,saved:true,getAttachments:()=>[]});
	let E={
		workspaceOutputs:{rememberDownload:async()=>{}},
		store:{get:()=>({}),peek:()=>undefined,update:async fn=>fn({})},
		manuscripts:{queueArticle:()=>{}},
		resolveAcademicTarget:async options=>({libraryID:1,collectionID:options.collectionID??null}),
		placeAcademicInCollection:async(id,target)=>calls.push('place:'+id+':'+target.collectionID),
		findAcademicItem:async()=>{calls.push('find');return existing?item(existing.id):null;},
		importAcademic:async()=>{calls.push('import');return {id:existing?.id||11};},
		library:{localPDF:async value=>{let id=typeof value==='number'?value:value?.id;if(existing&&id===existing.id)return existing.pdf;return files.get(id)||null;}},
		requestProvider:async url=>{calls.push('lookup');if(!lookup)throw Object.assign(Error('服务返回 HTTP 404'),{providerStatus:404});return JSON.stringify(lookup);},
		verifyDiscoveryPDF:async url=>{calls.push('probe');return probe(url);},
		requestDiscoveryPDF:async url=>{calls.push('download');return download(url);},
		markDiscoveryPDFFailure:async()=>{},
		clearDiscoveryPDFFailure:async()=>{}
	};
	let Zotero={
		Research:E,
		addShutdownListener(){},
		Items:{getAsync:async id=>item(id)},
		Libraries:{get:()=>({filesEditable})},
		Reader:{open:async()=>calls.push('open')},
		Utilities:{randomString:()=>'x'},
		getTempDirectory:()=>({path:'/tmp'}),
		File:{pathToFile:path=>({path})},
		Attachments:{importFromFile:async({parentItemID})=>{calls.push('attach:'+parentItemID);let id=nextID++,attachment={id,setField(){},saveTx:async()=>{},getFilePathAsync:async()=>'/local/'+id+'.pdf'};files.set(id,attachment);return attachment;}}
	};
	let context=vm.createContext({
		Zotero,
		IOUtils:{write:async()=>{},remove:async()=>{}},
		PathUtils:{join:(...parts)=>parts.join('/')},
		ChromeUtils:{importESModule:url=>url.includes('workspace-outputs')?WorkspaceOutputs:url.includes('reference-matcher')?references:url.endsWith('/arxiv.mjs')?Arxiv:{installDiscoveryFeed(){},installJournalSubscriptionTimer}}
	});
	vm.runInContext(await readFile(source,'utf8'),context);
	if(withArxiv)vm.runInContext(await readFile(arxivSource,'utf8'),context);
	let progress=value=>stages.push(value.stage);
	return {E,calls,stages,progress};
}

test('a reference without a public PDF files nothing in the library',async()=>{
	let f=await load({lookup:{best_oa_location:null,locations:[{is_oa:false,pdf_url:'https://publisher.example/closed.pdf'}]}});
	await assert.rejects(f.E.obtainPaper({id:'r1',doi:'10.1000/closed',title:'Closed'},{open:false,collectionID:7,onProgress:f.progress}),/^Error: 未找到公开 PDF；文库没有变化/);
	assert.deepEqual(f.calls,['find','lookup'],'no import before a PDF is found');
});

test('a PDF address that fails the probe files nothing and downloads nothing',async()=>{
	let f=await load({probe:async()=>({available:false,error:'来源返回网页或验证页面，未提供 PDF'})});
	// A web page at the PDF address returns on every attempt, so no retry is offered.
	await assert.rejects(f.E.obtainPaper({id:'r2',doi:'10.1000/landing',title:'Landing',pdf:'https://repository.example/landing'},{open:false,collectionID:7}),/^Error: 来源返回网页或验证页面，未提供 PDF；文库没有变化$/);
	assert.deepEqual(f.calls,['find','probe']);
});

test('a download that fails after a passing probe files nothing',async()=>{
	let f=await load({download:async()=>{throw Error('PDF 无法获取（HTTP 403）');}});
	await assert.rejects(f.E.obtainPaper({id:'r3',doi:'10.1000/forbidden',title:'Forbidden',pdf:'https://publisher.example/forbidden.pdf'},{open:false,collectionID:7}),/HTTP 403/);
	assert.ok(!f.calls.includes('import'),'the record is filed only after the PDF bytes arrive: '+f.calls.join(','));
	assert.ok(f.calls.indexOf('probe')<f.calls.indexOf('download'));
});

test('a reachable PDF is probed and downloaded before the record is filed and attached',async()=>{
	let f=await load({lookup:{best_oa_location:{is_oa:true,pdf_url:'https://repository.example/open.pdf'}}});
	let result=await f.E.obtainPaper({id:'r4',doi:'10.1000/open',title:'Open'},{open:false,collectionID:7,onProgress:f.progress});
	assert.deepEqual(f.calls,['find','lookup','probe','find','download','import','attach:11','place:11:7']);
	assert.equal(result.attachmentID,40);assert.equal(result.downloaded,true);assert.equal(result.path,'/local/40.pdf');
	assert.deepEqual(f.stages,['lookup','resolve','verify','download','save','saved']);
});

test('a paper that already has a local PDF is reused without a probe or a download',async()=>{
	let pdf={id:30,getFilePathAsync:async()=>'/local/30.pdf'},f=await load({existing:{id:12,pdf}});
	let result=await f.E.obtainPaper({id:'r5',doi:'10.1000/kept',title:'Kept',pdf:'https://repository.example/kept.pdf'},{open:false,collectionID:7});
	assert.deepEqual(f.calls,['find','place:12:7']);assert.equal(result.reused,true);assert.equal(result.attachmentID,30);assert.equal(result.path,'/local/30.pdf');
});

test('obtainOpenPaper downloads before it files the record',async()=>{
	let f=await load({download:async()=>{throw Error('PDF 无法获取（HTTP 404）');}});
	await assert.rejects(f.E.obtainOpenPaper({id:'r6',doi:'10.1000/gone',title:'Gone',oa:true,pdf:'https://repository.example/gone.pdf'},{collectionID:7}),/HTTP 404/);
	assert.ok(!f.calls.includes('import'),f.calls.join(','));
	await assert.rejects(f.E.obtainOpenPaper({id:'r7',doi:'10.1000/none',title:'None',oa:true},{collectionID:7}),/暂无直接公开 PDF/);
	assert.ok(!f.calls.includes('import'),f.calls.join(','));
});

test('a journal article whose open copy is an arXiv PDF is filed as that journal article',async()=>{
	let f=await load({lookup:{best_oa_location:{is_oa:true,pdf_url:'https://arxiv.org/pdf/2401.01234v2'}}}),imported=[],routed=[];
	let importAcademic=f.E.importAcademic;f.E.importAcademic=async(record,options)=>{imported.push(record);return importAcademic(record,options);};
	f.E.importAcademicPDF=async record=>{routed.push(record);return {itemID:99,attachmentID:98};};
	let record={id:'https://openalex.org/W4400000001',source:'OpenAlex',title:'A journal article with an arXiv copy',doi:'10.1103/physrevlett.000.000001',url:'https://doi.org/10.1103/physrevlett.000.000001',journal:'Physical Review Letters'};
	await f.E.obtainPaper(record,{open:false,collectionID:7});
	assert.equal(routed.length,0,'not sent to the arXiv preprint import');
	assert.equal(imported.length,1);assert.equal(imported[0].source,'OpenAlex');assert.equal(imported[0].journal,'Physical Review Letters');assert.equal(imported[0].url,record.url);
	assert.deepEqual(f.calls,['find','lookup','probe','find','download','import','attach:11','place:11:7']);
});

test('an arXiv record still uses the arXiv preprint import',async()=>{
	let f=await load(),routed=[];
	f.E.importAcademicPDF=async(record,options)=>{routed.push(record);return {itemID:99,attachmentID:98,collectionID:options.collectionID};};
	let result=await f.E.obtainOpenPaper({id:'2401.01234v2',source:'arXiv',title:'An arXiv paper',url:'https://arxiv.org/abs/2401.01234v2',pdf:'https://arxiv.org/pdf/2401.01234v2',oa:true},{collectionID:7});
	assert.equal(routed.length,1);assert.equal(result.itemID,99);assert.ok(!f.calls.includes('import'),f.calls.join(','));
});

// arxiv.js: an arXiv record is filed only after its PDF has been downloaded and checked.
let arxivPDF=()=>new TextEncoder().encode('%PDF-1.7\n'+'arXiv paper content '.repeat(8));
let arxivRecord={id:'2401.01234v2',source:'arXiv',title:'An arXiv paper',url:'https://arxiv.org/abs/2401.01234v2',pdf:'https://arxiv.org/pdf/2401.01234v2',authors:[]};

test('an arXiv PDF is downloaded and checked before the record is filed and attached',async()=>{
	let f=await load({withArxiv:true,download:async()=>arxivPDF()}),imported=[];
	let importAcademic=f.E.importAcademic;f.E.importAcademic=async(record,options)=>{imported.push(record);return importAcademic(record,options);};
	let result=await f.E.obtainPaper(arxivRecord,{open:false,collectionID:7,onProgress:f.progress});
	assert.deepEqual(f.calls,['find','download','import','attach:11'],'nothing is written before the PDF bytes arrive');
	assert.equal(imported.length,1);assert.equal(imported[0].source,'arXiv');assert.equal(imported[0].url,'https://arxiv.org/abs/2401.01234v2');
	assert.equal(result.itemID,11);assert.equal(result.attachmentID,40);assert.equal(result.downloaded,true);assert.equal(result.path,'/local/40.pdf');
	assert.deepEqual(f.stages,['lookup','download','save','saved']);
});

test('a failed arXiv download files nothing, and an existing record is left as it was',async()=>{
	// A refusal can pass and offers a retry; bytes that are not a PDF, or a 404, return on every attempt.
	for(let [download,message] of [[async()=>{throw Error('PDF 无法获取（HTTP 403）');},'公开 PDF 暂不可用：PDF 无法获取（HTTP 403）；文库没有变化，可稍后重试'],[async()=>new TextEncoder().encode('<html>Access denied</html>'),'下载返回非 PDF 内容；文库没有变化']]){
		let f=await load({withArxiv:true,download});
		await assert.rejects(f.E.obtainPaper(arxivRecord,{open:false,collectionID:7}),{message});
		assert.deepEqual(f.calls,['find','download'],'no import, attachment or folder change after a failed download');
	}
	let f=await load({withArxiv:true,existing:{id:12,pdf:null},download:async()=>{throw Error('PDF 无法获取（HTTP 404）');}});
	await assert.rejects(f.E.obtainPaper(arxivRecord,{open:false,collectionID:7}),{message:'PDF 无法获取（HTTP 404）；文库中的这条题录没有改动'});
	assert.deepEqual(f.calls,['find','download'],'the existing record is not moved into the folder without its PDF');
	let readOnly=await load({withArxiv:true,filesEditable:false});
	await assert.rejects(readOnly.E.obtainPaper(arxivRecord,{open:false,collectionID:7}),/^Error: 目标文库不能保存附件；文库没有变化$/);
	assert.deepEqual(readOnly.calls,['find'],'nothing is downloaded or filed for a library that cannot keep the PDF');
});

test('with arxiv.js loaded, a record that is not an arXiv record keeps the original obtainPaper path',async()=>{
	// The open copy of this journal article is on arxiv.org; the record itself is not an arXiv record.
	let journal={id:'0123456789abcdef0123456789abcdef01234567',source:'Semantic Scholar',title:'A journal article with an arXiv copy',doi:'10.1103/physrevlett.000.000002',url:'https://doi.org/10.1103/physrevlett.000.000002',journal:'Physical Review Letters',pdf:'https://arxiv.org/pdf/2401.05678v1',oa:true};
	let open={id:'https://openalex.org/W4400000002',source:'OpenAlex',title:'An open journal article',doi:'10.1000/open-journal',url:'https://doi.org/10.1000/open-journal',journal:'Open Journal',pdf:'https://repository.example/open-journal.pdf',oa:true};
	for(let record of [journal,open]){
		let f=await load({withArxiv:true}),imported=[],routed=[];
		let importAcademic=f.E.importAcademic;f.E.importAcademic=async(value,options)=>{imported.push(value);return importAcademic(value,options);};
		f.E.importAcademicPDF=async value=>{routed.push(value);return {itemID:99,attachmentID:98};};
		await f.E.obtainPaper(record,{open:false,collectionID:7});
		assert.equal(routed.length,0,'not sent to the arXiv preprint import: '+record.title);
		assert.deepEqual(f.calls,['find','probe','find','download','import','attach:11','place:11:7']);
		assert.equal(imported.length,1);assert.equal(imported[0].source,record.source);assert.equal(imported[0].url,record.url);assert.equal(imported[0].journal,record.journal);
	}
});

const raw=doi=>({DOI:doi,title:['Measured quantum spin experiment'],type:'journal-article','container-title':['Physical Review Letters'],ISSN:['0031-9007'],published:{'date-parts':[[2026,10,19]]},author:[{family:'Author'}],license:[{URL:'https://creativecommons.org/licenses/by/4.0/'}],link:[{URL:'https://example.org/'+doi+'.pdf','content-type':'application/pdf'}]});
function journals(includeMetadata){
	let state={settings:{}},saved=[];
	let E={store:{get:()=>state,update:async fn=>fn(state)},resolveAcademicTarget:async config=>({collectionID:config.collectionID,libraryID:1}),requestProvider:async()=>JSON.stringify({message:{items:[raw('10.1234/open')]}}),obtainPaper:async()=>{throw Error('PDF 无法获取（HTTP 403）');},importAcademic:async row=>saved.push(row.doi)};
	installJournalSubscriptions(E);
	return {E,state,saved,includeMetadata};
}

test('journal tracking with 同时保存题录 keeps the record when its PDF cannot be fetched',async()=>{
	let f=journals(true);await f.E.saveJournalSubscription({enabled:true,journalIDs:['prl'],collectionID:7,includeMetadata:true});
	let result=await f.E.refreshJournalSubscriptions();
	assert.deepEqual(f.saved,['10.1234/open']);assert.equal(result.metadata,1);assert.equal(result.pdf,0);assert.equal(result.errors.length,1,'the PDF failure is still reported and retried');assert.equal(f.state.settings.journalSubscription.lastChecked,0);
	let plain=journals(false);await plain.E.saveJournalSubscription({enabled:true,journalIDs:['prl'],collectionID:7});
	await plain.E.refreshJournalSubscriptions();assert.deepEqual(plain.saved,[],'without 同时保存题录 nothing is filed');
});

test('a later retry of a still-missing PDF does not count the record it saved earlier again',async()=>{
	let f=journals(true),library=new Set(),attempts=0;
	// As search.js does: a second import of the same DOI reuses the item.
	f.E.importAcademic=async row=>{let existing=library.has(row.doi);library.add(row.doi);return {id:11,existing};};
	f.E.obtainPaper=async()=>{attempts++;throw Error('PDF 无法获取（HTTP 403）');};
	await f.E.saveJournalSubscription({enabled:true,journalIDs:['prl'],collectionID:7,includeMetadata:true});
	let first=await f.E.refreshJournalSubscriptions();assert.equal(first.metadata,1);assert.equal(first.imported,1);
	let second=await f.E.refreshJournalSubscriptions();
	assert.equal(attempts,2,'the PDF is tried again');assert.equal(second.metadata,0);assert.equal(second.imported,0);assert.equal(second.errors.length,1);
	assert.equal(library.size,1);
});
