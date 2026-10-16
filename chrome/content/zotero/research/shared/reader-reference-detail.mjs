/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {cleanDOI,referenceArxiv,matchesReference,selectReferenceCandidate,crossrefRecord} from './reference-matcher.mjs';
import {prepareReaderPaneStyles} from './reader-pane-styles.mjs';

const tasks=new Map();
export function prepareReferenceDetailStyles(doc,{Zotero}){
 return prepareReaderPaneStyles(doc,{Zotero,name:'references',url:'chrome://zotero/content/research/shared/reader-reference-detail.css'});
}
const abort=signal=>{if(signal?.aborted)throw Error('已取消摘要读取');};
const plain=(text,Parser)=>{if(!Parser)return String(text||'').trim();return new Parser().parseFromString(String(text||''),'text/html').body.textContent.trim();};
export function referenceAbstractKey(ref,record){const doi=cleanDOI(ref?.doi||record?.doi),arxiv=referenceArxiv(ref?.quote)||referenceArxiv(record?.url)||referenceArxiv('arxiv:'+record?.id);return doi?'doi:'+doi:arxiv?'arxiv:'+arxiv:'';}
const accepted=(ref,record,candidate)=>!!candidate?.abstract?.trim()&&(record?.doi?cleanDOI(candidate.doi)===cleanDOI(record.doi):matchesReference(ref,candidate));

/** Retrieve provider text with an exact DOI/arXiv identity. A similar title or
 * a model-written summary must never be substituted for an original abstract. */
export async function fetchReferenceAbstract(E,ref,record,{signal,refresh=false,doc}={}){
 const Parser=doc?.defaultView?.DOMParser||globalThis.DOMParser;
 abort(signal);if(record?.abstract?.trim())return {...record,abstract:plain(record.abstract,Parser)};
 const key=referenceAbstractKey(ref,record),cached=key&&E.store?.get?.()?.referenceAbstractMetadata?.[key];
 if(!refresh&&cached&&Date.now()-cached.at<604800000){abort(signal);return cached.record;}
 const taskKey=key||'title:'+String(ref.title||ref.quote),existing=tasks.get(taskKey);
 const task=existing||(async()=>{
  let found;
  const tryProvider=async fn=>{try{const value=await fn();if(accepted(ref,record,value)){found={...record,...value,abstract:plain(value.abstract,Parser),citationOrigins:record?.citationOrigins||[ref]};return true;}}catch(error){/* Other public metadata providers can still supply the original. */}return false;};
  if(key.startsWith('arxiv:')&&E.arxivMetadata)await tryProvider(()=>E.arxivMetadata(key.slice(6)));
  else if(key.startsWith('doi:')){
   const doi=key.slice(4),request=async url=>JSON.parse(await E.requestProvider(url,{},12000));
   await tryProvider(async()=>{const p=await request('https://api.semanticscholar.org/graph/v1/paper/DOI:'+encodeURIComponent(doi)+'?fields=title,abstract,externalIds,url,year,venue');return {title:p.title,abstract:p.abstract||'',doi:p.externalIds?.DOI||'',url:p.url,date:String(p.year||''),journal:p.venue,source:'Semantic Scholar'};});
   if(!found)await tryProvider(async()=>{const p=await request('https://api.openalex.org/works/https://doi.org/'+encodeURIComponent(doi)),words=[];for(const [word,positions]of Object.entries(p.abstract_inverted_index||{}))for(const index of positions)words[index]=word;return {title:p.title,abstract:words.join(' '),doi:cleanDOI(p.doi),url:p.doi,date:String(p.publication_year||''),journal:p.primary_location?.source?.display_name,source:'OpenAlex'};});
   if(!found)await tryProvider(async()=>crossrefRecord((await request('https://api.crossref.org/works/'+encodeURIComponent(doi))).message));
  }else if(E.discoverySearch){
   await tryProvider(async()=>selectReferenceCandidate(ref,await E.discoverySearch(ref.title||ref.quote)));
  }
  if(!found)return null;
  if(key&&E.store?.update)await E.store.update(state=>{state.referenceAbstractMetadata||={};state.referenceAbstractMetadata[key]={at:Date.now(),record:found};});
  return found;
 })();
 if(!existing){tasks.set(taskKey,task);task.finally(()=>{if(tasks.get(taskKey)===task)tasks.delete(taskKey);}).catch(()=>{});}
 const result=await task;abort(signal);return result;
}

export function createReferenceDetail(doc,{title,ref,record,onBack,onLocate,onDownload}){
 const node=(tag,cls,parent,text)=>{const value=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);value.className=cls;if(text!==undefined)value.textContent=text;parent?.append(value);return value;};
 const root=node('section','reader-reference-detail');root.setAttribute('aria-label','参考文献摘要详情');
 const header=node('header','reader-reference-detail-header',root),back=node('button','reader-reference-back',header,'‹');back.type='button';back.title='返回参考文献';back.setAttribute('aria-label','返回参考文献');back.onclick=onBack;node('span','reader-reference-detail-number',header,ref.id?'引用 '+ref.id:'参考文献');
 const icon=(label,path,fn)=>{const button=node('button','reader-reference-action',header);button.type='button';button.title=label;button.setAttribute('aria-label',label);const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const p=doc.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',path);svg.append(p);button.append(svg);button.onclick=fn;return button;};
 const locate=icon('定位本文引用','M12 3v4m0 10v4M3 12h4m10 0h4M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z',onLocate),download=icon('获取公开全文','M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4',onDownload);download.hidden=!record;
 const reading=node('div','reader-reference-reading',root);node('h2','reader-reference-heading',reading,title);const meta=node('p','reader-reference-metadata',reading,[record?.journal,record?.date?.match(/(?:19|20)\d{2}/)?.[0]].filter(Boolean).join(' · '));meta.hidden=!meta.textContent;
 const originalSection=node('section','reader-reference-abstract-section',reading),originalLabel=node('h3','',originalSection,'Abstract'),original=node('p','reader-reference-abstract',originalSection);original.lang='en';
 const chineseSection=node('section','reader-reference-abstract-section',reading);node('h3','',chineseSection,'中文摘要');const chinese=node('p','reader-reference-abstract reader-reference-chinese',chineseSection);chinese.lang='zh-CN';chineseSection.hidden=true;
 const status=node('p','reader-reference-detail-status',reading,'正在获取原文摘要…');status.setAttribute('role','status');
 const source=node('a','reader-reference-provider',reading);source.target='_blank';source.rel='noopener';source.hidden=true;
 return {root,back,locate,download,original,chinese,chineseSection,status,setRecord(value){download.hidden=!value;meta.textContent=[value?.journal,value?.date?.match(/(?:19|20)\d{2}/)?.[0]].filter(Boolean).join(' · ');meta.hidden=!meta.textContent;original.textContent=value?.abstract||'';const english=!/[\u3400-\u9fff]/.test(value?.abstract||'');original.lang=english?'en':'zh-CN';originalLabel.textContent=english?'Abstract':'原文摘要';source.textContent=value?.source||'';source.href=value?.url||'';source.hidden=!value?.url;}};
}
