/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The download path must leave the library safe: Zotero's Find Available PDF fallback never
// erases an item another caller or the user has used, OpenAlex's paid copy is bought only after
// every free copy was tried, an existing item gets one PDF, and an arXiv download takes the
// same steps (status, corpus) as any other.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

let root=new URL('../../chrome/content/zotero/',import.meta.url),modules={'paper-overview-data.mjs':{}},sources={};
for(let name of ['paper-screening.mjs','reference-matcher.mjs','reference-metadata.mjs','discovery-feed.mjs','discovery-dates.mjs','arxiv.mjs','workspace-outputs.mjs','reader-reference-detail.mjs','pdf-resolver.mjs'])modules[name]=await import(new URL('research/shared/'+name,root));
for(let name of ['search.js','pdf-resolver.js','discovery.js','arxiv.js'])sources[name]=await readFile(new URL('xpcom/research/'+name,root),'utf8');
let Resolver=modules['pdf-resolver.mjs'];
let pdfBytes=()=>new TextEncoder().encode('%PDF-1.7\n'+'controlled content '.repeat(80));
let wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let never=()=>new Promise(()=>{});
let deferred=()=>{let resolve,promise=new Promise(ok=>{resolve=ok;});return {promise,resolve};};
let notFound=()=>{throw Object.assign(Error('服务返回 HTTP 404'),{providerStatus:404});};

// The real search.js, pdf-resolver.js, discovery.js and arxiv.js over an in-memory library.
// Timers run 100 times faster: the 30 s budget is 300 ms, Zotero's 60 s limit 600 ms.
async function library({zotero=null,openalex={id:'https://openalex.org/W123',locations:[]},provider,verify,request,settings={},keys=[]}={}){
	let items=new Map(),state={settings},calls=[],probes=[],opened=[],next=100,stamp=0;
	class Item{
		constructor(type){this.itemType=type;this.fields={};this.creators=[];this.collections=[];this.attachments=[];this.notes=[];this.tags=[];this.relations={};this.libraryID=1;this.deleted=false;}
		isRegularItem(){return !['attachment','note'].includes(this.itemType);}isPDFAttachment(){return this.itemType==='attachment';}
		getField(key){return this.fields[key]||'';}setField(key,value){this.fields[key]=value;}setCreators(value){this.creators=value;}getCreators(){return this.creators;}
		setCollections(value){this.collections=[...value];}getCollections(){return [...this.collections];}addToCollection(id){if(!this.collections.includes(id))this.collections.push(id);}
		getAttachments(){return this.attachments.filter(id=>!items.get(id)?.deleted);}getNotes(){return this.notes.filter(id=>!items.get(id)?.deleted);}getTags(){return this.tags.map(tag=>({...tag}));}getRelations(){return {...this.relations};}
		async getFilePathAsync(){return this.path||null;}async getBestAttachment(){return items.get(this.getAttachments()[0])||null;}
		async saveTx(){this.id??=next++;this.dateModified='2024-01-01 00:00:'+String(stamp++).padStart(2,'0');items.set(this.id,this);let parent=items.get(this.parentID);if(parent){let list=this.itemType==='note'?parent.notes:parent.attachments;if(!list.includes(this.id))list.push(this.id);}}
		async eraseTx(){this.deleted=true;calls.push('erase:'+this.id);for(let id of [...this.attachments,...this.notes])items.get(id).deleted=true;}
	}
	let attach=parentID=>{let file=new Item('attachment');file.id=next++;file.parentID=parentID;file.path='/storage/'+file.id+'.pdf';items.set(file.id,file);items.get(parentID).attachments.push(file.id);return file;};
	let pane={getSelectedLibraryIDs:()=>[1],getSelectedCollections:()=>[],selectItem:async()=>{}},view=(branch,id)=>branch?id===undefined?state[branch]:state[branch]?.[id]:state;
	let Zotero={Item,
		Search:class{addCondition(field,operator,value){this.condition={field,operator,value};}async search(){let {field,operator,value}=this.condition,key=field==='DOI'?'DOI':'url';return [...items.values()].filter(item=>item.libraryID===this.libraryID&&item.isRegularItem()&&(operator==='contains'?item.getField(key).includes(value):item.getField(key)===value)).map(item=>item.id);}},
		Items:{getAsync:async value=>Array.isArray(value)?value.map(id=>items.get(id)).filter(Boolean):items.get(value),get:id=>items.get(id)},
		Libraries:{userLibraryID:1,get:()=>({editable:true,filesEditable:true})},Collections:{getAsync:async id=>[7,8].includes(id)?{id,libraryID:1,name:'Folder '+id,deleted:false}:null,get:()=>null,getByLibrary:()=>[]},
		getActiveZoteroPane:()=>pane,getMainWindow:()=>({AbortController}),addShutdownListener(){},logError(){},debug(){},
		Reader:{open:async id=>{opened.push(id);}},Promise:{delay:async()=>{}},Utilities:{randomString:()=>String(next)},getTempDirectory:()=>({path:'/temporary'}),File:{pathToFile:path=>path},
		Attachments:{importFromFile:async({parentItemID})=>{calls.push('attach:'+parentItemID);return attach(parentItemID);},...(zotero?{addAvailableFile:async item=>{calls.push('zotero:'+item.id);return zotero(item,attach);}}:{})}
	};
	let E={
		fetchDiscoveryPage:async()=>({ok:false,status:404,headers:{get:()=>'text/html'},body:null}),
		requestProvider:async url=>provider?provider(url):url.includes('api.openalex.org')?JSON.stringify(openalex):notFound(),
		verifyDiscoveryPDF:async(url,options)=>{probes.push(url);return verify?verify(url,options):{available:false,error:'PDF 无法获取（HTTP 404）'};},
		requestDiscoveryPDF:async(url,options)=>{calls.push('fetch:'+url);if(request)return request(url,options);if(url.startsWith('https://content.openalex.org/'))return pdfBytes();throw Error('PDF 无法获取（HTTP 404）');},
		store:{get:view,peek:view,update:async fn=>fn(state)},
		scholarly:{contact:()=>'',has:async id=>keys.includes(id),prepare:async url=>({url:url+'?api_key=SECRET',wait:async()=>{}})},
		library:{localPDF:async value=>{let item=typeof value==='number'?items.get(value):value;if(!item||item.deleted)return null;if(item.itemType==='attachment')return item;return items.get(item.getAttachments().find(id=>items.get(id)?.isPDFAttachment()))||null;}},
		manuscripts:{queueArticle(){}},
		corpusIntake:{afterDownload:(saved,target)=>calls.push('corpus:'+saved.attachmentID+':'+target.projectID+':'+target.collectionID)},
		setTimeout:(fn,ms,...rest)=>setTimeout(fn,Math.ceil((ms||0)/100),...rest),clearTimeout:id=>clearTimeout(id)
	};
	Zotero.Research=E;
	let context=vm.createContext({Zotero,Cu:{},ChromeUtils:{importESModule:url=>{let value=modules[url.split('/').at(-1)];if(!value)throw Error('unexpected module '+url);return value;}},IOUtils:{exists:async()=>true,write:async()=>{},remove:async()=>{}},PathUtils:{join:(...parts)=>parts.join('/')},URL,Uint8Array,AbortController});
	for(let name of ['search.js','pdf-resolver.js','discovery.js','arxiv.js'])vm.runInContext(sources[name],context);
	E.workspaceOutputs.rememberDownload=async(record,saved)=>{calls.push('remember:'+saved.state);};
	let pdfsOf=item=>item.getAttachments().map(id=>items.get(id)).filter(file=>file?.isPDFAttachment());
	return {E,Item,items,calls,probes,opened,attach,pdfsOf,regular:()=>[...items.values()].filter(item=>item.isRegularItem()&&!item.deleted)};
}
let closed={id:'https://openalex.org/W123',source:'OpenAlex',doi:'10.1000/closed',title:'A closed paper',url:'https://doi.org/10.1000/closed',authors:[]};
let erased=f=>f.calls.filter(call=>call.startsWith('erase:'));

test('an item another caller saves while Zotero looks is not erased: joined during the import, or reused during the lookup',async()=>{
	// The batch's 只保存题录与摘要 joins the import obtainPaper's fallback started.
	let gate=deferred(),f=await library({zotero:async()=>false}),batch,asked=0;
	// The first call is obtainPaper's early lookup; the second is the fallback's import waiting for it.
	let prefetch=f.E.prefetchPaperMetadata;f.E.prefetchPaperMetadata=record=>{if(++asked===2){batch=wait(5).then(()=>f.E.importAcademic(record,{select:false,collectionID:7}));return gate.promise.then(()=>null);}return prefetch(record);};
	let download=f.E.obtainPaper(closed,{open:false,collectionID:7});
	while(!batch)await wait(5);await wait(20);gate.resolve();
	await assert.rejects(download,error=>{assert.match(error.message,/题录已保留（查找期间已被使用或修改）/);assert.doesNotMatch(error.message,/文库没有变化/);return true;});
	let saved=await batch;assert.equal(saved.joined,true,'the batch says it joined an import');
	assert.deepEqual(erased(f),[],'the item the batch reported as saved is kept');assert.equal(f.items.get(saved.id).deleted,false);assert.equal(f.regular().length,1);
	// The 导入 button reuses the item while Zotero's lookup runs.
	let lookup=deferred(),answer=deferred(),g=await library({zotero:async()=>{lookup.resolve();await answer.promise;return false;}});
	let second=g.E.obtainPaper(closed,{open:false,collectionID:7});await lookup.promise;
	let reused=await g.E.importAcademic(closed,{select:false,collectionID:7});assert.equal(reused.existing,true);
	answer.resolve();await assert.rejects(second,/题录已保留/);
	assert.deepEqual(erased(g),[]);assert.equal(g.items.get(reused.id).deleted,false);
});

test('an item the user changes while Zotero looks is kept; an untouched one is erased',async()=>{
	let edits={
		note:async(item,f)=>{let note=new f.Item('note');note.parentID=item.id;await note.saveTx();},
		tag:async item=>{item.tags.push({tag:'read later'});await item.saveTx();},
		folder:async item=>{item.collections.push(8);await item.saveTx();},
		relation:item=>{item.relations={'dc:relation':['http://zotero.org/users/1/items/ABCD']};},
		field:async item=>{item.setField('extra','checked by hand');await item.saveTx();},
		file:(item,f)=>{f.attach(item.id);}
	};
	for(let [name,edit] of Object.entries(edits)){
		let f;f=await library({zotero:async item=>{await edit(item,f);return false;}});
		await assert.rejects(f.E.obtainPaper(closed,{open:false,collectionID:7}),{message:/题录已保留（查找期间已被使用或修改）.*Zotero 的“查找可用 PDF”也未找到/},name);
		assert.deepEqual(erased(f),[],name);assert.equal(f.regular().length,1,name);
	}
	let untouched=await library({zotero:async()=>false});
	await assert.rejects(untouched.E.obtainPaper(closed,{open:false,collectionID:7}),{message:/文库没有变化.*Zotero 的“查找可用 PDF”也未找到/});
	assert.equal(erased(untouched).length,1,'nothing else used it, so the library is as it was');assert.equal(untouched.regular().length,0);
});
// OpenAlex holds a paid copy and lists three open copies on three hosts.
let held={id:'https://openalex.org/W123',has_content:{pdf:true},locations:['a','b','c'].map(host=>({is_oa:true,pdf_url:'https://'+host+'.example/paper.pdf'}))};
let paidOn={openalex:held,keys:['openalex'],settings:{openalexContentDownload:true},zotero:async()=>false};
let paidFetch=f=>f.calls.some(call=>call.includes('content.openalex.org'));

test('the paid copy is not bought when the budget ended before every free copy was tried, or a free copy failed in a way that can pass',async()=>{
	let stalled=await library({...paidOn,verify:()=>never()});
	await assert.rejects(stalled.E.obtainPaper(closed,{open:false}),error=>{assert.equal(error.incomplete,true);assert.equal(error.paidPDF,undefined);return true;});
	assert.deepEqual(stalled.probes,['https://a.example/paper.pdf','https://b.example/paper.pdf'],'c was never tried');assert.equal(paidFetch(stalled),false,'not paid while c is untried');
	let limited=await library({...paidOn,verify:async()=>({available:false,error:'PDF 无法获取（HTTP 429）',transient:true})});
	await assert.rejects(limited.E.obtainPaper(closed,{open:false}),{incomplete:true});assert.equal(limited.probes.length,3);assert.equal(paidFetch(limited),false,'not paid after a rate limit');
	// Every free copy failed for good: the paid copy is the fallback.
	let gone=await library({...paidOn});
	let saved=await gone.E.obtainPaper(closed,{open:false});assert.equal(saved.paid,true);assert.equal(saved.state,'pdf');assert.equal(gone.probes.length,3);assert.ok(paidFetch(gone));
	// Only a lookup failed (a keyless Semantic Scholar 429): the open copies OpenAlex listed were all tried.
	let lookup=await library({...paidOn,provider:url=>url.includes('api.openalex.org')?JSON.stringify(held):url.includes('semanticscholar')?Promise.reject(Object.assign(Error('服务返回 HTTP 429'),{providerStatus:429})):notFound()});
	assert.equal((await lookup.E.obtainPaper(closed,{open:false})).paid,true);
});

test('the resolver says when its search is incomplete',async()=>{
	let stage=(name,phase,run)=>({name,phase,lookup:phase>0,run});
	let timing={headStart:5,landingDelay:5,lookupTimeout:200,budget:60};
	await assert.rejects(Resolver.resolvePDFSources([stage('Record',0,async()=>[{url:'https://a.example/1.pdf'},{url:'https://b.example/1.pdf'},{url:'https://c.example/1.pdf'}])],{timing,probe:()=>never(),download:async()=>pdfBytes()}),{incomplete:true});
	await assert.rejects(Resolver.resolvePDFSources([stage('Record',0,async()=>[{url:'https://a.example/1.pdf'}])],{timing,probe:async()=>{throw Error('PDF 无法获取（HTTP 503）');},download:async()=>pdfBytes()}),{incomplete:true});
	await assert.rejects(Resolver.resolvePDFSources([stage('Record',0,async()=>[{url:'https://a.example/1.pdf'}]),stage('Busy',1,async()=>{throw Object.assign(Error('服务返回 HTTP 429'),{providerStatus:429});})],{timing,probe:async()=>{throw Error('PDF 无法获取（HTTP 404）');},download:async()=>pdfBytes()}),{incomplete:false,state:'failed'});
	await assert.rejects(Resolver.resolvePDFSources([stage('Record',0,async()=>[])],{timing,probe:async()=>({verified:true}),download:async()=>pdfBytes()}),{incomplete:false});
});
test('an existing item whose Zotero lookup outlasts its limit gets one PDF: no paid copy meanwhile, no second lookup, no late duplicate',async()=>{
	let work={id:'https://openalex.org/W123',has_content:{pdf:true},locations:[]},late=deferred();
	let f=await library({openalex:work,keys:['openalex'],settings:{openalexContentDownload:true},zotero:async(item,attach)=>{await late.promise;return attach(item.id);}});
	let item=new f.Item('journalArticle');item.setField('DOI',closed.doi);item.setField('title',closed.title);await item.saveTx();
	await assert.rejects(f.E.obtainPaper(closed,{open:false}),error=>{assert.match(error.message,/文库中的这条题录没有改动.*Zotero 的“查找可用 PDF”仍在进行，找到后会附在这条题录上/);assert.ok(error.state);return true;});
	assert.equal(paidFetch(f),false,'Zotero may still attach a PDF, so nothing is paid for');
	await assert.rejects(f.E.obtainPaper(closed,{open:false}),/仍在进行/);
	assert.equal(f.calls.filter(call=>call.startsWith('zotero:')).length,1,'a retry does not start a second lookup on the item');assert.equal(paidFetch(f),false);
	late.resolve();await wait(20);
	assert.equal(f.pdfsOf(item).length,1,'the late PDF is kept: it is the only one');
	// A PDF the item gains while the lookup runs is not doubled by the late one.
	let again=deferred(),g=await library({zotero:async(item,attach)=>{await again.promise;return attach(item.id);}});
	let other=new g.Item('journalArticle');other.setField('DOI',closed.doi);await other.saveTx();
	await assert.rejects(g.E.obtainPaper(closed,{open:false}),/仍在进行/);
	g.attach(other.id);again.resolve();await wait(20);
	assert.equal(g.pdfsOf(other).length,1,'the late file is erased beside the PDF added meanwhile');
});

test('an arXiv download is finished as any other: status on the result and the error, corpus intake, the Reader once',async()=>{
	let arxivRow=id=>({id,source:'arXiv',title:'An arXiv preprint',url:'https://arxiv.org/abs/'+id,pdf:'https://arxiv.org/pdf/'+id,authors:[],oa:true});
	let f=await library({request:async()=>pdfBytes()});
	let saved=await f.E.obtainPaper(arxivRow('2401.11111'),{open:true,collectionID:7,projectID:'proj1'});
	assert.equal(saved.state,'pdf');assert.equal(saved.label,'可下载');assert.ok(saved.reason);
	assert.deepEqual(f.calls.filter(call=>/^(?:corpus|remember):/.test(call)),['remember:pdf','corpus:'+saved.attachmentID+':proj1:7'],'remembered once, then sent to the project corpus');
	assert.deepEqual(f.opened,[saved.attachmentID],'the Reader opens once');
	for(let [status,state] of [[404,'none'],[429,'failed']]){
		let g=await library({request:async()=>{throw Object.assign(Error('PDF 无法获取（HTTP '+status+'）'),{status});}});
		await assert.rejects(g.E.obtainPaper(arxivRow('2401.2222'+status%10),{open:false,collectionID:7}),error=>{assert.equal(error.state,state,'HTTP '+status);assert.ok(error.label&&error.reason);return true;});
		assert.ok(!g.calls.some(call=>call.startsWith('corpus:')));
	}
});