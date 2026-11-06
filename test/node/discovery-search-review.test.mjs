/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Paper search review: a page missing an index is not cached, the notice names the
// Chinese OpenAlex search, the shared OpenAlex rest survives its sibling, a retry
// keeps its limit at the deadline, Chinese typed against Latin is split, a composed
// translation is a last resort, exclusions need adjacent words, a short abstract
// counts, and an arXiv 403 is not called an institution wall.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Feed from '../../chrome/content/zotero/research/shared/discovery-feed.mjs';
import * as ProviderErrors from '../../chrome/content/zotero/research/shared/provider-error.mjs';
import * as WorkspaceOutputs from '../../chrome/content/zotero/research/shared/workspace-outputs.mjs';
import {translateDiscoveryTerm,prepareDiscoveryQuery,discoveryScopeVerdict,discoveryScopeMatch} from '../../chrome/content/zotero/research/shared/discovery-query.mjs';
import {discoveryProviderNotice} from '../../chrome/content/zotero/research/shared/discovery-presentation.mjs';
import {pdfStatus} from '../../chrome/content/zotero/research/shared/pdf-status.mjs';

const root=new URL('../../chrome/content/zotero/',import.meta.url),source=name=>readFile(new URL(name,root),'utf8');
const [providersJS,scholarlyJS,discoveryJS]=await Promise.all(['xpcom/research/providers.js','xpcom/research/scholarly-sources.js','xpcom/research/discovery.js'].map(source));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const words=text=>Object.fromEntries(text.split(' ').reduce((map,word,index)=>map.set(word,[...(map.get(word)||[]),index]),new Map()));
const work=(id,title)=>({id:'https://openalex.org/W'+id,title,publication_date:'2024-05-01',cited_by_count:id,abstract_inverted_index:words('Short abstract'),authorships:[]});
const openalex=rows=>({results:rows,meta:{count:rows.length,next_cursor:null}}),crossref=rows=>({message:{'total-results':rows.length,items:rows}}),semantic=rows=>({total:rows.length,data:rows});
// The merged search with requestProvider answering by host (a function may throw or wait).
function engine(answers){
	const state={},urls=[],E={store:{get:(...path)=>path.reduce((value,name)=>value?.[name],state),update:async fn=>fn(state)},scholarly:{has:async()=>false},
		requestProvider:async(url,options)=>{const parsed=new URL(url);urls.push(parsed);const answer=answers[parsed.hostname];if(!answer)throw Object.assign(Error('HTTP 404'),{providerStatus:404});return JSON.stringify(typeof answer==='function'?await answer(parsed,options):answer);}};
	Feed.installDiscoveryFeed(E,{Zotero:{Items:{getAll:async()=>[]},Libraries:{userLibraryID:1}}});return {E,state,urls};
}
const withDiscovery=E=>{vm.runInNewContext(discoveryJS,{Zotero:{Research:E,Items:{getAll:async()=>[]},Libraries:{userLibraryID:1},addShutdownListener(){},Promise:{delay:async()=>{}}},ChromeUtils:{importESModule:url=>url.includes('workspace-outputs')?WorkspaceOutputs:url.includes('discovery-feed')?{...Feed,installDiscoveryFeed(){}}:{}}});return E;};
const scope=primaryKeyword=>({primaryKeyword,fuzzy:true});

test('a first page with an index still answering at the deadline is not cached, and the next search asks that index again',async()=>{
	const {E,state,urls}=engine({'api.openalex.org':async()=>{await sleep(400);return openalex([work(1,'Graph neural network for molecules')]);},'api.semanticscholar.org':semantic([]),'api.crossref.org':crossref([{DOI:'10.5/a',title:['Graph neural network for power grids'],type:'journal-article'}])});
	withDiscovery(E);
	const search=()=>E.searchPaperPage('graph neural network',{researchScope:scope('graph neural network'),limit:20,domainMatch:'rank',queryExpansion:'off',scanBudget:{batches:10,ms:100}});
	const first=await search();
	assert.equal(first.providerStates.openalex.status,'pending');assert.equal(first.providerErrors.length,0);assert.equal(first.records.length,1);
	assert.equal(Object.keys(state.paperSearchPages||{}).length,0,'a page missing OpenAlex is not kept for an hour');
	await sleep(500);const second=await search();
	assert.equal(second.cacheHit,false);assert.equal(urls.filter(url=>url.hostname==='api.openalex.org').length,2,'OpenAlex is asked again');
});

test('when only the Chinese OpenAlex search answered, the notice names it among the sources',()=>{
	const now=Date.UTC(2026,10,5,9,0),ok={status:'ok',rows:5};
	assert.equal(discoveryProviderNotice({openalex:{status:'limited',keyless:true,quota:true,rows:0},crossref:ok,'openalex-zh':{status:'ok',rows:1,keyless:true}},{now}).text,'OpenAlex 未配置密钥，英文检索额度已用完，结果仅来自 Crossref 和 OpenAlex（中文检索）。在设置中填写免费密钥可恢复。');
	assert.equal(discoveryProviderNotice({openalex:{status:'limited',keyless:true,quota:true,rows:0},'openalex-zh':{status:'limited',keyless:true,quota:true,rows:0},crossref:ok},{now}).text,'OpenAlex 未配置密钥，今日免费额度已用完，结果仅来自 Crossref。在设置中填写免费密钥可恢复。','both limited: unchanged');
	assert.deepEqual(discoveryProviderNotice({openalex:{...ok,keyless:true},'openalex-zh':{...ok,keyless:true},crossref:ok},{now}),{text:'OpenAlex 未配置密钥，每天约可免费检索 10 次；在设置中填写免费密钥可提高额度。',settings:true},'both answered: unchanged');
});

// The English OpenAlex search gets the keyless quota 429; the Chinese one succeeds or fails.
const quota429=()=>{throw Object.assign(Error('HTTP 429'),{providerStatus:429,rateLimited:true,keyless:true,quotaExhausted:true});};
function sharedRest({zh,english=quota429}){
	const {E,urls}=engine({'api.openalex.org':url=>/\p{Script=Han}/u.test(url.searchParams.get('search')||'')?zh():english(),'api.semanticscholar.org':semantic([]),'api.crossref.org':crossref([{DOI:'10.8/a',title:['Soil pore water dynamics'],type:'journal-article'}])});
	const prepared={query:'soil pore water',plainQuery:'soil pore water',originalQuery:'土壤孔隙水',groups:[['soil pore water']],domainMatch:'rank',researchScope:scope('soil pore water'),originalResearchScope:scope('土壤孔隙水')};
	const run=refresh=>E.searchDiscoverySources({refresh,prepared,filters:{pdfOnly:false},indexes:['openalex','semantic','crossref','openalex-zh'],limit:20});
	return {run,asked:()=>urls.filter(url=>url.hostname==='api.openalex.org').length};
}
test('the shared OpenAlex rest is kept when the Chinese search settles after the English 429, in either order and when it fails',async()=>{
	const zhRow=()=>openalex([work(7,'土壤孔隙水 soil pore water')]);
	for(const [label,zh,english] of [['zh succeeds later',async()=>{await sleep(20);return zhRow();},quota429],['zh succeeds first',zhRow,async()=>{await sleep(20);quota429();}],['zh times out later',async()=>{await sleep(20);throw Object.assign(Error('服务请求超时，请重试'),{name:'TimeoutError'});},quota429]]){
		const {run,asked}=sharedRest({zh,english}),first=await run(false);
		assert.equal(first.providerStates.openalex.status,'limited',label);const before=asked();
		const second=await run(true),third=await run(true);
		assert.equal(asked(),before,label+': OpenAlex is not asked again before midnight UTC');
		for(const result of [second,third]){assert.equal(result.providerStates.openalex.status,'limited',label);assert.equal(result.providerStates['openalex-zh'].status,'limited',label);assert.equal(result.providerStates.openalex.until,Feed.nextUTCMidnight(),label);}
	}
});

// providers.js and scholarly-sources.js on a virtual clock: timers run in time order.
function clockedTransport(answer){
	let now=Date.UTC(2026,10,5,9,0),seq=0;const timers=new Map(),fetched=[];
	class FakeDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
	const setTimer=(fn,ms)=>{const id=++seq;timers.set(id,{at:now+Math.max(0,Number(ms)||0),fn});return id;},clearTimer=id=>timers.delete(id);
	const E={store:{peek:()=>undefined},credentials:{get:async()=>''},setTimeout:setTimer,clearTimeout:clearTimer};
	const win={AbortController,fetch:(url,options)=>{fetched.push(now);return answer(fetched.length,options);}};
	vm.runInNewContext(scholarlyJS,{EasySch:E,URL,Promise,Date:FakeDate,ChromeUtils:{}});
	vm.runInNewContext(providersJS,{Zotero:{Research:E},Date:FakeDate,Cu:{Sandbox:function(){return win;}},Services:{scriptSecurityManager:{getSystemPrincipal:()=>({})}},ChromeUtils:{importESModule:url=>url.endsWith('provider-error.mjs')?ProviderErrors:{setTimeout:setTimer,clearTimeout:clearTimer}}});
	const drive=async promise=>{let done=false,value;promise.then(result=>{done=true;value={result};},error=>{done=true;value={error};});
		for(let guard=0;!done&&guard<1000;guard++){for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));if(done)break;const next=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];if(!next)continue;timers.delete(next[0]);now=Math.max(now,next[1].at);next[1].fn();}
		assert.ok(done,'the request settles');return value;};
	return {E,fetched,drive,now:()=>now};
}
const S2='https://api.semanticscholar.org/graph/v1/paper/search?query=x';
test('a Retry-After wait that cannot fit the deadline reports the limit instead of timing out',async()=>{
	const busy=clockedTransport(()=>Promise.resolve(new Response('{}',{status:429,headers:{'Retry-After':'8'}}))),{error}=await busy.drive(busy.E.requestProvider(S2,{},15000));
	assert.equal(error.name,'ProviderRequestError');assert.equal(error.rateLimited,true);assert.equal(error.keyless,true);assert.ok(Number.isFinite(error.retryAt));
	assert.ok(busy.now()<Date.UTC(2026,10,5,9,0)+15000,'it gives up before the deadline');
	const failure=Feed.discoveryFeedError(error);assert.equal(failure.code,'rate_limit');assert.equal(Feed.discoveryCooldown('semantic',error,busy.now()).limited,true);
	// The deadline ends while the retried request is still waiting for an answer.
	const slow=clockedTransport((count,options)=>count===1?Promise.resolve(new Response('{}',{status:429,headers:{'Retry-After':'2'}})):new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})),{once:true}))),late=(await slow.drive(slow.E.requestProvider(S2,{},15000))).error;
	assert.equal(late.name,'TimeoutError');assert.equal(late.rateLimited,true,'the 429 seen before the timeout is kept');assert.equal(Feed.discoveryFeedError(late).code,'rate_limit');
	const fine=clockedTransport(count=>Promise.resolve(count===1?new Response('{}',{status:429,headers:{'Retry-After':'2'}}):new Response('{"ok":1}',{status:200})));
	assert.deepEqual(await fine.drive(fine.E.requestProvider(S2,{},15000)),{result:'{"ok":1}'},'a short wait that fits is still waited out');
});

const rank={discovery:{domainMatch:'rank',queryExpansion:'off'}};
const store=()=>{const state={},updates=[];return {state,updates,E:{store:{get:(...path)=>path.reduce((value,name)=>value?.[name],state),update:async fn=>{updates.push(1);return fn(state);}}}};};
test('a Chinese word typed against Latin letters or digits is translated as a separate word',async()=>{
	assert.equal(translateDiscoveryTerm('CNN调制识别'),'CNN modulation recognition');assert.equal(translateDiscoveryTerm('YOLO目标检测'),'YOLO object detection');
	assert.equal(translateDiscoveryTerm('3D点云'),'3D point cloud');assert.equal(translateDiscoveryTerm('调制识别CNN'),'modulation recognition CNN');
	assert.equal(translateDiscoveryTerm('CNN-调制识别'),'CNN-modulation recognition','a typed hyphen is kept as typed');assert.equal(translateDiscoveryTerm('CNN土壤孔隙水'),'CNN土壤孔隙水','an unknown run is not padded');
	const {E}=store(),prepared=await prepareDiscoveryQuery(E,'CNN调制识别',scope('CNN调制识别'),undefined,rank);
	assert.equal(prepared.query,'CNN modulation recognition');
	assert.equal(discoveryScopeVerdict({title:'CNN-based automatic modulation recognition for cognitive radio'},prepared),'match');
});

test('a run composed from table pieces goes to the translator first and is only a fallback, never cached',async()=>{
	let calls=0;const {E}=store();E.studio={request:async(_prompt,values)=>{calls++;return{value:{translations:Object.fromEntries(Object.keys(values).map(key=>[key,'biochemistry']))}};}};
	const translated=await prepareDiscoveryQuery(E,'生物化学',scope('生物化学'),undefined,rank);
	assert.equal(calls,1,'the model is asked');assert.equal(translated.query,'biochemistry');
	assert.equal(discoveryScopeVerdict({title:'Advances in biochemistry of membrane proteins'},translated),'match');
	const bare=store(),guess=await prepareDiscoveryQuery(bare.E,'生物化学',scope('生物化学'),undefined,rank);
	assert.equal(guess.query,'biology chemistry','without a translator the composed words are used');assert.equal(guess.untranslated,false);assert.equal(guess.warning,'');
	assert.equal(bare.updates.length,0,'a guess is not saved as a translation');assert.equal(bare.state.discoveryQueryTranslations,undefined);
	const known=store(),pieces=await prepareDiscoveryQuery(known.E,'相位噪声补偿 光通信',scope('相位噪声补偿 光通信'),undefined,rank);
	assert.equal(pieces.query,'phase noise compensation optical communication');
});

test('a translated exclusion removes a record only where its words stand together',async()=>{
	const {E}=store(),prepared=await prepareDiscoveryQuery(E,'modulation recognition',{...scope('modulation recognition'),excludedKeywords:['信号检测','object detection','wireless']},undefined,rank);
	assert.ok(!prepared.researchScope.excludedKeywords.includes('signal detection'),'a composed guess is not an exclusion');
	const verdict=record=>discoveryScopeVerdict(record,prepared);
	assert.equal(verdict({title:'Deep learning based automatic modulation recognition',abstract:'We use the received signal and compare with likelihood based detection methods.'}),'match');
	assert.equal(verdict({title:'Modulation recognition of objects for detection tasks'}),'match','object and detection apart');
	assert.equal(verdict({title:'Modulation recognition meets object-detection networks'}),'excluded');assert.equal(verdict({title:'Modulation recognition in wireless links'}),'excluded');
	assert.equal(verdict({title:'Modulation recognition for 信号检测 systems'}),'excluded','the typed Chinese phrase still excludes');
});

test('a short abstract counts as evidence, and more text never turns a pass into a fail',async()=>{
	const {E}=store(),prepared=await prepareDiscoveryQuery(E,'phase noise compensation optical communication',scope('phase noise compensation optical communication'),undefined,rank),filler=' The proposed receiver is evaluated in simulation and in a laboratory testbed with standard equipment and several modulation formats.';
	const short={title:'A new receiver design for coherent links',abstract:'Phase noise compensation for optical communication systems with a pilot tone.'};
	assert.equal(discoveryScopeVerdict(short,prepared),'match');assert.equal(discoveryScopeVerdict({...short,abstract:short.abstract+filler},prepared),'match');
	const zh=await prepareDiscoveryQuery(E,'相位噪声补偿 光通信',scope('相位噪声补偿 光通信'),undefined,rank);
	assert.equal(discoveryScopeVerdict({title:'一种新的接收机设计',abstract:'本文研究光通信系统中的相位噪声补偿方法。'},zh),'match');
	const title={title:'Phase noise in coherent optical systems'};
	for(const abstract of ['Short abstract','Short abstract.'+filler])assert.equal(discoveryScopeMatch({...title,abstract},prepared).pass,true,'a title that passes alone still passes with an abstract');
	assert.equal(discoveryScopeVerdict({title:'Optical communication systems: an overview',abstract:'A short note.'},prepared),'keywords');
});

test('an arXiv PDF refused with 403 during the background check is a failed download, a publisher 403 asks for access',async()=>{
	const E={verifyDiscoveryPDF:async()=>({available:false,error:'PDF 无法获取（HTTP 403）',transient:false,checkedAt:Date.now()})};
	const rows=[{pdf:'https://arxiv.org/pdf/2101.00001'},{pdf:'https://www.example-publisher.com/doi/pdf/10.1/x'}];
	await Feed.checkDiscoveryPDFs(E,rows,{flush:false});
	assert.equal(rows[0].pdfStatus.state,'failed');assert.equal(rows[1].pdfStatus.state,'access');
	assert.equal(pdfStatus({available:false,error:'PDF 无法获取（HTTP 403）',url:'https://arxiv.org/pdf/2101.00001'}).state,'failed');
});
