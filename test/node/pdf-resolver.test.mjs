/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as Resolver from '../../chrome/content/zotero/research/shared/pdf-resolver.mjs';
import * as Arxiv from '../../chrome/content/zotero/research/shared/arxiv.mjs';
import * as Dates from '../../chrome/content/zotero/research/shared/discovery-dates.mjs';
import * as Screen from '../../chrome/content/zotero/research/shared/paper-screening.mjs';
import {installDiscoveryPDF,PDF_DOWNLOAD_TIMEOUT} from '../../chrome/content/zotero/research/shared/discovery-pdf.mjs';

let root=new URL('../../chrome/content/zotero/xpcom/research/',import.meta.url);
let sources={};for(let name of ['pdf-resolver.js','arxiv.js','search.js'])sources[name]=await readFile(new URL(name,root),'utf8');
let modules={'pdf-resolver.mjs':Resolver,'arxiv.mjs':Arxiv,'discovery-dates.mjs':Dates,'paper-screening.mjs':Screen};
let pdf=()=>new TextEncoder().encode('%PDF-1.7\n'+'open copy '.repeat(20));
let missing=()=>Object.assign(Error('服务返回 HTTP 404'),{providerStatus:404});

// X/pdf-resolver.js (and arxiv.js when asked) over controlled sources. api answers by host,
// files says how each PDF address responds; every request is logged in order.
async function load({api={},files={},page=null,email='',keys=[],withArxiv=false}={}){
	let log=[],marked=[],cleared=[],delays=[];
	let E={
		scholarly:{contact:()=>email,has:async id=>keys.includes(id)},
		requestProvider:async url=>{let host=new URL(url).hostname;log.push('api:'+host);let answer=api[host];if(!answer)throw missing();return JSON.stringify(typeof answer==='function'?answer(url):answer);},
		verifyDiscoveryPDF:async url=>{log.push('probe:'+url);let file=files[url];if(!file)return {available:false,error:'PDF 无法获取（HTTP 404）'};return file.probe||{available:true};},
		requestDiscoveryPDF:async url=>{log.push('download:'+url);let file=files[url];if(!file?.bytes)throw Error(file?.error||'PDF 无法获取（HTTP 404）');return file.bytes;},
		fetchDiscoveryPage:async url=>{log.push('page:'+url);return page?page(url):new Response('',{status:404,headers:{'content-type':'text/html'}});},
		markDiscoveryPDFFailure:async(url,error)=>marked.push([url,error.message]),
		clearDiscoveryPDFFailure:async url=>cleared.push(url),
		store:{get:()=>({}),update:async()=>{}}
	};
	let Zotero={Research:E,Promise:{delay:async ms=>{delays.push(ms);}},logError(){}};
	let context=vm.createContext({Zotero,ChromeUtils:{importESModule:url=>{let value=modules[url.split('/').at(-1)];if(!value)throw Error('unexpected module '+url);return value;}},URL,Uint8Array,AbortController,TextDecoder,Response});
	vm.runInContext(sources['pdf-resolver.js'],context);if(withArxiv)vm.runInContext(sources['arxiv.js'],context);
	return {E,log,marked,cleared,delays};
}

test('candidates are tried once each, repository copies first, and the first PDF ends the search',async()=>{
	let order=[],stage=(name,urls,phase=1)=>({name,phase,lookup:phase>0,run:async()=>{order.push(name);return urls&&urls.map(url=>({url}));}});
	let found=await Resolver.resolvePDFSources([
		stage('Record',['https://repo.example/a.pdf','http://arxiv.org/pdf/2401.00001'],0),
		stage('OpenAlex',['https://www.repo.example/a.pdf/','https://arxiv.org/pdf/2401.00001.pdf','https://repo.example/b.pdf']),
		stage('Unpaywall',null)
	],{timing:{headStart:0,landingDelay:0},probe:async url=>{order.push(url);if(url!=='https://repo.example/b.pdf')throw Error('PDF 无法获取（HTTP 404）');return {verified:true};},download:async url=>{order.push('download:'+url);return pdf();}});
	assert.deepEqual(order.filter(step=>step.startsWith('https://')),['https://arxiv.org/pdf/2401.00001','https://repo.example/a.pdf','https://repo.example/b.pdf'],'arXiv (a repository) first; www., a trailing slash, http on arXiv and .pdf on arXiv name the same file');
	assert.equal(order.at(-1),'download:https://repo.example/b.pdf');
	assert.equal(found.url,'https://repo.example/b.pdf');assert.equal(found.source,'OpenAlex');assert.deepEqual(found.tried,['Record','OpenAlex']);
	assert.equal(Resolver.pdfURL('https://sci-hub.se/10.1000/x'),'','a shadow library is never a candidate');assert.equal(Resolver.pdfURL('http://publisher.example/x.pdf'),'','plain http only for hosts known to serve https');
});

test('a web page or a 404 at the first copy moves on to the next source, which supplies the PDF',async()=>{
	let open='https://repo.example/accepted.pdf',f=await load({
		api:{'api.openalex.org':{best_oa_location:{is_oa:true,pdf_url:open},locations:[{is_oa:false,pdf_url:'https://publisher.example/closed.pdf'}]}},
		files:{'https://publisher.example/landing':{probe:{available:false,error:'来源返回网页或验证页面，未提供 PDF'}},[open]:{bytes:pdf()}}
	});
	let found=await f.E.resolveOpenPDF({source:'Crossref',doi:'10.1000/Moved',title:'Moved',pdf:'https://publisher.example/landing',pdfCandidates:['https://publisher.example/gone.pdf']});
	// Semantic Scholar and Europe PMC are asked together with OpenAlex; the probes keep their order.
	assert.deepEqual(f.log.filter(line=>!/semanticscholar|ebi\.ac\.uk/.test(line)),['probe:https://publisher.example/landing','probe:https://publisher.example/gone.pdf','api:api.openalex.org','probe:'+open,'download:'+open]);
	assert.equal(found.source,'OpenAlex');assert.equal(found.record.pdf,open);assert.equal(found.record.pdfSource,'OpenAlex');assert.equal(found.record.title,'Moved');
	assert.deepEqual(f.cleared,[open,'https://publisher.example/landing'],'a PDF that arrived clears both addresses');assert.deepEqual(f.marked,[]);
});

test('Unpaywall is asked only with a contact email, CORE only with a key',async()=>{
	let unpaywall={best_oa_location:{url_for_pdf:'https://repo.example/unpaywall.pdf'},oa_locations:[]};
	let core={results:[{doi:'10.1000/other',downloadUrl:'https://core.ac.uk/download/1.pdf'},{doi:'10.1000/x',downloadUrl:'https://core.ac.uk/download/2.pdf'}]};
	let api={'api.unpaywall.org':unpaywall,'api.core.ac.uk':core},files={'https://repo.example/unpaywall.pdf':{bytes:pdf()},'https://core.ac.uk/download/2.pdf':{bytes:pdf()}};
	let record={source:'Crossref',doi:'10.1000/x',title:'X'};
	let plain=await load({api,files});
	await assert.rejects(plain.E.resolveOpenPDF(record),{message:/^已尝试 4 个来源（OpenAlex、Semantic Scholar、Europe PMC、出版社页面）/});
	assert.ok(!plain.log.some(line=>/unpaywall|core\.ac\.uk/.test(line)),plain.log.join(','));
	let withEmail=await load({api,files,email:'reader@university.example'});
	assert.equal((await withEmail.E.resolveOpenPDF(record)).source,'Unpaywall');assert.ok(withEmail.log.includes('api:api.unpaywall.org'));
	let withKey=await load({api:{'api.core.ac.uk':core},files,keys:['core']});
	let found=await withKey.E.resolveOpenPDF(record);
	assert.equal(found.source,'CORE');assert.equal(found.url,'https://core.ac.uk/download/2.pdf','only the result with the same DOI');
});

test('a paper with a PMCID gets its Europe PMC copy, and a Springer Nature DOI its open-access link',async()=>{
	let f=await load({api:{'api.openalex.org':{ids:{pmcid:'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1234567'},locations:[]}},files:{'https://europepmc.org/articles/PMC1234567?pdf=render':{bytes:pdf()}}});
	let found=await f.E.resolveOpenPDF({doi:'10.1000/pmc',title:'Indexed'});
	assert.equal(found.source,'Europe PMC');assert.equal(found.url,'https://europepmc.org/articles/PMC1234567?pdf=render');assert.ok(!f.log.some(line=>line.includes('ebi.ac.uk')),'the PMCID from OpenAlex needs no search');
	let springer={records:[{doi:'10.1186/s12859-020-0001-x',openaccess:'true',url:[{format:'html',value:'http://link.springer.com/x'},{format:'pdf',value:'http://link.springer.com/content/pdf/10.1186/s12859-020-0001-x.pdf'}]}]};
	let s=await load({api:{'api.springernature.com':springer},keys:['springer-oa'],files:{'https://link.springer.com/content/pdf/10.1186/s12859-020-0001-x.pdf':{bytes:pdf()}}});
	assert.equal((await s.E.resolveOpenPDF({doi:'10.1186/s12859-020-0001-x'})).source,'Springer Nature');
	assert.deepEqual(Resolver.springerPDFs({records:[{doi:'10.1007/x',openaccess:'false',url:[{format:'pdf',value:'https://link.springer.com/x.pdf'}]}]},'10.1007/x'),[],'a record not marked open access gives nothing');
});

test('the DOI landing page is read last, and its citation_pdf_url must still pass the PDF check',async()=>{
	let html='<html><head><meta name="citation_title" content="T"><meta content="/content/paper.pdf?download=1&amp;x=2" name="citation_pdf_url"></head><body>'+'x'.repeat(5000)+'</body></html>';
	let file='https://journal.example/content/paper.pdf?download=1&x=2';
	let f=await load({page:()=>{let response=new Response(html,{status:200,headers:{'content-type':'text/html; charset=utf-8'}});Object.defineProperty(response,'url',{value:'https://journal.example/article/1'});return response;},files:{[file]:{bytes:pdf()}}});
	let found=await f.E.resolveOpenPDF({doi:'10.1000/page'});
	assert.equal(found.url,file);assert.equal(found.source,'出版社页面');assert.equal(f.log.at(-3),'page:https://doi.org/10.1000/page');assert.deepEqual(f.log.slice(-2),['probe:'+file,'download:'+file]);
	let login=await load({page:()=>new Response(html,{status:200,headers:{'content-type':'text/html'}}),files:{}});
	await assert.rejects(login.E.resolveOpenPDF({doi:'10.1000/page'}),/出版社页面：PDF 无法获取（HTTP 404）/,'a file behind a login is not saved');
});

test('an arXiv copy goes through arxiv.js\'s queue, 3.1 s apart, and a rate limit is waited out once',async()=>{
	let f=await load({withArxiv:true,api:{'api.semanticscholar.org':{externalIds:{ArXiv:'2401.00002'},openAccessPdf:null}}}),calls=0;
	f.E.requestDiscoveryPDF=async url=>{f.log.push('download:'+url);if(++calls===1)throw Object.assign(Error('PDF 无法获取（HTTP 429）'),{status:429,retryAfter:'2'});return pdf();};
	let found=await f.E.resolveOpenPDF({source:'Crossref',doi:'10.1000/journal',title:'Journal article'});
	assert.equal(found.source,'arXiv');assert.equal(found.url,'https://arxiv.org/pdf/2401.00002');
	assert.deepEqual(f.log.filter(line=>line.includes('arxiv.org')),['download:https://arxiv.org/pdf/2401.00002','download:https://arxiv.org/pdf/2401.00002'],'no separate probe; one retry after the 429');
	assert.ok(f.delays.includes(3100),'the retry waits at least the arXiv interval: '+f.delays.join(','));
	// Two arXiv downloads in a row: the second waits for the first's turn.
	let g=await load({withArxiv:true}),started=[];let release;let gate=new Promise(resolve=>release=resolve);
	g.E.requestDiscoveryPDF=async url=>{started.push(url);if(url.endsWith('1'))await gate;return pdf();};
	let first=g.E.arxivPDF('https://arxiv.org/pdf/2401.00001'),second=g.E.arxivPDF('https://arxiv.org/pdf/2401.00003');
	await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(started,['https://arxiv.org/pdf/2401.00001'],'the second waits while the first is downloading');
	release();await Promise.all([first,second]);assert.equal(started.length,2);assert.ok(g.delays.some(ms=>ms>3000),'the second waits the interval: '+g.delays.join(','));
});

test('when every source answers without a PDF the card names them and the addresses are recorded; a 429 or timeout records nothing',async()=>{
	let record={source:'OpenAlex',doi:'10.1000/none',title:'None',pdf:'https://publisher.example/none.pdf'};
	let f=await load({email:'reader@university.example',api:{'api.unpaywall.org':{best_oa_location:null,oa_locations:[]}}});
	await assert.rejects(f.E.resolveOpenPDF(record),error=>{
		assert.equal(error.message,'已尝试 5 个来源（OpenAlex、Unpaywall、Semantic Scholar、Europe PMC、出版社页面），均未找到可下载的开放获取 PDF。OpenAlex：PDF 无法获取（HTTP 404）。文库没有变化');
		assert.equal(error.lasting,true);assert.deepEqual(error.sources,['OpenAlex','Unpaywall','Semantic Scholar','Europe PMC','出版社页面']);return true;
	});
	assert.deepEqual(f.marked.map(([url])=>url),['https://publisher.example/none.pdf']);assert.match(f.marked[0][1],/均未找到可下载的开放获取 PDF/);
	for(let failure of [Object.assign(Error('服务返回 HTTP 429'),{providerStatus:429}),Object.assign(Error('服务请求超时，请重试'),{name:'TimeoutError'})]){
		let busy=await load({api:{'api.semanticscholar.org':()=>{throw failure;}}});
		busy.E.requestProvider=async url=>{busy.log.push(url);if(url.includes('semanticscholar'))throw failure;throw missing();};
		await assert.rejects(busy.E.resolveOpenPDF(record),{lasting:false,message:/^已尝试 4 个来源.*Semantic Scholar：服务.*。文库没有变化，部分来源暂时无法访问，可稍后重试$/});
		assert.deepEqual(busy.marked,[],'nothing recorded after '+failure.message);
	}
	let slow=await load({files:{'https://publisher.example/none.pdf':{error:'PDF 来源 20 秒没有响应（超时）'}}});
	await assert.rejects(slow.E.resolveOpenPDF(record),{lasting:false});assert.deepEqual(slow.marked,[],'a timed-out download is not recorded');
	let nothing=await load();
	await assert.rejects(nothing.E.resolveOpenPDF({title:'No identifiers'}),{message:'未找到公开 PDF；文库没有变化，可稍后重试',lasting:false});assert.deepEqual(nothing.log,[],'no identifier, no request');
});

test('a retracted work stops the search',async()=>{
	let f=await load({api:{'api.openalex.org':{is_retracted:true,best_oa_location:{is_oa:true,pdf_url:'https://repo.example/r.pdf'}}},files:{'https://repo.example/r.pdf':{bytes:pdf()}}});
	await assert.rejects(f.E.resolveOpenPDF({doi:'10.1000/retracted'}),/撤稿/);assert.ok(!f.log.some(line=>line.startsWith('download:')));
});

test('conference papers, preprints and journal articles get their own item types',async()=>{
	for(let [record,type] of [
		[{source:'Crossref',type:'proceedings-article',journal:'2023 IEEE Global Communications Conference'},'conferencePaper'],
		[{source:'OpenAlex',sourceType:'conference',journal:'ICASSP'},'conferencePaper'],
		[{source:'Semantic Scholar',journal:'Neural Information Processing Systems'},'conferencePaper'],
		[{source:'Semantic Scholar',journal:'Some Venue',pdfHints:{publicationTypes:['Conference']}},'conferencePaper'],
		[{source:'OpenAlex',journal:'Proceedings of the National Academy of Sciences'},'journalArticle'],
		[{source:'OpenAlex',journal:'bioRxiv',pdfHints:{type:'preprint'}},'preprint'],
		[{source:'OpenAlex',sourceType:'repository',journal:'Zenodo'},'preprint'],
		[{source:'Semantic Scholar',journal:'medRxiv'},'preprint'],
		[{source:'arXiv'},'preprint'],
		[{source:'OpenAlex',sourceType:'journal',journal:'Physical Review Letters'},'journalArticle'],
		[{source:'OpenAlex',sourceType:'repository',pdfHints:{type:'article'}},'journalArticle'],
		[{source:'Crossref',journal:'Controlled Journal'},'journalArticle']
	])assert.equal(Resolver.paperItemType(record),type,JSON.stringify(record));
	// search.js files them so: a conference paper's venue is its proceedings title.
	let made=[];
	class Item{constructor(type){this.itemType=type;this.fields={};made.push(this);}setField(key,value){this.fields[key]=value;}setCreators(){}setCollections(){}async saveTx(){this.id=50+made.length;}}
	let pane={getSelectedLibraryIDs:()=>[1],getSelectedCollections:()=>[]};
	let Zotero={Research:{},Item,getActiveZoteroPane:()=>pane,Libraries:{userLibraryID:1,get:()=>({editable:true})},Collections:{getAsync:async()=>null},Items:{getAsync:async()=>[]},Search:class{addCondition(){}async search(){return [];}}};
	vm.runInNewContext(sources['search.js'],{Zotero,ChromeUtils:{importESModule:url=>{let value=modules[url.split('/').at(-1)];if(!value)throw Error('unexpected module '+url);return value;}}});
	await Zotero.Research.importAcademic({source:'Crossref',type:'proceedings-article',doi:'10.1109/conf.1',title:'A conference paper',journal:'2023 IEEE Global Communications Conference',issn:'1234-5678',url:'https://doi.org/10.1109/conf.1'},{select:false});
	await Zotero.Research.importAcademic({source:'OpenAlex',doi:'10.1101/2024.01.01.1',title:'A preprint',journal:'bioRxiv',url:'https://doi.org/10.1101/2024.01.01.1',pdfHints:{type:'preprint'}},{select:false});
	assert.equal(made[0].itemType,'conferencePaper');assert.equal(made[0].fields.proceedingsTitle,'2023 IEEE Global Communications Conference');assert.equal(made[0].fields.publicationTitle,undefined);
	assert.equal(made[1].itemType,'preprint');assert.equal(made[1].fields.repository,'bioRxiv');assert.equal(made[1].fields.publicationTitle,undefined);
});

test('a download stops after 20 s without data, but a large PDF that keeps arriving is not cut off',async()=>{
	assert.deepEqual(PDF_DOWNLOAD_TIMEOUT,{firstByte:20000,idle:20000,total:180000});
	let chunk=new TextEncoder().encode('%PDF-1.7\n'+'x'.repeat(2000)),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
	let stream=gaps=>new ReadableStream({async start(controller){for(let gap of gaps){await wait(gap);controller.enqueue(chunk.slice());}controller.close();}});
	let respond=gaps=>async()=>new Response(stream(gaps),{status:200,headers:{'content-type':'application/pdf'}});
	// Scaled down: 40 ms idle, 400 ms total. Six chunks 30 ms apart take longer than the idle limit in all.
	let timeout={firstByte:40,idle:40,total:400};
	let steady={};installDiscoveryPDF(steady,{fetch:respond([5,30,30,30,30,30])});
	assert.equal((await steady.requestDiscoveryPDF('https://repo.example/large.pdf',{timeout})).length,chunk.length*6);
	let stalled={};installDiscoveryPDF(stalled,{fetch:respond([5,120])});
	await assert.rejects(stalled.requestDiscoveryPDF('https://repo.example/stalled.pdf',{timeout}),{name:'TimeoutError',timeoutStage:'idle'});
	let silent={};installDiscoveryPDF(silent,{fetch:()=>new Promise(()=>{})});
	await assert.rejects(silent.requestDiscoveryPDF('https://repo.example/silent.pdf',{timeout}),{name:'TimeoutError',timeoutStage:'firstByte',message:/没有响应（超时）/});
	let endless={};installDiscoveryPDF(endless,{fetch:respond(Array(40).fill(20))});
	await assert.rejects(endless.requestDiscoveryPDF('https://repo.example/endless.pdf',{timeout}),{name:'TimeoutError',timeoutStage:'total'});
	let large={};installDiscoveryPDF(large,{fetch:async()=>new Response(chunk,{status:200,headers:{'content-type':'application/pdf','content-length':'90000000'}})});
	await assert.rejects(large.requestDiscoveryPDF('https://repo.example/huge.pdf',{timeout}),/超过 80 MB/,'the 80 MB limit is unchanged');
});

test('the extractors read the services\' real answer shapes',()=>{
	// Shapes as returned by the services for 10.1038/s41586-020-2649-2 (trimmed).
	let s2={paperId:'024a',externalIds:{ArXiv:'2006.10256',DOI:'10.1038/s41586-020-2649-2',PubMedCentral:'7759461'},venue:'Nature',openAccessPdf:{url:'https://www.nature.com/articles/s41586-020-2649-2.pdf',status:'HYBRID'},publicationTypes:['Review','JournalArticle']};
	let unpaywall={best_oa_location:{url_for_pdf:'https://www.nature.com/articles/s41586-020-2649-2.pdf'},oa_locations:[{url_for_pdf:'https://www.nature.com/articles/s41586-020-2649-2.pdf'},{url_for_pdf:null,url:'https://europepmc.org/articles/pmc7759461'}]};
	assert.deepEqual(Resolver.semanticPDFs(s2),['https://www.nature.com/articles/s41586-020-2649-2.pdf']);
	assert.deepEqual(Resolver.unpaywallPDFs(unpaywall),['https://www.nature.com/articles/s41586-020-2649-2.pdf','https://www.nature.com/articles/s41586-020-2649-2.pdf']);
	let ctx=Resolver.pdfContext({doi:'https://doi.org/10.1038/S41586-020-2649-2'});Resolver.absorbSemantic(ctx,s2);
	assert.equal(ctx.doi,'10.1038/s41586-020-2649-2');assert.equal(ctx.arxiv,'2006.10256');assert.equal(ctx.pmcid,'PMC7759461');assert.deepEqual(ctx.hints.publicationTypes,['Review','JournalArticle']);
	assert.equal(Resolver.europePMCSearchPMCID({resultList:{result:[{doi:'10.1038/S41586-020-2649-2',pmcid:'PMC7759461',isOpenAccess:'N',inEPMC:'Y'}]}},'10.1038/s41586-020-2649-2'),'PMC7759461');
	assert.deepEqual(Resolver.corePDFs({results:[{title:'Array programming with NumPy',downloadUrl:'https://core.ac.uk/download/1.pdf'},{title:'Another',downloadUrl:'https://core.ac.uk/download/2.pdf'}]},{title:'Array Programming with NumPy'}),['https://core.ac.uk/download/1.pdf'],'without a DOI only the exact title');
	assert.equal(Resolver.pdfContext({doi:'10.48550/arXiv.2401.24680'}).arxiv,'2401.24680');
});
