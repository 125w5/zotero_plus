/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Feed from '../../chrome/content/zotero/research/shared/discovery-feed.mjs';
import {discoveryTopLabel,discoveryScanSummary,discoveryRelaxOptions,mergeDiscoveryScanStats,discoveryTopStatus,discoveryMetricFailure} from '../../chrome/content/zotero/research/shared/discovery-presentation.mjs';

const metricsSource=await readFile(new URL('../../chrome/content/zotero/xpcom/research/metrics-provider.js',import.meta.url),'utf8');
// metrics-provider.js on a plain store; without timers every write commits at once.
// win stands in for the main window that readJournalRank fetches through.
function metricsProvider({key='controlled-key',snapshots={},win=null}={}){
 const state={journalMetricSnapshots:snapshots},reads=[],credentials={value:key,get:async()=>{reads.push('get');return credentials.value;},set:async(_origin,value)=>{credentials.value=value;}};
 const R={store:{get:(...path)=>path.reduce((value,name)=>value?.[name],state),update:async fn=>fn(state)},metrics:new Map(),credentials,issn:item=>item.issn,refreshTrees(){}};
 vm.runInNewContext(metricsSource,{URL,Zotero:{Research:R,addShutdownListener(){},logError(){},getMainWindow:()=>win}});
 return{R,state,reads,credentials};
}
const journalItem=(journal,issn='')=>({issn,isRegularItem:()=>true,getField:key=>key==='publicationTitle'?journal:''});

test('easyScholar TOP categories such as 化学TOP become reported TOP; a CAS rank without TOP is not TOP',async()=>{
 const {R}=metricsProvider();
 // officialRank.all as easyScholar returns it: sciUpTop appears only for CAS TOP journals.
 R.readJournalRank=async journal=>({'Chem Top':{sciif:'7.1',sci:'Q1',sciUp:'化学1区',sciUpTop:'化学TOP'},'Materials':{sciif:'3.2',sci:'Q2',sciUp:'材料科学2区'},'Unranked':{sciif:'1.5'},'Top No IF':{sciUp:'地球科学1区',sciUpTop:'地球科学TOP'},'Nothing':{ccf:'C'}}[journal]);
 const top=await R.ensurePaperMetrics(journalItem('Chem Top','11112222'));
 assert.equal(top.top_status,'reported');assert.equal(top.cas_top,'化学TOP');assert.equal(top.cas_large_category,'化学1区');assert.equal(top.metric_year,null);assert.equal(top.impact_factor,7.1);
 assert.equal(discoveryTopStatus(top),'reported','undated easyScholar TOP passes the TOP filter as reported');
 assert.equal((await R.ensurePaperMetrics(journalItem('Materials','22223333'))).top_status,'not-top');
 assert.equal((await R.ensurePaperMetrics(journalItem('Unranked','33334444'))).top_status,'unknown','no CAS rank says nothing about TOP');
 const noIF=await R.ensurePaperMetrics(journalItem('Top No IF','44445555'));
 assert.equal(noIF.impact_factor,null,'a TOP journal without an SCI IF keeps its TOP record');assert.equal(noIF.top_status,'reported');assert.equal(R.metricStatus(journalItem('Top No IF','44445555')),'期刊暂无可用 IF');
 assert.equal(await R.ensurePaperMetrics(journalItem('Nothing','55556666')),undefined);assert.equal(R.metricStatus(journalItem('Nothing','55556666')),'期刊暂无可用 IF');
});

test('a snapshot saved before TOP was parsed is asked once more only when a TOP filter needs it',async()=>{
 const old={at:new Date().toISOString(),metric:{issn:'11112222',journal:'Chem Top',impact_factor:7.1,cas_top:'化学TOP',metric_year:null,source:'easyScholar 当前返回（年份未标明）'}};
 const {R}=metricsProvider({snapshots:{'11112222':old}});let lookups=0;R.readJournalRank=async()=>{lookups++;return{sciif:'7.1',sciUp:'化学1区',sciUpTop:'化学TOP'};};
 assert.equal((await R.ensurePaperMetrics(journalItem('Chem Top','11112222'))).top_status,undefined);assert.equal(lookups,0,'other callers keep the cached entry');
 assert.equal((await R.ensurePaperMetrics(journalItem('Chem Top','11112222'),{needTop:true})).top_status,'reported');assert.equal(lookups,1);
 await R.ensurePaperMetrics(journalItem('Chem Top','11112222'),{needTop:true});assert.equal(lookups,1,'the refreshed entry is reused');
});

test('lookup availability reads the password store once per short window and is reset when a key is saved',async()=>{
 const {R,reads,credentials}=metricsProvider({key:''});
 assert.equal(await R.journalMetricsAvailable(),false);assert.equal(await R.journalMetricsAvailable(),false);assert.equal(reads.length,1);
 await R.saveMetricsKey('new-key');assert.equal(credentials.value,'new-key');assert.equal(await R.journalMetricsAvailable(),true);assert.equal(reads.length,2);
});

test('the newest dated saved record overrides an undated easyScholar TOP, and both name their source',()=>{
 const snapshots={'11112222':{metric:{issn:'11112222',impact_factor:7.1,cas_top:'化学TOP',top_status:'reported',metric_year:null,source:'easyScholar 当前返回（年份未标明）'}}};
 const reported=Feed.enrichDiscoveryRecord({title:'A',issn:'1111-2222',pdf:'https://example.org/a.pdf'},{metrics:new Map(),store:{get:key=>key==='journalMetricSnapshots'?snapshots:{}}});
 assert.equal(reported.metrics.topStatus,'reported');assert.equal(discoveryTopLabel(reported).text,'化学TOP · easyScholar（年份未标明）');
 const saved=new Map([['11112222',[{issn:'11112222',metric_year:2025,source:'https://jcr.example.org/journal',impact_factor:7.4,cas_top:'非TOP'}]]]);
 const corrected=Feed.enrichDiscoveryRecord({title:'A',issn:'1111-2222',pdf:'https://example.org/a.pdf'},{metrics:saved,store:{get:key=>key==='journalMetricSnapshots'?snapshots:{}}});
 assert.equal(corrected.metrics.topStatus,'not-top','a dated user correction wins');assert.equal(corrected.metrics.impactFactor,7.4);
 const verified=Feed.enrichDiscoveryRecord({title:'A',issn:'1111-2222',pdf:'https://example.org/a.pdf'},{metrics:new Map([['11112222',[{issn:'11112222',metric_year:2024,source:'https://jcr.example.org/journal',impact_factor:7.4,cas_top:'TOP'}]]]),store:{get:()=>({})}});
 assert.equal(verified.metrics.topStatus,'verified');assert.equal(discoveryTopLabel(verified).text,'TOP · 2024 · jcr.example.org');
});

const words=text=>Object.fromEntries(text.split(' ').reduce((map,word,index)=>map.set(word,[...(map.get(word)||[]),index]),new Map()));
const work=(id,{issn,journal,cited=1})=>({id:'https://openalex.org/W'+id,title:'Solute transport through macropore networks '+id,publication_date:'2025-05-01',cited_by_count:cited,abstract_inverted_index:words('Measured solute transport in macropore soil columns'),primary_location:{source:{id:'https://openalex.org/S'+id,display_name:journal,type:'journal',issn_l:issn},is_oa:true,pdf_url:'https://example.org/'+id+'.pdf'},best_oa_location:{is_oa:true,pdf_url:'https://example.org/'+id+'.pdf'},authorships:[]});
const SCOPE={domain:'earth-environment',primaryKeyword:'solute transport',secondaryKeyword:'macropore',fuzzy:true};
const FILTERS={journalOnly:true,topOnly:true,sort:'citations',years:'5'};
// The user's filters: TOP needs metrics for journals that have no card yet.
function feed({available=true}={}){
 const state={},lookups=[],requests=[],records={'11112222':{cas_top:'化学TOP',top_status:'reported'},'22223333':{cas_large_category:'材料科学2区',top_status:'not-top'}};
 const E={store:{get:(...path)=>path.reduce((value,name)=>value?.[name],state),update:async fn=>fn(state)},verifyDiscoveryPDF:async()=>({available:true,checkedAt:Date.now()}),
  requestProvider:async url=>{requests.push(new URL(url));return JSON.stringify({results:[work(1,{issn:'1111-2222',journal:'Chem Top',cited:50}),work(2,{issn:'2222-3333',journal:'Materials',cited:30}),work(3,{issn:'3333-4444',journal:'No Record',cited:10})],meta:{count:3,next_cursor:null}});},
  journalMetricsAvailable:async()=>available,
  candidateMetric:async(record,options)=>{lookups.push({journal:record.journal,needTop:options?.needTop});const key=record.issn.replace('-','');const found=records[key];if(!found)return null;const metric={issn:key,journal:record.journal,impact_factor:5,metric_year:null,source:'easyScholar 当前返回（年份未标明）',...found};state.journalMetricSnapshots={...(state.journalMetricSnapshots||{}),[key]:{at:new Date().toISOString(),metric}};return metric;}};
 Feed.installDiscoveryFeed(E,{Zotero:{Items:{getAll:async()=>[]},Libraries:{userLibraryID:1}}});return{E,state,lookups,requests};
}

test('已核验顶刊 looks up the candidate journals before filtering and reports unknown journals separately',async()=>{
 const {E,lookups,requests}=feed();
 const result=await E.recommendationFeed({mode:'latest',query:'solute transport',researchScope:SCOPE,filters:FILTERS,limit:40,fillPage:true,domainMatch:'rank',scanBudget:{batches:10,ms:20000}});
 assert.deepEqual(result.records.map(row=>row.journal),['Chem Top']);assert.equal(result.records[0].metrics.topStatus,'reported');
 assert.equal(lookups.length,3,'one bounded lookup per candidate journal');assert.ok(lookups.every(row=>row.needTop===true));
 assert.deepEqual(result.scan.removed,{notTop:1,topUnknown:1});assert.equal(result.scan.metricLookup,'ok');assert.equal(result.scan.relax.topUnknown,1);assert.equal(result.scan.relax.top,2);
 assert.match(requests[0].searchParams.get('filter'),/^title_and_abstract\.search:solute transport macropore,/,'citations sort matches title and abstract');assert.equal(requests[0].searchParams.has('search'),false);assert.doesNotMatch(requests[0].searchParams.get('filter'),/earth/,'a ranked domain is not a required word');
 assert.equal(discoveryScanSummary(result.scan),'已扫描 3 篇：非 TOP 期刊 1 篇，期刊 TOP 未核验 1 篇');
 assert.deepEqual(discoveryRelaxOptions(result.scan).map(row=>row.label),['取消顶刊 +2','包含未核验期刊 +1']);
 const included=await E.recommendationFeed({mode:'latest',query:'solute transport',researchScope:SCOPE,filters:{...FILTERS,includeUnverified:true},limit:40,fillPage:true,domainMatch:'rank'});
 assert.deepEqual(included.records.map(row=>row.journal),['Chem Top','No Record']);assert.equal(discoveryTopLabel(included.records[1]).text,'期刊 TOP 未核验');assert.equal(lookups.length,3,'a journal without a record is not asked again at once');
});

test('without an easyScholar key the TOP filter says so instead of silently returning nothing',async()=>{
 const {E,lookups}=feed({available:false});
 const result=await E.recommendationFeed({mode:'latest',query:'solute transport',researchScope:SCOPE,filters:FILTERS,limit:40,fillPage:true,domainMatch:'rank'});
 assert.equal(result.records.length,0);assert.equal(lookups.length,0);assert.equal(result.scan.metricLookup,'no-key');assert.equal(result.scan.removed.topUnknown,3);
 assert.ok(result.limitations.some(note=>/未配置 easyScholar 密钥/.test(note)&&/包含未核验期刊/.test(note)));
});

test('scan counts from several rounds add up and only the filters that removed papers are named',()=>{
 const merged=mergeDiscoveryScanStats({scanned:40,total:100,removed:{keywords:38,pdf:1},relax:{}},{scanned:20,total:100,removed:{keywords:17,topUnknown:3},relax:{topUnknown:3,top:3}});
 assert.equal(discoveryScanSummary(merged),'已扫描 60/100 篇：题名与摘要缺少关键词 55 篇，期刊 TOP 未核验 3 篇，无公开 PDF 1 篇');
 assert.deepEqual(discoveryRelaxOptions({relax:{domain:15,top:3}}).map(row=>row.id),['top'],'domain is a ranking signal unless strict matching is on');
 assert.deepEqual(discoveryRelaxOptions({relax:{domain:15,top:3}},{strictDomain:true}).map(row=>row.label),['领域改为排序 +15','取消顶刊 +3']);
 const sources=mergeDiscoveryScanStats({metricLookup:'failed',metricFailed:2},{metricLookup:'ok',metricFailed:0},{metricLookup:'failed',metricFailed:1});
 assert.equal(sources.metricLookup,'failed','a later successful source does not hide a failed lookup');assert.equal(sources.metricFailed,3);
 assert.equal(mergeDiscoveryScanStats({metricLookup:'failed',metricFailed:1},{metricLookup:'no-key'}).metricLookup,'no-key');
 assert.equal(discoveryMetricFailure(sources),'easyScholar 查询未成功（3 本期刊），请检查设置中的密钥或稍后重试');assert.equal(discoveryMetricFailure({metricLookup:'ok'}),'');
});

// readJournalRank answers through the main window's fetch.
const easyScholarWindow=reply=>({AbortController,setTimeout,clearTimeout,fetch:async()=>reply()});
test('readJournalRank tells a journal without a record apart from a failed request',async()=>{
 const json=(body,status=200)=>()=>({ok:status===200,status,json:async()=>body});
 const answer=async reply=>{const {R}=metricsProvider({win:easyScholarWindow(reply)});return R.readJournalRank('Soil Journal');};
 assert.deepEqual(await answer(json({code:200,msg:'SUCCESS',data:{officialRank:{all:{sciif:'6.4',sciUp:'农林科学1区',sciUpTop:'农林科学TOP'}}}})),{sciif:'6.4',sciUp:'农林科学1区',sciUpTop:'农林科学TOP'});
 assert.equal(await answer(json({code:200,msg:'SUCCESS',data:{officialRank:{all:{}}}})),null,'easyScholar answered and has no record');
 assert.equal(await answer(json({code:200,msg:'SUCCESS',data:{}})),null);
 // A reply whose code is not 200, an HTTP error and a network error are failed requests.
 for(const reply of [json({code:401,msg:'refused',data:null}),json({},503),()=>{throw Error('offline');}])await assert.rejects(answer(reply),/查询未成功/);
});

test('a failed TOP refresh keeps the cached IF and its age, and is not asked again for 5 min',async()=>{
 const hourAgo=new Date(Date.now()-3600000).toISOString(),cached={at:hourAgo,metric:{issn:'11112222',journal:'Soil Journal',impact_factor:6.4,cas_top:null,metric_year:null,source:'easyScholar 当前返回（年份未标明）'}};
 const {R,state}=metricsProvider({snapshots:{'11112222':cached}});let lookups=0;R.readJournalRank=async()=>{lookups++;throw Error('HTTP 503');};
 const kept=await R.ensurePaperMetrics(journalItem('Soil Journal','11112222'),{needTop:true});
 assert.equal(lookups,1);assert.equal(kept.impact_factor,6.4,'the cached IF is still served');
 const saved=state.journalMetricSnapshots['11112222'];assert.equal(saved.kind,'failed');assert.equal(saved.metric.impact_factor,6.4,'the saved snapshot keeps its metric');assert.equal(saved.metricAt,hourAgo,'the metric keeps its own age');
 assert.equal((await R.ensurePaperMetrics(journalItem('Soil Journal','11112222'),{needTop:true})).impact_factor,6.4);assert.equal(lookups,1,'a failed request waits 5 min');
 assert.equal((await R.ensurePaperMetrics(journalItem('Soil Journal','11112222'))).impact_factor,6.4);assert.equal(lookups,1);
});

test('an entry saved before a key existed does not wait once a key exists, and saving a key drops the lookup errors',async()=>{
 const recent=new Date(Date.now()-60000).toISOString();
 const snapshots={'11112222':{at:recent,error:'IF 需配置 easyScholar',kind:'no-key'},'22223333':{at:recent,error:'影响因子查询未成功；原有题录保留',kind:'failed'},'33334444':{at:recent,error:'影响因子查询未成功；原有题录保留',kind:'failed',metric:{issn:'33334444',journal:'Kept',impact_factor:4.2,source:'easyScholar 当前返回（年份未标明）'},metricAt:recent},'44445555':{at:recent,error:'期刊暂无可用 IF',kind:'miss'}};
 const {R,state}=metricsProvider({key:'',snapshots});let lookups=0;R.readJournalRank=async()=>{lookups++;return{sciif:'5',sciUp:'地球科学1区',sciUpTop:'地球科学TOP'};};
 assert.equal(await R.ensurePaperMetrics(journalItem('No Key Yet','11112222'),{needTop:true}),undefined);assert.equal(lookups,0,'without a key the entry waits');
 const generation=R.journalMetricKeyGeneration;await R.saveMetricsKey('new-key');assert.equal(R.journalMetricKeyGeneration,generation+1);
 assert.deepEqual(Object.keys(state.journalMetricSnapshots),['33334444'],'errors recorded under the old key are dropped');
 assert.equal(state.journalMetricSnapshots['33334444'].error,undefined);assert.equal(state.journalMetricSnapshots['33334444'].metric.impact_factor,4.2,'a kept metric stays');
 assert.equal((await R.ensurePaperMetrics(journalItem('No Key Yet','11112222'),{needTop:true})).top_status,'reported');assert.equal(lookups,1,'the next lookup asks easyScholar');
 // An entry from before this version names the missing key only in its text.
 const legacy=metricsProvider({snapshots:{'55556666':{at:recent,error:'IF 需配置 easyScholar'}}});let asked=0;legacy.R.readJournalRank=async()=>{asked++;return{sciif:'2',sciUp:'化学3区'};};
 assert.equal((await legacy.R.ensurePaperMetrics(journalItem('Legacy','55556666'))).impact_factor,2);assert.equal(asked,1);
});

test('a failed easyScholar lookup is reported as failed, apart from journals without a record, and a fixed key is used at once',async()=>{
 const {R,state}=metricsProvider();let failing=true,asked=0;
 R.readJournalRank=async journal=>{asked++;if(failing)throw Error('HTTP 503');return{'Chem Top':{sciif:'7.1',sciUp:'化学1区',sciUpTop:'化学TOP'},'Materials':{sciif:'3.2',sciUp:'材料科学2区'}}[journal]||null;};
 const E=Object.assign(R,{verifyDiscoveryPDF:async()=>({available:true,checkedAt:Date.now()}),
  requestProvider:async()=>JSON.stringify({results:[work(1,{issn:'1111-2222',journal:'Chem Top',cited:50}),work(2,{issn:'2222-3333',journal:'Materials',cited:30}),work(3,{issn:'3333-4444',journal:'No Record',cited:10})],meta:{count:3,next_cursor:null}}),
  candidateMetric:(record,options)=>R.ensurePaperMetrics(journalItem(record.journal,String(record.issn||'').replace('-','')),options)});
 Feed.installDiscoveryFeed(E,{Zotero:{Items:{getAll:async()=>[]},Libraries:{userLibraryID:1}}});
 const search=()=>E.recommendationFeed({mode:'latest',query:'solute transport',researchScope:SCOPE,filters:FILTERS,limit:40,fillPage:true,domainMatch:'rank',scanBudget:{batches:10,ms:20000},refresh:true});
 const first=await search();
 assert.equal(first.records.length,0);assert.equal(first.scan.metricLookup,'failed');assert.equal(first.scan.metricFailed,3);assert.equal(first.scan.removed.topUnknown,3);
 assert.equal(discoveryMetricFailure(first.scan),'easyScholar 查询未成功（3 本期刊），请检查设置中的密钥或稍后重试');assert.equal(state.journalMetricSnapshots['11112222'].kind,'failed');
 failing=false;await R.saveMetricsKey('fixed-key');
 const second=await search();
 assert.equal(asked,6,'every journal is asked again after the key is saved');assert.deepEqual(second.records.map(row=>row.journal),['Chem Top']);
 assert.equal(second.scan.metricLookup,'ok');assert.equal(second.scan.metricFailed,0);assert.deepEqual(second.scan.removed,{notTop:1,topUnknown:1},'a journal without a record stays unknown, not failed');assert.equal(discoveryMetricFailure(second.scan),'');
});

test('with 包含未核验期刊 a page whose lookup failed is not served from the cache once the key is fixed',async()=>{
 const {R}=metricsProvider();let failing=true,requests=0;
 R.readJournalRank=async journal=>{if(failing)throw Error('HTTP 503');return{'Chem Top':{sciif:'7.1',sciUp:'化学1区',sciUpTop:'化学TOP'},'Materials':{sciif:'3.2',sciUp:'材料科学2区'}}[journal]||null;};
 const E=Object.assign(R,{verifyDiscoveryPDF:async()=>({available:true,checkedAt:Date.now()}),
  requestProvider:async()=>{requests++;return JSON.stringify({results:[work(1,{issn:'1111-2222',journal:'Chem Top',cited:50}),work(2,{issn:'2222-3333',journal:'Materials',cited:30}),work(3,{issn:'3333-4444',journal:'No Record',cited:10})],meta:{count:3,next_cursor:null}});},
  candidateMetric:(record,options)=>R.ensurePaperMetrics(journalItem(record.journal,String(record.issn||'').replace('-','')),options)});
 Feed.installDiscoveryFeed(E,{Zotero:{Items:{getAll:async()=>[]},Libraries:{userLibraryID:1}}});
 const search=()=>E.recommendationFeed({mode:'latest',query:'solute transport',researchScope:SCOPE,filters:{...FILTERS,includeUnverified:true},limit:40,fillPage:true,domainMatch:'rank',scanBudget:{batches:10,ms:20000}});
 const first=await search();assert.equal(first.records.length,3,'unverified journals are shown');assert.equal(first.scan.metricLookup,'failed');
 failing=false;await R.saveMetricsKey('fixed-key');
 const second=await search();assert.equal(requests,2,'the failed page is fetched again');assert.equal(second.cacheHit,false);assert.equal(second.scan.metricLookup,'ok');assert.deepEqual(second.records.map(row=>row.journal),['Chem Top','No Record']);
 const third=await search();assert.equal(requests,2,'a page whose lookup worked is reused');assert.equal(third.cacheHit,true);
});

test('the impact sort without the TOP filter returns without waiting for journal lookups',async()=>{
 const {E,lookups}=feed();
 const result=await E.recommendationFeed({mode:'latest',query:'solute transport',researchScope:SCOPE,filters:{journalOnly:true,sort:'impact',years:'5'},limit:40,fillPage:true,domainMatch:'rank',scanBudget:{batches:10,ms:20000}});
 assert.equal(lookups.length,0,'no lookup before the result; card labels load lazily');assert.equal(result.records.length,3);assert.equal(result.scan.metricLookup,'');
});
