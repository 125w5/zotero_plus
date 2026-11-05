/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Paper search: rate limits rest one index while the others answer, the page names what
// is missing, Chinese words are translated per word, topic fit is a score and the
// relevance order follows the text before the provider's own order.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Feed from '../../chrome/content/zotero/research/shared/discovery-feed.mjs';
import * as ProviderErrors from '../../chrome/content/zotero/research/shared/provider-error.mjs';
import * as Dates from '../../chrome/content/zotero/research/shared/discovery-dates.mjs';
import * as ArxivIDs from '../../chrome/content/zotero/research/shared/arxiv.mjs';
import * as WorkspaceOutputs from '../../chrome/content/zotero/research/shared/workspace-outputs.mjs';
import {discoveryCooldown,nextUTCMidnight} from '../../chrome/content/zotero/research/shared/discovery-feed.mjs';
import {translateDiscoveryTerm,prepareDiscoveryQuery,discoveryScopeMatch,discoveryScopeVerdict,discoveryTextRelevance} from '../../chrome/content/zotero/research/shared/discovery-query.mjs';
import {createDiscoveryMergePool,rankDiscoveryEntries,crossrefSearchURL} from '../../chrome/content/zotero/research/shared/discovery-providers.mjs';
import {discoveryProviderNotice} from '../../chrome/content/zotero/research/shared/discovery-presentation.mjs';

const root=new URL('../../chrome/content/zotero/',import.meta.url),source=name=>readFile(new URL(name,root),'utf8');
const [providersJS,scholarlyJS,arxivJS,discoveryJS,uiJS,settingsJS]=await Promise.all(['xpcom/research/providers.js','xpcom/research/scholarly-sources.js','xpcom/research/arxiv.js','xpcom/research/discovery.js','research/ui/discovery.js','research/ui/settings.js'].map(source));
const NO_KEYS={store:{peek:()=>undefined},credentials:{get:async()=>''}};

// providers.js with scholarly-sources.js; fetch answers from a list, short waits run at once.
function transport(answers,{keys={}}={}){
	const fetched=[],waits=[],E={...NO_KEYS,credentials:{get:async realm=>keys[realm.replace('easysch-scholarly:','')]||''},setTimeout:(fn,ms)=>{if(ms<=8000){waits.push(ms);Promise.resolve().then(fn);}return 0;},clearTimeout(){}};
	const win={AbortController,fetch:async url=>{fetched.push(url);const next=answers.length>1?answers.shift():answers[0];return new Response(next.body||'{}',{status:next.status,headers:next.headers||{}});}};
	vm.runInNewContext(scholarlyJS,{EasySch:E,URL,Promise,Date,ChromeUtils:{}});
	vm.runInNewContext(providersJS,{Zotero:{Research:E},Cu:{Sandbox:function(){return win;}},Services:{scriptSecurityManager:{getSystemPrincipal:()=>({})}},ChromeUtils:{importESModule:url=>url.endsWith('provider-error.mjs')?ProviderErrors:{setTimeout:E.setTimeout,clearTimeout(){}}}});
	return {E,fetched,waits};
}
const OPENALEX='https://api.openalex.org/works?search=x',S2='https://api.semanticscholar.org/graph/v1/paper/search?query=x';

test('a Retry-After of more than 8 s fails at once with the retry time; a short one is waited out',async()=>{
	let long=transport([{status:429,headers:{'Retry-After':'38'}}]),started=Date.now();
	let error=await long.E.requestProvider(OPENALEX,{},20000).catch(value=>value);
	assert.equal(long.fetched.length,1,'no retry when the service asks for 38 s');assert.equal(error.name,'ProviderRequestError');assert.equal(error.providerStatus,429);
	assert.equal(error.rateLimited,true);assert.equal(error.retryAfterMs,38000);assert.ok(error.retryAt>=started+38000&&error.retryAt<=Date.now()+38000);assert.equal(error.keyless,true);assert.equal(error.scholarlySource,'openalex');assert.equal(error.quotaExhausted,false);
	let short=transport([{status:429,headers:{'Retry-After':'2'}},{status:200,body:'{"ok":1}'}]);
	assert.equal(await short.E.requestProvider(OPENALEX,{},20000),'{"ok":1}');assert.deepEqual(short.waits.filter(ms=>ms>=1000&&(ms<3050||ms>3150)),[2000],'one wait of the asked 2 s (the rest is request spacing)');
	let keyed=transport([{status:429,headers:{'Retry-After':'60'}}],{keys:{openalex:'k'}}),keyedError=await keyed.E.requestProvider(OPENALEX,{},20000).catch(value=>value);assert.equal(keyedError.keyless,false);
	// OpenAlex pauses keyless search with 503 and Retry-After: 60 (seen live).
	let paused=transport([{status:503,headers:{'Retry-After':'60'}}]),pause=await paused.E.requestProvider(OPENALEX,{},20000).catch(value=>value);
	assert.equal(paused.fetched.length,1);assert.equal(pause.providerStatus,503);assert.equal(pause.rateLimited,true);assert.equal(pause.retryAfterMs,60000);
	assert.ok(discoveryCooldown('openalex',pause).until>Date.now()+59000,'the pause is honoured, not the 15 s of a plain failure');
	let busy=transport([{status:503}]),plain=await busy.E.requestProvider(OPENALEX,{},20000).catch(value=>value);assert.equal(busy.fetched.length,3);assert.equal(plain.rateLimited,undefined,'a 503 without Retry-After stays a plain failure');
});

test('a spent OpenAlex budget is not retried; a 429 without Retry-After keeps the short backoff',async()=>{
	let spent=transport([{status:429,headers:{'X-RateLimit-Remaining':'0','X-RateLimit-Credits-Required':'10'}}]),error=await spent.E.requestProvider(OPENALEX,{},20000).catch(value=>value);
	assert.equal(spent.fetched.length,1);assert.equal(error.quotaExhausted,true);assert.equal(error.retryAt,undefined);
	let s2=transport([{status:429}]),busy=await s2.E.requestProvider(S2,{},15000).catch(value=>value);
	assert.equal(s2.fetched.length,3,'two retries');assert.deepEqual(s2.waits.filter(ms=>ms<3050||ms>3150),[1500,3000],'1.5 s, then 3 s (3.1 s is the keyless request spacing)');assert.equal(busy.rateLimited,true);assert.equal(busy.retryAt,undefined);assert.equal(busy.keyless,true);
	let other=transport([{status:429,headers:{'Retry-After':'40'}}]),plain=await other.E.requestProvider('https://api.deepseek.com/chat/completions',{},20000).catch(value=>value);assert.equal(plain.rateLimited,undefined,'model requests are not scholarly requests');
});

test('the cooldown is the retry time, 60 s without one, and midnight UTC for a keyless or spent OpenAlex budget',()=>{
	const now=Date.UTC(2026,10,5,9,23),midnight=Date.UTC(2026,10,6);assert.equal(nextUTCMidnight(now),midnight);assert.equal(nextUTCMidnight(Date.UTC(2026,11,31,23,59)),Date.UTC(2027,0,1));
	const limited=extra=>Object.assign(Error('HTTP 429'),{providerStatus:429,rateLimited:true,...extra});
	assert.equal(discoveryCooldown('openalex',limited({keyless:true,retryAt:now+38000}),now).until,now+38000,'a short keyless limit keeps its retry time');
	let spent=discoveryCooldown('openalex',limited({keyless:true}),now);assert.equal(spent.until,midnight);assert.equal(spent.quota,true);assert.equal(spent.keyless,true);
	assert.equal(discoveryCooldown('openalex-zh',limited({keyless:false,quotaExhausted:true,retryAt:now+5000}),now).until,midnight);
	assert.equal(discoveryCooldown('openalex',limited({keyless:false}),now).until,now+60000,'a keyed limit without a time rests 60 s');
	assert.equal(discoveryCooldown('semantic',limited({keyless:true}),now).until,now+60000,'only OpenAlex has the daily budget');
	assert.equal(discoveryCooldown('semantic',limited({keyless:true,retryAt:now+90000}),now).until,now+90000);
	assert.equal(discoveryCooldown('crossref',Object.assign(Error('HTTP 503'),{providerStatus:503}),now).until,now+15000);
});

// The merged search, with requestProvider answering by host.
const words=text=>Object.fromEntries(text.split(' ').reduce((map,word,index)=>map.set(word,[...(map.get(word)||[]),index]),new Map()));
const work=(id,title,extra={})=>({id:'https://openalex.org/W'+id,title,publication_date:'2024-05-01',cited_by_count:id,abstract_inverted_index:words('Short abstract'),authorships:[],...extra});
const openalex=rows=>({results:rows,meta:{count:rows.length,next_cursor:null}}),crossref=rows=>({message:{'total-results':rows.length,items:rows}}),semantic=rows=>({total:rows.length,data:rows});
function engine(answers,{keys={openalex:false,semantic:false},extra={}}={}){
	const state={},urls=[],E={store:{get:(...path)=>path.reduce((value,name)=>value?.[name],state),update:async fn=>fn(state)},scholarly:{has:async id=>keys[id]},
		requestProvider:async(url,options)=>{const parsed=new URL(url);urls.push(parsed);const answer=answers[parsed.hostname];if(!answer)throw Object.assign(Error('HTTP 404'),{providerStatus:404});return JSON.stringify(typeof answer==='function'?await answer(parsed,options):answer);},...extra};
	Feed.installDiscoveryFeed(E,{Zotero:{Items:{getAll:async()=>[]},Libraries:{userLibraryID:1}}});return {E,state,urls};
}
const scope=primaryKeyword=>({primaryKeyword,fuzzy:true}),prepare=(E,query,extra={})=>E.prepareDiscoveryQuery(query,{...scope(query),...extra},undefined,{domainMatch:'rank',queryExpansion:'off'});
const limit429=extra=>()=>{throw Object.assign(Error('HTTP 429'),{providerStatus:429,rateLimited:true,...extra});};

test('a keyless OpenAlex limit rests OpenAlex until midnight UTC; the other indexes still answer and the states say so',async()=>{
	const {E,urls}=engine({'api.openalex.org':limit429({keyless:true}),'api.semanticscholar.org':semantic([{paperId:'p1',title:'Graph neural network for traffic'}]),'api.crossref.org':crossref([{DOI:'10.5/a',title:['Graph neural network for power grids'],type:'journal-article'}])});
	const prepared=await prepare(E,'graph neural network'),before=Date.now(),first=await E.searchDiscoverySources({prepared,filters:{pdfOnly:false},indexes:['openalex','semantic','crossref'],limit:20});
	assert.equal(first.records.length,2);const state=first.providerStates.openalex;assert.equal(state.status,'limited');assert.equal(state.keyless,true);assert.equal(state.quota,true);assert.equal(state.until,nextUTCMidnight(before));
	assert.deepEqual(first.providerStates.semantic,{status:'ok',rows:1,keyless:true});assert.equal(first.providerStates.crossref.status,'ok');assert.equal(first.providerStates.crossref.keyless,undefined,'Crossref has no key');
	const asked=urls.filter(url=>url.hostname==='api.openalex.org').length,again=await E.searchDiscoverySources({prepared:await prepare(E,'graph neural network'),filters:{pdfOnly:false},indexes:['openalex','semantic','crossref'],limit:20,refresh:true});
	assert.equal(urls.filter(url=>url.hostname==='api.openalex.org').length,asked,'not asked again before midnight, even on refresh');assert.equal(again.providerStates.openalex.status,'limited');assert.equal(again.records.length,2);
	assert.equal(discoveryProviderNotice(again.providerStates).text,'OpenAlex 未配置密钥，今日免费额度已用完，结果仅来自 Semantic Scholar 和 Crossref。在设置中填写免费密钥可恢复。');
});

test('a short limit rests only until its retry time, and the shared OpenAlex budget rests both OpenAlex searches',async()=>{
	let calls=0;const {E,urls}=engine({'api.semanticscholar.org':()=>{calls++;if(calls===1)limit429({keyless:true,retryAt:Date.now()+30})();return semantic([{paperId:'p',title:'Soil pore water transport'}]);},'api.openalex.org':limit429({keyless:false,retryAt:Date.now()+60000}),'api.crossref.org':crossref([])});
	const run=refresh=>E.searchDiscoverySources({refresh,prepared:{query:'soil pore water',plainQuery:'soil pore water',originalQuery:'土壤孔隙水',groups:[['soil pore water']],domainMatch:'rank',researchScope:scope('soil pore water'),originalResearchScope:scope('土壤孔隙水')},filters:{pdfOnly:false},indexes:['openalex','semantic','crossref','openalex-zh'],limit:20});
	const first=await run();assert.equal(first.providerStates.semantic.status,'limited');assert.equal(first.providerStates['openalex-zh'].status,'limited');
	assert.equal(urls.filter(url=>url.hostname==='api.openalex.org').length<=2,true);const openalexCalls=urls.filter(url=>url.hostname==='api.openalex.org').length;
	await new Promise(resolve=>setTimeout(resolve,60));const second=await run(true);
	assert.equal(calls,2,'Semantic Scholar is asked again after its 30 ms');assert.equal(second.providerStates.semantic.status,'ok');assert.equal(second.records[0].title,'Soil pore water transport');
	assert.equal(urls.filter(url=>url.hostname==='api.openalex.org').length,openalexCalls,'both OpenAlex indexes wait for the shared retry time');
	assert.equal(first.providerErrors.filter(error=>error.provider==='OpenAlex').length,1,'one OpenAlex failure is named once');
});

test('the notice names a keyless or limited OpenAlex and a keyless limited Semantic Scholar, and nothing otherwise',()=>{
	const now=Date.UTC(2026,10,5,9,0),ok={status:'ok',rows:20};
	assert.equal(discoveryProviderNotice({openalex:{status:'limited',keyless:true,quota:true,rows:0,until:now+3600000},semantic:{status:'limited',keyless:true,rows:0},arxiv:ok,crossref:ok},{now}).text,'OpenAlex 未配置密钥，今日免费额度已用完；Semantic Scholar 未配置密钥，暂时限流，结果仅来自 arXiv 和 Crossref。在设置中填写免费密钥可恢复。');
	const keyed=discoveryProviderNotice({openalex:{status:'limited',keyless:false,rows:0,until:now+38000},semantic:{...ok,keyless:false},crossref:ok},{now});assert.match(keyed.text,/^OpenAlex 暂时限流（约 \d\d:\d\d 后恢复），结果仅来自 Semantic Scholar 和 Crossref。$/);assert.equal(keyed.settings,false);
	assert.deepEqual(discoveryProviderNotice({openalex:{...ok,keyless:true},semantic:{...ok,keyless:true}},{now}),{text:'OpenAlex 未配置密钥，每天约可免费检索 10 次；在设置中填写免费密钥可提高额度。',settings:true});
	assert.equal(discoveryProviderNotice({openalex:{...ok,keyless:false},semantic:{status:'limited',keyless:false,rows:0}},{now}),null,'a keyed Semantic Scholar limit is not named');
	assert.equal(discoveryProviderNotice({openalex:{status:'limited',keyless:false,rows:0,until:now-1},crossref:ok},{now}),null,'a rest that has ended is not named');
	assert.equal(discoveryProviderNotice(undefined),null);
	assert.equal(discoveryProviderNotice({openalex:{status:'failed',keyless:true,rows:0},arxiv:ok},{now}).text,'OpenAlex 未配置密钥，暂时无法访问，结果仅来自 arXiv。在设置中填写免费密钥可恢复。');
});

test('the search page shows the notice in one line whose button opens 文献数据源 in settings',()=>{
	const node=(tag='div',text='',className='')=>({tag,textContent:text,className,hidden:false,title:'',children:[],dataset:{},append(...items){this.children.push(...items.filter(item=>typeof item==='object'));},replaceChildren(...items){this.children=[];this.append(...items);},setAttribute(){},closest(){return null;},querySelector:()=>null});
	const ui={};vm.runInNewContext(uiJS,{EasySchUI:ui});vm.runInNewContext(settingsJS,{EasySchUI:ui});
	const opened=[],field={focused:false,focus(){this.focused=true;}},fold={open:false},card={scrollIntoView(){opened.push('scroll');},closest:()=>fold,querySelector:selector=>selector.includes('openalex')?field:null};
	Object.assign(ui,{el:node,discoveryPresentationTools:{discoveryProviderNotice},discoveryProviderNotice:node('p','','muted'),pptButton(label,action,parent){const button=node('button',label);button.onclick=action;parent.append(button);return button;},show:tab=>opened.push('show:'+tab),$:id=>id==='scholarly-sources'?card:null});
	ui.renderDiscoveryProviderNotice({openalex:{status:'limited',keyless:true,quota:true,rows:0},crossref:{status:'ok',rows:5}});
	const host=ui.discoveryProviderNotice;assert.equal(host.hidden,false);assert.equal(host.children[0].textContent,'OpenAlex 未配置密钥，今日免费额度已用完，结果仅来自 Crossref。在设置中填写免费密钥可恢复。');
	host.children[1].onclick();assert.deepEqual(opened,['show:settings','scroll']);assert.equal(fold.open,true,'the folded 文献数据源 card is opened');assert.equal(field.focused,true);
	ui.renderDiscoveryProviderNotice(null);assert.equal(host.hidden,true);assert.equal(host.children.length,0);
});

test('the term table translates each word, keeps unknown words and keeps alternatives apart',()=>{
	assert.equal(translateDiscoveryTerm('调制识别 深度学习'),'modulation recognition deep learning');
	assert.equal(translateDiscoveryTerm('相位噪声补偿 光通信'),'phase noise compensation optical communication','a run made of known pieces');
	assert.equal(translateDiscoveryTerm('深度学习、神经网络'),'deep learning neural network');assert.equal(translateDiscoveryTerm('调制识别；信号识别'),'modulation recognition; signal recognition');
	assert.equal(translateDiscoveryTerm('CNN 调制识别'),'CNN modulation recognition');assert.equal(translateDiscoveryTerm('土壤孔隙水 深度学习'),'土壤孔隙水 deep learning','an unknown run stays for the translator');
	assert.equal(translateDiscoveryTerm('基于深度学习的调制识别'),'基于深度学习的调制识别','a run with an unknown piece is not partly translated');
});

test('a translated Chinese search also asks OpenAlex with the typed words and keeps the Chinese-titled papers',async()=>{
	const {E,urls}=engine({'api.openalex.org':url=>url.searchParams.get('search')==='调制识别 深度学习'?openalex([work(1,'基于深度学习的通信信号调制识别')]):openalex([work(2,'Deep learning for automatic modulation recognition')]),'api.semanticscholar.org':semantic([]),'api.crossref.org':crossref([])});
	const Zotero={Research:E,Items:{getAll:async()=>[]},Libraries:{userLibraryID:1},addShutdownListener(){},Promise:{delay:async()=>{}}};
	vm.runInNewContext(discoveryJS,{Zotero,ChromeUtils:{importESModule:url=>url.includes('workspace-outputs')?WorkspaceOutputs:url.includes('discovery-feed')?{...Feed,installDiscoveryFeed(){}}:{}}});
	const result=await E.searchPaperPage('调制识别 深度学习',{researchScope:scope('调制识别 深度学习'),limit:20,domainMatch:'rank',queryExpansion:'off'});
	assert.equal(result.searchQuery,'modulation recognition deep learning','translated by the table, no translator needed');
	assert.deepEqual(urls.filter(url=>url.hostname==='api.openalex.org').map(url=>url.searchParams.get('search')).sort(),['modulation recognition deep learning','调制识别 深度学习']);
	assert.deepEqual(result.records.map(row=>row.title).sort(),['Deep learning for automatic modulation recognition','基于深度学习的通信信号调制识别']);assert.equal(result.providerName,'OpenAlex','one OpenAlex in the source names');
});

test('topic fit is a score: most words suffice, a title-only record is judged on its title, exclusions and strict domains still remove',async()=>{
	const E={store:{get:()=>({}),update:async()=>{}}},prepared=await prepareDiscoveryQuery(E,'phase noise compensation optical communication',scope('phase noise compensation optical communication'),undefined,{discovery:{domainMatch:'rank',queryExpansion:'off'}});
	const verdict=record=>discoveryScopeVerdict(record,prepared),filler=' The proposed receiver is evaluated in simulation and in a laboratory testbed with standard equipment and several modulation formats.';
	assert.equal(verdict({title:'Phase noise in coherent optical systems'}),'match','three of five words in a title without abstract');
	assert.equal(verdict({title:'Optical communication systems: an overview'}),'keywords','two of five words are not enough');
	assert.equal(verdict({title:'Laser linewidth tolerance of carrier recovery',abstract:'We study laser phase noise and its compensation in coherent optical links.'+filler}),'match','the abstract supplies the words');
	assert.equal(verdict({title:'A survey of deep learning',abstract:'Optical character recognition and communication between agents are surveyed.'+filler}),'keywords');
	assert.equal(discoveryScopeMatch({title:'Joint compensation scheme for phase noise and dispersion in optical fiber communication'},prepared).coverage,1);
	const excluded=await prepareDiscoveryQuery(E,'phase noise',{...scope('phase noise'),excludedKeywords:['wireless']},undefined,{discovery:{domainMatch:'rank',queryExpansion:'off'}});
	assert.equal(discoveryScopeVerdict({title:'Phase noise compensation in wireless OFDM'},excluded),'excluded');
	const strict=await prepareDiscoveryQuery(E,'phase noise',{...scope('phase noise'),domain:'optics'},undefined,{discovery:{domainMatch:'strict',queryExpansion:'off'}});
	assert.equal(discoveryScopeVerdict({title:'Phase noise of crystal oscillators in clocks'},strict),'domain');assert.equal(discoveryScopeVerdict({title:'Phase noise of lasers in optical links'},strict),'match');
	const two=await prepareDiscoveryQuery(E,'soil pore water',{...scope('soil pore water'),secondaryKeyword:'macropore'},undefined,{discovery:{domainMatch:'rank',queryExpansion:'off'}});
	assert.equal(discoveryScopeVerdict({title:'Soil pore water chemistry'},two),'keywords','each named concept needs evidence');assert.equal(discoveryScopeVerdict({title:'Macropore flow of soil water'},two),'match');
});

test('relevance follows the text first, then the fused rank; Crossref order counts less; a date sort is unchanged',async()=>{
	const E={store:{get:()=>({}),update:async()=>{}}},prepared=await prepareDiscoveryQuery(E,'3D Gaussian splatting',scope('3D Gaussian splatting'),undefined,{discovery:{domainMatch:'rank',queryExpansion:'off'}});
	const pool=createDiscoveryMergePool(),row=(title,source,doi,extra={})=>({title,source,doi,date:'2024',...extra});
	pool.add('crossref',[row('Gaussian splatting in volume visualization of 3D data','Crossref','10.1/c1'),row('Specialized 3D Gaussian Splatting reconstruction','Crossref','10.1/c2')]);
	pool.add('openalex',[row('Survey of radiance field rendering','OpenAlex','10.1/o1',{abstract:'Methods based on 3D Gaussian splatting and NeRF are compared in detail across many benchmarks and settings.'}),row('3D Gaussian Splatting for real-time radiance field rendering','OpenAlex','10.1/o2',{date:'2023'})]);
	pool.add('arxiv',[row('3D Gaussian Splatting for Real-Time Radiance Field Rendering','arXiv','',{date:'2023'})]);
	const entries=pool.entries,text=discoveryTextRelevance(entries.map(entry=>entry.record),prepared),ordered=rankDiscoveryEntries(entries,['openalex','semantic','arxiv','crossref'],{text}).map(entry=>entry.record.title);
	assert.equal(ordered[0],'3D Gaussian Splatting for real-time radiance field rendering','the paper two indexes found, with every word in its title');
	assert.ok(ordered.indexOf('Specialized 3D Gaussian Splatting reconstruction')<ordered.indexOf('Survey of radiance field rendering'),'title words outweigh abstract words');
	assert.deepEqual(rankDiscoveryEntries(entries,['openalex','arxiv','crossref']).map(entry=>entry.record.title).slice(0,2),['3D Gaussian Splatting for real-time radiance field rendering','Survey of radiance field rendering'],'without text the fused rank leads, and Crossref\'s first place counts half');
	const dated=Feed.applyDiscoveryFilters(entries.map(entry=>({...entry.record})),{pdfOnly:false,sort:'date'}).map(row=>row.date);assert.deepEqual(dated,[...dated].sort().reverse());
	assert.equal(new URL(crossrefSearchURL({query:'3D Gaussian splatting'})).searchParams.get('query.bibliographic'),'3D Gaussian splatting');assert.equal(new URL(crossrefSearchURL({query:'x'})).searchParams.has('query'),false);
	// Chinese and English words of one pool have very different idf; a Chinese paper
	// with one of the two concepts must not outrank papers with both.
	const zh=await prepareDiscoveryQuery(E,'调制识别 深度学习',scope('调制识别 深度学习'),undefined,{discovery:{domainMatch:'rank',queryExpansion:'off'}}),mixed=[{title:'基于深度学习的学习情绪分析',abstract:'本文基于深度学习技术构建面向教育场景的多维度情绪识别模型。',keywords:['deep learning','emotion recognition']},{title:'基于深度学习的通信信号调制识别技术研究',abstract:'调制识别是认知无线电中的前置环节，本文建立卷积神经网络的深度学习模型。'},...Array.from({length:6},(_,i)=>({title:'Deep learning based modulation recognition method '+i,abstract:'A deep learning model for modulation recognition of radio signals is proposed and evaluated on public datasets.'}))];
	const scores=discoveryTextRelevance(mixed,zh);assert.ok(scores.get(mixed[0])<Math.min(...mixed.slice(1).map(row=>scores.get(row))),'one concept of two ranks last');
	const bare={title:'Joint compensation scheme for phase noise and dispersion in optical fiber communication'},rich={title:'Machine learning techniques in optical communication',abstract:'Phase noise compensation and carrier recovery for optical communication links are discussed; phase noise models and compensation methods for optical communication are reviewed in depth.'},pn=await prepareDiscoveryQuery(E,'phase noise compensation optical communication',scope('phase noise compensation optical communication'),undefined,{discovery:{domainMatch:'rank',queryExpansion:'off'}}),both=discoveryTextRelevance([bare,rich],pn);
	assert.ok(both.get(bare)>both.get(rich),'a title with every word outranks an abstract that repeats them, even without an abstract');
});

// arxiv.js with a Zotero.HTTP that answers Atom feeds by query.
function arxiv(feeds){
	const calls=[],E={},entry=id=>'<entry><id>http://arxiv.org/abs/'+id+'v1</id><title>Paper '+id+'</title><summary>Abstract</summary><published>2024-01-02T00:00:00Z</published></entry>';
	const atom=xml=>{const tags=(text,name)=>[...text.matchAll(new RegExp('<'+name+'>([\\s\\S]*?)</'+name+'>','g'))].map(match=>match[1]),el=text=>({textContent:text,getElementsByTagNameNS:(_ns,name)=>tags(text,name).map(el)});return{documentElement:{localName:'feed'},querySelector:()=>null,getElementsByTagNameNS:(_ns,name)=>tags(xml,name==='totalResults'?'opensearch:totalResults':name).map(el)};};
	const Zotero={Research:E,Promise:{delay:async()=>{}},logError(){},getMainWindow:()=>({DOMParser:class{parseFromString(text){return atom(text);}}}),HTTP:{request:async(_method,url)=>{const query=new URL(url).searchParams.get('search_query');calls.push(query);const ids=feeds(query);return{status:200,responseText:'<feed><opensearch:totalResults>'+ids.total+'</opensearch:totalResults>'+ids.list.map(entry).join('')+'</feed>',getResponseHeader:()=>null};}}};
	vm.runInNewContext(arxivJS,{Zotero,URLSearchParams,ChromeUtils:{importESModule:url=>url.includes('discovery-dates')?Dates:ArxivIDs}});return {E,calls};
}
const ids=(from,count)=>Array.from({length:count},(_,i)=>'2401.'+String(from+i).padStart(5,'0'));

test('arXiv asks for each word in title or abstract without grammatical words, and widens a thin first page once with OR',async()=>{
	const {E,calls}=arxiv(query=>query.includes(' OR abs:"compensation") OR ')?{total:300,list:ids(1,20)}:{total:4,list:ids(1,4)});
	const page=await E.arxivSearchPage('phase noise compensation for a optical link',{limit:20});
	assert.equal(calls[0],'(ti:"phase" OR abs:"phase") AND (ti:"noise" OR abs:"noise") AND (ti:"compensation" OR abs:"compensation") AND (ti:"optical" OR abs:"optical") AND (ti:"link" OR abs:"link")','for, a and one-letter words are dropped');
	assert.equal(calls[1],'(ti:"phase" OR abs:"phase") OR (ti:"noise" OR abs:"noise") OR (ti:"compensation" OR abs:"compensation") OR (ti:"optical" OR abs:"optical") OR (ti:"link" OR abs:"link")');
	assert.equal(page.widened,true);assert.equal(page.records.length,20,'the four AND papers first, then the new OR papers');assert.deepEqual([...page.records.slice(0,4).map(row=>row.id)],ids(1,4).map(id=>id+'v1'));assert.equal(page.total,300);assert.equal(page.hasMore,true);
	const next=await E.arxivSearchPage('phase noise compensation for a optical link',{limit:20,page:2,any:true});assert.equal(calls.length,3);assert.match(calls[2],/ OR \(ti:"noise"/);assert.equal(next.widened,undefined);
	const full=arxiv(()=>({total:400,list:ids(1,20)}));await full.E.arxivSearchPage('3D Gaussian splatting',{limit:20});assert.equal(full.calls.length,1,'a full page needs no OR search');
	const dated=arxiv(()=>({total:2,list:ids(1,2)}));await dated.E.arxivSearchPage('phase noise',{limit:20,filters:{yearFrom:'2020',yearTo:'2024'}});
	assert.match(dated.calls[1],/^\(\(ti:"phase" OR abs:"phase"\) OR \(ti:"noise" OR abs:"noise"\)\) AND submittedDate:\[202001010000 TO 202412312359\]$/,'the year range applies to the OR search too');
});

test('after arXiv widened its first page the merged search keeps asking arXiv with OR',async()=>{
	const asked=[],{E}=engine({'api.openalex.org':openalex([]),'api.crossref.org':crossref([])},{extra:{arxivSearchPage:async(_query,options)=>{asked.push({page:options.page,any:options.any});const start=asked.length*50;return{records:Array.from({length:50},(_,i)=>({id:'2401.'+String(start+i).padStart(5,'0'),title:'Phase noise compensation study '+(start+i),abstract:'Phase noise compensation in optical communication links.'})),total:500,hasMore:true,widened:asked.length===1};}}});
	const prepared=await prepare(E,'phase noise compensation'),first=await E.searchDiscoverySources({prepared,filters:{pdfOnly:false},indexes:['openalex','arxiv','crossref'],limit:40});
	await E.searchDiscoverySources({prepared,filters:{pdfOnly:false},indexes:['openalex','arxiv','crossref'],limit:40,cursor:first.nextCursor});
	await E.searchDiscoverySources({prepared,filters:{pdfOnly:false},indexes:['openalex','arxiv','crossref'],limit:40,cursor:'discovery-merge-v1:80'});
	assert.deepEqual(asked[0],{page:1,any:undefined});assert.ok(asked.slice(1).every(row=>row.any===true),'later pages use OR');assert.deepEqual(asked.map(row=>row.page),asked.map((_,i)=>i+1),'pages advance one at a time');
});
