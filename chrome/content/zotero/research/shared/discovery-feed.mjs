/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {abstractExcerpt} from './paper-overview-data.mjs';
import {prepareDiscoveryQuery,matchesPreparedDiscoveryScope,discoveryScopeVerdict,discoveryDomainMatch,removeDiscoveryQueryTerm,academicDiscoveryTerms,machineDiscoveryTerms,discoveryTextRelevance} from './discovery-query.mjs';
export {prepareDiscoveryQuery,matchesPreparedDiscoveryScope} from './discovery-query.mjs';
import {discoveryDateFilters,discoveryDateRange,matchesDiscoveryDate} from './discovery-dates.mjs';
import {discoveryContinuation,parseDiscoveryContinuation,discoverySourceScope,matchDiscoverySource,crossrefFeedRecord,europePMCFeedRecord,crossrefFeedURL,europePMCFeedURL,discoveryArxivID,DISCOVERY_INDEX_LABELS,createDiscoveryMergePool,rankDiscoveryEntries,semanticSearchURL,semanticFeedRecord,arxivFeedRecord,crossrefSearchURL,coreSearchURL,coreFeedRecord,springerSearchURL,springerFeedRecord} from './discovery-providers.mjs';
import {pdfCandidateURLs} from './discovery-pdf.mjs';
import {pdfStatus} from './pdf-status.mjs';
import {normalizeResearchScope,buildResearchQuery,matchesResearchScope} from './research-domain.mjs';
import {installJournalSubscriptions} from './discovery-journals.mjs';
import {discoveryBranch,discoveryView,installDiscoveryPDF,verifiedDiscoveryRecords,createStoreBranchWriter} from './discovery-pdf.mjs';
export {verifiedDiscoveryRecords,discoveryBranch,createStoreBranchWriter} from './discovery-pdf.mjs';
import {createDiscoverySearchRunner} from './discovery-search-task.mjs';
import {sortDiscoveryRecords,discoveryTopStatus} from './discovery-presentation.mjs';
export {discoveryTopStatus,mergeDiscoveryScanStats} from './discovery-presentation.mjs';
export {installJournalSubscriptionTimer} from './discovery-journals.mjs';
export {normalizeResearchScope,buildResearchQuery,matchesResearchScope} from './research-domain.mjs';
export {discoveryDateRange} from './discovery-dates.mjs';

export const DISCOVERY_DISCIPLINES=[
 ['engineering','工程技术','Engineering'],['information','信息科学','Computer science'],['materials','材料科学','Materials science'],
 ['chemistry','化学','Chemistry'],['life','生命科学','Biology'],['math','数学','Mathematics'],['physics','物理','Physics'],
 ['earth','地球科学','Earth sciences'],['medicine','医学','Medicine'],['psychology','心理学','Psychology']
].map(([id,label,query])=>({id,label,query}));
export function discoveryPreferences(value={}){
 return {topics:[...new Set((value.topics||[]).filter(t=>typeof t==='string'&&t.trim()).map(t=>t.trim().slice(0,300)))].slice(0,30),
  disciplineIDs:[...new Set((value.disciplineIDs||[]).filter(id=>DISCOVERY_DISCIPLINES.some(d=>d.id===id)))],
  sources:(value.sources||[]).filter(s=>/^https:\/\/openalex\.org\/S\d+$/.test(s?.id)&&typeof s.name==='string').map(s=>({id:s.id,name:s.name,kind:s.kind||'journal',...(s.issn?{issn:String(s.issn)}:{})})).slice(0,30),activeTopic:String(value.activeTopic||'').slice(0,300)};
}
// The same rule as openalexPDF in reference-metadata.mjs: only an open-access copy gives
// the PDF. primary_location is the version of record, and its pdf_url can be the
// paywalled publisher file; the landing page and journal may still come from it.
const openAlexPDF=p=>{
 const location=[p.best_oa_location,p.primary_location,...(p.locations||[])].find(x=>/^https:\/\//i.test(x?.pdf_url||'')&&(x===p.best_oa_location?x.is_oa!==false:x.is_oa));
 return location?.pdf_url||(p.open_access?.is_oa!==false&&/^https:\/\/.+\.pdf(?:[?#]|$)/i.test(p.open_access?.oa_url||'')?p.open_access.oa_url:'');
};
export function openAlexFeedRecord(p){
 const words=[];for(const[word,positions]of Object.entries(p.abstract_inverted_index||{}))for(const i of positions)words[i]=word;
 const locations=[p.best_oa_location,p.primary_location,...(p.locations||[])],location=locations.find(l=>l?.pdf_url&&/^https:\/\//i.test(l.pdf_url)&&(l.is_oa===true||l===p.best_oa_location))||p.best_oa_location||p.primary_location,source=p.primary_location?.source||location?.source;
 const arxiv=locations.map(row=>discoveryArxivID(row?.landing_page_url)||discoveryArxivID(row?.pdf_url)).find(Boolean)||discoveryArxivID(p.doi),pmcid=String(p.ids?.pmcid||'').match(/PMC\d+/i)?.[0]||locations.map(row=>String(row?.landing_page_url||'').match(/\/pmc\/articles\/(PMC\d+)/i)?.[1]).find(Boolean);
 return{id:p.id,openalexId:String(p.id||'').split('/').at(-1),...(arxiv?{arxiv}:{}),...(pmcid?{pmcid:pmcid.toUpperCase()}:{}),title:p.title||p.display_name,abstract:words.join(' '),topicIDs:[...new Set([p.primary_topic?.id,...(p.topics||[]).map(row=>row.id)].filter(Boolean))],keywords:(p.keywords||[]).map(row=>row.display_name).filter(Boolean).slice(0,8),doi:(p.doi||'').replace(/^https?:\/\/doi.org\//,''),url:location?.landing_page_url||p.doi||p.id,pdf:openAlexPDF(p),pdfCandidates:[...new Set(locations.filter(row=>row?.is_oa&&/^https:\/\//i.test(row.pdf_url||'')).map(row=>row.pdf_url))],journal:source?.display_name||'',issn:source?.issn_l||'',sourceID:source?.id||'',sourceName:source?.display_name||'',sourceType:source?.type||'',source:'OpenAlex',date:p.publication_date||String(p.publication_year||''),citationCount:p.cited_by_count??null,oa:p.open_access?.is_oa===true||location?.is_oa===true||!!p.best_oa_location,retracted:p.is_retracted===true,authors:(p.authorships||[]).map(a=>({lastName:a.author?.display_name||'',fieldMode:1}))};
}
// pdfOnly: only rows with a public PDF. Callers that do not say keep the
// former PDF-only results; the literature search page passes false.
export function discoveryFilters(value={}){
 return{pdfOnly:value.pdfOnly!==false,journalOnly:value.journalOnly===true,sourceIDs:[...new Set((value.sourceIDs||[]).map(id=>String(id).replace(/^https:\/\/openalex\.org\//,'')).filter(id=>/^S\d+$/.test(id)))],topOnly:value.topOnly===true,...(value.topOnly===true&&value.includeUnverified===true?{includeUnverified:true}:{}),sort:['impact','citations','date','relevance'].includes(value.sort)?value.sort:'',...discoveryDateFilters(value)};
}
export function discoveryPDFAvailable(row){return !row.retracted&&(!row.pdfUnavailable||row.localPDF===true||!!row.attachmentID)&&(!!row.attachmentID||row.localPDF===true||/^https:\/\//i.test(String(row.pdf||'')));}
// The metrics provider writes new journal metrics in batches. Overlay the
// entries it has not committed yet so a TOP or IF filter sees them at once.
function journalMetricSnapshots(E){let saved=discoveryView(E,'journalMetricSnapshots'),pending=E.pendingJournalMetrics?.();return pending&&Object.keys(pending).length?{...saved,...pending}:saved;}
export const discoveryJournalKey=record=>{const issn=String(record.issn||'').replace(/-/g,'').toUpperCase();return issn||'journal:'+String(record.journal||'').normalize('NFKC').toLowerCase().trim();};
export function discoveryMetric(record,E,snapshots=journalMetricSnapshots(E)){
 const issn=String(record.issn||'').replace(/-/g,'').toUpperCase(),journal='journal:'+String(record.journal||'').normalize('NFKC').toLowerCase().trim(),saved=[...(E.metrics?.get?.(issn)||[]),snapshots[issn]?.metric,snapshots[journal]?.metric].filter(m=>m&&typeof m.source==='string'&&m.source.trim());
 // OpenAlex's two-year mean citations is not an impact factor. Only the
 // user's saved metric records or the existing journal provider cache count.
 // IF and TOP are chosen separately: a TOP-only lookup must not hide a dated IF.
 const year=m=>Number(m.metric_year)||0,valid=m=>m.impact_factor!==''&&m.impact_factor!=null&&Number.isFinite(Number(m.impact_factor))&&Number(m.impact_factor)>=0;
 // The newest dated TOP record wins, so a saved non-TOP correction overrides an
 // undated easyScholar TOP; records of the same year keep their order.
 const impactMetric=[...saved].sort((a,b)=>year(b)-year(a)).find(valid),topMetric=saved.map(m=>({m,status:discoveryTopStatus(m)})).filter(row=>row.status!=='unknown').sort((a,b)=>year(b.m)-year(a.m))[0];
 if(!impactMetric&&!topMetric)return null;
 const base=impactMetric||topMetric.m,impact=impactMetric?Number(impactMetric.impact_factor):null,topStatus=topMetric?.status||'unknown';
 return{...base,impact_factor:impact,metric_year:impactMetric?impactMetric.metric_year||null:null,cas_top:topMetric?.m.cas_top??base.cas_top??null,top_status:topStatus,top_source:topMetric?.m.source||'',top_year:topStatus==='verified'?topMetric.m.top_year||topMetric.m.metric_year:null,top:topStatus==='verified'||topStatus==='reported'};
}
export function discoveryEnrichment(E){return {metrics:journalMetricSnapshots(E),failures:discoveryView(E,'discoveryPDFFailures')};}
export function enrichDiscoveryRecord(row,E,snapshot=discoveryEnrichment(E)){const failure=snapshot.failures[row.pdf],metric=discoveryMetric(row,E,snapshot.metrics),record={...row,pdfUnavailable:!!failure&&Date.now()-failure.at<86400000};return metric?{...record,metric,metrics:{impactFactor:metric.impact_factor,year:metric.metric_year,source:metric.source,top:metric.top,topStatus:metric.top_status,topSource:metric.top_source,topYear:metric.top_year}}:record;}
// TOP from a saved record: 'verified', 'reported', 'not-top' or 'unknown'.
const rowTopStatus=row=>row.metrics?.topStatus||(row.metrics?.top===true?'reported':'unknown');
// Every filter a row fails, so counts can name what removed it.
export function discoveryRowFlags(row,filters){
 const flags=[];if(filters.pdfOnly!==false&&!discoveryPDFAvailable(row))flags.push('pdf');if(!matchesDiscoveryDate(row,filters))flags.push('date');if(filters.journalOnly&&row.sourceType!=='journal')flags.push('journal');if(filters.sourceIDs.length&&!filters.sourceIDs.includes(String(row.sourceID||'').split('/').at(-1)))flags.push('source');
 if(filters.topOnly){const status=rowTopStatus(row);if(status==='not-top')flags.push('notTop');else if(status!=='verified'&&status!=='reported')flags.push('topUnknown');}
 return flags;
}
const unverifiedRow=row=>row.metrics?.topUnverified?row:{...row,metrics:{...(row.metrics||{}),topUnverified:true}};
export function applyDiscoveryFilters(rows,value={}){
 const filters=discoveryFilters(value),result=[];
 for(const row of rows){const flags=discoveryRowFlags(row,filters);if(!flags.length)result.push(row);else if(filters.includeUnverified&&flags.length===1&&flags[0]==='topUnknown')result.push(unverifiedRow(row));}
 return sortDiscoveryRecords(result,filters.sort);
}
// Eligible rows, the first filter that removed each other row (so the counts
// add up to what was scanned), and what dropping one filter would add back.
export function discoveryFilterTally(rows,value={}){
 const filters=discoveryFilters(value),eligible=[],removed={},relax={},single={date:'date',journal:'journal',source:'source',topUnknown:'topUnknown'};
 for(const row of rows){
  const flags=discoveryRowFlags(row,filters),allowed=filters.includeUnverified&&flags.length===1&&flags[0]==='topUnknown';
  if(!flags.length||allowed){eligible.push(allowed?unverifiedRow(row):row);continue;}
  removed[flags[0]]=(removed[flags[0]]||0)+1;
  if(flags.every(flag=>flag==='notTop'||flag==='topUnknown'))relax.top=(relax.top||0)+1;
  if(flags.length===1&&single[flags[0]])relax[single[flags[0]]]=(relax[single[flags[0]]]||0)+1;
 }
 return{eligible,removed,relax};
}
// One provider batch before the journal filters: dedupe, then the scope
// verdict. Off-scope rows are counted by reason; kept rows carry the domain
// ranking signal when the search names a domain.
export function screenDiscoveryRows(raw,{name='openalex',sources=[],seen=new Set(),prepared,stats,choice,E,snapshot=discoveryEnrichment(E)}){
 const rows=[],ranks=prepared.domainMatch==='rank'||prepared.domainMatch==='strict';
 for(const item of raw){
  const row=name==='openalex'?item:matchDiscoverySource(item,sources);if(!row)continue;const id=String(row.doi||row.url||row.id).toLowerCase();if(!row.title||!id||seen.has(id)||row.retracted)continue;seen.add(id);stats.scanned++;
  const verdict=discoveryScopeVerdict(row,prepared);if(verdict==='excluded'||verdict==='keywords'){stats.removed[verdict]=(stats.removed[verdict]||0)+1;continue;}
  const enriched=enrichDiscoveryRecord(row,E,snapshot);
  if(verdict==='domain'){stats.removed.domain=(stats.removed.domain||0)+1;if(!discoveryRowFlags(enriched,choice).length)stats.relax.domain=(stats.relax.domain||0)+1;continue;}
  stats.matched++;rows.push(ranks?{...enriched,domainMatch:discoveryDomainMatch(row,prepared)}:enriched);
 }
 return rows;
}
// Library fallback terms: Latin words of any length, and each Chinese run as
// itself plus its two-character pieces, since Chinese has no spaces.
export function discoveryLocalTerms(query){
 const terms=new Set();
 for(const token of String(query||'').normalize('NFKC').toLowerCase().split(/[\s,，;；、。:：()（）"“”]+/).filter(Boolean)){
  for(const run of token.match(/\p{Script=Han}+/gu)||[]){terms.add(run);if(run.length>2)for(let i=0;i<run.length-1;i++)terms.add(run.slice(i,i+2));}
  for(const word of token.replace(/\p{Script=Han}+/gu,' ').split(' '))if(/[\p{L}\p{N}]/u.test(word))terms.add(word);
 }
 return [...terms];
}
export const discoveryLocalScore=(text,terms)=>{const haystack=String(text||'').normalize('NFKC').toLowerCase();return terms.reduce((sum,term)=>sum+(haystack.includes(term)?term.length>2?2:1:0),0);};
// Background check of the shown page with the probe that verifiedDiscoveryRecords
// uses, a few rows at a time. onResult(row,'available'|'none') as each settles;
// an address that failed in the last day is not probed again.
export async function checkDiscoveryPDFs(E,rows,{signal,concurrency=4,flush=true,onResult=()=>{}}={}){
 const failures=discoveryView(E,'discoveryPDFFailures'),queue=[...rows];
 const one=async row=>{
  if(row.localPDF||row.attachmentID)return'available';
  let last=null;
  for(const url of pdfCandidateURLs(row)){
   if(signal?.aborted)return null;const failure=failures?.[url];if(failure&&Date.now()-failure.at<86400000)continue;
   let result;try{result=await E.verifyDiscoveryPDF?.(url,{signal});}catch{if(signal?.aborted)return null;continue;}
   if(result?.available){row.pdf=url;row.pdfVerified=true;row.pdfVerifiedAt=result.checkedAt;row.pdfUnavailable=false;delete row.pdfStatus;return'available';}
   if(result)last=result;
  }
  // The card names why the checked addresses gave no file (article page, login or human check).
  if(last&&!signal?.aborted)row.pdfStatus=pdfStatus(last);
  return signal?.aborted?null:'none';
 };
 await Promise.all(Array.from({length:Math.min(concurrency,queue.length)},async()=>{while(queue.length&&!signal?.aborted){const row=queue.shift(),state=await one(row);if(state&&!signal?.aborted)onResult(row,state);}}));
 if(flush&&!signal?.aborted)await E.flushDiscoveryPDFChecks?.()?.catch?.(()=>{});
}
export function discoveryJournalOptions(rows){return [...new Map(rows.filter(row=>/^https:\/\/openalex\.org\/S\d+$/.test(row.sourceID)&&row.sourceType==='journal').map(row=>[row.sourceID,{id:row.sourceID,name:row.sourceName||row.journal}])).values()];}
export function discoveryFilterLimitations(value={}){const filters=discoveryFilters(value);return[...(filters.topOnly?[filters.includeUnverified?'顶刊筛选使用有来源的 TOP 记录（easyScholar 或已保存指标）；没有记录的期刊标为“期刊 TOP 未核验”后显示。':'顶刊筛选仅使用有来源的 TOP 记录（easyScholar 或已保存指标）；没有记录的期刊未核验，不进入结果。']:[]),...(filters.sort==='impact'?['影响因子排序只适用于已加载且有来源的指标；没有指标的论文排在后面。']:[])];}
// A sorted list must come from the same fields as the local title/abstract
// check; the default full-text search lets highly cited papers that mention
// the terms only in their body text crowd out every match. Each query group is
// one filter clause (repeated clauses AND together); its alternatives are
// quoted phrases joined with OR. plain sends only each group's first term.
const filterText=value=>String(value||'').replace(/[,|"]+/g,' ').replace(/\s+/g,' ').trim();
export function discoveryFeedURL({mode='trends',preferences={},query='',groups=null,plain=false,fieldIDs=[],researchScope={},filters={},page=1,cursor,limit=20,now=Date.now(),topicFilter=true}={}){
 const settings=discoveryPreferences(preferences),choice=discoveryFilters(filters),filter=['is_retracted:false',...(choice.pdfOnly?['open_access.is_oa:true']:[]),'type:article|preprint|review'],params=new URLSearchParams();
 const discipline=DISCOVERY_DISCIPLINES.filter(d=>settings.disciplineIDs.includes(d.id)).map(d=>d.query);
 const topic=query.trim()||(mode==='subscriptions'?settings.activeTopic||settings.topics[0]||'':''),list=(groups||[]).map(group=>(plain?group.slice(0,1):group).map(filterText).filter(Boolean)).filter(group=>group.length);
 if(list.length&&choice.sort!=='relevance'){
  if(list.every(group=>group.length===1))filter.unshift('title_and_abstract.search:'+list.map(group=>group[0]).join(' '));
  else filter.unshift(...list.map(group=>'title_and_abstract.search:'+(group.length===1?group[0]:group.map(term=>term.includes(' ')?'"'+term+'"':term).join(' OR '))));
 }
 else if(list.length)params.set('search',plain?list.map(group=>group[0]).join(' '):topic);
 else if(topic&&choice.sort!=='relevance')filter.unshift('title_and_abstract.search:'+filterText(topic));
 else if(topic||discipline.length&&!fieldIDs.length)params.set('search',topic||discipline.join(' OR '));
 if(fieldIDs.length)filter.push('primary_topic.field.id:'+fieldIDs.join('|'));
 const topicID=normalizeResearchScope(researchScope).topicID;if(topicID&&topicFilter)filter.push('topics.id:'+topicID.split('/').at(-1));
 const sourceIDs=choice.sourceIDs.length?choice.sourceIDs:settings.sources.map(s=>s.id.split('/').at(-1));if(sourceIDs.length)filter.push('primary_location.source.id:'+sourceIDs.join('|'));
 if(choice.journalOnly)filter.push('primary_location.source.type:journal');
 const range=discoveryDateRange(choice,{mode,now});if(range.from)filter.push('from_publication_date:'+range.from);if(range.to)filter.push('to_publication_date:'+range.to);
 params.set('filter',filter.join(','));if(choice.sort!=='relevance')params.set('sort',choice.sort==='citations'||!choice.sort&&mode==='trends'?'cited_by_count:desc':'publication_date:desc');params.set('per-page',String(Math.min(100,Math.max(5,Number(limit)||20))));if(cursor!=null)params.set('cursor',String(cursor));else params.set('page',String(Math.max(1,Number(page)||1)));
 return 'https://api.openalex.org/works?'+params;
}
export function discoveryFeedError(error,provider='在线来源'){
 const raw=String(error?.message||error),status=Number(error?.providerStatus||error?.status||raw.match(/(?:HTTP\s*|status\s*[:=]?\s*)(\d{3})/i)?.[1])||null,limited=status===429||error?.rateLimited===true||/\b429\b|rate.?limit|too many requests/i.test(raw),timeout=error?.name==='TimeoutError'||/timeout|超时/i.test(raw);
 return{provider,status,limited,code:limited?'rate_limit':timeout?'timeout':status?'http_error':'connection',message:limited?provider+' 请求较多，已暂停请求，可稍后刷新。':timeout?provider+' 响应超时。':status?provider+' 暂时无法访问（'+status+'）。':provider+' 暂时无法连接。'};
}
// When a rate-limited or failed index may be asked again. requestProvider's
// retryAt (from Retry-After) is honoured. OpenAlex's free budget without a key
// (about ten searches a day) resets at midnight UTC: a spent budget, or a
// keyless limit that names no retry time, rests until then.
export const nextUTCMidnight=(now=Date.now())=>{const day=new Date(now);return Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate()+1);};
export function discoveryCooldown(name,error,now=Date.now()){
 const failure=discoveryFeedError(error,DISCOVERY_INDEX_LABELS[name]),openalex=name==='openalex'||name==='openalex-zh',retryAt=Number(error?.retryAt);
 if(!failure.limited)return{...failure,until:now+15000};
 const quota=openalex&&(error?.quotaExhausted===true||error?.keyless===true&&!Number.isFinite(retryAt));
 return{...failure,until:quota?nextUTCMidnight(now):Number.isFinite(retryAt)&&retryAt>now?retryAt:now+60000,...(quota?{quota:true}:{}),...(typeof error?.keyless==='boolean'?{keyless:error.keyless}:{})};
}
// Both OpenAlex indexes share one budget and one rest.
const cooldownKey=name=>name==='openalex-zh'?'openalex':name;

export function installDiscoveryFeed(E,{Zotero}){
 const Controller=function(){if(E.createProviderController)return E.createProviderController();const C=Zotero.getMainWindow?.()?.AbortController||globalThis.AbortController;return new C();},runtime={AbortController:Controller,setTimeout:(...args)=>(E.setTimeout||globalThis.setTimeout)(...args),clearTimeout:(...args)=>(E.clearTimeout||globalThis.clearTimeout)(...args)};
 E.runDiscoverySearchTask=createDiscoverySearchRunner(runtime);
 installDiscoveryPDF(E,{fetch:(...args)=>E.fetchDiscoveryPDF(...args),createController:()=>new runtime.AbortController(),setTimeout:runtime.setTimeout,clearTimeout:runtime.clearTimeout});
 let logError=error=>Zotero.logError?.(error),writers={discoveryChinese:createStoreBranchWriter(E,'discoveryChinese',{limit:200,onError:logError}),discoveryBriefs:createStoreBranchWriter(E,'discoveryBriefs',{limit:100,onError:logError}),discoverySources:createStoreBranchWriter(E,'discoverySources',{limit:24,onError:logError}),discoveryTopics:createStoreBranchWriter(E,'discoveryTopics',{limit:24,onError:logError}),discoveryTermTranslations:createStoreBranchWriter(E,'discoveryTermTranslations',{limit:500,onError:logError})};
 // Stop probes first, then queue every pending cache write before the
 // workspace store's own shutdown flush.
 Zotero.addShutdownListener?.(()=>{E.stopDiscoveryPDF?.();return Promise.allSettled([E.flushDiscoveryPDFChecks?.(),...Object.values(writers).map(writer=>writer.flush())]);});
 installJournalSubscriptions(E);
 // Without saved model settings and a key no translation or expansion request is made.
 const modelReady=async()=>{if(!E.studio?.request)return false;if(typeof E.settings!=='function')return true;const settings=E.settings()||{};if(!settings.endpoint||!settings.model)return false;try{const endpoint=E.core?.endpoint?E.core.endpoint(settings.endpoint):settings.endpoint;return !E.credentials?.get||!!await E.credentials.get(endpoint);}catch{return false;}};
 const timers={AbortController:Zotero.getMainWindow?.()?.AbortController||globalThis.AbortController,setTimeout:E.setTimeout?.bind(E)||globalThis.setTimeout,clearTimeout:E.clearTimeout?.bind(E)||globalThis.clearTimeout};
 E.prepareDiscoveryQuery=(query,scope,signal,discovery)=>prepareDiscoveryQuery(E,query,scope,signal,{...timers,modelReady,termCache:writers.discoveryTermTranslations,academicTerms:(fields,currentSignal,options)=>academicDiscoveryTerms(E,fields,currentSignal,options),machineTerms:(fields,currentSignal,options)=>machineDiscoveryTerms(E,fields,currentSignal,{...timers,...options}),...(discovery?{discovery}:{})});
 E.removeDiscoveryQueryTerm=(signature,term)=>removeDiscoveryQueryTerm(E,signature,term);
 // plainQueries: grouped queries the index rejected or matched nothing with;
 // later pages of the same search keep the plain form their cursor came from.
 const pending=new Map(),sourceTasks=new Map(),topicTasks=new Map(),summaries=new Map(),cooldowns=new Map(),metricTasks=new Map(),metricMisses=new Map(),plainQueries=new Set();let fieldTask;
 const settle=(promise,ms,signal)=>new Promise(resolve=>{let done=false;const finish=value=>{if(done)return;done=true;runtime.clearTimeout(timer);signal?.removeEventListener('abort',stop);resolve(value);},stop=()=>finish(undefined),timer=runtime.setTimeout(stop,Math.max(0,ms));signal?.addEventListener('abort',stop,{once:true});Promise.resolve(promise).then(finish,()=>finish(undefined));});
 // The TOP filter needs records for journals that have no card yet. Look up at
 // most 40 journals per batch (one page), three at a time, within 5 s and the
 // search budget; a lookup that runs longer still fills the cache for the next
 // batch. A failed request (its snapshot says so) is counted in failed, apart
 // from a journal easyScholar has no record for; only the latter is skipped
 // for 30 min, and a saved key ends that wait.
 let metricKeyGeneration=E.journalMetricKeyGeneration||0;
 const snapshotEntry=key=>{const pending=E.pendingJournalMetrics?.();return pending&&Object.hasOwn(pending,key)?pending[key]:discoveryView(E,'journalMetricSnapshots',key);};
 const lookupJournalMetrics=async(rows,{signal,until=Infinity,failed=new Set()})=>{
  if(!E.candidateMetric||!E.journalMetricsAvailable)return'none';
  if(!await E.journalMetricsAvailable())return'no-key';
  if((E.journalMetricKeyGeneration||0)!==metricKeyGeneration){metricKeyGeneration=E.journalMetricKeyGeneration||0;metricMisses.clear();}
  let now=Date.now(),queue=[],seen=new Set(),outcomes=new Map();
  for(const row of rows){const key=discoveryJournalKey(row);if(!row.journal||seen.has(key))continue;seen.add(key);if(now-(metricMisses.get(key)||0)<1800000)continue;queue.push({key,row});if(queue.length===40)break;}
  const deadline=Math.min(now+5000,until);
  await Promise.all(Array.from({length:Math.min(3,queue.length)},async()=>{while(queue.length&&!signal?.aborted&&Date.now()<deadline){const {key,row}=queue.shift();let task=metricTasks.get(key);if(!task){task=Promise.resolve().then(()=>E.candidateMetric({journal:row.journal,issn:row.issn},{needTop:true})).then(metric=>{let entry=snapshotEntry(key),outcome=entry?.error&&(entry.kind==='failed'||entry.kind==='no-key')?'failed':metric?.source?'ok':'miss';if(outcome==='miss')metricMisses.set(key,Date.now());return outcome;},()=>'failed').finally(()=>metricTasks.delete(key));metricTasks.set(key,task);}task.then(outcome=>outcomes.set(key,outcome));await settle(task,deadline-Date.now(),signal);}}));
  for(const [key,outcome] of outcomes)if(outcome==='failed')failed.add(key);
  return failed.size?'failed':'ok';
 };
 E.markDiscoveryPDFFailure=async(url,error)=>{if(!/^https:\/\//i.test(url||''))return;await E.store.update(s=>{s.discoveryPDFFailures||={};s.discoveryPDFFailures[url]={at:Date.now(),reason:String(error?.message||error).slice(0,500)};for(const key of Object.keys(s.discoveryPDFFailures).slice(0,-100))delete s.discoveryPDFFailures[key];});};
 E.clearDiscoveryPDFFailure=async url=>{if(discoveryBranch(E,'discoveryPDFFailures')[url])await E.store.update(s=>delete s.discoveryPDFFailures[url]);};
 const resolveFields=async preferences=>{
  if(!preferences.disciplineIDs.length)return[];
  let fields=discoveryBranch(E,'discoveryFields').records;
  if(!fields){fieldTask||=E.requestProvider('https://api.openalex.org/fields?per-page=50',{},15000).then(JSON.parse).then(async result=>{const records=(result.results||[]).filter(row=>/^https:\/\/openalex\.org\/fields\/\d+$/.test(row.id));await E.store.update(s=>s.discoveryFields={records,at:Date.now()});return records;}).finally(()=>fieldTask=null);fields=await fieldTask;}
  const names={engineering:['Engineering'],information:['Computer Science'],materials:['Materials Science'],chemistry:['Chemistry'],life:['Agricultural and Biological Sciences','Biochemistry, Genetics and Molecular Biology','Immunology and Microbiology'],math:['Mathematics'],physics:['Physics and Astronomy'],earth:['Earth and Planetary Sciences'],medicine:['Medicine'],psychology:['Psychology']};
  return fields.filter(field=>preferences.disciplineIDs.some(id=>names[id].some(name=>name.toLowerCase()===field.display_name?.toLowerCase()))).map(field=>field.id.split('/').at(-1));
 };
 const localRows=async(query,filters={},sources=[])=>{
  const items=await Zotero.Items.getAll(Zotero.Libraries.userLibraryID,true,false),terms=discoveryLocalTerms(query),choice=discoveryFilters(filters);
  const rows=items.filter(item=>item.isRegularItem()&&!item.deleted&&item.itemType!=='manuscript').map(item=>({...E.library.describe(item),paperItemID:item.id,libraryID:item.libraryID,kind:'paper',source:'我的文库',sourceType:item.itemType==='journalArticle'?'journal':'',journal:item.getField('publicationTitle')||'',issn:item.getField('ISSN')||'',abstract:item.getField('abstractNote')||'',date:item.getField('date')||''}));
  const ordered=rows.map(row=>matchDiscoverySource(row,sources)).filter(Boolean).map(row=>({...row,score:discoveryLocalScore(row.title+' '+row.abstract,terms)})).sort((a,b)=>b.score-a.score||String(b.date).localeCompare(String(a.date))).slice(0,12),available=[];
  for(const row of ordered){const item=items.find(item=>item.id===row.paperItemID),attachment=await E.library.localPDF(item);if(attachment)available.push(enrichDiscoveryRecord({...row,attachmentID:attachment.id,localPDF:true},E));else if(!choice.pdfOnly)available.push(enrichDiscoveryRecord(row,E));}
  return applyDiscoveryFilters(available,filters);
 };
 // One provider batch: scope screen, TOP records for the rows only the TOP
 // filter is still undecided on, then the filter tally. Counts go to stats so an
 // empty page can say what removed it. The impact sort ranks dated records only,
 // and an easyScholar lookup gives none, so it does not wait for lookups; card
 // labels load lazily. failed collects the journals whose lookup failed.
 const scanBatch=async(raw,{name,sources,seen,prepared,choice,stats,journalRows,signal,until,failed=new Set()})=>{
  const rows=screenDiscoveryRows(raw,{name,sources,seen,prepared,stats,choice,E});journalRows.push(...rows);
  const needTop=row=>!['verified','reported','not-top'].includes(rowTopStatus(row));
  const candidates=choice.topOnly?rows.filter(row=>needTop(row)&&discoveryRowFlags(row,choice).every(flag=>flag==='notTop'||flag==='topUnknown')):[];
  if(candidates.length){
   const lookup=await lookupJournalMetrics(candidates,{signal,until,failed});
   // 'no-key' outranks 'failed', which outranks 'ok'; failed is cumulative.
   if(lookup!=='none'&&stats.metricLookup!=='no-key')stats.metricLookup=lookup;stats.metricFailed=failed.size;
   if(lookup==='ok'||lookup==='failed'){const fresh=discoveryEnrichment(E),changed=new Set(candidates);for(let i=0;i<rows.length;i++)if(changed.has(rows[i])){const domainMatch=rows[i].domainMatch;rows[i]=enrichDiscoveryRecord(rows[i],E,fresh);if(domainMatch!==undefined)rows[i].domainMatch=domainMatch;}}
  }
  const tally=discoveryFilterTally(rows,choice);
  for(const group of ['removed','relax'])for(const [key,count] of Object.entries(tally[group]))stats[group][key]=(stats[group][key]||0)+count;
  return tally.eligible;
 };
 // The search page screens Semantic Scholar and arXiv pages the same way.
 E.screenDiscoveryBatch=(rows,{name,prepared,choice,stats,signal,until,failed})=>scanBatch(rows,{name,sources:[],seen:new Set(),prepared,choice:discoveryFilters(choice),stats,journalRows:[],signal,until,failed});
 const recommendationFeed=async({mode='trends',preferences={},query='',page=1,cursor,filters={},limit=20,signal,refresh=false,provider='',researchScope={},onProgress,fillPage=false,domainMatch,queryExpansion,scanBudget,emptyFallback,prepared:given}={})=>{
  // The literature search page lists records first and checks PDFs in the
  // background; it says pdfOnly itself when 只显示可下载 is ticked.
  if(['rank','strict'].includes(domainMatch)&&filters?.pdfOnly===undefined)filters={...filters,pdfOnly:false};
  let scope=normalizeResearchScope(researchScope);if(['semantic','arxiv'].includes(provider)){if(!E.searchPaperPage)throw Error('当前来源尚未准备好');return E.searchPaperPage(query,{provider,page,cursor,filters,limit,signal,researchScope:scope,onProgress,fillPage,domainMatch,queryExpansion,scanBudget});}
  // The model step (expansion or translation) is reported, so its wait does not
  // look like a slow PDF search.
  const prepared=given||await E.prepareDiscoveryQuery(query,scope,signal,domainMatch?{domainMatch,queryExpansion,onPhase:phase=>onProgress?.({records:[],phase,partial:true})}:undefined);query=prepared.query;scope=prepared.researchScope;
  query=String(query||'').trim();page=Math.max(1,Math.floor(Number(page)||1));limit=Math.min(100,Math.max(5,Math.floor(Number(limit)||20)));
  const settings=discoveryPreferences(preferences);if(mode==='subscriptions'&&!query&&!settings.topics.length&&!settings.disciplineIDs.length&&!settings.sources.length)return{records:[],hasMore:false,needsPersonalization:true,mode};
  const budget={batches:Math.min(12,Math.max(fillPage?4:3,Math.floor(Number(scanBudget?.batches)||0))),ms:Number(scanBudget?.ms)>0?Number(scanBudget.ms):Infinity};
  const choice=discoveryFilters(filters),key='pdf-feed-v8-verified:'+JSON.stringify([mode,settings,query,page,cursor,choice,limit,provider,scope,fillPage,prepared.domainMatch||'',budget.batches]),cache=discoveryView(E,'discoveryFeeds',key),now=Date.now();
  // Empty verified batches can be caused by a cancelled probe, a temporary
  // publisher failure, or metrics arriving after a TOP filter was applied.
  // Do not pin that empty state for the normal one-hour successful-feed TTL.
  // A page whose journal lookup failed or had no key is not reused either; it
  // would still say so after the key is fixed.
  if(!refresh&&cache?.result?.records?.length&&now-cache.at<3600000&&!['failed','no-key'].includes(cache.result.scan?.metricLookup)){const snapshot=discoveryEnrichment(E);return{...cache.result,records:applyDiscoveryFilters((cache.result.records||[]).map(row=>enrichDiscoveryRecord(row,E,snapshot)),choice),cacheHit:true};}
  if(signal?.aborted)throw Object.assign(Error('已取消'),{name:'AbortError'});const active=pending.get(key);if(active&&!active.signal?.aborted){const result=await active.promise;if(signal?.aborted)throw Object.assign(Error('已取消'),{name:'AbortError'});return result;}
  const task=(async()=>{
   const check=()=>{if(signal?.aborted)throw Object.assign(Error('已取消'),{name:'AbortError'});},continuation=parseDiscoveryContinuation(cursor),sources=discoverySourceScope(settings,choice,{discoverySources:discoveryView(E,'discoverySources')}),errors=[],notes=[...(prepared.warning?[prepared.warning]:[]),...(prepared.notes||[])],topic=query.trim()||(mode==='subscriptions'?settings.activeTopic||settings.topics[0]||'':''),plain=String(prepared.plainQuery??query).trim()||topic,discipline=DISCOVERY_DISCIPLINES.filter(d=>settings.disciplineIDs.includes(d.id)).map(d=>d.query),fallbackQuery=[plain,...discipline].filter(Boolean).join(' '),labels={openalex:'OpenAlex',crossref:'Crossref',europepmc:'Europe PMC'};
   if(String(cursor||'').startsWith('discovery-v1:')&&!continuation)throw Error('推荐页已失效，请刷新后重试');
   if(provider&&!['openalex','crossref','europepmc'].includes(provider))throw Error('不支持的文献来源');
   // With keywords, a ranked topic is a ranking signal, not an index filter,
   // so the fallback indexes may answer as well.
   const topicFilter=!!scope.topicID&&!(prepared.domainMatch==='rank'&&prepared.groups?.length);
   // Discovery searches hand an empty OpenAlex answer to the fallback indexes;
   // other callers keep the OpenAlex page unless they ask for it.
   const handOver=emptyFallback??['rank','strict'].includes(prepared.domainMatch);
   if(topicFilter&&provider&&provider!=='openalex')throw Error('所选在线研究主题需要 OpenAlex 来源；也可改用自定义领域名称检索。');
   const requested=continuation?.provider||(['openalex','crossref','europepmc'].includes(provider)?provider:'openalex'),providers=topicFilter?['openalex']:requested==='openalex'?['openalex','crossref','europepmc']:requested==='crossref'?['crossref','europepmc']:['europepmc'];let emptyResult;
   const stats={scanned:0,matched:0,total:0,removed:{},relax:{},metricLookup:'',metricFailed:0,batches:0},started=Date.now(),until=started+budget.ms,failedJournals=new Set();let probeFailures=0;
   const snapshotStats=()=>({...stats,removed:{...stats.removed},relax:{...stats.relax},elapsedMs:Date.now()-started});
   // Only the result is read back. The raw scan rows (with abstracts) were
   // also stored and grew the workspace file without any reader.
   const save=async entry=>{check();await E.store.update(s=>{s.discoveryFeeds||={};s.discoveryFeeds[key]={at:Date.now(),result:entry.result};for(const old of Object.keys(s.discoveryFeeds).slice(0,-24))delete s.discoveryFeeds[old];});check();return entry.result;};
   for(const name of providers){
    check();const cooldown=cooldowns.get(name);if(cooldown&&Date.now()<cooldown.until&&(!refresh||cooldown.failure.limited)){errors.push(cooldown.failure);continue;}
    // Without a known journal/ISSN, an OpenAlex ID cannot be translated into
    // another index's filter. Keep the user's scope instead of broadening it.
    if(name!=='openalex'&&sources.some(source=>!source.name&&!source.issn)){notes.push('所选期刊尚无可核对的名称或 ISSN，备用来源保留筛选条件。');continue;}
    try{
     const seen=new Set(),records=[],journalRows=[];let fieldIDs=[],nextPage=continuation?.provider===name?continuation.page:name==='openalex'||provider===name?page:1,nextCursor=continuation?.provider===name?continuation.cursor||undefined:name==='openalex'?cursor??(page===1?'*':undefined):undefined,hasMore=false,rawTotal=0,usedPlain=false;
     if(name==='openalex')try{fieldIDs=await resolveFields(settings);}catch(error){check();notes.push('学科索引暂不可用，已按所选学科关键词检索。');}
     // Base pages fill the list; extra pages (scanBudget) run only while every
     // batch so far came back empty, within the batch and time budget.
     const base=fillPage?4:3,grouped=!!prepared.groups?.some(group=>group.length>1),plainKey=JSON.stringify([query,mode,choice.sort]);
     for(let scanned=0;scanned<budget.batches;scanned++){
      check();let raw,rawCount=0,newCursor;
      if(name==='openalex'){
       const url=plainOnly=>discoveryFeedURL({mode,preferences:settings,query,groups:prepared.groups||null,plain:plainOnly,fieldIDs,researchScope:scope,filters:choice,page:nextPage,cursor:nextCursor,limit,topicFilter});
       let plainOnly=!grouped||plainQueries.has(plainKey),data=null;
       try{data=JSON.parse(await E.requestProvider(url(plainOnly),{signal},20000));}catch(error){check();if(plainOnly||!/\b400\b/.test(String(error?.providerStatus||error?.status||'')+' '+String(error?.message||'')))throw error;}
       // OR groups are documented for search=; when the index rejects the
       // grouped form, or the title/abstract filter form matches nothing, the
       // plain form keeps the search and its cursor.
       if(!plainOnly&&(!data||!scanned&&nextCursor==='*'&&choice.sort!=='relevance'&&Number(data.meta?.count)===0)){plainQueries.add(plainKey);plainOnly=true;data=JSON.parse(await E.requestProvider(url(true),{signal},20000));}
       usedPlain||=plainOnly&&grouped;
       if(!Array.isArray(data?.results))throw Error('来源返回格式不正确');raw=data.results.map(openAlexFeedRecord);rawCount=data.results.length;newCursor=data.meta?.next_cursor;hasMore=Object.hasOwn(data.meta||{},'next_cursor')?!!newCursor&&!!rawCount:(nextPage-1)*limit+rawCount<(data.meta?.count||0);stats.total=Math.max(stats.total,Number(data.meta?.count)||0);
      }else if(name==='crossref'){
       const data=JSON.parse(await E.requestProvider(crossrefFeedURL({mode,query:fallbackQuery,filters:choice,sources,cursor:nextCursor,page:nextPage,limit}),{signal},10000)),message=data.message;if(!Array.isArray(message?.items))throw Error('来源返回格式不正确');raw=message.items.map(row=>crossrefFeedRecord(row,{metadata:!choice.pdfOnly})).filter(Boolean);rawCount=message.items.length;newCursor=message['next-cursor'];hasMore=!!rawCount&&(nextPage-1)*limit+rawCount<(message['total-results']||0)&&(!newCursor||newCursor!==nextCursor);
      }else{
       const data=JSON.parse(await E.requestProvider(europePMCFeedURL({mode,query:fallbackQuery,filters:choice,sources,cursor:nextCursor,limit}),{signal},10000));if(!Array.isArray(data.resultList?.result))throw Error('来源返回格式不正确');raw=data.resultList.result.map(europePMCFeedRecord).filter(Boolean);rawCount=data.resultList.result.length;newCursor=data.nextCursorMark;hasMore=!!rawCount&&!!newCursor&&newCursor!==nextCursor&&(nextPage-1)*limit+rawCount<(data.hitCount||0);
      }
      check();stats.batches++;rawTotal+=rawCount;
      const eligible=await scanBatch(raw,{name,sources,seen,prepared,choice,stats,journalRows,signal,until,failed:failedJournals});check();
      // Without pdfOnly the records are shown at once; the page checks PDFs afterwards.
      const verified=!choice.pdfOnly?{records:eligible}:await verifiedDiscoveryRecords(E,eligible,{signal,refresh,flush:false,onProgress:progress=>{if(!onProgress||!progress.records.length||progress.done===progress.total)return;onProgress({records:applyDiscoveryFilters([...records,...progress.records],choice),provider:labels[name],providerID:name,page,nextPage,nextCursor,hasMore:true,effectiveResearchScope:scope,query,partial:true,phase:'verify',done:progress.done,total:progress.total,scan:snapshotStats()});}});
      const failed=eligible.length-verified.records.length;if(failed>0){stats.removed.probe=(stats.removed.probe||0)+failed;probeFailures+=failed;}
      records.push(...verified.records);nextPage++;nextCursor=newCursor;
      if(onProgress)onProgress({records:applyDiscoveryFilters(records,choice),provider:labels[name],providerID:name,page,nextPage,nextCursor,hasMore,effectiveResearchScope:scope,query,partial:true,scan:snapshotStats()});
      // Stop when the page is full or the index is exhausted. After the base
      // pages, keep scanning only while nothing has passed, within the budget.
      if(records.length>=(fillPage?limit:1)||!hasMore||scanned+1>=base&&(records.length||Date.now()>=until))break;
     }
     if(usedPlain)notes.push('同义检索式未返回结果，已改用每组第一个检索词。');
     // Only the TOP filter looks journals up, so only it can lack a key.
     const metricNote=stats.metricLookup==='no-key'?['未配置 easyScholar 密钥，期刊 TOP 无法核验；可在设置中保存密钥，或选择“包含未核验期刊”。']:[];
     const scan={...snapshotStats(),exhausted:!hasMore,budgetHit:hasMore&&!records.length},limitations=[...discoveryFilterLimitations(choice),...notes,...metricNote,...(probeFailures?[probeFailures+' 篇论文的公开地址暂未通过 PDF 获取检查，已从可下载结果中排除。']:[]),...(name==='europepmc'?['当前备用来源 Europe PMC 主要覆盖生命科学与医学。']:[]),...(name!=='openalex'?['已使用 '+labels[name]+(choice.pdfOnly||name==='europepmc'?' 的开放 PDF 题录。':' 的题录。')]:[])];
     const result={records:applyDiscoveryFilters(records,choice),effectiveResearchScope:scope,searchQuery:usedPlain?String(prepared.plainQuery||query):query,hasMore,nextCursor:hasMore?(name==='openalex'?nextCursor||null:discoveryContinuation(name,nextCursor,nextPage)):null,nextPage,page,mode,provider:labels[name],providerID:name,filters:choice,filterOptions:{journals:discoveryJournalOptions(journalRows)},limitations,providerErrors:errors,at:new Date().toISOString(),cacheHit:false,disciplineFilter:name==='openalex'&&fieldIDs.length?'provider-field':settings.disciplineIDs.length?'keyword':'none',scan,...(prepared.queryExpansion?{queryExpansion:prepared.queryExpansion}:{})},entry={result,sourceRecords:journalRows};
     cooldowns.delete(name);
     // An index that matched nothing hands over to the next one; one whose
     // matches were all filtered reports what removed them.
     if(result.records.length||continuation?.provider===name||name==='openalex'&&(rawTotal>0||!handOver))return await save(entry);emptyResult||=entry;
    }catch(error){check();if(error.name==='AbortError')throw error;const failure=discoveryFeedError(error,labels[name]),rest=discoveryCooldown(name,error);errors.push(failure);cooldowns.set(name,{until:rest.until,failure:rest});}
   }
   // Every index came back empty: keep the first one's page, with the scan
   // counts of all of them.
   if(emptyResult){emptyResult.result.providerErrors=errors;emptyResult.result.scan={...emptyResult.result.scan,...snapshotStats()};return await save(emptyResult);}
   const cachedRows=cache?.result?applyDiscoveryFilters((cache.result.records||[]).map(row=>enrichDiscoveryRecord(row,E)),choice):[],fallback=cachedRows.length?cachedRows:(await localRows([plain,prepared.originalQuery].filter(Boolean).join(' '),choice,sources)).filter(row=>matchesPreparedDiscoveryScope(row,prepared)),retryAt=Math.min(...providers.map(name=>cooldowns.get(name)).filter(value=>value?.failure.limited&&value.until>Date.now()).map(value=>value.until));
   return{records:fallback,hasMore:false,nextCursor:null,page,mode,filters:choice,filterOptions:cache?.result?.filterOptions||{journals:[]},limitations:[...discoveryFilterLimitations(choice),...notes],fallback:cachedRows.length?'cache':'library',error:errors.map(error=>error.message).join(' ')||'当前筛选条件暂无可用的在线来源。',providerErrors:errors,retryAt:Number.isFinite(retryAt)?retryAt:0,cacheHit:!!cache?.result,scan:snapshotStats(),...(prepared.queryExpansion?{queryExpansion:prepared.queryExpansion}:{})};
  })();
  // Up to four scans share one PDF-check commit, written when the task
  // settles, including on cancellation and provider failure.
  task.catch(()=>{}).finally(()=>E.flushDiscoveryPDFChecks?.()?.catch(logError));
  const entry={promise:task,signal};pending.set(key,entry);try{return await task;}finally{if(pending.get(key)===entry)pending.delete(key);}
 };
 E.recommendationFeed=(options={})=>E.runDiscoverySearchTask((signal,onProgress)=>recommendationFeed({...options,signal,onProgress}),options);
 // Metadata-first search over several indexes at once. Each index is asked for
 // one large page; later pages come from the merged pool and ask an index again
 // only when the pool runs short. A failed or rate-limited index leaves the
 // others' results. OpenAlex search costs quota per call, a DOI lookup does not.
 const POOL_PAGE={openalex:100,'openalex-zh':50,semantic:100,arxiv:50,crossref:50,core:50,springer:50},OPENALEX_SELECT='id,ids,doi,title,display_name,publication_date,publication_year,primary_location,best_oa_location,locations,open_access,authorships,cited_by_count,abstract_inverted_index,keywords,primary_topic,topics,is_retracted,type',pools=new Map();
 const fetchIndex=async(name,state,pool,signal)=>{
  const {prepared,choice,plain}=pool,offset=state.fetched;let limit=POOL_PAGE[name];
  // The typed Chinese words, so Chinese-titled papers are found next to the translated search.
  if(name==='openalex-zh'){
   const data=JSON.parse(await E.requestProvider(discoveryFeedURL({mode:'latest',query:pool.original,plain:true,researchScope:prepared.researchScope,filters:choice,cursor:state.cursor||'*',limit,topicFilter:false})+'&select='+OPENALEX_SELECT,{signal},20000));
   if(!Array.isArray(data?.results))throw Error('来源返回格式不正确');state.cursor=data.meta?.next_cursor||'';
   return{rows:data.results.map(openAlexFeedRecord),more:!!state.cursor&&data.results.length>0,total:Number(data.meta?.count)||0};
  }
  if(name==='openalex'){
   const grouped=!!prepared.groups?.some(group=>group.length>1),url=plainOnly=>discoveryFeedURL({mode:'latest',query:prepared.query,groups:prepared.groups||null,plain:plainOnly,researchScope:prepared.researchScope,filters:choice,cursor:state.cursor||'*',limit,topicFilter:false})+'&select='+OPENALEX_SELECT;
   let plainOnly=!grouped||!!state.plain,data=null;
   try{data=JSON.parse(await E.requestProvider(url(plainOnly),{signal},20000));}catch(error){if(signal?.aborted||plainOnly||!/\b400\b/.test(String(error?.providerStatus||error?.status||'')+' '+String(error?.message||'')))throw error;}
   if(!plainOnly&&(!data||!state.cursor&&choice.sort!=='relevance'&&Number(data.meta?.count)===0)){state.plain=plainOnly=true;data=JSON.parse(await E.requestProvider(url(true),{signal},20000));}
   if(!Array.isArray(data?.results))throw Error('来源返回格式不正确');state.cursor=data.meta?.next_cursor||'';
   return{rows:data.results.map(openAlexFeedRecord),more:!!state.cursor&&data.results.length>0,total:Number(data.meta?.count)||0};
  }
  if(name==='semantic'){limit=Math.min(limit,999-offset);if(limit<=0)return{rows:[],more:false,total:state.total};const data=JSON.parse(await E.requestProvider(semanticSearchURL({query:plain,filters:choice,offset,limit}),{signal},15000)),list=data?.data||[];if(!Array.isArray(list))throw Error('来源返回格式不正确');return{rows:list.map(semanticFeedRecord).filter(Boolean),more:data.next!=null&&list.length>0,total:Number(data.total)||0};}
  if(name==='arxiv'){state.page=(state.page||0)+1;const data=await E.arxivSearchPage(plain,{page:state.page,limit,signal,filters:choice,any:state.any});if(data.widened)state.any=true;return{rows:(data.records||[]).map(arxivFeedRecord).filter(Boolean),more:!!data.hasMore,total:Number(data.total)||0};}
  if(name==='crossref'){if(offset>=1000)return{rows:[],more:false,total:state.total};const message=JSON.parse(await E.requestProvider(crossrefSearchURL({query:plain,filters:choice,offset,limit}),{signal},15000)).message;if(!Array.isArray(message?.items))throw Error('来源返回格式不正确');const total=Number(message['total-results'])||0;return{rows:message.items.map(row=>crossrefFeedRecord(row,{metadata:true})).filter(Boolean),more:message.items.length>0&&offset+message.items.length<total,total};}
  if(name==='core'){const data=JSON.parse(await E.requestProvider(coreSearchURL({query:plain,offset,limit}),{signal},20000));if(!Array.isArray(data?.results))throw Error('来源返回格式不正确');const total=Number(data.totalHits)||0;return{rows:data.results.map(coreFeedRecord).filter(Boolean),more:data.results.length>0&&offset+data.results.length<total,total};}
  const data=JSON.parse(await E.requestProvider(springerSearchURL({query:plain,offset,limit}),{signal},15000));if(!Array.isArray(data?.records))throw Error('来源返回格式不正确');const total=Number(data.result?.[0]?.total)||0;return{rows:data.records.map(springerFeedRecord).filter(Boolean),more:data.records.length>0&&offset+data.records.length<total,total};
 };
 E.searchDiscoverySources=async({prepared,filters={},indexes=['openalex'],cursor,limit=40,signal,refresh=false,onProgress,scanBudget}={})=>{
  const check=()=>{if(signal?.aborted)throw Object.assign(Error('已取消'),{name:'AbortError'});};check();
  const choice=discoveryFilters({...filters,sort:filters.sort||'relevance'}),poolKey=JSON.stringify([prepared.query,prepared.plainQuery,prepared.domainMatch,prepared.researchScope,choice,indexes]),served=Number(String(cursor||'').match(/^discovery-merge-v1:(\d+)$/)?.[1])||0;limit=Math.min(100,Math.max(5,Math.floor(Number(limit)||40)));
  // A new search starts a new pool; a cursor the pool has passed (a cached
  // first page) or a lost pool is rebuilt, skipping the papers already shown.
  let pool=pools.get(poolKey);
  if(!pool||!cursor&&(refresh||pool.served)||cursor&&pool.served>served){pool={prepared,choice,plain:String(prepared.plainQuery||prepared.query||'').trim(),original:String(prepared.originalQuery||'').trim(),merged:createDiscoveryMergePool(),indexes:Object.fromEntries(indexes.map(name=>[name,{fetched:0,more:true,total:0,task:null}])),errors:new Map(),served:0,skip:served,screened:new WeakSet()};}
  else if(cursor&&pool.served<served)pool.skip=served-pool.served;
  pools.delete(poolKey);pools.set(poolKey,pool);for(const old of [...pools.keys()].slice(0,-6))pools.delete(old);
  const stats={scanned:0,matched:0,total:0,removed:{},relax:{},metricLookup:'',metricFailed:0,batches:0},snapshot=discoveryEnrichment(E),ranks=['rank','strict'].includes(prepared.domainMatch),started=Date.now();
  // Screened again on each pass: a later index may add the abstract that matches.
  const screen=(entry,count)=>{
   const row=entry.record;if(row.retracted)return false;
   const verdict=discoveryScopeVerdict(row,prepared);let flags=[];
   if(verdict==='match'){const enriched=enrichDiscoveryRecord(row,E,snapshot);row.pdfUnavailable=enriched.pdfUnavailable;if(enriched.metrics){row.metric=enriched.metric;row.metrics=enriched.metrics;}if(ranks)row.domainMatch=discoveryDomainMatch(row,prepared);flags=discoveryRowFlags(row,choice);}
   if(count&&!pool.screened.has(entry)){
    pool.screened.add(entry);stats.scanned++;
    if(verdict!=='match'){stats.removed[verdict]=(stats.removed[verdict]||0)+1;if(verdict==='domain'&&!discoveryRowFlags(enrichDiscoveryRecord(row,E,snapshot),choice).length)stats.relax.domain=(stats.relax.domain||0)+1;}
    else{stats.matched++;if(flags.length){stats.removed[flags[0]]=(stats.removed[flags[0]]||0)+1;if(flags.length===1&&['date','journal','source','topUnknown'].includes(flags[0]))stats.relax[flags[0]]=(stats.relax[flags[0]]||0)+1;}}
   }
   return verdict==='match'&&!flags.length;
  };
  const select=commit=>{
   const eligible=pool.merged.entries.filter(entry=>!entry.served&&screen(entry,commit)),byRecord=new Map(eligible.map(entry=>[entry.record,entry]));
   // Relevance: text relevance over this pool's unshown papers, then the fused rank.
   const text=['relevance',''].includes(choice.sort)?discoveryTextRelevance(eligible.map(entry=>entry.record),prepared):undefined;
   const ordered=sortDiscoveryRecords(rankDiscoveryEntries(eligible,indexes,{text}).map(entry=>entry.record),choice.sort).map(record=>byRecord.get(record)),skipped=ordered.slice(0,pool.skip),page=ordered.slice(pool.skip,pool.skip+limit),left=ordered.length-skipped.length-page.length;
   if(commit){for(const entry of [...skipped,...page])entry.served=true;pool.served+=skipped.length+page.length;pool.skip-=skipped.length;}
   return{records:page.map(entry=>entry.record),left};
  };
  // Whether OpenAlex and Semantic Scholar have a saved key; undefined when unknown.
  const keyed=Object.fromEntries(await Promise.all(['openalex','semantic'].map(async id=>[id,E.scholarly?.has?await Promise.resolve(E.scholarly.has(id)).catch(()=>undefined):undefined])));
  let finished=false;
  const launch=name=>{
   const state=pool.indexes[name];if(state.task)return state.task;if(!state.more||pool.errors.has(name))return null;
   const cooldown=cooldowns.get(cooldownKey(name));if(cooldown&&Date.now()<cooldown.until&&(!refresh||cooldown.failure.limited)){pool.errors.set(name,cooldown.failure);return null;}
   state.task=fetchIndex(name,state,pool,signal).then(result=>{
    pool.merged.add(name,result.rows,state.fetched);state.fetched+=result.rows.length;state.more=result.more;state.total=Math.max(state.total,result.total);stats.batches++;cooldowns.delete(cooldownKey(name));
    if(!finished&&onProgress&&result.rows.length){const preview=select(false);if(preview.records.length)onProgress({records:preview.records,provider:'',providerID:'',partial:true,hasMore:true,query:prepared.query,effectiveResearchScope:prepared.researchScope});}
   },error=>{if(signal?.aborted||error?.name==='AbortError')return;const rest=discoveryCooldown(name,error);pool.errors.set(name,rest);cooldowns.set(cooldownKey(name),{until:rest.until,failure:rest});}).finally(()=>{state.task=null;});
   return state.task;
  };
  // At most two rounds of index pages per call, within the time budget; an
  // index still answering after it joins the pool for the next page.
  const deadline=started+Math.min(20000,Number(scanBudget?.ms)>0?Number(scanBudget.ms):20000);
  for(let round=0;round<2;round++){
   check();const tasks=select(false).records.length<limit?indexes.map(launch).filter(Boolean):[];if(!tasks.length)break;
   await settle(Promise.allSettled(tasks),deadline-Date.now(),signal);check();if(Date.now()>=deadline)break;
  }
  finished=true;const picked=select(true),failures=[...new Map([...pool.errors.entries()].map(([name,failure])=>[cooldownKey(name),failure])).values()],used=indexes.filter(name=>pool.indexes[name].fetched>0),hasMore=picked.left>0||indexes.some(name=>pool.indexes[name].more&&!pool.errors.has(name));
  // Per index: 'ok', 'limited' (until), 'failed' or 'pending' (still answering at the
  // deadline); keyless when no key is saved (or the failure says so).
  const providerStates=Object.fromEntries(indexes.map(name=>{const state=pool.indexes[name],error=pool.errors.get(name),id=cooldownKey(name),keyless=typeof error?.keyless==='boolean'?error.keyless:keyed[id]===undefined?undefined:!keyed[id];return[name,{status:error?(error.limited?'limited':'failed'):state.task?'pending':'ok',rows:state.fetched,...(error?.until?{until:error.until}:{}),...(error?.quota?{quota:true}:{}),...(keyless!==undefined?{keyless}:{})}];}));
  stats.total=indexes.reduce((sum,name)=>sum+(pool.indexes[name].total||0),0);
  const failedLabels=[...new Set(failures.map(failure=>failure.provider))];
  const notes=[...(prepared.warning?[prepared.warning]:[]),...(prepared.notes||[]),...(failures.length&&used.length?['部分来源暂不可用（'+failedLabels.join('、')+'），已显示其他来源的结果。']:[]),...(pool.indexes.openalex?.plain&&prepared.groups?.some(group=>group.length>1)?['同义检索式未返回结果，已改用每组第一个检索词。']:[])];
  const scan={...stats,elapsedMs:Date.now()-started,exhausted:!hasMore,budgetHit:hasMore&&!picked.records.length};
  if(!used.length&&pool.errors.size>=indexes.length){
   const rows=(await localRows([pool.plain,prepared.originalQuery].filter(Boolean).join(' '),choice,[])).filter(row=>matchesPreparedDiscoveryScope(row,prepared));
   return{records:rows,effectiveResearchScope:prepared.researchScope,searchQuery:prepared.query,query:prepared.query,hasMore:false,nextCursor:null,provider:'',providerID:'',filters:choice,filterOptions:{journals:[]},limitations:[...discoveryFilterLimitations(choice),...notes],fallback:'library',error:failures.map(failure=>failure.message).join(' '),providerErrors:failures,providerStates,cacheHit:false,scan,...(prepared.queryExpansion?{queryExpansion:prepared.queryExpansion}:{})};
  }
  return{records:picked.records,effectiveResearchScope:prepared.researchScope,searchQuery:prepared.query,query:prepared.query,hasMore,nextCursor:hasMore?'discovery-merge-v1:'+pool.served:null,provider:'',providerID:'',providerName:[...new Set(used.map(name=>DISCOVERY_INDEX_LABELS[name]))].join('、'),providers:used,filters:choice,filterOptions:{journals:discoveryJournalOptions(picked.records)},limitations:[...discoveryFilterLimitations(choice),...notes],providerErrors:failures,providerStates,at:new Date().toISOString(),cacheHit:false,scan,...(prepared.queryExpansion?{queryExpansion:prepared.queryExpansion}:{})};
 };
 E.checkDiscoveryPDFs=(rows,options)=>checkDiscoveryPDFs(E,rows,options);
 const catalog=async(kind,query,{signal}={})=>{
  query=String(query||'').normalize('NFKC').trim().slice(0,200);if(!query)return[];const check=()=>{if(signal?.aborted)throw Object.assign(Error('已取消'),{name:'AbortError'});};check();
  const tasks=kind==='sources'?sourceTasks:topicTasks,key=kind==='sources'?'discoverySources':'discoveryTopics',decorate=records=>{if(kind!=='sources')return records;let snapshots=journalMetricSnapshots(E);return records.filter(row=>row.kind==='journal').map(row=>({...row,metric:discoveryMetric({journal:row.name,issn:row.issn},E,snapshots)}));},cached=writers[key].get(query);if(cached&&Date.now()-cached.at<86400000)return decorate(cached.records);
  const active=tasks.get(query);if(active&&!active.signal?.aborted){const records=await active.promise;check();return decorate(records);}
  const task=(async()=>{const params=new URLSearchParams({'per-page':'12'}),issn=query.replace(/-/g,'');if(kind==='sources'){params.set('filter','type:journal'+(/^\d{7}[\dX]$/i.test(issn)?',issn:'+issn.slice(0,4)+'-'+issn.slice(4):''));if(!/^\d{7}[\dX]$/i.test(issn))params.set('search',query);}else params.set('search',query);
   const data=JSON.parse(await E.requestProvider('https://api.openalex.org/'+kind+'?'+params,{signal},15000));check();if(!Array.isArray(data.results))throw Error('在线目录返回格式不正确');const records=data.results.filter(row=>kind==='sources'?/^https:\/\/openalex\.org\/S\d+$/.test(row.id)&&row.type==='journal':/^https:\/\/openalex\.org\/T\d+$/.test(row.id)).map(row=>kind==='sources'?{id:row.id,name:row.display_name,kind:'journal',issn:row.issn_l||row.issn?.[0]||'',issns:row.issn||[]}:{id:row.id,name:row.display_name,field:row.field?.display_name||'',terms:(row.keywords||[]).map(term=>typeof term==='string'?term:term.display_name).filter(Boolean).slice(0,12)});
   await writers[key].set(query,{at:Date.now(),records});check();return records;})();const entry={promise:task,signal};tasks.set(query,entry);try{return decorate(await task);}finally{if(tasks.get(query)===entry)tasks.delete(query);}
 };
 E.findDiscoverySources=(query,options)=>catalog('sources',query,options);
 E.findDiscoveryTopics=(query,options)=>catalog('topics',query,options);
 E.discoveryBrief=async row=>{
  if(!row.abstract)return null;const excerpt=abstractExcerpt(row.abstract,{limit:320});if(/[\u3400-\u9fff]/.test(excerpt.text))return{...excerpt,language:'zh',translated:false};
  const key=excerpt.text,cache=writers.discoveryBriefs.get(key);if(cache?.text)return{...excerpt,text:cache.text,language:'zh',translated:true};if(summaries.has(key))return summaries.get(key);
  const task=(async()=>{try{const reply=await E.quickTranslate(excerpt.text,undefined,{persist:false,allowModelFallback:false});if(!reply?.text?.trim())throw Error('译文为空');const result={...excerpt,text:reply.text.trim(),language:'zh',translated:true};await writers.discoveryBriefs.set(key,{text:result.text,at:Date.now()});return result;}catch{return{...excerpt,language:'en',translated:false};}})();summaries.set(key,task);try{return await task;}finally{summaries.delete(key);}
 };
 let chineseTail=Promise.resolve();const chineseJobs=new Map();
 E.discoveryChinese=async(row,{signal}={})=>{
  const title=String(row.title||'').trim(),excerpt=abstractExcerpt(row.abstract||'',{limit:900}).text||'';
  if(/[\u3400-\u9fff]/.test(title)&&(!excerpt||/[\u3400-\u9fff]/.test(excerpt)))return{title,summary:excerpt,translated:false};
  const key=title+'\n'+excerpt,saved=writers.discoveryChinese.get(key);if(saved?.title)return saved;const active=chineseJobs.get(key);if(active&&!active.signal?.aborted)return active.promise;
  const task=chineseTail.catch(()=>{}).then(async()=>{if(signal?.aborted)throw Object.assign(Error('已取消'),{name:'AbortError'});
   const marker='ZXQBLOCK0ZXQ',reply=await E.quickTranslate(title+(excerpt?'\n'+marker+'\n'+excerpt:''),signal,{purpose:'material',persist:false}),parts=String(reply?.text||'').split(marker);
   if(!parts[0]?.trim()||excerpt&&parts.length!==2)throw Error('中文翻译未保留标题与摘要边界，原文已保留');
   if(signal?.aborted)throw Object.assign(Error('已取消'),{name:'AbortError'});const value={title:parts[0].trim(),summary:excerpt?parts[1].trim():'',translated:true};await writers.discoveryChinese.set(key,value);return value;
  });const entry={promise:task,signal};chineseJobs.set(key,entry);chineseTail=task.catch(()=>{});try{return await task;}finally{if(chineseJobs.get(key)===entry)chineseJobs.delete(key);}
 };
 E.discoveryPreview=async row=>{
  let item=row.paperItemID&&await Zotero.Items.getAsync(row.paperItemID);if(!item&&typeof row.id==='number')item=await Zotero.Items.getAsync(row.id);
  if(!item&&(row.doi||row.url)){const search=new Zotero.Search();search.libraryID=row.libraryID||Zotero.Libraries.userLibraryID;search.addCondition(row.doi?'DOI':'url','is',row.doi||row.url);const ids=await search.search();if(ids.length)item=await Zotero.Items.getAsync(ids[0]);}
  if(!item)return null;const attachment=await E.library.localPDF(item);if(!attachment)return null;const cover=await E.firstPage(attachment);return{...cover,attachmentID:attachment.id,paperItemID:item.parentID||item.id};
 };
}
