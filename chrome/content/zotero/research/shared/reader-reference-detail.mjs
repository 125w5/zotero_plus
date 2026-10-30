/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {cleanDOI,referenceArxiv,matchesReference,selectReferenceCandidate,crossrefRecord} from './reference-matcher.mjs';
import {prepareReaderPaneStyles} from './reader-pane-styles.mjs';
import {consumeReferenceTask,lookupReferenceMetadata} from './reference-metadata.mjs';

const tasksByEnvironment=new WeakMap();
export function prepareReferenceDetailStyles(doc,{Zotero}){
 return prepareReaderPaneStyles(doc,{Zotero,name:'references',url:'chrome://zotero/content/research/shared/reader-reference-detail.css'});
}
const abort=signal=>{if(signal?.aborted)throw Error('已取消摘要读取');};
const plain=(text,Parser)=>{if(!Parser)return String(text||'').trim();return new Parser().parseFromString(String(text||''),'text/html').body.textContent.trim();};
// Provider keys identify records, not the printed bibliography number. Keep
// those keys for matching and use a bounded label only in the reader chrome.
export function referenceDisplayNumber(ref={},index=0){
 const id=String(ref.id||'').trim();return /^[1-9]\d{0,3}$/.test(id)?id:String(index+1);
}
export function referenceAbstractKey(ref,record){const doi=cleanDOI(ref?.doi||record?.doi),arxiv=referenceArxiv(ref?.quote)||referenceArxiv(record?.url)||referenceArxiv('arxiv:'+record?.id);return doi?'doi:'+doi:arxiv?'arxiv:'+arxiv:'';}
const accepted=(ref,record,candidate)=>!!candidate?.abstract?.trim()&&(record?.doi?cleanDOI(candidate.doi)===cleanDOI(record.doi):matchesReference(ref,candidate));
const FOUND_ABSTRACT_TTL=7*24*60*60*1000;
const MISSING_ABSTRACT_TTL=60*60*1000;
let referenceTitleKey=ref=>{let text=String(ref?.title||ref?.quote||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim().slice(0,300);return text?'title:'+text:'';};
// HTTP 404/410 means that source does not index the work: an answer, not a failure.
let notIndexed=error=>[404,410].includes(error?.providerStatus)||/HTTP\s*(?:404|410)\b/.test(String(error?.message||''));
let failureText=errors=>[...new Set(errors.flatMap(error=>String(error?.message||'').split('；')).map(text=>{text=text.replace(/[。；;\s]+$/,'');return /\p{Script=Han}/u.test(text)?text:'公开来源暂时无法访问';}))].join('；')||'公开来源暂时无法访问';

/** Retrieve provider text with an exact DOI/arXiv identity. A similar title or
 * a model-written summary must never be substituted for an original abstract. */
export async function fetchReferenceAbstract(E,ref,record,{signal,refresh=false,doc}={}){
 const Parser=doc?.defaultView?.DOMParser||globalThis.DOMParser;
 abort(signal);if(record?.abstract?.trim())return {...record,abstract:plain(record.abstract,Parser)};
 // A found abstract is kept about 7 days; an absence or a failed lookup about
 // 1 hour. refresh bypasses only the absence or failure entry, never a found one.
 // A reference without DOI or arXiv caches only those entries, under its title.
 let key=referenceAbstractKey(ref,record),cacheKey=key||referenceTitleKey(ref),cached=cacheKey&&E.store?.get?.('referenceAbstractMetadata',cacheKey);
 if(cached&&(cached.record||!refresh)&&Date.now()-cached.at<(cached.record?FOUND_ABSTRACT_TTL:MISSING_ABSTRACT_TTL)){abort(signal);if(cached.error)throw Error(cached.error);return cached.record||null;}
 let tasks=tasksByEnvironment.get(E);if(!tasks){tasks=new Map();tasksByEnvironment.set(E,tasks);}
 const taskKey=key||'title:'+String(ref.title||ref.quote);
 return consumeReferenceTask(tasks,taskKey,async workSignal=>{
  abort(workSignal);
  // The absence is known once any source answered; only a lookup in which no
  // source answered is a failure.
  let found,answered=0,errors=[];
  const tryProvider=async fn=>{abort(workSignal);try{const value=await fn();abort(workSignal);answered++;if(accepted(ref,record,value)){found={...record,...value,abstract:plain(value.abstract,Parser),citationOrigins:record?.citationOrigins||[ref]};return true;}}catch(error){abort(workSignal);if(notIndexed(error))answered++;else errors.push(error);}return false;};
  const arxiv=key.startsWith('arxiv:')?key.slice(6):referenceArxiv(key.slice(4));
  if(arxiv&&E.arxivMetadata)await tryProvider(async()=>{const value=await E.arxivMetadata(arxiv,{signal:workSignal});return {...value,...(key.startsWith('doi:')?{doi:key.slice(4)}: {})};});
  if(!found&&key.startsWith('doi:')){
   const doi=key.slice(4),request=async url=>JSON.parse(await E.requestProvider(url,{signal:workSignal},12000));
   await tryProvider(async()=>{const p=await request('https://api.semanticscholar.org/graph/v1/paper/DOI:'+encodeURIComponent(doi)+'?fields=title,abstract,externalIds,url,year,venue');return {title:p.title,abstract:p.abstract||'',doi:p.externalIds?.DOI||'',url:p.url,date:String(p.year||''),journal:p.venue,source:'Semantic Scholar'};});
   if(!found)await tryProvider(async()=>{const p=await request('https://api.openalex.org/works/https://doi.org/'+encodeURIComponent(doi)),words=[];for(const [word,positions]of Object.entries(p.abstract_inverted_index||{}))for(const index of positions)words[index]=word;return {title:p.title,abstract:words.join(' '),doi:cleanDOI(p.doi),url:p.doi,date:String(p.publication_year||''),journal:p.primary_location?.source?.display_name,source:'OpenAlex'};});
   if(!found)await tryProvider(async()=>crossrefRecord((await request('https://api.crossref.org/works/'+encodeURIComponent(doi))).message));
  }else if(!found&&(E.discoverySearch||E.requestProvider)){
   await tryProvider(async()=>selectReferenceCandidate(ref,await lookupReferenceMetadata(E,ref,{signal:workSignal,requireAbstract:true,Parser})));
  }
  abort(workSignal);
  // A title match is never cached as an abstract; it only clears that title's
  // absence or failure entry.
  let failure=!found&&!answered&&errors.length?failureText(errors):'';
  let write=found?key&&{at:Date.now(),record:found}:cacheKey&&{at:Date.now(),record:null,...(failure?{error:failure}:{})},stale=found&&!key&&cached;
  if((write||stale)&&E.store?.update)await E.store.update(state=>{abort(workSignal);state.referenceAbstractMetadata||={};if(write)state.referenceAbstractMetadata[cacheKey]=write;else delete state.referenceAbstractMetadata[cacheKey];});
  if(failure)throw Error(failure);
  return found||null;
 },{signal,createController:()=>new (doc?.defaultView?.AbortController||globalThis.AbortController)()});
}

export function createReferenceDetail(doc,{title,ref,record,number=referenceDisplayNumber(ref),onBack,onLocate,onDownload}){
 const node=(tag,cls,parent,text)=>{const value=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);value.className=cls;if(text!==undefined)value.textContent=text;parent?.append(value);return value;};
 const root=node('section','reader-reference-detail');root.setAttribute('aria-label','参考文献摘要详情');
 const header=node('header','reader-reference-detail-header',root),back=node('button','reader-reference-back',header,'‹');back.type='button';back.title='返回参考文献';back.setAttribute('aria-label','返回参考文献');back.onclick=onBack;node('span','reader-reference-detail-number',header,'参考文献 '+number);
 const icon=(label,path,fn)=>{const button=node('button','reader-reference-action',header);button.type='button';button.title=label;button.setAttribute('aria-label',label);const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const p=doc.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',path);svg.append(p);button.append(svg);button.onclick=fn;return button;};
 const locate=icon('定位本文引用','M12 3v4m0 10v4M3 12h4m10 0h4M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z',onLocate),download=icon('获取公开全文','M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4',onDownload);download.hidden=!record;
 const reading=node('div','reader-reference-reading',root);node('h2','reader-reference-heading',reading,title);const meta=node('p','reader-reference-metadata',reading,[record?.journal,record?.date?.match(/(?:19|20)\d{2}/)?.[0]].filter(Boolean).join(' · '));meta.hidden=!meta.textContent;
 const originalSection=node('section','reader-reference-abstract-section',reading),originalLabel=node('h3','',originalSection,'Abstract'),original=node('p','reader-reference-abstract',originalSection);original.lang='en';
 const chineseSection=node('section','reader-reference-abstract-section',reading);node('h3','',chineseSection,'中文摘要');const chinese=node('p','reader-reference-abstract reader-reference-chinese',chineseSection);chinese.lang='zh-CN';chineseSection.hidden=true;
 const status=node('p','reader-reference-detail-status',reading,'正在获取原文摘要…');status.setAttribute('role','status');
 // A failed abstract lookup is cached about an hour; this is its explicit retry.
 const retry=node('button','reader-reference-retry',reading,'重试读取摘要');retry.type='button';retry.hidden=true;
 const source=node('a','reader-reference-provider',reading);source.target='_blank';source.rel='noopener';
 const showSource=value=>{const doi=cleanDOI(ref?.doi),arxiv=referenceArxiv(ref?.quote);source.href=value?.url||(doi?'https://doi.org/'+doi:arxiv?'https://arxiv.org/abs/'+arxiv:'https://scholar.google.com/scholar?q='+encodeURIComponent(ref?.title||ref?.quote||title));source.textContent=value?.source||(doi?'DOI 原始来源':arxiv?'arXiv 原始来源':'检索这条题录');source.hidden=false;};showSource(record);
 return {root,back,locate,download,original,chinese,chineseSection,status,retry,setRecord(value){download.hidden=!value;meta.textContent=[value?.journal,value?.date?.match(/(?:19|20)\d{2}/)?.[0]].filter(Boolean).join(' · ');meta.hidden=!meta.textContent;original.textContent=value?.abstract||'';const english=!/[\u3400-\u9fff]/.test(value?.abstract||'');original.lang=english?'en':'zh-CN';originalLabel.textContent=english?'Abstract':'原文摘要';showSource(value);}};
}
