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
export function crossrefFeedRecord(p,{now=Date.now()}={}){
 const license=(p.license||[]).find(entry=>/^https?:\/\/(?:www\.)?creativecommons\.org\/(?:licenses|publicdomain)\//i.test(entry.URL||'')&&(!entry.start?.['date-time']||Date.parse(entry.start['date-time'])<=now));
 const link=license&&(p.link||[]).find(entry=>/^https:\/\//i.test(entry.URL||'')&&(/application\/pdf/i.test(entry['content-type']||'')||/(?:\.pdf(?:[?#]|$)|\/pdf(?:[/?#]|$)|[?&]pdf=)/i.test(entry.URL)));
 if(!p.DOI||!p.title?.[0]||!link)return null;
 const type=p.type==='journal-article'?'journal':p.type==='proceedings-article'?'conference':p.type==='posted-content'?'repository':'';
 return{id:'https://doi.org/'+p.DOI,doi:p.DOI,title:cleanText(p.title[0]),abstract:cleanText(p.abstract),url:p.URL||'https://doi.org/'+p.DOI,pdf:link.URL,oa:true,retracted:(p['update-to']||[]).some(update=>/retract/i.test(update.type||'')),source:'Crossref',sourceType:type,sourceID:'',journal:cleanText(p['container-title']?.[0]),sourceName:cleanText(p['container-title']?.[0]),issn:p.ISSN?.[0]||'',issns:p.ISSN||[],date:isoDate((p.published||p['published-online']||p['published-print']||p.issued)?.['date-parts']?.[0]),citationCount:p['is-referenced-by-count']??null,license:license.URL,authors:(p.author||[]).map(author=>author.family?{lastName:author.family,firstName:author.given||'',fieldMode:0}:{lastName:author.name||'',fieldMode:1})};
}
export function europePMCFeedRecord(p){
 const entries=p.fullTextUrlList?.fullTextUrl||[],link=entries.find(entry=>entry.documentStyle?.toLowerCase()==='pdf'&&/^(?:OA|F)$/i.test(entry.availabilityCode||'')&&/^https:\/\//i.test(entry.url||''));
 if(p.isOpenAccess!=='Y'||p.hasPDF!=='Y'||!link||!p.title)return null;
 const journal=p.journalInfo?.journal||{},authors=p.authorList?.author||[],types=p.pubTypeList?.pubType||[];
 return{id:p.pmcid?'https://europepmc.org/articles/'+p.pmcid:'https://europepmc.org/article/'+p.source+'/'+p.id,doi:p.doi||'',title:cleanText(p.title),abstract:cleanText(p.abstractText),url:p.doi?'https://doi.org/'+p.doi:link.url,pdf:link.url,oa:true,retracted:types.some(type=>/retract/i.test(type)),source:'Europe PMC',sourceType:journal.title?'journal':'repository',sourceID:'',sourceName:journal.title||'',journal:journal.title||'',issn:journal.issn||journal.essn||'',issns:[journal.issn,journal.essn].filter(Boolean),date:p.firstPublicationDate||p.journalInfo?.dateOfPublication||String(p.pubYear||''),citationCount:Number.isFinite(Number(p.citedByCount))?Number(p.citedByCount):null,pmcid:p.pmcid||'',authors:authors.length?authors.map(author=>author.lastName?{lastName:author.lastName,firstName:author.firstName||'',fieldMode:0}:{lastName:author.fullName||author.collectiveName||'',fieldMode:1}):p.authorString?[{lastName:p.authorString,fieldMode:1}]:[]};
}
export function crossrefFeedURL({mode,query='',filters={},sources=[],cursor,page=1,limit=20,now=Date.now()}={}){
 const parameters=new URLSearchParams({rows:String(Math.min(100,Math.max(5,Number(limit)||20)))}),restrictions=['has-full-text:true'];
 if(query.trim())parameters.set('query',query.trim());if(sources.length)parameters.set('query.container-title',sources.map(source=>source.name||source.issn).filter(Boolean).join(' '));
 if(filters.journalOnly)restrictions.push('type:journal-article');const range=discoveryDateRange(filters,{mode,now});if(range.from)restrictions.push('from-pub-date:'+range.from);if(range.to)restrictions.push('until-pub-date:'+range.to);
 parameters.set('filter',restrictions.join(','));if(cursor!=null||page===1)parameters.set('cursor',cursor||'*');else parameters.set('offset',String((page-1)*limit));
 if(filters.sort!=='relevance'){parameters.set('sort',filters.sort==='citations'||!filters.sort&&mode==='trends'?'is-referenced-by-count':'published');parameters.set('order','desc');}
 return 'https://api.crossref.org/works?'+parameters;
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
