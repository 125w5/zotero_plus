/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {discoveryDateRange} from './discovery-dates.mjs';
// Alternate providers expose publication metadata. A full-text link alone is
// not evidence that a publisher PDF is open access: Crossref also indexes TDM.
const cleanText=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/&(?:amp|lt|gt|quot|apos);/g,value=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[value])).replace(/\s+/g,' ').trim();
const journalKey=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const issnKey=value=>String(value||'').replace(/[^0-9x]/gi,'').toUpperCase();
const isoDate=parts=>Array.isArray(parts)&&Number(parts[0])?parts.slice(0,3).map((part,index)=>String(part).padStart(index?2:4,'0')).join('-'):'';

export function discoveryContinuation(provider,cursor,page){return 'discovery-v1:'+encodeURIComponent(JSON.stringify({provider,cursor:String(cursor||''),page:Math.max(1,Number(page)||1)}));}
export function parseDiscoveryContinuation(value){
 if(typeof value!=='string'||!value.startsWith('discovery-v1:'))return null;
 try{const data=JSON.parse(decodeURIComponent(value.slice(13)));return ['crossref','europepmc'].includes(data.provider)&&typeof data.cursor==='string'&&Number.isSafeInteger(data.page)&&data.page>0?data:null;}catch{return null;}
}
export function discoverySourceScope(preferences,filters,state={}){
 const known=[...(preferences.sources||[]),...Object.values(state.discoverySources||{}).flatMap(entry=>entry.records||[])],ids=filters.sourceIDs.length?filters.sourceIDs:(preferences.sources||[]).map(source=>String(source.id).split('/').at(-1));
 return ids.map(id=>known.find(source=>String(source.id).split('/').at(-1)===id)||{id:'https://openalex.org/'+id,name:''});
}
export function matchDiscoverySource(row,sources){
 if(!sources.length)return row;const issns=[row.issn,...(row.issns||[])].filter(Boolean).map(issnKey),name=journalKey(row.journal);
 const match=sources.find(source=>source.issn&&issns.includes(issnKey(source.issn))||source.name&&name===journalKey(source.name));
 // Reuse an OpenAlex source ID only after its actual ISSN or journal name
 // matches provider metadata. Unknown IDs must never broaden the filter.
 return match?{...row,sourceID:match.id,sourceName:match.name||row.journal}:null;
}
// metadata:true keeps a record without an open PDF (pdf ''), for the
// metadata-first search; the default still requires one.
export function crossrefFeedRecord(p,{now=Date.now(),metadata=false}={}){
 const license=(p.license||[]).find(entry=>/^https?:\/\/(?:www\.)?creativecommons\.org\/(?:licenses|publicdomain)\//i.test(entry.URL||'')&&(!entry.start?.['date-time']||Date.parse(entry.start['date-time'])<=now));
 const link=license&&(p.link||[]).find(entry=>/^https:\/\//i.test(entry.URL||'')&&(/application\/pdf/i.test(entry['content-type']||'')||/(?:\.pdf(?:[?#]|$)|\/pdf(?:[/?#]|$)|[?&]pdf=)/i.test(entry.URL)));
 if(!p.DOI||!p.title?.[0]||!link&&!metadata)return null;
 const type=p.type==='journal-article'?'journal':p.type==='proceedings-article'?'conference':p.type==='posted-content'?'repository':'';
 return{id:'https://doi.org/'+p.DOI,doi:p.DOI,title:cleanText(p.title[0]),abstract:cleanText(p.abstract),url:p.URL||'https://doi.org/'+p.DOI,pdf:link?.URL||'',oa:!!link,retracted:(p['update-to']||[]).some(update=>/retract/i.test(update.type||'')),source:'Crossref',sourceType:type,sourceID:'',journal:cleanText(p['container-title']?.[0]),sourceName:cleanText(p['container-title']?.[0]),issn:p.ISSN?.[0]||'',issns:p.ISSN||[],date:isoDate((p.published||p['published-online']||p['published-print']||p.issued)?.['date-parts']?.[0]),citationCount:p['is-referenced-by-count']??null,...(license?{license:license.URL}:{}),...(discoveryArxivID(p.DOI)?{arxiv:discoveryArxivID(p.DOI)}:{}),authors:(p.author||[]).map(author=>author.family?{lastName:author.family,firstName:author.given||'',fieldMode:0}:{lastName:author.name||'',fieldMode:1})};
}
export function europePMCFeedRecord(p){
 const entries=p.fullTextUrlList?.fullTextUrl||[],link=entries.find(entry=>entry.documentStyle?.toLowerCase()==='pdf'&&/^(?:OA|F)$/i.test(entry.availabilityCode||'')&&/^https:\/\//i.test(entry.url||''));
 if(p.isOpenAccess!=='Y'||p.hasPDF!=='Y'||!link||!p.title)return null;
 const journal=p.journalInfo?.journal||{},authors=p.authorList?.author||[],types=p.pubTypeList?.pubType||[];
 return{id:p.pmcid?'https://europepmc.org/articles/'+p.pmcid:'https://europepmc.org/article/'+p.source+'/'+p.id,doi:p.doi||'',title:cleanText(p.title),abstract:cleanText(p.abstractText),url:p.doi?'https://doi.org/'+p.doi:link.url,pdf:link.url,oa:true,retracted:types.some(type=>/retract/i.test(type)),source:'Europe PMC',sourceType:journal.title?'journal':'repository',sourceID:'',sourceName:journal.title||'',journal:journal.title||'',issn:journal.issn||journal.essn||'',issns:[journal.issn,journal.essn].filter(Boolean),date:p.firstPublicationDate||p.journalInfo?.dateOfPublication||String(p.pubYear||''),citationCount:Number.isFinite(Number(p.citedByCount))?Number(p.citedByCount):null,pmcid:p.pmcid||'',authors:authors.length?authors.map(author=>author.lastName?{lastName:author.lastName,firstName:author.firstName||'',fieldMode:0}:{lastName:author.fullName||author.collectiveName||'',fieldMode:1}):p.authorString?[{lastName:p.authorString,fieldMode:1}]:[]};
}
export function crossrefFeedURL({mode,query='',filters={},sources=[],cursor,page=1,limit=20,now=Date.now()}={}){
 const parameters=new URLSearchParams({rows:String(Math.min(100,Math.max(5,Number(limit)||20)))}),restrictions=filters.pdfOnly===false?(filters.journalOnly?[]:['type:journal-article','type:proceedings-article','type:posted-content']):['has-full-text:true'];
 if(query.trim())parameters.set('query',query.trim());if(sources.length)parameters.set('query.container-title',sources.map(source=>source.name||source.issn).filter(Boolean).join(' '));
 if(filters.journalOnly)restrictions.push('type:journal-article');const range=discoveryDateRange(filters,{mode,now});if(range.from)restrictions.push('from-pub-date:'+range.from);if(range.to)restrictions.push('until-pub-date:'+range.to);
 parameters.set('filter',restrictions.join(','));if(cursor!=null||page===1)parameters.set('cursor',cursor||'*');else parameters.set('offset',String((page-1)*limit));
 if(filters.sort!=='relevance'){parameters.set('sort',filters.sort==='citations'||!filters.sort&&mode==='trends'?'is-referenced-by-count':'published');parameters.set('order','desc');}
 return 'https://api.crossref.org/works?'+parameters;
}
// Metadata-first search: every index's rows share one shape. The download
// step reads the identifiers (doi, arxiv, pmcid, s2Id, coreId, openalexId).
// openalex-zh: the same index asked with the typed Chinese words.
export const DISCOVERY_INDEX_LABELS={openalex:'OpenAlex',semantic:'Semantic Scholar',arxiv:'arXiv',crossref:'Crossref',core:'CORE',springer:'Springer Nature',europepmc:'Europe PMC','openalex-zh':'OpenAlex'};
export const discoveryDOI=value=>String(value||'').trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i,'').replace(/[.,;]+$/,'').toLowerCase();
export function discoveryArxivID(value){
 const text=String(value||'').trim(),match=text.match(/(?:arxiv\.org\/(?:abs|pdf)\/|10\.48550\/arxiv\.|^arxiv\s*:\s*|^)((?:\d{4}\.\d{4,5}|[a-z][a-z.-]*\/\d{7}))(?:v\d+)?(?:\.pdf)?(?:[?#].*)?$/i);
 return match?match[1].toLowerCase():'';
}
const preprintDOI=doi=>/^10\.48550\/arxiv\./.test(doi);
export const discoveryTitleKey=value=>String(value||'').replace(/<[^>]*>/g,' ').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
const yearOf=row=>Number(String(row.date||'').match(/^\d{4}/)?.[0])||0;
// Identity keys, strongest first. Short titles ("Introduction") never match by title.
export function discoveryMergeKeys(row){
 const keys=[],doi=discoveryDOI(row.doi),arxiv=row.arxiv||discoveryArxivID(doi)||(row.source==='arXiv'?discoveryArxivID(row.id||row.url):''),title=discoveryTitleKey(row.title);
 if(doi)keys.push('doi:'+doi);if(arxiv)keys.push('arxiv:'+arxiv);if(title.length>=(/\p{Script=Han}/u.test(title)?8:20))keys.push('title:'+title);
 return keys;
}
const SEMANTIC_FIELDS='paperId,title,abstract,year,publicationDate,url,externalIds,authors,venue,journal,citationCount,openAccessPdf,publicationTypes';
export function semanticFeedRecord(p){
 if(!p?.paperId||!p.title)return null;const ids=p.externalIds||{},pdf=/^https:\/\//i.test(p.openAccessPdf?.url||'')?p.openAccessPdf.url:'',types=p.publicationTypes||[],venue=p.journal?.name||p.venue||'';
 return{id:p.paperId,s2Id:p.paperId,title:cleanText(p.title),abstract:cleanText(p.abstract),date:p.publicationDate||String(p.year||''),doi:ids.DOI||'',...(ids.ArXiv?{arxiv:discoveryArxivID(ids.ArXiv)}:{}),...(ids.PubMedCentral?{pmcid:'PMC'+String(ids.PubMedCentral).replace(/^PMC/i,'')}:{}),url:p.url||(ids.DOI?'https://doi.org/'+ids.DOI:''),pdf,pdfCandidates:pdf?[pdf]:[],journal:venue,sourceName:venue,sourceID:'',sourceType:types.includes('JournalArticle')?'journal':types.includes('Conference')?'conference':ids.ArXiv&&!venue?'repository':'',source:'Semantic Scholar',citationCount:p.citationCount??null,oa:!!pdf,retracted:false,authors:(p.authors||[]).map(a=>({lastName:a.name||'',firstName:'',fieldMode:1}))};
}
export function semanticSearchURL({query,filters={},offset=0,limit=100}){
 const parameters=new URLSearchParams({query,offset:String(offset),limit:String(limit),fields:SEMANTIC_FIELDS}),range=discoveryDateRange(filters);
 if(range.from||range.to)parameters.set('year',(range.from?range.from.slice(0,4):'')+'-'+(range.to?range.to.slice(0,4):''));
 return 'https://api.semanticscholar.org/graph/v1/paper/search?'+parameters+(filters.pdfOnly?'&openAccessPdf':'');
}
export function arxivFeedRecord(p){
 const arxiv=discoveryArxivID(p?.id)||discoveryArxivID(p?.url);if(!arxiv||!p.title)return null;const pdf=/^https:\/\//i.test(p.pdf||'')?p.pdf:'https://arxiv.org/pdf/'+arxiv;
 return{...p,arxiv,title:cleanText(p.title),abstract:cleanText(p.abstract),source:'arXiv',sourceType:'repository',journal:'',pdf,pdfCandidates:[pdf],oa:true,retracted:null,citationCount:null};
}
export function crossrefSearchURL({query,filters={},offset=0,limit=50}){
 const range=discoveryDateRange(filters),restrictions=[...(filters.journalOnly?['type:journal-article']:['type:journal-article','type:proceedings-article','type:posted-content']),...(filters.pdfOnly?['has-full-text:true']:[]),...(range.from?['from-pub-date:'+range.from]:[]),...(range.to?['until-pub-date:'+range.to]:[])];
 // query.bibliographic matches title, authors, venue and year, not funder or
 // reference text; select names only the fields crossrefFeedRecord reads.
 const parameters=new URLSearchParams({'query.bibliographic':query,rows:String(limit),offset:String(offset),filter:restrictions.join(','),select:'DOI,title,type,container-title,ISSN,published,published-online,published-print,issued,abstract,author,is-referenced-by-count,link,license,update-to,URL'});
 if(filters.sort==='date'||filters.sort==='citations'){parameters.set('sort',filters.sort==='date'?'published':'is-referenced-by-count');parameters.set('order','desc');}
 return 'https://api.crossref.org/works?'+parameters;
}
export function coreFeedRecord(p){
 if(!p?.id||!p.title)return null;const links=[p.downloadUrl,...(p.links||[]).filter(link=>link?.type==='download').map(link=>link.url),...(p.sourceFulltextUrls||[])].filter(url=>/^https:\/\//i.test(url||'')),pdf=links.find(url=>/core\.ac\.uk\/download\//i.test(url))||links[0]||'',journal=p.journals?.[0]?.title||'',issn=(p.journals?.[0]?.identifiers||[]).map(value=>String(value).replace(/^issn:/i,'')).find(value=>/^\d{4}-?\d{3}[\dX]$/i.test(value))||'';
 return{id:'https://core.ac.uk/works/'+p.id,coreId:String(p.id),title:cleanText(p.title),abstract:cleanText(p.abstract),doi:p.doi||'',...(p.arxivId?{arxiv:discoveryArxivID(p.arxivId)}:{}),url:p.doi?'https://doi.org/'+p.doi:'https://core.ac.uk/works/'+p.id,pdf,pdfCandidates:[...new Set(links)].slice(0,4),journal,sourceName:journal,issn,sourceID:'',sourceType:journal?'journal':'repository',source:'CORE',date:p.publishedDate?String(p.publishedDate).slice(0,10):String(p.yearPublished||''),citationCount:Number.isFinite(Number(p.citationCount))?Number(p.citationCount):null,oa:!!pdf,retracted:false,authors:(p.authors||[]).map(a=>({lastName:a.name||'',fieldMode:1}))};
}
export const coreSearchURL=({query,offset=0,limit=50})=>'https://api.core.ac.uk/v3/search/works?'+new URLSearchParams({q:query,offset:String(offset),limit:String(limit)});
const springerText=value=>typeof value==='string'?cleanText(value):Array.isArray(value)?value.map(springerText).join(' ').trim():value&&typeof value==='object'?Object.values(value).map(springerText).join(' ').trim():'';
export function springerFeedRecord(p){
 if(!p?.title)return null;const doi=p.doi||String(p.identifier||'').replace(/^doi:/i,''),open=String(p.openaccess)==='true',link=(p.url||[]).find(entry=>entry?.format==='pdf'&&/^https?:\/\//i.test(entry.value||'')),pdf=open&&link?link.value.replace(/^http:\/\//i,'https://'):'',journal=cleanText(p.publicationName);
 return{id:doi?'https://doi.org/'+doi:'springer:'+discoveryTitleKey(p.title),doi,title:cleanText(p.title),abstract:springerText(p.abstract),url:doi?'https://doi.org/'+doi:'',pdf,pdfCandidates:pdf?[pdf]:[],journal,sourceName:journal,issn:p.issn||p.eIssn||'',sourceID:'',sourceType:/journal/i.test(p.publicationType||'')||/article/i.test(p.contentType||'')?'journal':'',source:'Springer Nature',date:String(p.publicationDate||p.onlineDate||'').slice(0,10),citationCount:null,oa:open,retracted:false,authors:(p.creators||[]).map(c=>{const [last,first]=String(c?.creator||'').split(/,\s*/);return{lastName:last||'',firstName:first||'',fieldMode:0};})};
}
export const springerSearchURL=({query,offset=0,limit=50})=>'https://api.springernature.com/meta/v2/json?'+new URLSearchParams({q:query,s:String(offset+1),p:String(limit)});
// Rows from several indexes are merged by DOI, arXiv number or normalized
// title and year. A merged record stays one object, so cards already shown
// keep their identity while later indexes fill in its fields.
const PRIORITY=['openalex','crossref','springer','semantic','core','arxiv','europepmc'];
const indexOf=label=>{const id=Object.keys(DISCOVERY_INDEX_LABELS).find(key=>DISCOVERY_INDEX_LABELS[key]===label);return id?PRIORITY.indexOf(id):PRIORITY.length;};
const venueScore=row=>row.sourceType==='journal'?(row.issn?4:3):row.sourceType==='conference'?2:row.journal&&row.sourceType!=='repository'?1:0;
function mergeDiscoveryRecord(target,row){
 const rank=Math.min(...(row.sources||[row.source]).map(indexOf)),current=Math.min(...(target.sources||[target.source]).map(indexOf)),better=rank<current;
 const targetDOI=discoveryDOI(target.doi),rowDOI=discoveryDOI(row.doi),upgrade=!!rowDOI&&!preprintDOI(rowDOI)&&(!targetDOI||preprintDOI(targetDOI));
 if(upgrade||!targetDOI&&rowDOI)target.doi=row.doi;
 if(venueScore(row)>venueScore(target)||venueScore(row)===venueScore(target)&&better&&row.journal){for(const key of ['journal','sourceName','sourceType','issn','issns'])if(row[key]!==undefined&&row[key]!=='')target[key]=row[key];if(row.sourceID)target.sourceID=row.sourceID;}
 else if(!target.sourceID&&row.sourceID&&discoveryTitleKey(row.journal)===discoveryTitleKey(target.journal))target.sourceID=row.sourceID;
 if(!target.date||upgrade&&row.date||String(row.date||'').length>String(target.date).length&&String(row.date).slice(0,4)===String(target.date).slice(0,4))target.date=row.date||target.date;
 if(row.url&&(!target.url||upgrade))target.url=row.url;
 if(String(row.abstract||'').length>String(target.abstract||'').length)target.abstract=row.abstract;
 if((row.authors||[]).length>(target.authors||[]).length)target.authors=row.authors;
 if(Number.isFinite(row.citationCount)&&!(target.citationCount>=row.citationCount))target.citationCount=row.citationCount;
 for(const key of ['keywords','topicIDs'])if(row[key]?.length)target[key]=[...new Set([...(target[key]||[]),...row[key]])].slice(0,12);
 const pdfs=[...new Set([target.pdf,...(target.pdfCandidates||[]),row.pdf,...(row.pdfCandidates||[])].filter(url=>/^https:\/\//i.test(String(url||''))))].slice(0,6);
 target.pdfCandidates=pdfs;if(!/^https:\/\//i.test(target.pdf||''))target.pdf=pdfs[0]||'';
 for(const key of ['arxiv','pmcid','s2Id','coreId','openalexId','license'])if(!target[key]&&row[key])target[key]=row[key];
 target.oa=target.oa===true||row.oa===true;target.retracted=target.retracted===true||row.retracted===true;
 target.sources=[...new Set([...(target.sources||[target.source]),...(row.sources||[row.source])])].sort((a,b)=>indexOf(a)-indexOf(b));target.source=target.sources[0];
 return target;
}
export function createDiscoveryMergePool(){
 const index=new Map(),entries=[];let order=0;
 const compatible=(entry,row,key)=>{const a=discoveryDOI(entry.record.doi),b=discoveryDOI(row.doi);if(a&&b&&a!==b&&!preprintDOI(a)&&!preprintDOI(b))return false;if(!key.startsWith('title:'))return true;const x=yearOf(entry.record),y=yearOf(row);return !x||!y||Math.abs(x-y)<=1;};
 const register=entry=>{for(const key of discoveryMergeKeys(entry.record)){const list=index.get(key)||[];if(!list.includes(entry))list.push(entry);index.set(key,list);}};
 // Rows in one index's order; rank is that index's rank of the first row.
 function add(name,rows,start=0){
  let added=0;
  rows.forEach((raw,i)=>{
   if(!raw?.title)return;const row={...raw,sources:[raw.source||DISCOVERY_INDEX_LABELS[name]]},matches=[];
   for(const key of discoveryMergeKeys(row))for(const entry of index.get(key)||[])if(!entry.merged&&!matches.includes(entry)&&compatible(entry,row,key))matches.push(entry);
   matches.sort((a,b)=>Number(b.served)-Number(a.served)||a.order-b.order);
   let entry=matches[0];
   if(entry){mergeDiscoveryRecord(entry.record,row);for(const other of matches.slice(1)){if(other.served)continue;mergeDiscoveryRecord(entry.record,other.record);other.merged=true;for(const [source,rank] of Object.entries(other.ranks))entry.ranks[source]=Math.min(entry.ranks[source]??Infinity,rank);}}
   else{entry={record:mergeDiscoveryRecord({...row,pdfCandidates:[...(row.pdfCandidates||[])]},row),ranks:{},order:order++,served:false};entries.push(entry);added++;}
   entry.ranks[name]=Math.min(entry.ranks[name]??Infinity,start+i);register(entry);
  });
  return added;
 }
 return{add,get entries(){return entries.filter(entry=>!entry.merged);}};
}
// Interleaves the indexes by rank (reciprocal-rank fusion; Crossref, whose
// relevance order is loose, counts half): a paper several indexes return moves
// up; ties keep OpenAlex first. With text (record -> [0,1] text relevance) the
// relevance order is mostly the text score, then the fused rank, a small bonus
// when two indexes found the paper and for a DOI, an abstract and an open PDF.
const RANK_WEIGHT={crossref:0.5};
export function discoveryEntryScore(entry,text){
 const fused=Object.entries(entry.ranks).reduce((sum,[name,rank])=>sum+(RANK_WEIGHT[name]??1)/(10+rank),0);if(!text)return fused;
 const record=entry.record,providers=new Set(record.sources||[record.source]).size;
 return 0.65*(text.get(record)||0)+0.25*Math.min(1,fused*10)+(providers>1?0.05:0)+(record.doi?0.02:0)+(String(record.abstract||'').length>40?0.02:0)+(/^https:\/\//i.test(record.pdf||'')?0.01:0);
}
export function rankDiscoveryEntries(entries,names=PRIORITY,{text}={}){
 const scores=new Map(entries.map(entry=>[entry,discoveryEntryScore(entry,text)])),first=entry=>Math.min(...Object.entries(entry.ranks).map(([name,rank])=>rank*names.length+Math.max(0,names.indexOf(name))));
 return [...entries].sort((a,b)=>scores.get(b)-scores.get(a)||first(a)-first(b)||a.order-b.order);
}
export function europePMCFeedURL({mode,query='',filters={},sources=[],cursor='*',limit=20,now=Date.now()}={}){
 const clauses=['OPEN_ACCESS:Y','HAS_PDF:Y','NOT PUB_TYPE:"Retracted Publication"','NOT PUB_TYPE:"Retraction of Publication"'];
 // Reserve API query syntax for our own filters. Each topic word is a quoted
 // term joined with AND, so a user's colon or parenthesis cannot remove the
 // OA/PDF restriction and a multi-word topic does not need the exact phrase.
 let words=query.trim().split(/\s+/)
  .map(word=>word.replace(/["\\]/g,''))
  .filter(Boolean);
 if(words.length)clauses.unshift(words.map(word=>'"'+word+'"').join(' AND '));
 const issns=sources.map(source=>source.issn).filter(issn=>/^\d{4}-\d{3}[\dX]$/i.test(issn||''));if(issns.length===sources.length&&issns.length)clauses.push('('+issns.map(issn=>'ISSN:'+issn).join(' OR ')+')');
 const range=discoveryDateRange(filters,{mode,now});if(range.from||range.to)clauses.push('FIRST_PDATE:['+(range.from||'1000-01-01')+' TO '+(range.to||'3000-12-31')+']');
 if(filters.journalOnly)clauses.push('PUB_TYPE:"Journal Article"');
 const parameters=new URLSearchParams({query:clauses.join(' AND '),format:'json',resultType:'core',pageSize:String(Math.min(100,Math.max(5,Number(limit)||20))),cursorMark:cursor||'*'});
 if(filters.sort!=='relevance')parameters.set('sort',filters.sort==='citations'||!filters.sort&&mode==='trends'?'CITED desc':'FIRST_PDATE_D desc');
 return 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?'+parameters;
}
