/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The download path: parallel resolution, the status classifier, Zotero's resolver as a fallback,
// translator metadata for the new item and OpenAlex's paid copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as Resolver from '../../chrome/content/zotero/research/shared/pdf-resolver.mjs';
import * as Status from '../../chrome/content/zotero/research/shared/pdf-status.mjs';
import * as Arxiv from '../../chrome/content/zotero/research/shared/arxiv.mjs';
import * as Screen from '../../chrome/content/zotero/research/shared/paper-screening.mjs';
import * as WorkspaceOutputs from '../../chrome/content/zotero/research/shared/workspace-outputs.mjs';
import * as references from '../../chrome/content/zotero/research/shared/reference-matcher.mjs';
import {readDiscoveryPDF} from '../../chrome/content/zotero/research/shared/discovery-pdf.mjs';
import {installJournalSubscriptionTimer} from '../../chrome/content/zotero/research/shared/discovery-journals.mjs';

let root=new URL('../../chrome/content/zotero/xpcom/research/',import.meta.url);
let sources={};for(let name of ['pdf-resolver.js','discovery.js','search.js'])sources[name]=await readFile(new URL(name,root),'utf8');
let pdf=()=>new TextEncoder().encode('%PDF-1.7\n'+'open copy '.repeat(20));
let wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let never=()=>new Promise(()=>{});
let fast={headStart:5,landingDelay:5,lookupTimeout:200,budget:400};
let stage=(name,phase,run,extra={})=>({name,phase,lookup:phase>0,run,...extra});

test('the lookups run together: a slow one does not hold back the copy another finds',async()=>{
	let started=[],t0=Date.now();
	let found=await Resolver.resolvePDFSources([
		stage('Record',0,async()=>[]),
		stage('Slow',1,async()=>{started.push('Slow');return never();}),
		stage('Fast',1,async()=>{started.push('Fast');await wait(10);return [{url:'https://repo.example/fast.pdf'}];}),
		stage('Later',1,async()=>{started.push('Later');await wait(40);return [{url:'https://other.example/later.pdf'}];})
	],{timing:fast,probe:async()=>({verified:true}),download:async()=>pdf()});
	assert.equal(found.url,'https://repo.example/fast.pdf');assert.equal(found.source,'Fast');
	assert.deepEqual(started.sort(),['Fast','Later','Slow'],'every lookup started at once');
	assert.ok(Date.now()-t0<150,'returned without waiting for the slow lookup: '+(Date.now()-t0)+' ms');
});

test('the first verified copy wins and the probes still running are stopped',async()=>{
	let aborted=[];
	let found=await Resolver.resolvePDFSources([stage('Record',0,async()=>[{url:'https://slow.example/a.pdf'},{url:'https://quick.example/b.pdf'}])],{timing:fast,
		probe:async(url,source,signal)=>{if(url.includes('slow')){signal.addEventListener('abort',()=>aborted.push(url));return never();}await wait(5);return {verified:true};},download:async()=>pdf()});
	assert.equal(found.url,'https://quick.example/b.pdf');assert.deepEqual(aborted,['https://slow.example/a.pdf']);
});

test('at most two probes at a time and never two on one host; repository copies before publisher links, the landing page last',async()=>{
	let live=new Map(),most=0,perHost=0,order=[];
	let probe=async url=>{let host=new URL(url).hostname;order.push(url);live.set(host,(live.get(host)||0)+1);most=Math.max(most,[...live.values()].reduce((a,b)=>a+b,0));perHost=Math.max(perHost,live.get(host));await wait(5);live.set(host,live.get(host)-1);throw Error('PDF 无法获取（HTTP 404）');};
	await assert.rejects(Resolver.resolvePDFSources([
		stage('Record',0,async()=>[{url:'https://link.springer.com/content/pdf/1.pdf'},{url:'https://journal.example/1.pdf'},{url:'https://journal.example/2.pdf'},{url:'https://journal.example/3.pdf'},{url:'https://arxiv.org/pdf/2401.00001'}]),
		stage('Page',2,async()=>[{url:'https://press.example/from-page.pdf'}],{landing:true}),
		stage('OpenAlex',1,async()=>[{url:'https://europepmc.org/articles/PMC1?pdf=render'},{url:'https://journal.example/4.pdf'}])
	],{timing:{...fast,headStart:50},probe,download:async()=>pdf()}),{state:'none'});
	assert.equal(most,2);assert.equal(perHost,1,'one host is probed one address at a time');
	assert.equal(order[0],'https://arxiv.org/pdf/2401.00001','a repository copy first');
	assert.ok(order.indexOf('https://link.springer.com/content/pdf/1.pdf')>order.indexOf('https://journal.example/1.pdf'),'a publisher that often bot-checks after other links');
	assert.equal(order.at(-1),'https://press.example/from-page.pdf','the landing page\'s citation_pdf_url last');
});

test('the whole search stops at the budget, says some sources did not finish, and records nothing',async()=>{
	let t0=Date.now();
	await assert.rejects(Resolver.resolvePDFSources([stage('Record',0,async()=>[{url:'https://hang.example/a.pdf'}]),stage('Hang',1,async()=>never())],{timing:{...fast,budget:80,lookupTimeout:1000},probe:async()=>never(),download:async()=>pdf()}),error=>{
		assert.equal(error.lasting,false);assert.equal(error.state,'failed');assert.match(error.message,/部分来源暂时无法访问，可稍后重试$/);return true;
	});
	assert.ok(Date.now()-t0<300,'stopped at the budget: '+(Date.now()-t0)+' ms');
});

test('an arXiv download already under way finishes after the budget',async()=>{
	let found=await Resolver.resolvePDFSources([stage('Record',0,async()=>[{url:'https://arxiv.org/pdf/2401.00009'}])],{timing:{...fast,budget:20},exempt:url=>url.includes('arxiv.org'),probe:async()=>{await wait(60);return {bytes:pdf()};},download:async()=>pdf()});
	assert.equal(found.url,'https://arxiv.org/pdf/2401.00009');assert.ok(found.bytes.length>100);
});

test('a copy whose address failed for good in the last day is not probed again',async()=>{
	let probed=[];
	await assert.rejects(Resolver.resolvePDFSources([stage('Record',0,async()=>[{url:'https://dead.example/a.pdf'}])],{timing:fast,skip:url=>url.includes('dead')?{at:Date.now(),reason:'PDF 无法获取（HTTP 404）'}:null,probe:async url=>{probed.push(url);return {verified:true};},download:async()=>pdf()}),error=>{assert.equal(error.lasting,false,'its day is not extended');assert.deepEqual(error.attempted,[]);assert.equal(error.state,'none');return true;});
	assert.deepEqual(probed,[]);
});

test('the status classifier names each outcome',()=>{
	let state=value=>Status.pdfStatus(value).state;
	assert.deepEqual(Status.PDF_STATUS_LABELS,{pdf:'可下载',landing:'只有落地页',access:'需要机构权限',none:'没有公开全文',checking:'检查中',failed:'下载失败'});
	assert.equal(state({available:true}),'pdf');assert.equal(state({attachmentID:3}),'pdf');assert.equal(state({pdf:'https://x.example/a.pdf',pdfVerified:true}),'pdf');
	assert.equal(state({checking:true}),'checking');assert.equal(state({pdf:'https://x.example/a.pdf'}),'checking');assert.equal(state({}),'none');
	assert.equal(state({available:false,error:'来源返回网页或验证页面，未提供 PDF'}),'landing');
	assert.equal(state({available:false,error:'来源返回网页或验证页面（出版社要求人机验证），未提供 PDF'}),'access');
	assert.equal(state({available:false,error:'PDF 无法获取（HTTP 403）'}),'access');
	assert.equal(Status.pdfErrorStatus(Error('PDF 无法获取（HTTP 403）'),{url:'https://arxiv.org/pdf/1'}).state,'failed','arXiv refuses for a while, then lets in again');
	assert.equal(state({available:false,error:'PDF 来源 20 秒没有响应（超时）',transient:true}),'failed');
	assert.equal(state(Object.assign(Error('x'),{name:'AbortError'})),'failed');assert.equal(Status.pdfStatus(Object.assign(Error('x'),{name:'AbortError'})).reason,'已取消');
	let mixed=Status.pdfFailuresStatus([{source:'OpenAlex',url:'https://a.example/1.pdf',error:Error('来源返回网页或验证页面，未提供 PDF')},{source:'Unpaywall',url:'https://onlinelibrary.wiley.com/x',error:Error('PDF 无法获取（HTTP 403）')}]);
	assert.equal(mixed.state,'access','a source asking for access is named before a landing page');assert.match(mixed.reason,/^Unpaywall：/);
	assert.equal(Status.pdfFailuresStatus([{source:'OpenAlex',url:'https://a.example/1.pdf',error:Error('PDF 无法获取（HTTP 404）')}]).state,'none');
	assert.equal(Status.pdfFailuresStatus([],{transient:true}).state,'failed');
	// A source whose own wording already says to retry is not told twice (seen live: "…可稍后重试；可稍后重试").
	assert.equal(Status.pdfFailuresStatus([{source:'OpenAlex',error:Error('来源暂时无法访问，可稍后重试'),transient:true}],{transient:true}).reason,'OpenAlex：来源暂时无法访问，可稍后重试');
	for(let value of Object.values(Status.PDF_STATUS_LABELS))assert.ok(value);
	for(let outcome of [{available:true},{},{checking:true}]){let row=Status.pdfStatus(outcome);assert.deepEqual(Object.keys(row),['state','label','reason']);assert.ok(/\p{Script=Han}/u.test(row.reason));}
});

test('a bot-check page is told apart from an article page',async()=>{
	let page=html=>new Response(html,{status:200,headers:{'content-type':'text/html'}});
	await assert.rejects(readDiscoveryPDF(page('<html><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/x"></script></html>'),{probe:true}),error=>Status.pdfStatus({available:false,error:error.message}).state==='access'&&Resolver.lastingPDFError(error.message));
	// Springer's Fastly check (seen live on link.springer.com/content/pdf/...).
	await assert.rejects(readDiscoveryPDF(page('<html><head><link href="/_fs-ch-1T1wmsGaOgGaSxcX/assets/styles.css"><title>Client Challenge</title></head></html>'),{probe:true}),error=>Status.pdfStatus({available:false,error:error.message}).state==='access');
	await assert.rejects(readDiscoveryPDF(page('<html><head><title>Challenges in sparse-view reconstruction</title></head></html>'),{probe:true}),error=>Status.pdfStatus({available:false,error:error.message}).state==='landing','an article about challenges is an article page');
	await assert.rejects(readDiscoveryPDF(page('<html><head><title>An article</title></head><body>Abstract</body></html>'),{probe:true}),error=>Status.pdfStatus({available:false,error:error.message}).state==='landing'&&error.message==='来源返回网页或验证页面，未提供 PDF');
});

// discovery.js over pdf-resolver.js with no open copy anywhere, so obtainPaper reaches the fallbacks.
async function engine({existing=null,zotero,paid=null,settings={},keys=[],openalex={}}={}){
	let calls=[],items=new Map(),files=new Map(),nextID=40,progress=[];
	let makeItem=id=>{let item={id,deleted:false,getAttachments:()=>[],eraseTx:async()=>{item.deleted=true;calls.push('erase:'+id);}};items.set(id,item);return item;};
	if(existing)makeItem(existing);
	let E={
		workspaceOutputs:{rememberDownload:async()=>{}},
		store:{get:()=>({}),peek:(key,id)=>key==='settings'?settings[id]:undefined,update:async fn=>fn({})},
		settings:()=>settings,
		manuscripts:{queueArticle:id=>calls.push('queue:'+id)},
		corpusIntake:{afterDownload:saved=>calls.push('corpus:'+saved.attachmentID)},
		scholarly:{contact:()=>'',has:async id=>keys.includes(id),prepare:async url=>({url:url+'?api_key=SECRET',wait:async()=>{}})},
		resolveAcademicTarget:async options=>({libraryID:1,collectionID:options.collectionID??null}),
		placeAcademicInCollection:async(id,target)=>calls.push('place:'+id+':'+target.collectionID),
		findAcademicItem:async()=>existing?items.get(existing):null,
		importAcademic:async()=>{let item=makeItem(11);calls.push('import');return {id:item.id,existing:false};},
		library:{localPDF:async value=>{let id=typeof value==='number'?value:value?.id;return files.get(id)||null;}},
		requestProvider:async url=>{if(url.includes('api.openalex.org'))return JSON.stringify(openalex);throw Object.assign(Error('服务返回 HTTP 404'),{providerStatus:404});},
		fetchDiscoveryPage:async()=>({ok:false,status:404,headers:{get:()=>'text/html'},body:null}),
		verifyDiscoveryPDF:async()=>({available:false,error:'PDF 无法获取（HTTP 403）'}),
		requestDiscoveryPDF:async url=>{calls.push('fetch:'+url);if(paid&&url.startsWith('https://content.openalex.org/'))return pdf();throw Error('PDF 无法获取（HTTP 404）');},
		markDiscoveryPDFFailure:async()=>{},clearDiscoveryPDFFailure:async()=>{},
		setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,ms===60000?40:ms)),clearTimeout:id=>clearTimeout(id)
	};
	let attach=parentID=>{let id=nextID++,attachment={id,parentID,deleted:false,isPDFAttachment:()=>true,setField(){},saveTx:async()=>{},getFilePathAsync:async()=>'/local/'+id+'.pdf',eraseTx:async()=>{attachment.deleted=true;calls.push('erase:'+id);}};files.set(id,attachment);return attachment;};
	let Zotero={Research:E,addShutdownListener(){},logError(){},
		Items:{getAsync:async id=>items.get(id)||null},Libraries:{get:()=>({filesEditable:true})},Reader:{open:async()=>{}},Promise:{delay:async()=>{}},
		Utilities:{randomString:()=>'x'},getTempDirectory:()=>({path:'/tmp'}),File:{pathToFile:path=>({path})},
		Attachments:{importFromFile:async({parentItemID})=>{calls.push('attach:'+parentItemID);return attach(parentItemID);},...(zotero?{addAvailableFile:async item=>{calls.push('zotero:'+item.id);return zotero(item,attach);}}:{})}};
	let modules={'pdf-resolver.mjs':Resolver,'arxiv.mjs':Arxiv};
	let context=vm.createContext({Zotero,IOUtils:{write:async()=>{},remove:async()=>{}},PathUtils:{join:(...parts)=>parts.join('/')},URL,TextDecoder,Response,
		ChromeUtils:{importESModule:url=>url.includes('workspace-outputs')?WorkspaceOutputs:url.includes('reference-matcher')?references:modules[url.split('/').at(-1)]||{installDiscoveryFeed(){},installJournalSubscriptionTimer}}});
	vm.runInContext(sources['pdf-resolver.js'],context);vm.runInContext(sources['discovery.js'],context);
	return {E,calls,items,files,progress:value=>progress.push(value),stages:progress};
}
let closed={id:'w1',source:'OpenAlex',doi:'10.1000/closed',title:'A closed paper',url:'https://doi.org/10.1000/closed'};

test('when no open copy is found, Zotero\'s own resolver is asked and its PDF is kept with the new item',async()=>{
	let f=await engine({zotero:(item,attach)=>attach(item.id)});
	let saved=await f.E.obtainPaper(closed,{open:false,collectionID:7,onProgress:f.progress});
	assert.equal(saved.viaZotero,true);assert.equal(saved.attachmentID,40);assert.equal(saved.state,'pdf');assert.equal(saved.label,'可下载');assert.equal(saved.path,'/local/40.pdf');
	assert.deepEqual(f.calls.filter(call=>!call.startsWith('fetch:')),['import','zotero:11','queue:40','place:11:7','corpus:40'],'filed, attached through Zotero, then placed and sent to the corpus as any download');
	assert.ok(f.stages.some(row=>/Zotero/.test(row.text)));
});

test('when Zotero\'s resolver finds nothing the new item is erased and the error says why',async()=>{
	let f=await engine({zotero:async()=>false});
	await assert.rejects(f.E.obtainPaper({...closed,pdf:'https://onlinelibrary.wiley.com/doi/pdfdirect/10.1000/closed'},{open:false,collectionID:7}),error=>{
		assert.equal(error.state,'access','the publisher refused the copies that were listed');assert.equal(error.label,'需要机构权限');assert.ok(error.reason);
		assert.match(error.message,/文库没有变化.*Zotero 的“查找可用 PDF”也未找到/);return true;
	});
	assert.deepEqual(f.calls.filter(call=>!call.startsWith('fetch:')),['import','zotero:11','erase:11'],'the library is as it was');
	let slow=await engine({zotero:()=>never()});
	await assert.rejects(slow.E.obtainPaper(closed,{open:false}),/查找可用 PDF/);assert.ok(slow.calls.includes('erase:11'),'a resolver that does not answer in time leaves no item');
	let epub=await engine({zotero:(item,attach)=>{let file=attach(item.id);file.isPDFAttachment=()=>false;return file;}});
	await assert.rejects(epub.E.obtainPaper(closed,{open:false}));assert.ok(epub.calls.includes('erase:40')&&epub.calls.includes('erase:11'),'only a PDF counts');
});

test('an existing item is not erased when Zotero\'s resolver finds nothing, and a record without DOI or URL is not sent to it',async()=>{
	let f=await engine({existing:12,zotero:async()=>false});
	await assert.rejects(f.E.obtainPaper(closed,{open:false}),/文库中的这条题录没有改动/);
	assert.deepEqual(f.calls.filter(call=>!call.startsWith('fetch:')),['zotero:12']);assert.equal(f.items.get(12).deleted,false);
	let bare=await engine({zotero:async()=>{throw Error('must not be asked');}});
	await assert.rejects(bare.E.obtainPaper({id:'x',title:'No identifier'},{open:false}),{state:'none'});assert.ok(!bare.calls.some(call=>call.startsWith('zotero:')||call==='import'));
});

test('OpenAlex\'s paid copy is fetched only with the setting on and a key saved, and the key is not stored',async()=>{
	let work={id:'https://openalex.org/W123',has_content:{pdf:true},locations:[]};
	let off=await engine({paid:true,keys:['openalex'],openalex:work});
	await assert.rejects(off.E.obtainPaper(closed,{open:false}));assert.ok(!off.calls.some(call=>call.includes('content.openalex.org')),'off by default');
	let noKey=await engine({paid:true,settings:{openalexContentDownload:true},openalex:work});
	await assert.rejects(noKey.E.obtainPaper(closed,{open:false}));assert.ok(!noKey.calls.some(call=>call.includes('content.openalex.org')));
	let on=await engine({paid:true,keys:['openalex'],settings:{openalexContentDownload:true},openalex:work});let saving;
	let obtainOpen=on.E.obtainOpenPaper;on.E.obtainOpenPaper=async(record,options)=>{saving=record;return obtainOpen(record,options);};
	let saved=await on.E.obtainPaper(closed,{open:false});
	assert.ok(on.calls.includes('fetch:https://content.openalex.org/works/W123.pdf?api_key=SECRET'));assert.equal(saved.paid,true);assert.equal(saved.state,'pdf');
	assert.equal(saving.pdf,'https://content.openalex.org/works/W123.pdf');assert.ok(!JSON.stringify(saving).includes('SECRET'));
	let notHeld=await engine({paid:true,keys:['openalex'],settings:{openalexContentDownload:true},openalex:{id:'https://openalex.org/W9',locations:[]}});
	await assert.rejects(notHeld.E.obtainPaper(closed,{open:false}));assert.ok(!notHeld.calls.some(call=>call.includes('content.openalex.org')),'a work OpenAlex does not hold is not paid for');
});

// search.js with a controllable Zotero.Translate.Search.
function searchEngine({translate,timeout=15000}={}){
	let made=[],notes=[],identifiers=[];
	class Item{constructor(type){this.itemType=type;this.itemTypeID=type;this.libraryID=1;this.fields={};this.creators=[];this.collections=[];if(type==='note')notes.push(this);else made.push(this);}
		setField(key,value){this.fields[key]=value;}getField(key){return this.fields[key]||'';}setCreators(list){this.creators=list;}getCreators(){return this.creators;}setCollections(list){this.collections=list;}getCollections(){return this.collections;}addToCollection(id){this.collections.push(id);}setNote(text){this.note=text;}
		fromJSON(json){for(let [key,value] of Object.entries(json))if(key==='creators')this.creators=value;else if(key==='tags')this.tags=value;else if(key!=='itemType')this.fields[key]=value;}async saveTx(){this.id??=50+made.length+notes.length;}}
	class Search{setIdentifier(value){identifiers.push(value);}async getTranslators(){return [{label:'DOI'}];}setTranslator(){}translate(options){assert.equal(options.libraryID,false,'the translator saves nothing');assert.equal(options.saveAttachments,false);return translate();}}
	let pane={getSelectedLibraryIDs:()=>[1],getSelectedCollections:()=>[]};
	let R={setTimeout:(fn,ms)=>setTimeout(fn,ms===15000?timeout:ms),clearTimeout:id=>clearTimeout(id)};
	let Zotero={Research:R,Item,Translate:{Search},getActiveZoteroPane:()=>pane,Libraries:{userLibraryID:1,get:()=>({editable:true})},Collections:{getAsync:async id=>({id,libraryID:1,name:'Folder'})},Items:{getAsync:async id=>Array.isArray(id)?[]:made.find(item=>item.id===id)||null},Search:class{addCondition(){}async search(){return [];}},Prefs:{get:()=>true},Date:{dateToISO:date=>date.toISOString().slice(0,19).replace('T',' ')},logError(){},debug(){}};
	vm.runInNewContext(sources['search.js'],{Zotero,setTimeout,clearTimeout,ChromeUtils:{importESModule:url=>({'pdf-resolver.mjs':Resolver,'arxiv.mjs':Arxiv,'paper-screening.mjs':Screen})[url.split('/').at(-1)]}});
	return {R,made,notes,identifiers};
}
let record={source:'OpenAlex',doi:'10.1103/PhysRevLett.1.1',title:'Short title from search',abstract:'Search abstract',journal:'Physical Review Letters',url:'https://doi.org/10.1103/PhysRevLett.1.1',authors:[{lastName:'A. Author',firstName:'',fieldMode:1}]};
let translated={itemType:'journalArticle',title:'The full title',creators:[{firstName:'Ada',lastName:'Author',creatorType:'author'},{firstName:'Ben',lastName:'Second'}],publicationTitle:'Physical Review Letters',volume:'1',issue:'1',pages:'1-4',DOI:'10.1103/physrevlett.1.1',date:'1958',tags:['quantum',{tag:'',type:1}],notes:[{note:'Translator note'}],attachments:[{title:'Full Text PDF',mimeType:'application/pdf',url:'https://publisher.example/a.pdf'}],accessDate:'CURRENT_TIMESTAMP'};

test('a paper with a DOI is filed with the translator\'s full metadata, in its folder, without the translator\'s attachments',async()=>{
	let f=searchEngine({translate:async()=>[translated]});
	let saved=await f.R.importAcademic(record,{select:false,collectionID:7});
	assert.equal(saved.metadata,'translator');assert.equal(JSON.stringify(f.identifiers),JSON.stringify([{DOI:'10.1103/PhysRevLett.1.1'}]));
	let item=f.made[0];
	assert.equal(item.itemType,'journalArticle');assert.equal(item.fields.title,'The full title');assert.equal(item.fields.volume,'1');assert.equal(item.fields.issue,'1');assert.equal(item.fields.pages,'1-4');
	let plain=value=>JSON.parse(JSON.stringify(value));
	assert.deepEqual(plain(item.creators.map(c=>c.firstName+' '+c.lastName+' '+c.creatorType)),['Ada Author author','Ben Second author'],'names in two fields; a missing role is author');
	assert.equal(item.fields.abstractNote,'Search abstract','what the translator left empty comes from the search record');assert.equal(item.fields.url,record.url);assert.equal(item.fields.DOI,record.doi,'the DOI as the duplicate check searches it');
	assert.deepEqual(plain(item.collections),[7]);assert.equal(item.fields.attachments,undefined);assert.equal(item.fields.notes,undefined);assert.match(item.fields.accessDate,/^\d{4}-/);
	assert.deepEqual(plain(item.tags),[{tag:'quantum'}]);assert.deepEqual(plain(f.notes.map(note=>note.note)),['Translator note']);assert.equal(f.notes[0].parentID,item.id);
});

test('an arXiv record asks the arXiv translator, and its address stays https',async()=>{
	let f=searchEngine({translate:async()=>[{itemType:'preprint',title:'A preprint',creators:[{firstName:'C',lastName:'D',creatorType:'author'}],url:'http://arxiv.org/abs/2401.01234v2',repository:'arXiv'}]});
	await f.R.importAcademic({source:'arXiv',id:'2401.01234v2',title:'A preprint',url:'https://arxiv.org/abs/2401.01234v2',pdf:'https://arxiv.org/pdf/2401.01234v2',authors:[]},{select:false});
	assert.equal(JSON.stringify(f.identifiers),JSON.stringify([{arXiv:'2401.01234v2'}]));assert.equal(f.made[0].fields.url,'https://arxiv.org/abs/2401.01234v2');assert.equal(f.made[0].fields.archiveID,'2401.01234v2');
});

test('a translator that fails or does not answer in time leaves the hand-built item',async()=>{
	for(let translate of [async()=>{throw Error('no results');},async()=>[],()=>never()]){
		let f=searchEngine({translate,timeout:20});
		let saved=await f.R.importAcademic(record,{select:false});
		assert.equal(saved.metadata,undefined);let item=f.made[0];
		assert.equal(item.itemType,'journalArticle');assert.equal(item.fields.title,'Short title from search');assert.equal(item.fields.publicationTitle,'Physical Review Letters');assert.equal(item.creators[0].lastName,'A. Author');
	}
	let early=searchEngine({translate:async()=>[translated]});
	let first=early.R.prefetchPaperMetadata(record),second=early.R.prefetchPaperMetadata({...record});
	assert.equal(first,second,'obtainPaper\'s early lookup is the one importAcademic waits for');assert.equal(early.identifiers.length,1);
});
