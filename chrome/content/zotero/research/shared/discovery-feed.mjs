/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {abstractExcerpt} from './paper-overview-data.mjs';

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
export function openAlexFeedRecord(p){
 const words=[];for(const[word,positions]of Object.entries(p.abstract_inverted_index||{}))for(const i of positions)words[i]=word;
 const locations=[p.best_oa_location,p.primary_location,...(p.locations||[])],location=locations.find(l=>l?.pdf_url&&/^https:\/\//i.test(l.pdf_url)&&(l.is_oa===true||l===p.best_oa_location))||p.best_oa_location||p.primary_location,source=p.primary_location?.source||location?.source;
 return{id:p.id,title:p.title||p.display_name,abstract:words.join(' '),doi:(p.doi||'').replace(/^https?:\/\/doi.org\//,''),url:location?.landing_page_url||p.doi||p.id,pdf:location?.pdf_url||'',journal:source?.display_name||'',issn:source?.issn_l||'',sourceID:source?.id||'',sourceName:source?.display_name||'',sourceType:source?.type||'',source:'OpenAlex',date:p.publication_date||String(p.publication_year||''),citationCount:p.cited_by_count??null,oa:p.open_access?.is_oa===true||location?.is_oa===true||!!p.best_oa_location,retracted:p.is_retracted===true,authors:(p.authorships||[]).map(a=>({lastName:a.author?.display_name||'',fieldMode:1}))};
}
export function discoveryFilters(value={}){
 return{journalOnly:value.journalOnly===true,sourceIDs:[...new Set((value.sourceIDs||[]).map(id=>String(id).replace(/^https:\/\/openalex\.org\//,'')).filter(id=>/^S\d+$/.test(id)))],topOnly:value.topOnly===true,sort:['impact','citations','date','relevance'].includes(value.sort)?value.sort:'',years:['1','5'].includes(String(value.years))?String(value.years):''};
}
export function discoveryPDFAvailable(row){return !row.retracted&&(!row.pdfUnavailable||row.localPDF===true||!!row.attachmentID)&&(!!row.attachmentID||row.localPDF===true||/^https:\/\//i.test(String(row.pdf||'')));}
export function discoveryMetric(record,E){
 const issn=String(record.issn||'').replace(/-/g,'').toUpperCase(),journal='journal:'+String(record.journal||'').normalize('NFKC').toLowerCase().trim(),snapshots=E.store.get().journalMetricSnapshots||{},saved=[...(E.metrics?.get?.(issn)||[]),snapshots[issn]?.metric,snapshots[journal]?.metric].filter(m=>m&&typeof m.source==='string'&&m.source.trim());
 // OpenAlex's two-year mean citations is not an impact factor. Only the
 // user's saved metric records or the existing journal provider cache count.
 const metric=saved.sort((a,b)=>(b.metric_year||0)-(a.metric_year||0)).find(m=>m.impact_factor!==''&&m.impact_factor!=null&&Number.isFinite(Number(m.impact_factor))&&Number(m.impact_factor)>=0||m.cas_top!=null);
 if(!metric)return null;const raw=metric.impact_factor,impact=raw==null||String(raw).trim()===''?null:Number(raw),top=/^(?:yes|true|1|是|top|top期刊)$/i.test(String(metric.cas_top||'').trim());
 return{...metric,impact_factor:Number.isFinite(impact)&&impact>=0?impact:null,metric_year:metric.metric_year||null,top};
}
export function enrichDiscoveryRecord(row,E){const failure=E.store.get().discoveryPDFFailures?.[row.pdf],metric=discoveryMetric(row,E),record={...row,pdfUnavailable:!!failure&&Date.now()-failure.at<86400000};return metric?{...record,metric,metrics:{impactFactor:metric.impact_factor,year:metric.metric_year,source:metric.source,top:metric.top}}:record;}
export function applyDiscoveryFilters(rows,value={}){
 const filters=discoveryFilters(value),result=rows.filter(row=>discoveryPDFAvailable(row)&&(!filters.journalOnly||row.sourceType==='journal')&&(!filters.sourceIDs.length||filters.sourceIDs.includes(String(row.sourceID||'').split('/').at(-1)))&&(!filters.topOnly||row.metrics?.top===true));
 const impact=row=>row.metric?.impact_factor!=null?Number(row.metric.impact_factor):row.metrics?.impactFactor!=null?Number(row.metrics.impactFactor):-1;
 if(filters.sort==='impact')result.sort((a,b)=>impact(b)-impact(a)||String(b.date||'').localeCompare(String(a.date||'')));
 else if(filters.sort==='citations')result.sort((a,b)=>(b.citationCount??-1)-(a.citationCount??-1));
 else if(filters.sort==='date')result.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
 return result;
}
export function discoveryJournalOptions(rows){return [...new Map(rows.filter(row=>/^https:\/\/openalex\.org\/S\d+$/.test(row.sourceID)&&row.sourceType==='journal').map(row=>[row.sourceID,{id:row.sourceID,name:row.sourceName||row.journal}])).values()];}
export function discoveryFilterLimitations(value={}){const filters=discoveryFilters(value);return[...(filters.topOnly?['顶刊筛选仅使用已保存且有来源的 TOP 标记；未核验期刊不进入结果。']:[]),...(filters.sort==='impact'?['影响因子排序只适用于已加载且有来源的指标；没有指标的论文排在后面。']:[])];}
export function discoveryFeedURL({mode='trends',preferences={},query='',fieldIDs=[],filters={},page=1,cursor,limit=20,now=Date.now()}={}){
 const settings=discoveryPreferences(preferences),choice=discoveryFilters(filters),filter=['is_retracted:false','open_access.is_oa:true','type:article|preprint|review'],params=new URLSearchParams();
 const discipline=DISCOVERY_DISCIPLINES.filter(d=>settings.disciplineIDs.includes(d.id)).map(d=>d.query);
 const topic=query.trim()||(mode==='subscriptions'?settings.activeTopic||settings.topics[0]||'':'');
 if(topic||discipline.length&&!fieldIDs.length)params.set('search',topic||discipline.join(' OR '));
 if(fieldIDs.length)filter.push('primary_topic.field.id:'+fieldIDs.join('|'));
 const sourceIDs=choice.sourceIDs.length?choice.sourceIDs:settings.sources.map(s=>s.id.split('/').at(-1));if(sourceIDs.length)filter.push('primary_location.source.id:'+sourceIDs.join('|'));
 if(choice.journalOnly)filter.push('primary_location.source.type:journal');
 if(choice.years||mode==='trends'){const start=new Date(now);start.setUTCFullYear(start.getUTCFullYear()-Number(choice.years||1));filter.push('from_publication_date:'+start.toISOString().slice(0,10));}
 params.set('filter',filter.join(','));if(choice.sort!=='relevance')params.set('sort',choice.sort==='citations'||!choice.sort&&mode==='trends'?'cited_by_count:desc':'publication_date:desc');params.set('per-page',String(Math.min(100,Math.max(5,Number(limit)||20))));if(cursor!=null)params.set('cursor',String(cursor));else params.set('page',String(Math.max(1,Number(page)||1)));
 return 'https://api.openalex.org/works?'+params;
}
export function discoveryFeedError(error){const limited=/429|rate.?limit|too many requests/i.test(String(error?.message||error));return{limited,message:limited?'文献来源请求较多，已暂停请求。保留已有结果，可稍后刷新。':'联网推荐暂不可用，已有结果和本地论文仍可使用。'};}

export function installDiscoveryFeed(E,{Zotero}){
 const pending=new Map(),sourceTasks=new Map(),summaries=new Map();let cooldownUntil=0,fieldTask;
 E.markDiscoveryPDFFailure=async(url,error)=>{if(!/^https:\/\//i.test(url||''))return;await E.store.update(s=>{s.discoveryPDFFailures||={};s.discoveryPDFFailures[url]={at:Date.now(),reason:String(error?.message||error).slice(0,500)};for(const key of Object.keys(s.discoveryPDFFailures).slice(0,-100))delete s.discoveryPDFFailures[key];});};
 E.clearDiscoveryPDFFailure=async url=>{if(E.store.get().discoveryPDFFailures?.[url])await E.store.update(s=>delete s.discoveryPDFFailures[url]);};
 const resolveFields=async preferences=>{
  if(!preferences.disciplineIDs.length)return[];
  let fields=E.store.get().discoveryFields?.records;
  if(!fields){fieldTask||=E.requestProvider('https://api.openalex.org/fields?per-page=50',{},15000).then(JSON.parse).then(async result=>{const records=(result.results||[]).filter(row=>/^https:\/\/openalex\.org\/fields\/\d+$/.test(row.id));await E.store.update(s=>s.discoveryFields={records,at:Date.now()});return records;}).finally(()=>fieldTask=null);fields=await fieldTask;}
  const names={engineering:['Engineering'],information:['Computer Science'],materials:['Materials Science'],chemistry:['Chemistry'],life:['Agricultural and Biological Sciences','Biochemistry, Genetics and Molecular Biology','Immunology and Microbiology'],math:['Mathematics'],physics:['Physics and Astronomy'],earth:['Earth and Planetary Sciences'],medicine:['Medicine'],psychology:['Psychology']};
  return fields.filter(field=>preferences.disciplineIDs.some(id=>names[id].some(name=>name.toLowerCase()===field.display_name?.toLowerCase()))).map(field=>field.id.split('/').at(-1));
 };
 const localRows=async(query,filters={})=>{
  const items=await Zotero.Items.getAll(Zotero.Libraries.userLibraryID,true,false),terms=String(query||'').toLowerCase().split(/\s+/).filter(t=>t.length>2);
  const rows=items.filter(item=>item.isRegularItem()&&!item.deleted&&item.itemType!=='manuscript').map(item=>({...E.library.describe(item),paperItemID:item.id,libraryID:item.libraryID,kind:'paper',source:'我的文库',sourceType:item.itemType==='journalArticle'?'journal':'',journal:item.getField('publicationTitle')||'',issn:item.getField('ISSN')||'',abstract:item.getField('abstractNote')||'',date:item.getField('date')||''}));
  const ordered=rows.map(row=>({...row,score:terms.filter(t=>(row.title+' '+row.abstract).toLowerCase().includes(t)).length})).sort((a,b)=>b.score-a.score||String(b.date).localeCompare(String(a.date))).slice(0,12),available=[];
  for(const row of ordered){const item=items.find(item=>item.id===row.paperItemID),attachment=await E.library.localPDF(item);if(attachment)available.push(enrichDiscoveryRecord({...row,attachmentID:attachment.id,localPDF:true},E));}
  return applyDiscoveryFilters(available,filters);
 };
 E.recommendationFeed=async({mode='trends',preferences={},query='',page=1,cursor,filters={},limit=20,signal,refresh=false}={})=>{
  const settings=discoveryPreferences(preferences);if(mode==='subscriptions'&&!query&&!settings.topics.length&&!settings.disciplineIDs.length&&!settings.sources.length)return{records:[],hasMore:false,needsPersonalization:true,mode};
  const choice=discoveryFilters(filters),key='pdf-feed-v3:'+JSON.stringify([mode,settings,query,page,cursor,choice,limit]),cache=E.store.get().discoveryFeeds?.[key],now=Date.now();
  if(!refresh&&cache&&now-cache.at<3600000)return{...cache.result,records:applyDiscoveryFilters((cache.sourceRecords||cache.result.records).map(row=>enrichDiscoveryRecord(row,E)),choice),cacheHit:true};
  if(pending.has(key))return pending.get(key);
  const task=(async()=>{try{
   if(signal?.aborted)throw Object.assign(Error('已取消'),{name:'AbortError'});
   if(Date.now()<cooldownUntil)throw Error('HTTP 429');
   const fieldIDs=await resolveFields(settings),seen=new Set(),records=[],journalRows=[];let nextCursor=cursor??(page===1?'*':undefined),nextPage=page,hasMore=false;
   // A provider page can contain OA landing pages without a downloadable PDF.
   // Continue a bounded number of raw pages and retain the provider cursor even
   // when local TOP/metric restrictions leave the visible batch empty.
   for(let scanned=0;scanned<3;scanned++){
    const url=discoveryFeedURL({mode,preferences:settings,query,fieldIDs,filters:choice,page:nextPage,cursor:nextCursor,limit}),data=JSON.parse(await E.requestProvider(url,{signal},20000));if(signal?.aborted)throw Object.assign(Error('已取消'),{name:'AbortError'});
    const raw=(data.results||[]).map(p=>enrichDiscoveryRecord(openAlexFeedRecord(p),E)).filter(row=>{const id=String(row.doi||row.url||row.id).toLowerCase();if(!row.title||!id||seen.has(id)||row.retracted)return false;seen.add(id);return true;});journalRows.push(...raw);
    records.push(...applyDiscoveryFilters(raw,choice));hasMore=Object.hasOwn(data.meta||{},'next_cursor')?!!data.meta.next_cursor&&!!data.results?.length:(nextPage-1)*limit+(data.results?.length||0)<(data.meta?.count||0);nextCursor=data.meta?.next_cursor??undefined;nextPage++;
    if(records.length||!hasMore)break;
   }
   const result={records:applyDiscoveryFilters(records,choice),hasMore,nextCursor:nextCursor||null,nextPage,page,mode,provider:'OpenAlex',filters:choice,filterOptions:{journals:discoveryJournalOptions(journalRows)},limitations:discoveryFilterLimitations(choice),at:new Date().toISOString(),cacheHit:false,disciplineFilter:fieldIDs.length?'provider-field':settings.disciplineIDs.length?'keyword':'none'};
   await E.store.update(s=>{s.discoveryFeeds||={};s.discoveryFeeds[key]={at:Date.now(),result,sourceRecords:journalRows};for(const old of Object.keys(s.discoveryFeeds).slice(0,-24))delete s.discoveryFeeds[old];});return result;
  }catch(error){if(signal?.aborted||error.name==='AbortError')throw error;const failure=discoveryFeedError(error);if(failure.limited)cooldownUntil=Math.max(cooldownUntil,Date.now()+60000);
   const cachedRows=cache?applyDiscoveryFilters((cache.sourceRecords||cache.result.records).map(row=>enrichDiscoveryRecord(row,E)),choice):[],fallback=cachedRows.length?cachedRows:await localRows(query||settings.activeTopic||settings.topics[0],choice);return{records:fallback,hasMore:false,nextCursor:null,page,mode,filters:choice,filterOptions:cache?.result.filterOptions||{journals:[]},limitations:discoveryFilterLimitations(choice),fallback:cachedRows.length?'cache':'library',error:failure.message,retryAt:cooldownUntil,cacheHit:!!cache};
  }})();pending.set(key,task);try{return await task;}finally{pending.delete(key);}
 };
 E.findDiscoverySources=async(query,{signal}={})=>{
  query=String(query||'').trim();if(!query)return[];if(sourceTasks.has(query))return sourceTasks.get(query);
  const task=(async()=>{const cached=E.store.get().discoverySources?.[query];if(cached&&Date.now()-cached.at<86400000)return cached.records;
   const data=JSON.parse(await E.requestProvider('https://api.openalex.org/sources?search='+encodeURIComponent(query)+'&per-page=12',{signal},15000));const records=(data.results||[]).filter(s=>/^https:\/\/openalex\.org\/S\d+$/.test(s.id)).map(s=>({id:s.id,name:s.display_name,kind:s.type||'journal',issn:s.issn_l||''}));
   await E.store.update(s=>{s.discoverySources||={};s.discoverySources[query]={at:Date.now(),records};for(const old of Object.keys(s.discoverySources).slice(0,-16))delete s.discoverySources[old];});return records;})();sourceTasks.set(query,task);try{return await task;}finally{sourceTasks.delete(query);}
 };
 E.discoveryBrief=async row=>{
  if(!row.abstract)return null;const excerpt=abstractExcerpt(row.abstract,{limit:320});if(/[\u3400-\u9fff]/.test(excerpt.text))return{...excerpt,language:'zh',translated:false};
  const key=excerpt.text,cache=E.store.get().discoveryBriefs?.[key];if(cache)return{...excerpt,text:cache.text,language:'zh',translated:true};if(summaries.has(key))return summaries.get(key);
  const task=(async()=>{try{const reply=await E.quickTranslate(excerpt.text,undefined,{persist:false,allowModelFallback:false});if(!reply?.text?.trim())throw Error('译文为空');const result={...excerpt,text:reply.text.trim(),language:'zh',translated:true};await E.store.update(s=>{s.discoveryBriefs||={};s.discoveryBriefs[key]={text:result.text,at:Date.now()};for(const old of Object.keys(s.discoveryBriefs).slice(0,-100))delete s.discoveryBriefs[old];});return result;}catch{return{...excerpt,language:'en',translated:false};}})();summaries.set(key,task);try{return await task;}finally{summaries.delete(key);}
 };
 E.discoveryPreview=async row=>{
  let item=row.paperItemID&&await Zotero.Items.getAsync(row.paperItemID);if(!item&&typeof row.id==='number')item=await Zotero.Items.getAsync(row.id);
  if(!item&&(row.doi||row.url)){const search=new Zotero.Search();search.libraryID=row.libraryID||Zotero.Libraries.userLibraryID;search.addCondition(row.doi?'DOI':'url','is',row.doi||row.url);const ids=await search.search();if(ids.length)item=await Zotero.Items.getAsync(ids[0]);}
  if(!item)return null;const attachment=await E.library.localPDF(item);if(!attachment)return null;const cover=await E.firstPage(attachment);return{...cover,attachmentID:attachment.id,paperItemID:item.parentID||item.id};
 };
}
