/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {arxivID} from './arxiv.mjs';
export const referenceArxiv = text => arxivID(String(text||'').match(/(?:arxiv\s*:\s*|arxiv\.org\/(?:abs|pdf)\/|10\.48550\/arxiv\.)((?:\d{4}\.\d{4,5}|[a-z][a-z.-]*\/\d{7})(?:v[1-9]\d*)?)/i)?.[1]);
const identity = p => p.doi?'doi:'+cleanDOI(p.doi):'arxiv:'+(arxivID(p.id)||arxivID(p.url));
export const cleanDOI = value => String(value || '').trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '').replace(/[.,;]+$/, '').toLowerCase();
const norm = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
// These are supplied by metadata providers or the user's library. Never infer
// a subject from a title just to fill an empty row in the reference pane.
export function referenceTags(p) {
 const values=value=>Array.isArray(value)?value:typeof value==='string'?[value]:[];
 const tags=[...values(p.tags),...values(p.subject),...values(p.keywords)],seen=new Set();
 return tags.map(t=>typeof t==='string'?t:t?.tag||t?.name||'').map(t=>t.normalize('NFKC').trim()).filter(t=>{const key=t.toLowerCase();if(!key||seen.has(key))return false;seen.add(key);return true;});
}
export function crossrefRecord(p) {
 return {id:p.DOI,doi:cleanDOI(p.DOI),title:p.title?.[0]||'',abstract:p.abstract||'',tags:referenceTags(p),date:String(p.published?.['date-parts']?.[0]?.[0]||''),journal:p['container-title']?.[0]||'',url:p.URL||'https://doi.org/'+p.DOI,source:'Crossref',authors:(p.author||[]).map(a=>({lastName:a.family||a.name||'',firstName:a.given||''}))};
}
export function referenceFromCrossref(p,i) {
 return {id:p.key||String(i+1),doi:cleanDOI(p.DOI),title:p['article-title']||'',quote:p.unstructured||[p.author,p['article-title'],p['journal-title'],p.year,p.DOI].filter(Boolean).join('. '),date:String(p.year||''),author:p.author||'',origin:'Crossref 登记的参考文献'};
}
export const REFERENCE_PARSE_VERSION='pdf-references-5';
export function parseReferenceText(text) {
 const heads=[...String(text||'').matchAll(/(?:^|\n)\s*(?:[IVX\d.]+\s+)?(?:REFERENCES|BIBLIOGRAPHY|参考文献)\s*(?:\n|$)/gi)];
 if(!heads.length)return [];
 const h=heads.at(-1),tail=text.slice(h.index+h[0].length).split(/(?:\n|\s)(?:APPENDIX|ACKNOWLEDGMENTS|作者简介|Publisher[’']s Note)\b/i)[0];
 // PDFWorker can join a numbered label directly to its author: [2]M. Wang.
 // The bracketed label is the boundary; whitespace after it is optional.
 let entries=[...tail.matchAll(/(?:^|\s)\[(\d+)\]\s*([\s\S]*?)(?=\s\[\d+\]|$)/g)];
 if(!entries.length){
  // PDFWorker joins every printed line in a paragraph. Springer bibliographies
  // can therefore contain 30 numbered entries on one line. Require a coherent
  // sequence before treating an inline number as a reference boundary; page,
  // volume and conference numbers must remain inside their own reference.
  const markers=[...tail.matchAll(/(?:^|\s)(\d{1,4})\.[ \t]+(?=\p{Lu}|(?:de|van|von|da|del|der|di|le|al)\s)/gu)],runs=[];
  for(const marker of markers){let run=runs.find(run=>Number(run.at(-1)[1])+1===Number(marker[1]));if(!run){run=[];runs.push(run);}run.push(marker);}
  const ordered=runs.sort((a,b)=>b.length-a.length)[0]||[];
  if(ordered.length>=2)entries=ordered.map((marker,i)=>[marker[0],marker[1],tail.slice(marker.index+marker[0].length,ordered[i+1]?.index??tail.length)]);
  else entries=[...tail.matchAll(/(?:^|\n)\s*(\d+)\.\s+([\s\S]*?)(?=\n\s*\d+\.\s|$)/g)];
 }
 const repeated=new Map();for(const line of String(text).split('\n')){const value=line.trim();if(value)repeated.set(value,(repeated.get(value)||0)+1);}
 return entries.filter(m=>m[2].trim().length>15).slice(0,2000).map(m=>{const quote=m[2].split('\n').filter(line=>!/^\s*Page\s+\d+\s+of\s+\d+\s*$/i.test(line)&&!((repeated.get(line.trim())||0)>=3&&line.trim().length<150)).join('\n').replace(/\s*Page\s+\d+\s+of\s+\d+\s*$/i,'').replace(/-\s*\n\s*/g,'').replace(/\s+/g,' ').trim(),title=quote.match(/[“"]([^”"]{8,400})[”"]/)?.[1]?.replace(/[.,，]+$/, '')||'',doi=cleanDOI(quote.match(/10\.\d{4,9}\/[^\s<>]+/i)?.[0]);return {id:m[1],title,quote,doi,date:quote.match(/\b(?:19|20)\d{2}\b/)?.[0]||'',origin:'当前 PDF 参考文献'};});
}
// A similar title alone never establishes a citation. Require the registered DOI,
// or the complete title with corroborating author/year in the actual bibliography.
export function matchesReference(ref,p) {
 if(!p.title)return false;
 const aid=referenceArxiv(ref.quote);if(!ref.doi&&aid)return aid===(arxivID(p.id)||arxivID(p.url));
 if(!p.doi)return false;
 if(ref.doi)return cleanDOI(ref.doi)===cleanDOI(p.doi);
 const title=norm(p.title),quote=norm(ref.quote),expected=norm(ref.title);
 if(title.length<16||!(expected?title===expected:quote.includes(title)))return false;
 const year=String(p.date||'').match(/(?:19|20)\d{2}/)?.[0];
 if(ref.date&&year&&ref.date!==year)return false;
 const authorText=norm(ref.author||ref.quote),author=(p.authors||[]).some(a=>norm(a.lastName).length>2&&authorText.includes(norm(a.lastName)));
 return !!(author&&year&&(ref.date===year||String(ref.quote).includes(year)));
}
export function selectReferenceCandidate(ref,candidates) {
 const matches=[...new Map(candidates.filter(p=>matchesReference(ref,p)).map(p=>[identity(p),p])).values()];
 return matches.length===1?matches[0]:null;
}
export async function resolveReferences(refs,{lookup,signal,onProgress=()=>{},limit=150,budget=90000,now=Date.now}={}) {
 const started=now(),resolved=new Array(refs.length),skipped=[];let next=0,done=0;
 const check=()=>{if(signal?.aborted)throw Error('已取消参考文献收集');};
 async function worker(){while(next<refs.length){check();const index=next++,ref=refs[index];let reason='未找到可核验题录';
  if(index>=limit||now()-started>budget)reason='本次检索范围或等待时间已达上限';
  else try{const found=selectReferenceCandidate(ref,await lookup(ref));check();if(found)resolved[index]={...found,incomplete:false,reason:'当前论文引用的文献 · 已匹配题录',citationOrigins:[ref]};}
  catch(e){check();reason='题录检索失败：'+e.message;}
  if(!resolved[index])skipped.push({referenceID:ref.id,reason});onProgress({done:++done,total:refs.length,found:resolved.filter(Boolean).length,index,reference:ref,record:resolved[index]||null,reason:resolved[index]?'':reason});
 }}
 await Promise.all([worker(),worker()]);check();const unique=new Map();let reused=0;
 for(const p of resolved.filter(Boolean)){const key=identity(p);if(unique.has(key)){unique.get(key).citationOrigins.push(...p.citationOrigins);reused++;}else unique.set(key,p);}
 return {records:[...unique.values()],total:refs.length,skipped,reused};
}
