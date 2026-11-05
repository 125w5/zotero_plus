/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import vm from 'node:vm';
import * as Feed from '../../chrome/content/zotero/research/shared/discovery-feed.mjs';
import * as WorkspaceOutputs from '../../chrome/content/zotero/research/shared/workspace-outputs.mjs';
import {createDiscoveryMergePool,rankDiscoveryEntries,discoveryArxivID} from '../../chrome/content/zotero/research/shared/discovery-providers.mjs';
import {prepareDiscoveryQuery,matchesPreparedDiscoveryScope} from '../../chrome/content/zotero/research/shared/discovery-query.mjs';
import {matchesResearchScope} from '../../chrome/content/zotero/research/shared/research-domain.mjs';

const words=text=>Object.fromEntries(text.split(' ').reduce((map,word,index)=>map.set(word,[...(map.get(word)||[]),index]),new Map()));
const work=(id,title,extra={})=>({id:'https://openalex.org/W'+id,title,publication_date:'2024-05-01',cited_by_count:id,abstract_inverted_index:words('Short abstract'),primary_location:{source:{id:'https://openalex.org/S1',display_name:'Journal One',type:'journal',issn_l:'1234-5678'}},authorships:[],...extra});
const SCOPE={primaryKeyword:'graph neural network',fuzzy:true};
// Answers by host; a function answer may throw (provider failure) or return a promise.
function engine(answers,{extra={}}={}){
 const state={},urls=[],E={store:{get:(...path)=>path.reduce((value,name)=>value?.[name],state),update:async fn=>fn(state)},verifyDiscoveryPDF:async()=>({available:true,checkedAt:Date.now()}),
  requestProvider:async(url,options)=>{const parsed=new URL(url);urls.push(parsed);const answer=answers[parsed.hostname];if(!answer)throw Object.assign(Error('HTTP 404'),{providerStatus:404});return JSON.stringify(typeof answer==='function'?await answer(parsed,options):answer);},...extra};
 Feed.installDiscoveryFeed(E,{Zotero:{Items:{getAll:async()=>extra.items||[]},Libraries:{userLibraryID:1}}});return{E,state,urls};
}
const prepared=(E,scope=SCOPE)=>E.prepareDiscoveryQuery(scope.primaryKeyword,scope,undefined,{domainMatch:'rank',queryExpansion:'off'});
const openalex=rows=>({results:rows,meta:{count:rows.length,next_cursor:null}}),semantic=rows=>({total:rows.length,data:rows}),crossref=rows=>({message:{'total-results':rows.length,items:rows}});

test('the merge pool joins one paper across indexes by DOI, arXiv number and title with year, and keeps the fullest fields',()=>{
 const pool=createDiscoveryMergePool();
 pool.add('openalex',[{id:'W1',openalexId:'W1',title:'Graph neural networks for molecules',doi:'https://doi.org/10.1/ABC',journal:'Journal One',sourceType:'journal',issn:'1234-5678',date:'2024-05-01',abstract:'Short.',citationCount:3,source:'OpenAlex',pdf:'',pdfCandidates:[]}]);
 pool.add('semantic',[{id:'s2-1',s2Id:'s2-1',title:'Graph Neural Networks for Molecules',doi:'10.1/abc',abstract:'A much longer abstract from Semantic Scholar.',citationCount:9,source:'Semantic Scholar',pdf:'https://example.org/a.pdf',pdfCandidates:['https://example.org/a.pdf'],journal:'J1',sourceType:''}]);
 // The preprint has only the arXiv DOI; OpenAlex named the arXiv copy of a journal article.
 pool.add('arxiv',[{id:'2401.00001v2',arxiv:'2401.00001',title:'Message passing on point clouds',date:'2023-12-30',source:'arXiv',sourceType:'repository',pdf:'https://arxiv.org/pdf/2401.00001v2',pdfCandidates:['https://arxiv.org/pdf/2401.00001v2']}]);
 pool.add('openalex',[{id:'W2',title:'Message passing on point clouds',doi:'10.2/journal',arxiv:'2401.00001',journal:'Journal Two',sourceType:'journal',date:'2024-03-01',source:'OpenAlex'}],1);
 // Title and year: one year apart still matches; a different DOI does not; a short title never.
 pool.add('crossref',[{id:'c1',title:'Benchmarking graph transformers at scale!',doi:'',date:'2022',source:'Crossref'},{id:'c2',title:'Benchmarking Graph Transformers at Scale',date:'2023-02-01',source:'Crossref',doi:'10.3/x'},{id:'c3',title:'Benchmarking graph transformers at scale',date:'2023',doi:'10.3/other',source:'Crossref'},{id:'c4',title:'Introduction',date:'2024',source:'Crossref'},{id:'c5',title:'Introduction',date:'2024',source:'Crossref'}]);
 const rows=pool.entries.map(entry=>entry.record);
 assert.equal(rows.length,6,'DOI pair, arXiv pair, title pair, conflicting DOI and two short titles');
 const molecule=rows.find(row=>row.openalexId==='W1');assert.equal(molecule.s2Id,'s2-1');assert.equal(molecule.abstract,'A much longer abstract from Semantic Scholar.');assert.equal(molecule.journal,'Journal One','the journal record keeps its venue');assert.equal(molecule.citationCount,9);assert.equal(molecule.pdf,'https://example.org/a.pdf');assert.deepEqual(molecule.sources,['OpenAlex','Semantic Scholar']);assert.equal(molecule.source,'OpenAlex');
 const cloud=rows.find(row=>row.arxiv==='2401.00001');assert.equal(cloud.doi,'10.2/journal','the version of record supplies the DOI');assert.equal(cloud.journal,'Journal Two');assert.equal(cloud.date,'2024-03-01');assert.deepEqual(cloud.pdfCandidates,['https://arxiv.org/pdf/2401.00001v2']);assert.equal(cloud.source,'OpenAlex');
 assert.equal(rows.filter(row=>/benchmarking/i.test(row.title)).length,2,'title+year merged one pair; a second DOI stays apart');
 assert.equal(rows.find(row=>/benchmarking/i.test(row.title)&&row.doi==='10.3/x').date,'2023-02-01');
 assert.equal(rows.filter(row=>row.title==='Introduction').length,2,'short titles are never merged by title');
 assert.equal(discoveryArxivID('https://arxiv.org/abs/2401.00001v3'),'2401.00001');assert.equal(discoveryArxivID('10.48550/arXiv.2401.00001'),'2401.00001');assert.equal(discoveryArxivID('10.1000/2401.00001'),'');
});

test('ranking interleaves the indexes by rank and puts a paper several indexes return first',()=>{
 const pool=createDiscoveryMergePool(),row=(title,source,doi)=>({title,source,doi,date:'2024'});
 pool.add('openalex',[row('Only OpenAlex first result','OpenAlex','10.9/a'),row('Shared paper returned by both','OpenAlex','10.9/s'),row('Only OpenAlex third result','OpenAlex','10.9/c')]);
 pool.add('semantic',[row('Only Semantic Scholar first result','Semantic Scholar','10.9/b'),row('Shared paper returned by both','Semantic Scholar','10.9/s')]);
 const titles=rankDiscoveryEntries(pool.entries,['openalex','semantic']).map(entry=>entry.record.title);
 assert.deepEqual(titles,['Shared paper returned by both','Only OpenAlex first result','Only Semantic Scholar first result','Only OpenAlex third result']);
});
test('the indexes are asked together and a failing or rate-limited one leaves the others',async()=>{
 const releases=[],{E,urls}=engine({'api.openalex.org':()=>new Promise(resolve=>releases.push(()=>resolve(openalex([work(1,'Graph neural network for traffic',{doi:'https://doi.org/10.5/t'})])))),'api.semanticscholar.org':()=>{throw Object.assign(Error('HTTP 429'),{providerStatus:429});},'api.crossref.org':crossref([{DOI:'10.5/T',title:['Graph neural network for traffic'],type:'journal-article','container-title':['Traffic Journal'],published:{'date-parts':[[2024]]}},{DOI:'10.5/u',title:['A graph neural network for power grids'],type:'journal-article',published:{'date-parts':[[2023]]}}])});
 const task=E.searchDiscoverySources({prepared:await prepared(E),filters:{pdfOnly:false},indexes:['openalex','semantic','crossref'],limit:20});
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(urls.map(url=>url.hostname).sort(),['api.crossref.org','api.openalex.org','api.semanticscholar.org'],'no index waits for another');
 releases[0]();const result=await task;
 assert.deepEqual(result.records.map(row=>row.title),['Graph neural network for traffic','A graph neural network for power grids']);assert.deepEqual([...result.records[0].sources],['OpenAlex','Crossref']);
 assert.equal(result.providerErrors.length,1);assert.equal(result.providerErrors[0].provider,'Semantic Scholar');assert.equal(result.providerErrors[0].limited,true);
 assert.ok(result.limitations.includes('部分来源暂不可用（Semantic Scholar），已显示其他来源的结果。'));assert.equal(urls.filter(url=>url.hostname==='api.semanticscholar.org').length,1,'a rate-limited index is not asked again in the same search');
 assert.equal(result.fallback,undefined);assert.equal(result.records[0].pdf,'','records without a PDF are listed');
});

test('one OpenAlex search of 100 fills several pages; later pages come from the merged pool',async()=>{
 const rows=Array.from({length:100},(_,i)=>work(i+1,'Graph neural network study '+(i+1),{doi:'https://doi.org/10.6/'+(i+1)})),{E,urls}=engine({'api.openalex.org':{results:rows,meta:{count:5000,next_cursor:'next'}},'api.semanticscholar.org':semantic([]),'api.crossref.org':crossref([])});
 const query=await prepared(E),first=await E.searchDiscoverySources({prepared:query,filters:{pdfOnly:false},indexes:['openalex','semantic','crossref'],limit:40});
 assert.equal(first.records.length,40);assert.equal(first.hasMore,true);assert.equal(first.nextCursor,'discovery-merge-v1:40');assert.equal(urls.filter(url=>url.hostname==='api.openalex.org').length,1);assert.equal(urls[0].searchParams.get('per-page'),'100');assert.match(urls[0].searchParams.get('select'),/abstract_inverted_index/);
 const second=await E.searchDiscoverySources({prepared:query,filters:{pdfOnly:false},indexes:['openalex','semantic','crossref'],limit:40,cursor:first.nextCursor});
 assert.equal(second.records.length,40);assert.equal(urls.filter(url=>url.hostname==='api.openalex.org').length,1,'the pool answers the second page');assert.equal(new Set([...first.records,...second.records].map(row=>row.doi)).size,80);
});

test('只显示可下载 asks the indexes for open PDFs and drops records without one; off, records come first',async()=>{
 const answers={'api.openalex.org':openalex([work(1,'Graph neural network with a PDF',{best_oa_location:{is_oa:true,pdf_url:'https://example.org/1.pdf'}}),work(2,'Graph neural network without a PDF')]),'api.semanticscholar.org':semantic([])};
 const off=engine(answers),offResult=await off.E.searchDiscoverySources({prepared:await prepared(off.E),filters:{pdfOnly:false},indexes:['openalex','semantic'],limit:20});
 assert.doesNotMatch(off.urls[0].searchParams.get('filter'),/is_oa/);assert.equal(off.urls[1].searchParams.has('openAccessPdf'),false);assert.equal(offResult.records.length,2);
 const on=engine(answers),onResult=await on.E.searchDiscoverySources({prepared:await prepared(on.E),filters:{pdfOnly:true},indexes:['openalex','semantic'],limit:20});
 assert.match(on.urls[0].searchParams.get('filter'),/open_access\.is_oa:true/);assert.match(on.urls[1].href,/&openAccessPdf$/);assert.deepEqual(onResult.records.map(row=>row.title),['Graph neural network with a PDF']);assert.equal(onResult.scan.removed.pdf,1);
 assert.match(new URL(Feed.discoveryFeedURL({query:'x'})).searchParams.get('filter'),/is_oa:true/,'callers that do not say keep PDF-only results');
});

test('Chinese terms go to the DeepSeek academic translation, then the research model, Youdao and Azure, each once',async()=>{
 const order=[],settings={endpoint:'https://model.example',model:'chat',translationEndpoint:'https://api.deepseek.com',translationModel:'deepseek-flash',youdaoAppID:'app',azureTranslatorRegion:'eastasia'};
 const {E,urls}=engine({'api.openalex.org':openalex([])},{extra:{settings:()=>settings,credentials:{get:async address=>'key-for-'+address},studio:{request:async()=>{order.push('model');throw Error('model down');}},translateYoudao:async(text,to)=>{order.push('youdao:'+to);return{text:'soil pore water'};},translateAzure:async()=>{order.push('azure');return{text:'wrong'};}}});
 const request=E.requestProvider;E.requestProvider=async(url,options,...rest)=>{if(url.startsWith('https://api.deepseek.com')){order.push('academic');throw Object.assign(Error('HTTP 500'),{providerStatus:500});}return request(url,options,...rest);};
 const query=await E.prepareDiscoveryQuery('土壤孔隙水',{primaryKeyword:'土壤孔隙水'},undefined,{domainMatch:'rank',queryExpansion:'off'});
 assert.deepEqual(order,['academic','model','youdao:en','youdao:en'],'a failed source is not retried; Azure is not needed once Youdao answers');assert.equal(query.query,'soil pore water');assert.equal(query.untranslated,false);assert.equal(query.warning,'');
 assert.equal(urls.length,0);
});

test('the academic translation sends both keywords in one short JSON request and a term searched again sends none',async()=>{
 const sent=[],settings={translationEndpoint:'https://api.deepseek.com'},{E,state}=engine({},{extra:{settings:()=>settings,credentials:{get:async address=>address==='https://api.deepseek.com'?'k':''}}});
 E.requestProvider=async(url,options,timeout,read)=>{sent.push({url,body:JSON.parse(options.body),timeout});return read({json:async()=>({choices:[{message:{content:'{"primary":["fruit decay","fruit rot","fruit spoilage"],"secondary":["lesion detection"]}'}}]})});};
 const scope={primaryKeyword:'水果腐败',secondaryKeyword:'病斑检出'},run=expansion=>E.prepareDiscoveryQuery('水果腐败',scope,undefined,{domainMatch:'rank',queryExpansion:expansion});
 const first=await run('auto');assert.equal(sent.length,1,'one request for both keywords, translation and synonyms');
 const {body,timeout,url}=sent[0];assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(body.model,'deepseek-flash');assert.equal(body.stream,false);assert.equal(body.temperature,0);assert.ok(body.max_tokens<=300);assert.deepEqual(body.thinking,{type:'disabled'});assert.deepEqual(body.response_format,{type:'json_object'});assert.deepEqual(timeout,{firstByte:6000,total:10000});
 assert.deepEqual(JSON.parse(body.messages[1].content),{primary:'水果腐败',secondary:'病斑检出'},'the query that repeats the first keyword is not sent twice');
 assert.equal(first.plainQuery,'fruit decay lesion detection');assert.deepEqual(first.queryExpansion.terms,{primaryKeyword:['fruit rot','fruit spoilage']});assert.ok(state.discoveryTermTranslations['水果腐败']);
 const again=await run('off');assert.equal(sent.length,1,'the cached term needs no request');assert.equal(again.plainQuery,'fruit decay lesion detection');
 const expanded=await E.prepareDiscoveryQuery('病斑检出',{primaryKeyword:'病斑检出'},undefined,{domainMatch:'rank',queryExpansion:'auto'});assert.equal(sent.length,1);assert.equal(expanded.query,'lesion detection','a cached term without synonyms translates without a request');
});

test('with no translation configured the Chinese terms go to OpenAlex and Crossref untranslated and the page says so',async()=>{
 const source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/discovery.js',import.meta.url),'utf8'),{E,urls}=engine({'api.openalex.org':openalex([work(1,'土壤孔隙水运移研究'),work(2,'Unrelated English paper')]),'api.crossref.org':crossref([{DOI:'10.8/zh',title:['土壤孔隙水的季节变化'],type:'journal-article',published:{'date-parts':[[2023]]}}])});
 const Zotero={Research:E,Items:{getAll:async()=>[]},Libraries:{userLibraryID:1},addShutdownListener(){},Promise:{delay:async()=>{}}};
 vm.runInNewContext(source,{Zotero,ChromeUtils:{importESModule:url=>url.includes('workspace-outputs')?WorkspaceOutputs:url.includes('discovery-feed')?{...Feed,installDiscoveryFeed(){}}:{}}});
 E.arxivSearchPage=async()=>{throw Error('must not be asked');};
 const result=await E.searchPaperPage('土壤孔隙水',{researchScope:{primaryKeyword:'土壤孔隙水'},limit:20,domainMatch:'rank',queryExpansion:'off'});
 assert.deepEqual(urls.map(url=>url.hostname).sort(),['api.crossref.org','api.openalex.org'],'Semantic Scholar and arXiv are not asked with Chinese words');assert.equal(urls.find(url=>url.hostname==='api.openalex.org').searchParams.get('search'),'土壤孔隙水');assert.equal(urls.find(url=>url.hostname==='api.crossref.org').searchParams.get('query.bibliographic'),'土壤孔隙水');
 assert.ok(result.limitations.includes('未配置翻译，中文检索词未翻译，结果可能很少。可在设置中配置模型或学术翻译。'));assert.deepEqual(result.records.map(row=>row.title).sort(),['土壤孔隙水的季节变化','土壤孔隙水运移研究']);
});

test('the local check accepts the Chinese term or its translation in each group, and similar Chinese phrasing',async()=>{
 const E={store:{get:()=>({})},studio:{request:async()=>({value:{translations:{query:'soil pore water',primaryKeyword:'soil pore water'}}})}};
 const query=await prepareDiscoveryQuery(E,'土壤孔隙水',{primaryKeyword:'土壤孔隙水',secondaryKeyword:'macropore'},undefined,{discovery:{domainMatch:'rank',queryExpansion:'off'}});
 assert.equal(matchesPreparedDiscoveryScope({title:'土壤孔隙水 and macropore flow'},query),true,'Chinese first group, English second group');
 assert.equal(matchesPreparedDiscoveryScope({title:'Soil pore water in macropore networks'},query),true);assert.equal(matchesPreparedDiscoveryScope({title:'土壤孔隙水研究'},query),false,'every group is still required');
 assert.equal(matchesResearchScope({title:'基于深度学习的图像目标检测方法'},{primaryKeyword:'目标检测图像'},{domain:false,stemmed:true}),true,'most two-character pieces present');
 assert.equal(matchesResearchScope({title:'基于深度学习的图像目标检测方法'},{primaryKeyword:'目标检测图像'}),false,'other callers keep the exact phrase');
 assert.equal(matchesResearchScope({title:'蛋白质折叠预测'},{primaryKeyword:'目标检测图像'},{domain:false,stemmed:true}),false);
});

test('when every index fails the library fallback matches Chinese and short words',async()=>{
 const item=(id,title)=>({id,itemType:'journalArticle',isRegularItem:()=>true,getField:key=>({title,abstractNote:'',date:'2024'}[key]||'')});
 const items=[item(1,'土壤孔隙水的运移规律'),item(2,'AI 辅助的作物识别'),item(3,'无关的论文')];
 const {E}=engine({},{extra:{items,library:{describe:entry=>({id:entry.id,title:entry.getField('title')}),localPDF:async()=>null}}});
 const chinese=await E.searchDiscoverySources({prepared:await E.prepareDiscoveryQuery('土壤孔隙水',{primaryKeyword:'土壤孔隙水'},undefined,{domainMatch:'rank',queryExpansion:'off'}),filters:{pdfOnly:false},indexes:['openalex']});
 assert.equal(chinese.fallback,'library');assert.deepEqual(chinese.records.map(row=>row.title),['土壤孔隙水的运移规律'],'a library item without a PDF is listed when PDFs are not required');
 assert.deepEqual(Feed.discoveryLocalTerms('AI 作物识别'),['ai','作物识别','作物','物识','识别']);assert.ok(Feed.discoveryLocalScore('AI 辅助的作物识别',Feed.discoveryLocalTerms('AI 作物识别'))>Feed.discoveryLocalScore('无关的论文',Feed.discoveryLocalTerms('AI 作物识别')));
});

test('a search with translation, merging and PDF checks writes only its own caches, never the corpus or materials',async()=>{
 const source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/discovery.js',import.meta.url),'utf8'),written=new Set();
 const {E,state}=engine({'api.openalex.org':openalex([work(1,'Fruit decay detection with images',{doi:'https://doi.org/10.7/a',best_oa_location:{is_oa:true,pdf_url:'https://example.org/a.pdf'}})]),'api.semanticscholar.org':semantic([{paperId:'p',title:'Fruit decay detection with images',externalIds:{DOI:'10.7/A'}}]),'api.crossref.org':crossref([])},{extra:{settings:()=>({translationEndpoint:'https://api.deepseek.com'}),credentials:{get:async()=>'k'}}});
 Object.assign(state,{corpus:{entries:{}},researchMaterials:{},materialCatalog:{},projects:{p1:{corpus:[]}},settings:{}});
 const update=E.store.update;E.store.update=async fn=>{const before=Object.fromEntries(Object.entries(state).map(([key,value])=>[key,JSON.stringify(value)]));const result=await update(fn);for(const [key,value] of Object.entries(state))if(before[key]!==JSON.stringify(value))written.add(key);return result;};
 const request=E.requestProvider;E.requestProvider=async(url,options,timeout,read)=>url.startsWith('https://api.deepseek.com')?read({json:async()=>({choices:[{message:{content:'{"primary":["fruit decay"]}'}}]})}):request(url,options,timeout,read);
 const Zotero={Research:E,Items:{getAll:async()=>[]},Libraries:{userLibraryID:1},addShutdownListener(){},Promise:{delay:async()=>{}}};
 vm.runInNewContext(source,{Zotero,ChromeUtils:{importESModule:url=>url.includes('workspace-outputs')?WorkspaceOutputs:url.includes('discovery-feed')?{...Feed,installDiscoveryFeed(){}}:{}}});
 const result=await E.searchPaperPage('水果腐败',{researchScope:{primaryKeyword:'水果腐败'},limit:20,domainMatch:'rank',queryExpansion:'off'});
 assert.equal(result.records.length,1);await Feed.checkDiscoveryPDFs(E,result.records,{onResult(){}});await new Promise(resolve=>setTimeout(resolve,450));
 assert.ok(written.has('paperSearchPages')&&written.has('discoveryTermTranslations'),'the recorder sees the cache writes');
 for(const branch of ['corpus','researchMaterials','materialCatalog','projects','papers'])assert.ok(!written.has(branch),'search wrote '+branch);
 assert.deepEqual([...written].filter(branch=>!['discoveryTermTranslations','discoveryQueryTranslations','paperSearchPages','discoveryPDFChecks','discoveryQueryExpansions'].includes(branch)),[],'only search caches are written');
});

test('checkDiscoveryPDFs probes each candidate in turn and skips an address that failed today',async()=>{
 const probed=[],E={store:{get:()=>({discoveryPDFFailures:{'https://bad.example/1.pdf':{at:Date.now()}}})},verifyDiscoveryPDF:async url=>{probed.push(url);return{available:url.includes('good'),checkedAt:1};},flushDiscoveryPDFChecks:async()=>{probed.push('flush');}};
 const rows=[{title:'a',pdf:'https://bad.example/1.pdf',pdfCandidates:['https://bad.example/1.pdf','https://good.example/1.pdf']},{title:'b',pdf:'https://other.example/2.pdf'},{title:'c',attachmentID:9}],states=new Map();
 await Feed.checkDiscoveryPDFs(E,rows,{onResult:(row,state)=>states.set(row.title,state)});
 assert.deepEqual(Object.fromEntries(states),{a:'available',b:'none',c:'available'});assert.equal(rows[0].pdf,'https://good.example/1.pdf');assert.equal(rows[0].pdfVerified,true);assert.ok(!probed.includes('https://bad.example/1.pdf'));assert.equal(probed.at(-1),'flush');
});
test('checkDiscoveryPDFs keeps why the checked addresses gave no file, for the result card',async()=>{
 const answers={'https://pub.example/a.pdf':{available:false,error:'出版社要求人机验证',transient:false},'https://repo.example/b.pdf':{available:false,error:'返回网页或验证页面（text/html）',transient:false}};
 const E={store:{get:()=>({})},verifyDiscoveryPDF:async url=>({...answers[url],checkedAt:1}),flushDiscoveryPDFChecks:async()=>{}};
 const rows=[{title:'a',pdf:'https://pub.example/a.pdf'},{title:'b',pdf:'https://repo.example/b.pdf'}];
 await Feed.checkDiscoveryPDFs(E,rows,{onResult(){}});
 assert.deepEqual(rows.map(row=>row.pdfStatus?.state),['access','landing']);assert.equal(rows[0].pdfStatus.label,'需要机构权限');
});
const uiSource=new URL('../../chrome/content/zotero/research/ui/discovery.js',import.meta.url),uiScript=new vm.Script(await readFile(uiSource,'utf8'),{filename:pathToFileURL(fileURLToPath(uiSource)).href,importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});
const node=(tag='div',text='',className='')=>({tag,textContent:text,className,value:'',checked:false,disabled:false,title:'',dataset:{},children:[],
 setAttribute(key,value){this[key]=String(value);},append(...children){for(const child of children){if(typeof child!=='object')continue;child.remove?.();child.parent=this;this.children.push(child);}},prepend(...children){for(const child of children.reverse()){child.remove?.();child.parent=this;this.children.unshift(child);}},
 replaceChildren(...children){this.children=[];this.append(...children);},insertBefore(child,before){child.remove?.();child.parent=this;const index=before?this.children.indexOf(before):-1;this.children.splice(index<0?this.children.length:index,0,child);},addEventListener(){},remove(){if(this.parent){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}},
 matches(selector){return selector.startsWith('.')&&this.className.split(' ').includes(selector.slice(1));},querySelector(selector){return this.querySelectorAll(selector)[0]||null;},querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);},
 get lastElementChild(){return this.children.at(-1);},get classList(){return{toggle(){}};}});
test('result cards show 可下载 PDF, 正在检查 PDF or 仅题录, update when the check settles, and 只显示可下载 hides a record without one',async()=>{
 const ui={},results=node(),state={settings:{}},checks=[];vm.createContext(ui);
 uiScript.runInContext(vm.createContext({EasySchUI:ui,AbortController,document:{querySelector:()=>null},window:{getSelection:()=>null},setTimeout,clearTimeout}));
 Object.assign(ui,{el:node,$:id=>id==='search-results'?results:null,status(){},pptButton(label,action,parent){const button=node('button',label);button.onclick=action;parent.append(button);return button;},agentDiscoveryPresentation:{discoveryPDFCandidate:()=>false},agentFilesTools:{setDiscoveryPaperDragData(){}},renderMarkdown(){},
  E:{store:{get:(...path)=>path.reduce((value,key)=>value?.[key],state),peek:(...path)=>path.reduce((value,key)=>value?.[key],state),update:async fn=>fn(state)},library:{},checkDiscoveryPDFs:async(rows,{onResult})=>{checks.push(...rows.map(row=>row.title));await null;for(const row of rows)onResult(row,row.title==='Remote'?'available':'none');}}});
 const rows=[{title:'Local',attachmentID:3,source:'OpenAlex'},{title:'Remote',pdf:'https://example.org/r.pdf',source:'OpenAlex'},{title:'Closed',pdf:'https://example.org/closed.pdf',source:'Crossref'},{title:'Metadata only',pdf:'',source:'Crossref'}];
 const label=title=>results.querySelectorAll('.discovery-paper').find(card=>card._discoveryRecord.title===title)?.querySelector('.discovery-pdf-state')?.textContent;
 ui.renderDiscovery(rows,{search:true});
 assert.equal(results.querySelectorAll('.discovery-paper').length,4,'every record is listed, the reference-pane PDF rule does not apply');
 assert.deepEqual(rows.map(row=>label(row.title)),['可下载 PDF','正在检查 PDF','正在检查 PDF','仅题录']);assert.deepEqual(checks,['Remote','Closed'],'only records with an address are checked');
 await new Promise(resolve=>setImmediate(resolve));assert.equal(label('Remote'),'可下载 PDF');assert.equal(label('Closed'),'仅题录');
 ui.discoveryPDFOnly={checked:true};ui.renderDiscovery(rows,{search:true});
 assert.deepEqual(results.querySelectorAll('.discovery-paper').map(card=>card._discoveryRecord.title),['Local','Remote']);assert.equal(checks.length,2,'a settled check is not repeated');
 // A check that reached the publisher names why there is no file, with the reason as the tooltip.
 ui.discoveryPDFOnly={checked:false};rows[2].pdfStatus={state:'access',label:'需要机构权限',reason:'出版社要求登录、机构订阅或人机验证'};ui.renderDiscovery(rows,{search:true});
 const closed=results.querySelectorAll('.discovery-paper').find(card=>card._discoveryRecord.title==='Closed').querySelector('.discovery-pdf-state');
 assert.equal(closed.textContent,'需要机构权限');assert.match(closed.title,/机构订阅/);
});
