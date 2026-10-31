/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {cleanDOI,referenceArxiv,crossrefRecord,matchesReference} from './reference-matcher.mjs';

export const REFERENCE_LOOKUP_VERSION='public-reference-2';
export const checkReferenceSignal=signal=>{if(signal?.aborted)throw Object.assign(Error('已取消参考文献读取'),{name:'AbortError'});};

/** A request belongs to its current consumers. Closing one reader leaves the
 * other reader intact; closing the last reader stops the actual provider IO. */
export function consumeReferenceTask(tasks,key,work,{signal,createController=()=>new AbortController()}={}){
 checkReferenceSignal(signal);let task=tasks.get(key);
 if(task?.controller.signal.aborted){tasks.delete(key);task=null;}
 if(!task){
  task={controller:createController(),consumers:new Set()};tasks.set(key,task);
  task.promise=Promise.resolve().then(()=>work(task.controller.signal)).finally(()=>{if(tasks.get(key)===task)tasks.delete(key);});
 }
 return new Promise((resolve,reject)=>{
  let settled=false;
  const consumer={},finish=(fn,value)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',cancel);task.consumers.delete(consumer);fn(value);};
  const cancel=()=>{finish(reject,Object.assign(Error('已取消参考文献读取'),{name:'AbortError'}));if(!task.consumers.size){task.controller.abort();if(tasks.get(key)===task)tasks.delete(key);}};
  task.consumers.add(consumer);signal?.addEventListener('abort',cancel,{once:true});task.promise.then(value=>finish(resolve,value),error=>finish(reject,error));if(signal?.aborted)cancel();
 });
}

const namedAuthor=name=>{const words=String(name||'').trim().split(/\s+/u);return {lastName:words.pop()||'',firstName:words.join(' ')};};
const semanticRecord=p=>({id:p.paperId||p.externalIds?.ArXiv||'',title:p.title||'',abstract:p.abstract||'',doi:cleanDOI(p.externalIds?.DOI),url:p.externalIds?.ArXiv?'https://arxiv.org/abs/'+p.externalIds.ArXiv:p.url||'',date:p.publicationDate||String(p.year||''),journal:p.venue||'',source:'Semantic Scholar',pdf:p.openAccessPdf?.url||'',authors:(p.authors||[]).map(person=>namedAuthor(person.name))});
// Only an open-access copy gives the PDF: primary_location is the version of record,
// and its pdf_url can be the paywalled publisher file. oa_url may be a landing page.
const openalexPDF=p=>{
 const location=[p.best_oa_location,p.primary_location,...(p.locations||[])].find(x=>x?.pdf_url&&(x===p.best_oa_location?x.is_oa!==false:x.is_oa));
 return location?.pdf_url||(p.open_access?.is_oa!==false&&/\.pdf(?:[?#]|$)/i.test(p.open_access?.oa_url||'')?p.open_access.oa_url:'');
};
const openalexRecord=p=>{
 const words=[];for(const [word,positions]of Object.entries(p.abstract_inverted_index||{}))for(const index of positions)words[index]=word;
 return {id:p.id||'',title:p.title||p.display_name||'',abstract:words.join(' '),doi:cleanDOI(p.doi),url:p.doi||p.primary_location?.landing_page_url||'',date:p.publication_date||String(p.publication_year||''),journal:p.primary_location?.source?.display_name||'',source:'OpenAlex',pdf:openalexPDF(p),authors:(p.authorships||[]).map(person=>namedAuthor(person.author?.display_name))};
};

/** Public metadata fallbacks still have to match the printed reference. Search
 * results are candidates, never evidence that a paper has been identified. */
export async function lookupReferenceMetadata(E,ref,{signal,requireAbstract=false,Parser}={}){
 checkReferenceSignal(signal);const doi=cleanDOI(ref.doi),arxiv=referenceArxiv(ref.doi)||(!doi&&referenceArxiv(ref.quote)),query=String(ref.title||ref.quote||'').trim(),records=[],errors=[];
 const accepted=()=>records.some(record=>matchesReference(ref,record)&&(!requireAbstract||record.abstract?.trim()));
 const add=values=>{for(const value of values||[]){if(!value?.title)continue;const record={...value};if(Parser)record.abstract=new Parser().parseFromString(record.abstract||'','text/html').body.textContent.trim();records.push(record);}};
 const attempt=async fn=>{checkReferenceSignal(signal);try{const values=await fn();checkReferenceSignal(signal);add(values);}catch(error){checkReferenceSignal(signal);errors.push(error.message);}};
 const request=async url=>{const value=JSON.parse(await E.requestProvider(url,{signal},12000));checkReferenceSignal(signal);return value;};
 if(arxiv&&E.arxivMetadata){await attempt(async()=>{const record=await E.arxivMetadata(arxiv,{signal});return [{...record,...(doi?{doi}: {})}];});if(accepted())return records;}
 if(E.requestProvider){
  await attempt(async()=>{const data=(await request(doi?'https://api.crossref.org/works/'+encodeURIComponent(doi):'https://api.crossref.org/works?query.bibliographic='+encodeURIComponent(query.slice(0,700))+'&rows=12')).message;return (doi?[data]:data?.items||[]).map(crossrefRecord);});
  if(accepted())return records;
  await attempt(async()=>{const data=await request(doi?'https://api.openalex.org/works/https://doi.org/'+encodeURIComponent(doi):'https://api.openalex.org/works?search='+encodeURIComponent(query.slice(0,500))+'&per-page=12');return (doi?[data]:data.results||[]).map(openalexRecord);});
  if(accepted())return records;
  await attempt(async()=>{const fields='paperId,title,abstract,externalIds,url,year,venue,authors,openAccessPdf',data=await request(doi?'https://api.semanticscholar.org/graph/v1/paper/DOI:'+encodeURIComponent(doi)+'?fields='+fields:'https://api.semanticscholar.org/graph/v1/paper/search?query='+encodeURIComponent(query.slice(0,500))+'&limit=12&fields='+fields);return (doi?[data]:data.data||[]).map(semanticRecord);});
 }else if(E.discoverySearch){await attempt(()=>E.discoverySearch(query,{signal}));}
 checkReferenceSignal(signal);
 if(!records.length&&errors.length)throw Error(errors.join('；'));
 return records;
}
