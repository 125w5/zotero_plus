/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The open-access copies of one paper, gathered source by source (X/pdf-resolver.js makes
// the requests). Only copies a source declares open are taken, and each one must pass the
// PDF check before it is saved; a login page or paywall is never worked around, and shadow
// libraries are never consulted, whatever a record or a page links to.
import {arxivID} from './arxiv.mjs';
import {requestWithinDeadline} from './request-deadline.mjs';
import {pdfStatus,pdfFailuresStatus} from './pdf-status.mjs';
export {pdfStatus,pdfErrorStatus,pdfFailuresStatus,PDF_STATUS_LABELS} from './pdf-status.mjs';

const SHADOW=/(?:^|\.)(?:sci-hub\.[a-z.]+|libgen\.[a-z.]+|library\.lol|z-lib\.[a-z.]+|zlibrary\.[a-z.]+|1lib\.[a-z.]+|annas-archive\.[a-z.]+|booksc\.[a-z.]+)$/i;
// Hosts whose interfaces still answer with http:// addresses for files they serve over https.
const UPGRADE=/^(?:(?:export|www)\.)?arxiv\.org$|^(?:www\.)?europepmc\.org$|^link\.springer\.com$|^(?:www\.)?nature\.com$|(?:^|\.)biomedcentral\.com$|^core\.ac\.uk$/i;
const HOSTS=[[/(?:^|\.)arxiv\.org$/i,'arXiv'],[/(?:^|\.)europepmc\.org$/i,'Europe PMC'],[/(?:^|\.)ncbi\.nlm\.nih\.gov$/i,'PubMed Central'],[/(?:^|\.)core\.ac\.uk$/i,'CORE']];
const cancelled=()=>Object.assign(Error('已取消 PDF 获取'),{name:'AbortError'});
const unique=values=>[...new Set(values.filter(Boolean))];
const empty=value=>value===null||value===undefined||value===''||Array.isArray(value)&&!value.length;
const fill=(target,source)=>{for(const [key,value] of Object.entries(source))if(empty(target[key])&&!empty(value))target[key]=value;return target;};
export const cleanDOI=value=>String(value||'').trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i,'').replace(/[.,;]+$/,'').toLowerCase();
export const rawDOI=value=>String(value||'').trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i,'').replace(/[.,;]+$/,'');
const cleanTitle=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export const pmcID=value=>{const digits=String(value||'').trim().match(/(?:^|\/|PMC)(\d{4,9})\/?$/i)?.[1];return digits?'PMC'+digits:'';};
export const doiPath=doi=>rawDOI(doi).split('/').map(encodeURIComponent).join('/');

export function pdfURL(value,base){
 const text=String(value||'').trim();if(!text)return '';
 let parsed;try{parsed=new URL(text,base);}catch{return '';}
 if(parsed.protocol==='http:'&&UPGRADE.test(parsed.hostname))parsed.protocol='https:';
 if(parsed.protocol!=='https:'||SHADOW.test(parsed.hostname))return '';
 return parsed.href;
}
// Two addresses of one file count once: www./export. hosts, a trailing slash and arXiv's .pdf.
export function pdfKey(url){
 try{const parsed=new URL(url),host=parsed.hostname.toLowerCase().replace(/^(?:www|export)\./,'');let path=parsed.pathname.replace(/\/+$/,'');if(host==='arxiv.org')path=path.replace(/\.pdf$/i,'');return host+path+parsed.search;}
 catch{return String(url||'');}
}
export function pdfSourceLabel(url,fallback=''){let host='';try{host=new URL(url).hostname;}catch{}return HOSTS.find(([pattern])=>pattern.test(host))?.[1]||fallback||host.replace(/^www\./,'')||'检索结果';}

// The identifiers each source is asked by. Lookups add what they learn (a PMCID from
// OpenAlex, an arXiv number from Semantic Scholar) for the sources after them.
export function pdfContext(record={}){
 const doi=cleanDOI(record.doi),urls=[record.arxiv,record.pdf,...(record.pdfCandidates||[]),record.url];
 const s2=[record.s2Id,record.source==='Semantic Scholar'?record.id:''].find(id=>/^[0-9a-f]{40}$/i.test(id||''))||'';
 return {doi,rawDOI:rawDOI(record.doi),arxiv:urls.map(arxivID).find(Boolean)||(/^10\.48550\/arxiv\./.test(doi)&&arxivID(doi.slice(15)))||'',pmcid:pmcID(record.pmcid),s2,core:String(record.coreId||'').replace(/\D/g,''),openalex:String(record.openalexId||(record.source==='OpenAlex'?record.id:'')||'').match(/(W\d+)$/i)?.[1]||'',title:String(record.title||'').trim(),hints:{}};
}
export function recordPDFs(record={}){return [record.pdf,...(record.pdfCandidates||[])].map(url=>pdfURL(url)).filter(Boolean).map(url=>({url,source:pdfSourceLabel(url,record.source)}));}
export function openAlexPDFs(work){return [work?.best_oa_location,...(work?.locations||[])].filter(row=>row?.is_oa&&row.pdf_url).map(row=>row.pdf_url);}
export function absorbOpenAlex(ctx,work={}){
 const locations=[work.best_oa_location,work.primary_location,...(work.locations||[])].filter(Boolean);
 fill(ctx,{doi:cleanDOI(work.doi),rawDOI:rawDOI(work.doi),pmcid:pmcID(work.ids?.pmcid),arxiv:locations.map(row=>arxivID(row.landing_page_url)||arxivID(row.pdf_url)).find(Boolean)||''});
 fill(ctx.hints,{type:work.type,typeCrossref:work.type_crossref,sourceType:work.primary_location?.source?.type,venue:work.primary_location?.source?.display_name});
 // OpenAlex's own cached copy (content API, paid per file): only a work it says it holds.
 const id=String(work.id||'').match(/(W\d+)$/i)?.[1];if(id&&(work.has_content?.pdf===true||work.content_urls?.pdf))ctx.paidPDF||=openAlexContentURL(id);
}
export const openAlexContentURL=id=>{const work=String(id||'').match(/(W\d+)$/i)?.[1];return work?'https://content.openalex.org/works/'+work.toUpperCase()+'.pdf':'';};
export function unpaywallPDFs(data){return [data?.best_oa_location,...(data?.oa_locations||[])].map(row=>row?.url_for_pdf).filter(Boolean);}
export function semanticPDFs(paper){return paper?.openAccessPdf?.url?[paper.openAccessPdf.url]:[];}
export function absorbSemantic(ctx,paper={}){
 const ids=paper.externalIds||{};
 fill(ctx,{doi:cleanDOI(ids.DOI),rawDOI:rawDOI(ids.DOI),arxiv:arxivID(ids.ArXiv)||'',pmcid:pmcID(ids.PubMedCentral)});
 fill(ctx.hints,{publicationTypes:paper.publicationTypes||[],venue:paper.venue});
}
// A search answer must name the same DOI, or without one the same title; a direct work lookup is taken as is.
export function corePDFs(data,{doi='',title=''}={}){
 const want=cleanDOI(doi),name=cleanTitle(title),rows=Array.isArray(data?.results)?data.results:data?[data]:[];
 return rows.filter(row=>want?cleanDOI(row.doi)===want:name?cleanTitle(row.title)===name:true).map(row=>row.downloadUrl).filter(Boolean);
}
export function europePMCSearchPMCID(data,doi){
 const want=cleanDOI(doi),row=(data?.resultList?.result||[]).find(row=>(!want||cleanDOI(row.doi)===want)&&pmcID(row.pmcid)&&(row.isOpenAccess==='Y'||row.inEPMC==='Y'));
 return row?pmcID(row.pmcid):'';
}
export const europePMCPDF=pmcid=>pmcid?'https://europepmc.org/articles/'+pmcid+'?pdf=render':'';
export const SPRINGER_PREFIX=/^10\.(?:1007|1186|1038)\//;
// Only a record the Open Access API marks open; without a PDF link the publisher's usual file address.
export function springerPDFs(data,doi){
 const want=cleanDOI(doi),raw=rawDOI(doi);
 return (data?.records||[]).filter(row=>cleanDOI(row.doi)===want&&String(row.openaccess)==='true').flatMap(row=>{
  const links=(row.url||[]).filter(link=>/pdf/i.test(link.format||'')).map(link=>link.value).filter(Boolean);
  return links.length?links:[/^10\.1038\//.test(want)?'https://www.nature.com/articles/'+raw.slice(8)+'.pdf':'https://link.springer.com/content/pdf/'+raw+'.pdf'];
 });
}
const decodeEntities=text=>text.replace(/&#x([0-9a-f]+);/gi,(_,hex)=>String.fromCodePoint(parseInt(hex,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
export function citationPDFs(html,base){
 const urls=[];
 for(const tag of String(html||'').match(/<meta\b[^>]*>/gi)||[]){
  const attr=name=>tag.match(new RegExp('\\s'+name+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i'))?.slice(1).find(value=>value!==undefined);
  if(/^citation_pdf_url$/i.test(attr('name')||attr('property')||'')){const url=pdfURL(decodeEntities(attr('content')||''),base);if(url)urls.push(url);}
 }
 return unique(urls);
}
// A DOI landing page is read only up to </head>, where the citation_* tags are.
export async function readLandingPage(fetch,url,{signal,timeout=10000,maxBytes=1_000_000,...runtime}={}){
 return requestWithinDeadline(async current=>{
  const response=await fetch(url,{method:'GET',redirect:'follow',signal:current,headers:{Accept:'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1'}});
  const discard=async()=>{try{await response.body?.cancel?.();}catch{}};
  if(!response.ok){await discard();throw Object.assign(Error('出版社页面无法访问（HTTP '+response.status+'）'),{providerStatus:response.status});}
  const type=response.headers?.get?.('content-type')||'',finalURL=response.url||url;
  if(/application\/pdf/i.test(type)){await discard();return {url:finalURL,pdf:true,html:''};}
  if(type&&!/html|xml/i.test(type)){await discard();return {url:finalURL,html:''};}
  const reader=response.body?.getReader?.();let html='';
  if(reader){const decoder=new TextDecoder();let loaded=0;try{while(loaded<maxBytes){const {done,value}=await reader.read();if(done)break;loaded+=value.length;html+=decoder.decode(value,{stream:true});if(/<\/head>/i.test(html))break;}}finally{try{await reader.cancel();}catch{}}}
  else if(typeof response.text==='function')html=String(await response.text()).slice(0,maxBytes);
  return {url:finalURL,html};
 },{signal,timeout,...runtime});
}
// The failures that repeat on every attempt at an address (as discovery.js's lastingPDF).
export const lastingPDFError=text=>/（HTTP 4(?:04|10)）|返回网页或验证页面|返回非 PDF|超过 80 MB/.test(String(text?.message??text??''));
// A lookup that can answer later: a rate limit, a busy server, a timeout or no connection.
export function transientLookup(error){const status=Number(error?.providerStatus||error?.status)||0;if(status)return status===429||status>=500;return error?.name!=='SyntaxError';}
// A copy that can arrive later. A publisher's 401/403 counts as no open copy, as before;
// arxiv.org refuses automated access for a while and then lets it in again.
export function candidateTransient(error,url=''){const text=String(error?.message??error??'');return !lastingPDFError(text)&&!(/（HTTP 40[13]）/.test(text)&&!/^https:\/\/(?:export\.|www\.)?arxiv\.org\//i.test(url));}
const reasonText=error=>{const text=String(error?.message??error??'').replace(/[，,]\s*(?:请重试|未保存为?附件)$/,'');return /\p{Script=Han}/u.test(text)?text:'暂时无法访问';};
export function pdfSourcesFailure({tried=[],failures=[],transient=false}={},unchanged='文库没有变化'){
 if(!tried.length)return Object.assign(Error('未找到公开 PDF；'+unchanged+'，可稍后重试'),{lasting:false,sources:[],attempted:[]},transient?pdfFailuresStatus(failures,{transient}):pdfStatus('none'));
 const details=unique(failures.map(row=>row.source+'：'+reasonText(row.error))).slice(0,3);
 const text='已尝试 '+tried.length+' 个来源（'+tried.join('、')+'），均未找到可下载的开放获取 PDF'+(details.length?'。'+details.join('；'):'')+'。'+unchanged+(transient?'，部分来源暂时无法访问，可稍后重试':'');
 // Only a PDF address that failed for good is lasting; sources that answered with no open copy
 // can list one later, so that outcome keeps its retry. An address skipped because it failed
 // in the last day is not recorded again, so its day is not extended.
 const attempted=unique(failures.filter(row=>!row.cached).map(row=>row.url).filter(Boolean));
 return Object.assign(Error(text),{lasting:!transient&&attempted.length>0,sources:tried,attempted},pdfFailuresStatus(failures,{transient}));
}
const hostOf=url=>{try{return new URL(url).hostname.toLowerCase().replace(/^(?:www|export)\./,'');}catch{return '';}};
// Repositories serve their files to any client; these publishers often answer a plain request
// with a bot check or an HTML viewer (audit: Springer, Wiley, IOP, HAL), so they wait their turn.
const REPOSITORY=/(?:^|\.)(?:arxiv\.org|europepmc\.org|ncbi\.nlm\.nih\.gov|core\.ac\.uk|zenodo\.org|osf\.io|semanticscholar\.org)$/i;
const GUARDED=/(?:^|\.)(?:link\.springer\.com|onlinelibrary\.wiley\.com|iopscience\.iop\.org|sciencedirect\.com|tandfonline\.com|journals\.sagepub\.com|pubs\.acs\.org|academic\.oup\.com|hal\.science|hal\.archives-ouvertes\.fr|researchgate\.net)$/i;
export function pdfTier(url,{landing=false}={}){if(landing)return 3;const host=hostOf(url);return REPOSITORY.test(host)?0:GUARDED.test(host)?2:1;}
const controller=()=>{const listeners=new Set(),signal={aborted:false,addEventListener:(type,fn)=>{if(type==='abort')listeners.add(fn);},removeEventListener:(type,fn)=>listeners.delete(fn)};return {signal,abort(){if(signal.aborted)return;signal.aborted=true;for(const fn of [...listeners])try{fn();}catch{}listeners.clear();}};};
const whenAborted=signal=>new Promise((_,reject)=>{const stop=()=>reject(cancelled());if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});});
export const PDF_RESOLVE_TIMING=Object.freeze({budget:30000,headStart:2500,landingDelay:4000,lookupTimeout:15500,probes:2});
// Every source at once. Stages are {name,phase,lookup,run,derive,after,landing}: phase 0 starts
// at once (the record's own addresses), phase 1 after headStart or as soon as phase 0 has nothing
// left (the metadata services, together), phase 2 after landingDelay or when phase 1 is quiet (the
// DOI landing page). run() returns candidates, [] for none, or null when it does not apply (no
// identifier, key or contact email) -- such a stage runs again once another lookup has answered,
// since it may have learned the identifier. derive() adds candidates from what the lookups learned;
// after names stages whose answer a stage waits for. Candidates are probed best tier first, at most
// `probes` at a time and never two on one host; the first verified one is downloaded and ends the
// search. Lookups and probes stop when the budget ends; a download, or a probe that is itself the
// download (exempt, arXiv), runs on to its own limits.
export async function resolvePDFSources(stages,{probe,download,exempt=()=>false,skip=()=>null,signal,onSource=()=>{},unchanged,timing={},setTimeout:later=globalThis.setTimeout,clearTimeout:clear=globalThis.clearTimeout}={}){
 const time={...PDF_RESOLVE_TIMING,...timing},master=controller(),timers=[],seen=new Set(),pending=[],ready=[],probing=new Map(),lookups=new Set(),order=new Map(),tried=new Set(),failures=[],started=new Set();
 const state=new Map(stages.map(stage=>[stage,'idle']));let seq=0,transient=false,expired=false,downloading=false,settled=false,resolve,reject;
 const rank=(name,stage)=>{if(!order.has(name))order.set(name,[stage?stages.indexOf(stage):-1,seq++]);};
 const note=(name,stage)=>{rank(name,stage);tried.add(name);};
 const done=new Promise((ok,fail)=>{resolve=ok;reject=fail;});
 const finish=(error,value)=>{if(settled)return;settled=true;for(const id of timers)clear(id);master.abort();if(error)reject(error);else resolve(value);};
 const child=()=>{const sub=controller();master.signal.addEventListener('abort',()=>sub.abort());return sub;};
 const abortUser=()=>finish(cancelled());
 const position=name=>order.get(name)||[stages.length,Infinity],before=(a,b)=>{const [x,y]=[position(a),position(b)];return x[0]-y[0]||x[1]-y[1];};
 const add=(rows,stage)=>{for(const row of rows||[]){
  const url=pdfURL(row.url),key=url&&pdfKey(url);if(!url||seen.has(key))continue;seen.add(key);
  const source=row.source||stage.name,cached=skip(url);
  if(cached){note(source,stage);failures.push({source,url,error:Object.assign(Error('近一天内已确认无法获取'),{cached:cached.reason||''}),cached:true,stage});continue;}
  pending.push({url,source,stage,host:hostOf(url),tier:pdfTier(url,{landing:stage.landing}),index:stages.indexOf(stage),seq:seq++});
 }};
 const derive=()=>{for(const stage of stages)if(stage.derive&&started.has(stage.phase))try{add(stage.derive(),stage);}catch{}};
 const blocked=stage=>(stage.after||[]).some(name=>stages.some(other=>other.name===name&&started.has(other.phase)&&['idle','running','waiting-run'].includes(state.get(other))&&other!==stage));
 const runStage=stage=>{
  if(settled)return;if(expired){state.set(stage,'done');return pump();}
  if(blocked(stage)){state.set(stage,'blocked');return;}
  const sub=child(),entry={stage,sub};lookups.add(entry);state.set(stage,'running');
  let timer;const timeout=new Promise((_,fail)=>{timer=later(()=>{sub.abort();fail(Object.assign(Error(stage.name+' 查询超时'),{name:'TimeoutError'}));},time.lookupTimeout);});timers.push(timer);
  Promise.race([Promise.resolve().then(()=>stage.run(sub.signal)),timeout,whenAborted(sub.signal)]).then(rows=>{
   lookups.delete(entry);clear(timer);if(settled)return;
   if(rows===null||rows===undefined){state.set(stage,'waiting');return settle(false);}
   state.set(stage,'done');if(stage.lookup)note(stage.name,stage);add(rows,stage);settle(true);
  },error=>{
   lookups.delete(entry);clear(timer);if(settled)return;
   if(signal?.aborted)return finish(cancelled());if(error?.stop)return finish(error);
   state.set(stage,'done');note(stage.name,stage);
   const timedOut=expired||error?.name==='TimeoutError'||error?.name==='AbortError';
   if(timedOut||transientLookup(error)){transient=true;failures.push({source:stage.name,error:timedOut&&error?.name==='AbortError'?Object.assign(Error(stage.name+' 查询超时'),{name:'TimeoutError'}):error,stage});}
   settle(true);
  });
 };
 // An answer may name an identifier another stage was missing, or unblock one waiting for it.
 const settle=answered=>{
  if(answered)for(const stage of stages)if(started.has(stage.phase)&&state.get(stage)==='waiting'){state.set(stage,'waiting-run');runStage(stage);}
  for(const stage of stages)if(started.has(stage.phase)&&state.get(stage)==='blocked'&&!blocked(stage))runStage(stage);
  derive();pump();
 };
 const startPhase=phase=>{
  if(settled||started.has(phase))return;started.add(phase);
  const list=stages.filter(stage=>(stage.phase||0)===phase);
  const names=list.filter(stage=>stage.lookup).map(stage=>stage.name);if(names.length)onSource(names);
  for(const stage of list){if(stage.run)runStage(stage);else state.set(stage,'done');}
  // A phase with lookups derives once they answer, so a record's own address keeps its source.
  if(!list.some(stage=>stage.run))derive();pump();
 };
 const phases=[...new Set(stages.map(stage=>stage.phase||0))].sort((a,b)=>a-b);
 const quiet=phase=>!downloading&&!ready.length&&!probing.size&&!pending.length&&stages.every(stage=>(stage.phase||0)>=phase||started.has(stage.phase||0)&&['done','waiting'].includes(state.get(stage)));
 const startProbe=row=>{
  const sub=child(),entry={row,sub,exempt:!!exempt(row.url)};probing.set(row,entry);rank(row.source,row.stage);tried.add(row.source);
  Promise.race([Promise.resolve().then(()=>probe(row.url,row.source,sub.signal)),whenAborted(sub.signal)]).then(value=>{
   probing.delete(row);if(settled)return;
   if(value?.bytes)return finish(null,{bytes:value.bytes,url:row.url,source:row.source});
   ready.push(row);pump();
  },error=>{
   probing.delete(row);if(settled)return;if(signal?.aborted)return finish(cancelled());
   const timedOut=expired&&!entry.exempt||error?.name==='AbortError';
   transient||=timedOut||!!error?.transient||candidateTransient(error,row.url);
   failures.push({source:row.source,url:row.url,error:timedOut&&error?.name==='AbortError'?Object.assign(Error('核验 PDF 超时'),{name:'TimeoutError'}):error,transient:timedOut||!!error?.transient,stage:row.stage});pump();
  });
 };
 const startDownload=row=>{
  downloading=true;const sub=child();
  Promise.race([Promise.resolve().then(()=>download(row.url,row.source,sub.signal)),whenAborted(sub.signal)]).then(bytes=>finish(null,{bytes,url:row.url,source:row.source}),error=>{
   downloading=false;if(settled)return;if(signal?.aborted)return finish(cancelled());
   transient||=candidateTransient(error,row.url);failures.push({source:row.source,url:row.url,error,stage:row.stage});pump();
  });
 };
 const fail=()=>{
  const rows=[...failures].sort((a,b)=>before(a.source,b.source));
  finish(pdfSourcesFailure({tried:[...tried].sort(before),failures:rows,transient},unchanged));
 };
 const pump=()=>{
  if(settled)return;
  for(const phase of phases)if(!started.has(phase)&&phases.filter(p=>p<phase).every(p=>started.has(p))&&quiet(phase))startPhase(phase);
  if(settled)return;
  if(ready.length&&!downloading){ready.sort((a,b)=>a.tier-b.tier||a.index-b.index||a.seq-b.seq);return startDownload(ready.shift());}
  if(downloading)return;
  if(!expired){
   pending.sort((a,b)=>a.tier-b.tier||a.index-b.index||a.seq-b.seq);
   for(let i=0;i<pending.length&&probing.size<time.probes;){const row=pending[i],hosts=new Set([...probing.keys()].map(other=>other.host));if(hosts.has(row.host)){i++;continue;}pending.splice(i,1);startProbe(row);}
  }
  const active=probing.size||lookups.size||stages.some(stage=>['running','blocked','waiting-run'].includes(state.get(stage)));
  if(!active&&(expired||!pending.length)&&(expired||phases.every(phase=>started.has(phase))))fail();
 };
 // The budget ends lookups and probes; what was not reached is left untried, and the failure says
 // some sources could not be reached in time.
 const expire=()=>{
  if(settled)return;expired=true;
  if(lookups.size||[...probing.values()].some(entry=>!entry.exempt)||pending.length||phases.some(phase=>!started.has(phase))){transient=true;if(!failures.some(row=>row.budget))failures.push({source:'查找',error:Object.assign(Error('查找超过 '+Math.round(time.budget/1000)+' 秒，部分来源未完成'),{name:'TimeoutError'}),budget:true,transient:true});}
  pending.length=0;for(const entry of [...lookups])entry.sub.abort();for(const entry of probing.values())if(!entry.exempt)entry.sub.abort();
  for(const stage of stages)if(['blocked','waiting','waiting-run'].includes(state.get(stage)))state.set(stage,'done');
  pump();
 };
 if(signal?.aborted)throw cancelled();signal?.addEventListener('abort',abortUser,{once:true});
 timers.push(later(expire,time.budget));
 if(phases.length>1)timers.push(later(()=>startPhase(phases[1]),time.headStart));
 if(phases.length>2)timers.push(later(()=>startPhase(phases[2]),time.headStart+time.landingDelay));
 startPhase(phases[0]);
 try{return {...await done,tried:[...tried].sort(before)};}
 finally{signal?.removeEventListener('abort',abortUser);}
}

// The Zotero item type of a paper, from the record and what the lookups said about it
// (OpenAlex type/type_crossref/source type, Crossref type, Semantic Scholar publicationTypes).
const PREPRINT_VENUE=/^(?:arxiv(?:\.org)?|biorxiv|medrxiv|chemrxiv|ssrn|research square|preprints(?:\.org)?|techrxiv|psyarxiv|osf preprints|eartharxiv|engrxiv)\b/i;
const CONFERENCE_VENUE=/\b(?:conference|symposium|workshop|proceedings|neural information processing systems|neurips|nips|icml|iclr|cvpr|iccv|eccv|aaai|ijcai|emnlp|naacl|sigir|sigkdd|kdd|icassp|interspeech|globecom|infocom)\b/i;
// Journals named Proceedings.
const JOURNAL_PROCEEDINGS=/^(?:proceedings of the (?:national academy|royal society|japan academy|ieee\s*$)|pnas\b)/i;
export function paperItemType(record={}){
 if(record.source==='arXiv')return 'preprint';
 const hints=record.pdfHints||{},types=[record.type,record.crossrefType,hints.type,hints.typeCrossref].map(value=>String(value||'').toLowerCase());
 const kinds=[...(record.publicationTypes||[]),...(hints.publicationTypes||[])].map(value=>String(value).toLowerCase()),sourceType=String(record.sourceType||hints.sourceType||'').toLowerCase(),venue=String(record.venue||record.journal||hints.venue||'').trim();
 if(types.some(type=>['proceedings-article','proceedings','conference-paper','conference'].includes(type))||kinds.includes('conference')||sourceType==='conference')return 'conferencePaper';
 if(types.some(type=>['preprint','posted-content'].includes(type)))return 'preprint';
 if(types.some(type=>['article','journal-article','review','letter'].includes(type))||kinds.some(kind=>['journalarticle','review'].includes(kind))||sourceType==='journal')return 'journalArticle';
 if(sourceType==='repository'||PREPRINT_VENUE.test(venue))return 'preprint';
 if(CONFERENCE_VENUE.test(venue)&&!JOURNAL_PROCEEDINGS.test(venue))return 'conferencePaper';
 return 'journalArticle';
}
