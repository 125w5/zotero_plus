/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {discoverySearchTask} from '../../chrome/content/zotero/research/shared/discovery-search-task.mjs';
import {normalizeResearchScope} from '../../chrome/content/zotero/research/shared/research-domain.mjs';
import {sortDiscoveryRecords} from '../../chrome/content/zotero/research/shared/discovery-presentation.mjs';
import * as Presentation from '../../chrome/content/zotero/research/shared/discovery-presentation.mjs';

const script=await readFile(new URL('../../chrome/content/zotero/research/ui/discovery.js',import.meta.url),'utf8');
function fixture(request,{IntersectionObserver}={}){
 const ui={},state={settings:{}},renders=[],observers=[],statuses=[],root={},frames=new Map();let frameSerial=0;
 const node=(tag='div',text='',className='')=>({tag,textContent:text,className,value:'',dataset:{},children:[],events:{},setAttribute(key,value){this[key]=value;},append(...children){for(const child of children){child.remove();child.parent=this;this.children.push(child);}},prepend(...children){for(const child of children.reverse()){child.remove();child.parent=this;this.children.unshift(child);}},replaceChildren(...children){for(const child of this.children)child.parent=null;this.children=[];this.append(...children);},insertBefore(child,before){child.remove();child.parent=this;this.children.splice(before?this.children.indexOf(before):this.children.length,0,child);},addEventListener(type,callback){this.events[type]=callback;},matches(selector){return selector.startsWith('.')?this.className.split(' ').includes(selector.slice(1)):this.tag===selector;},querySelector(selector){return this.querySelectorAll(selector)[0]||null;},querySelectorAll(selector){const direct=selector.startsWith(':scope > ');if(direct)selector=selector.slice(9);return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...(direct?[]:child.querySelectorAll(selector))]);},get options(){return this.children;},get lastElementChild(){return this.children.at(-1);},get classList(){return{toggle:(value,on)=>{const classes=new Set(this.className.split(' ').filter(Boolean));if(on)classes.add(value);else classes.delete(value);this.className=[...classes].join(' ');}};},remove(){if(this.parent){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}}});
 const results=node(),source=node('select'),query=node('input'),submit=node('button'),collect=node('button'),view={querySelector:()=>({open:false})},elements={'search-results':results,'search-query':query,'search-source':source,'search-academic':submit,'collect-references':collect,'view-search':view};
 vm.runInNewContext(script,{EasySchUI:ui,AbortController,document:{querySelector:()=>root},window:{IntersectionObserver,requestAnimationFrame:fn=>{const id=++frameSerial;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)},IntersectionObserver,setTimeout,clearTimeout});
 const renderDiscovery=ui.renderDiscovery.bind(ui);
 Object.assign(ui,{activeView:'search',discoveryRunTask:discoverySearchTask,el:node,$:id=>elements[id],pptButton(label,action,parent){const button=node('button',label);button.onclick=action;parent.append(button);return button;},discoveryScopeReady:Promise.resolve(),discoveryPrimary:query,discoverySecondary:node('input'),discoveryDomain:{value:'physics'},discoveryAcronym:node('input'),discoveryFuzzy:{checked:true},discoveryScopeNote:node(),collectionStatus:node(),collectionJournal:node('select'),collectionFilters:{sort:'relevance',years:'5'},agentDiscoveryPresentation:{discoveryJournalChoices:()=>[]},status(message,error=false){statuses.push({message,error});},renderCollectionHistory(){},renderDiscovery(rows,options){renders.push({rows,options});results.dataset.collectionResults='search';},installAgentPaging(target,more,load,scroll){assert.equal(ui.collectionSearching,false,'visible sentinel is armed after the busy guard is released');assert.equal(scroll,root);observers.push(load);target._endOff=()=>{};},E:{store:{get:()=>state,update:async fn=>fn(state)},searchPaperPage:request,recommendationFeed:request}});
 query.value='spin';return{ui,state,results,renders,observers,statuses,renderDiscovery,frames,runFrames:()=>{const due=[...frames.values()];frames.clear();for(const fn of due)fn();}};
}
const rows=(start,count)=>Array.from({length:count},(_,i)=>({id:start+i,title:'Measured paper '+(start+i),doi:'10.1000/'+(start+i)}));

test('recommendation continuation exceeds twenty and re-arms after idle with the exact cursor and saved filters',async()=>{
 const calls=[],{ui,results,renders,observers}=fixture(async options=>{calls.push(options);return calls.length===1?{records:rows(0,20),page:1,nextPage:7,nextCursor:'opaque-next',providerID:'crossref',hasMore:true}:{records:[...rows(19,1),...rows(20,2)],page:7,nextPage:8,nextCursor:null,providerID:'crossref',hasMore:false};});
 ui.discoveryMode='trends';await ui.searchCollection();assert.equal(ui.collectionResults.length,20);assert.equal(observers.length,1);const first=ui.collectionResults[19];ui.collectionChosen.add(first);ui.collectionFilters={sort:'date',years:'1'};
 const button=results.querySelector('.discovery-page-controls').children[0];assert.equal(button.disabled,false);await button.onclick();assert.equal(ui.collectionResults.length,22);assert.strictEqual(ui.collectionResults[19],first,'duplicate page metadata preserves selected record identity');assert.ok(ui.collectionChosen.has(first));assert.equal(calls[1].page,7);assert.equal(calls[1].cursor,'opaque-next');assert.equal(calls[1].provider,'crossref');assert.equal(calls[1].filters.years,'5');assert.equal(renders[1].options.append,true);assert.equal(results.querySelector('.discovery-page-controls'),null);
});

test('an empty round stops automatic loading and offers 继续搜索 with the scanned count until a round adds papers',async()=>{
 let count=0;const {ui,results,observers}=fixture(async()=>({records:++count===3?rows(21,1):count===4?rows(30,1):[],page:count,nextPage:count+1,nextCursor:'cursor-'+count,providerID:'openalex',hasMore:count<4,scan:{scanned:40,matched:count===3?1:0,total:400,removed:{keywords:count===3?39:40},relax:{}}}));
 const button=()=>results.querySelector('.discovery-page-controls').children[0];
 ui.discoveryMode='latest';await ui.searchCollection();assert.equal(observers.length,0,'an empty first round does not arm the visible sentinel');assert.equal(button().textContent,'继续搜索 · 已扫描 40 篇');
 await button().onclick();assert.equal(observers.length,0,'a second empty round still waits for the user');assert.equal(button().textContent,'继续搜索 · 已扫描 80 篇');assert.equal(ui.discoveryScan.removed.keywords,80);
 await button().onclick();assert.equal(ui.collectionResults.length,1);assert.equal(observers.length,1,'a round that adds a paper re-arms automatic loading');assert.equal(button().textContent,'加载更多论文');
 await observers[0]();assert.equal(ui.collectionResults.length,2);assert.equal(ui.collectionSearching,false);assert.equal(ui.collectionSearchState.hasMore,false);
});

test('a failed continuation preserves the loaded records and offers an explicit retry without an automatic retry loop',async()=>{
 let calls=0;const{ui,results,observers}=fixture(async()=>{if(++calls===2)throw Error('HTTP 429');return{records:rows(calls===1?0:20,calls===1?20:1),page:calls===1?1:2,nextPage:2,nextCursor:'same-next',providerID:'openalex',hasMore:calls===1};});ui.discoveryMode='latest';await ui.searchCollection();await observers[0]();assert.equal(calls,2);assert.equal(observers.length,1);assert.equal(ui.collectionResults.length,20);const retry=results.querySelector('.discovery-page-controls').children[0];assert.equal(retry.textContent,'重试加载更多');await retry.onclick();assert.equal(ui.collectionResults.length,21);assert.equal(ui.collectionPagingError,false);
});

test('a superseded result cannot render after its history save yields to a newer search',async()=>{
 let release,historyStarted;const entered=new Promise(resolve=>historyStarted=resolve),{ui,state,renders}=fixture(async query=>({records:rows(query==='older'?1:2,1),provider:'openalex',hasMore:false}));let saves=0;ui.E.store.update=async fn=>{fn(state);if(++saves===1){historyStarted();await new Promise(resolve=>release=resolve);}};
 ui.discoveryPrimary.value='older';const older=ui.searchCollection();await entered;ui.discoveryPrimary.value='newer';await ui.searchCollection();release();await older;assert.equal(renders.length,1);assert.equal(ui.collectionSearchState.query,'newer');assert.equal(ui.collectionResults[0].id,2);assert.equal(ui.collectionSearching,false);
});

test('leaving discovery aborts pending search and translation without clearing the displayed results',async()=>{
 let release,signal;const {ui,results,renders}=fixture(async(_query,options)=>{signal=options.signal;await new Promise(resolve=>release=resolve);return{records:rows(1,1),hasMore:false};});results.dataset.collectionResults='search';ui.discoveryTranslationController=new AbortController();const translation=ui.discoveryTranslationController.signal;
 const pending=ui.searchCollection();await new Promise(resolve=>setImmediate(resolve));ui.$('collect-references').disabled=true;ui.suspendDiscovery();assert.equal(signal.aborted,true);assert.equal(translation.aborted,true);assert.equal(ui.$('collect-references').disabled,false,'canceled reference collection remains available after returning');assert.equal(results.dataset.collectionResults,'search');release();await pending;assert.equal(renders.length,0);assert.equal(ui.collectionSearching,false);
});

test('paging and select-all retain existing cards, expanded source details and lazy markdown',()=>{
 const {ui,results,renderDiscovery}=fixture();ui.renderDiscovery=renderDiscovery;ui.agentDiscoveryPresentation.discoveryPDFCandidate=()=>true;ui.agentDiscoveryPresentation.discoveryMetricLabel=()=>null;const markdown=[];ui.renderMarkdown=(target,text)=>{markdown.push(text);target.textContent=text;};
 const first=rows(0,20).map(row=>({...row,source:'OpenAlex',abstract:'Measured full source abstract.'}));ui.renderDiscovery(first,{search:true});const list=results.children[1],card=list.children[0],details=card.children.find(child=>child.tag==='details');assert.equal(markdown.length,0,'closed full-source sections do not parse every abstract');details.open=true;details.events.toggle();assert.equal(markdown.length,1);
 ui.renderDiscovery([...first,...rows(20,2).map(row=>({...row,source:'Crossref'}))],{search:true,append:true});assert.equal(list.children.length,22);assert.strictEqual(list.children[0],card);assert.strictEqual(card.children.find(child=>child.tag==='details'),details);assert.equal(details.open,true);assert.equal(markdown.length,1);
 const selectAll=results.children[0].children[0].children[0];selectAll.checked=true;selectAll.onchange();assert.equal(ui.collectionChosen.size,22);assert.strictEqual(list.children[0],card);assert.equal(details.open,true);assert.equal(markdown.length,1);
});

test('a retained card keeps a translation that finishes while a source filter hides it',async()=>{
 let intersect,finish,calls=0;class Observer{constructor(callback){intersect=callback;}observe(){}unobserve(){}disconnect(){}}
 const {ui,results,renderDiscovery}=fixture(undefined,{IntersectionObserver:Observer});ui.renderDiscovery=renderDiscovery;ui.agentDiscoveryPresentation.discoveryPDFCandidate=()=>true;ui.agentDiscoveryPresentation.discoveryMetricLabel=()=>null;ui.E.discoveryChinese=()=>{calls++;return new Promise(resolve=>finish=resolve);};
 const record={...rows(1,1)[0],source:'OpenAlex',abstract:'Original summary.'};ui.renderDiscovery([record],{search:true});const list=results.children[1],card=list.children[0],source=results.children[0].children[1].children[1];Object.defineProperty(card,'isConnected',{get:()=>!!card.parent});
 intersect([{isIntersecting:true,target:card}]);assert.equal(calls,1);source.value='Crossref';source.onchange();assert.equal(card.isConnected,false);finish({title:'中文标题',summary:'中文摘要',translated:true});await new Promise(resolve=>setImmediate(resolve));source.value='';source.onchange();
 assert.strictEqual(list.children[0],card);assert.equal(card.querySelector('.discovery-collection-title').textContent,'中文标题');assert.equal(card.querySelector('.collection-abstract').textContent,'中文摘要');assert.equal(card.dataset.translation,'translated');assert.equal(calls,1);
});

test('incremental search starts a fresh selection surface then preserves selections while the remaining PDF pages arrive',async()=>{
 let count=0;const f=fixture(async(_query,options)=>{assert.equal(options.fillPage,true);const first=rows(100*++count,1);options.onProgress({records:first});options.onProgress({records:first});assert.equal(f.frames.size,1,'progress reports within one frame render once');assert.equal(f.renders.length,renderBase,'no render before the frame');f.runFrames();f.ui.collectionChosen.add(f.ui.collectionResults[0]);const second=rows(100*count+1,1);options.onProgress({records:[...first,...second]});f.runFrames();return{records:[...first,...second],providerID:'openalex',hasMore:false};}),{ui,renders}=f;let renderBase=0;
 ui.discoveryResultsView=()=>{};await ui.searchCollection();assert.equal(renders.length,3);assert.equal(renders[0].options.append,false,'a new query cannot reuse the previous query’s selection closure');assert.equal(renders[1].options.append,true);assert.equal(renders[2].options.append,true);assert.equal(ui.collectionChosen.size,1);assert.ok(ui.collectionChosen.has(ui.collectionResults[0]));
 renderBase=renders.length;ui.discoveryPrimary.value='new query';await ui.searchCollection();assert.equal(renders[3].options.append,false);assert.equal(ui.collectionChosen.size,1);assert.equal(ui.collectionResults[0].id,200);
});
test('a progress report still waiting for its frame is shown when the search stops',async()=>{
 let entered;const started=new Promise(resolve=>entered=resolve),f=fixture(async(_query,options)=>{options.onProgress({records:rows(300,3)});entered();return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('已取消'),{name:'AbortError'})),{once:true}));});
 const pending=f.ui.searchCollection();await started;assert.equal(f.renders.length,0);assert.equal(f.frames.size,1);f.ui.discoveryAbort.abort();await pending;
 assert.equal(f.renders.length,1);assert.equal(f.ui.collectionResults.length,3);assert.equal(f.frames.size,0,'no frame is left after the search ends');assert.equal(f.ui.collectionStatus.textContent,'已停止检索');
});

test('canceling a new query after partial results cannot resume the previous query’s cursor or reveal a global error bar',async()=>{
 let entered;const started=new Promise(resolve=>entered=resolve),{ui,results,statuses}=fixture(async(_query,options)=>{options.onProgress({records:rows(100,2)});entered();return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('已取消'),{name:'AbortError'})),{once:true}));});
 ui.collectionResults=rows(0,20);ui.collectionSearchState={query:'previous query',researchScope:{},filters:{},provider:'crossref',page:1,nextPage:2,nextCursor:'old-cursor',hasMore:true};results.dataset.collectionResults='search';ui.discoveryPrimary.value='new query';const pending=ui.searchCollection();await started;ui.discoveryAbort.abort();await pending;
 assert.equal(ui.collectionResults.length,2);assert.equal(ui.collectionResults[0].id,100);assert.equal(ui.collectionSearchState,null,'the previous query cursor is invalidated at the start of a different search');assert.equal(results.querySelector('.discovery-page-controls'),null,'retry cannot fetch the previous topic into the new partial results');assert.equal(ui.collectionSearching,false);assert.equal(ui.collectionStatus.role,'status');assert.equal(ui.collectionStatus.textContent,'已停止检索');assert.equal(statuses.some(row=>row.error),false,'正常取消不显示会移动整页的全局错误条');
});

test('provider failures use the existing inline alert and clear an earlier global error before searching',async()=>{
 const{ui,statuses}=fixture(async()=>{throw Error('HTTP 429，请稍后重试');});await ui.searchCollection();assert.deepEqual(statuses[0],{message:'',error:false});assert.equal(ui.collectionStatus.role,'alert');assert.equal(ui.collectionStatus.textContent,'HTTP 429，请稍后重试');assert.equal(statuses.some(row=>row.error),false);assert.equal(ui.collectionSearching,false);
});
test('stop immediately clears busy feedback even when a provider never honors cancellation',async()=>{
 let entered;const started=new Promise(resolve=>entered=resolve),{ui}=fixture(async()=>{entered();return new Promise(()=>{});});
 const pending=ui.searchCollection();await started;ui.stopDiscoverySearch();assert.equal(ui.collectionStatus.textContent,'已停止检索');assert.equal(ui.collectionStatus['aria-busy'],'false');assert.equal(ui.collectionSearching,false);await pending;
});
test('keyword-only retry clears domain and filters, keeps exclusions and matching mode, and says exactly what changed',async()=>{
 const {ui,state}=fixture();ui.discoveryScopeTools={normalizeResearchScope};ui.discoveryPrimary.value='AccMPEG';ui.discoverySecondary.value='';ui.discoveryAcronym.value='custom acronym';
 for(const key of ['collectionJournalType','collectionSort','discoveryYears','discoveryYearFrom','discoveryYearTo'])ui[key]={value:'restricted'};
 ui.discoveryExcluded={value:'medical；clinical'};ui.discoveryFuzzy={checked:false};
 ui.discoveryDomainPicker={setScope:scope=>assert.equal(scope.domain,''),getScope:scope=>scope};ui.discoveryYearRange={hidden:false};
 await ui.resetDiscoveryFilters({keepKeywords:true});assert.equal(ui.discoveryPrimary.value,'AccMPEG');assert.equal(ui.discoveryDomain.value,'');assert.equal(ui.collectionJournal.value,'');assert.equal(ui.discoveryYears.value,'');assert.equal(ui.collectionSort.value,'relevance');assert.equal(ui.collectionSearchState,null);
 assert.equal(ui.discoveryExcluded.value,'medical；clinical','exclusions survive a keyword-only retry');assert.equal(ui.discoveryFuzzy.checked,false,'the matching mode survives');
 assert.match(ui.collectionStatus.textContent,/已取消研究领域、来源、期刊类别、指定期刊和年份限制，排序恢复为相关性；保留关键词、缩写含义、排除词、精确匹配/);assert.equal(ui.discoveryScopeNote.textContent,ui.collectionStatus.textContent);
 assert.deepEqual([...state.settings.discoveryResearchScope.excludedKeywords],['medical','clinical']);assert.equal(state.settings.discoveryResearchScope.fuzzy,false);
 await ui.resetDiscoveryFilters();assert.equal(ui.discoveryExcluded.value,'');assert.equal(ui.discoveryFuzzy.checked,true);assert.equal(ui.discoveryPrimary.value,'');assert.equal(ui.collectionStatus.textContent,'搜索与筛选已清空');assert.equal(ui.discoveryScopeNote.textContent,'');
});

test('the current unified search retries an empty batch with refresh and clears retry state only after recovery',async()=>{
 const calls=[],{ui}=fixture(async(_query,options)=>{calls.push(options);return{records:calls.length===1?[]:rows(1,1),provider:'openalex',hasMore:false};});
 await ui.searchCollection();assert.equal(calls[0].refresh,false);assert.equal(ui.collectionSearchNeedsRetry,true);
 await ui.searchCollection();assert.equal(calls[1].refresh,true,'an explicit re-search must recheck the failed PDF and provider state');assert.equal(ui.collectionResults.length,1);assert.equal(ui.collectionSearchNeedsRetry,false);
});

test('the current unified search can resubmit after failure without inheriting its busy state',async()=>{
 const calls=[],{ui}=fixture(async(_query,options)=>{calls.push(options);if(calls.length===1)throw Error('temporary source failure');return{records:rows(2,1),provider:'openalex',hasMore:false};});
 await ui.searchCollection();assert.equal(ui.collectionSearching,false);assert.equal(ui.collectionSearchNeedsRetry,true);
 await ui.searchCollection();assert.equal(calls[1].refresh,true);assert.equal(ui.collectionResults[0].id,2);assert.equal(ui.collectionStatus.role,'status');assert.equal(ui.collectionSearching,false);
});

test('the effective query and limitations are shown as a visible line and survive loading more',async()=>{
 let calls=0;const f=fixture(async()=>++calls===1?{records:rows(1,2),providerID:'openalex',page:1,nextPage:2,hasMore:true,searchQuery:'AccMPEG communications',limitations:['当前来源不支持精确期刊筛选']}:{records:rows(3,1),providerID:'openalex',page:2,hasMore:false,searchQuery:'AccMPEG communications',limitations:['当前来源不支持精确期刊筛选']}),{ui}=f;
 ui.discoveryScopeTools={normalizeResearchScope};ui.discoveryDomainPicker={setScope(){},getScope:scope=>scope};for(const key of ['collectionJournalType','collectionSort','discoveryYears','discoveryYearFrom','discoveryYearTo'])ui[key]={value:''};ui.discoveryExcluded={value:''};
 ui.discoveryPrimary.value='AccMPEG';await ui.resetDiscoveryFilters({keepKeywords:true});await ui.searchCollection();
 assert.match(ui.discoveryScopeNote.textContent,/已取消研究领域/);assert.match(ui.discoveryScopeNote.textContent,/实际检索词：AccMPEG communications/);assert.match(ui.discoveryScopeNote.textContent,/不支持精确期刊筛选/);
 const shown=ui.discoveryScopeNote.textContent;await ui.searchCollection(true);assert.equal(ui.discoveryScopeNote.textContent,shown,'loading more keeps the line');
 ui.discoveryPrimary.value='other topic';await ui.searchCollection();assert.doesNotMatch(ui.discoveryScopeNote.textContent,/已取消研究领域/,'the reset note belongs only to the retry it explained');assert.match(ui.discoveryScopeNote.textContent,/实际检索词/);
});

test('the selected sort is re-applied to merged pages and partial results',async()=>{
 let calls=0,partialOrder;const page=(ids,counts)=>ids.map((id,i)=>({id,title:'Paper '+id,doi:'10.1/'+id,citationCount:counts[i]}));
 const f=fixture(async(_query,options)=>{if(++calls===1){options.onProgress({records:page([1,2],[5,40])});f.runFrames();partialOrder=[...f.ui.collectionResults].map(row=>row.id);return{records:page([1,2],[5,40]),providerID:'semantic',page:1,nextPage:2,hasMore:true};}return{records:page([3,4],[90,1]),providerID:'semantic',page:2,hasMore:false};}),{ui}=f;
 Object.assign(ui.agentDiscoveryPresentation,{sortDiscoveryRecords,mergeDiscoveryRecords:Presentation.mergeDiscoveryRecords});ui.collectionFilters={sort:'citations'};
 await ui.searchCollection();assert.deepEqual(partialOrder,[2,1],'partial results follow the selected sort');assert.deepEqual([...ui.collectionResults].map(row=>row.id),[2,1]);
 await ui.searchCollection(true);assert.deepEqual([...ui.collectionResults].map(row=>row.id),[3,2,1,4],'a highly cited page-2 paper moves above weaker page-1 results');
});
test('with 相关性 a later page is appended; its domain matches rank only within that page',async()=>{
 let calls=0;const row=(id,domainMatch)=>({id,title:'Paper '+id,doi:'10.2/'+id,domainMatch});
 const f=fixture(async(_query,options)=>{if(++calls===1){const first=Presentation.sortDiscoveryRecords([row('p1-a',false),row('p1-b',false),row('p1-c',true)],'relevance');options.onProgress({records:first});f.runFrames();return{records:first,providerID:'openalex',page:1,nextPage:2,hasMore:true};}options.onProgress({records:[row('p2-b',false)]});f.runFrames();return{records:[row('p2-b',false),row('p2-a',true)],providerID:'openalex',page:2,hasMore:false};}),{ui}=f;
 ui.discoveryPresentationTools=Presentation;ui.collectionFilters={sort:'relevance'};
 await ui.searchCollection();assert.deepEqual(ui.collectionResults.map(item=>item.id),['p1-c','p1-a','p1-b']);const firstPage=[...ui.collectionResults];
 await ui.searchCollection(true);assert.deepEqual(ui.collectionResults.map(item=>item.id),['p1-c','p1-a','p1-b','p2-a','p2-b'],'page 2 follows the cards already shown');
 assert.ok(firstPage.every((item,index)=>ui.collectionResults[index]===item),'the shown cards keep their places and identities');
});
test('a load-more round whose papers first arrive through progress reports re-arms automatic loading',async()=>{
 // The 最新 mode calls recommendationFeed with one options object.
 let calls=0;const f=fixture(async options=>{if(++calls===1)return{records:rows(0,20),page:1,nextPage:2,nextCursor:'cursor-2',providerID:'openalex',hasMore:true,scan:{scanned:40,matched:20,total:400,removed:{},relax:{}}};
  // The feed reports verified papers while it checks PDFs; a frame shows them before the round ends.
  options.onProgress({records:rows(20,5),partial:true,phase:'verify',done:5,total:8,scan:{scanned:40}});f.runFrames();
  return{records:rows(20,5),page:2,nextPage:3,nextCursor:'cursor-3',providerID:'openalex',hasMore:true,scan:{scanned:40,matched:5,total:400,removed:{pdf:35},relax:{}}};}),{ui,results,observers}=f;
 ui.discoveryMode='latest';await ui.searchCollection();assert.equal(observers.length,1);
 await observers[0]();assert.equal(ui.collectionResults.length,25);assert.equal(ui.discoveryEmptyRound,false,'papers shown by a progress report count as added');
 assert.equal(observers.length,2,'automatic loading is armed again');assert.equal(results.querySelector('.discovery-page-controls').children[0].textContent,'加载更多论文');assert.match(ui.collectionStatus.textContent,/^已显示 25 篇 · 下滑或点击加载更多/);
});
test('the status line names the model step while the query is expanded, then returns to the PDF search',async()=>{
 const seen=[],f=fixture(async(_query,options)=>{options.onProgress({records:[],phase:'expand',partial:true});seen.push(f.ui.collectionStatus.textContent);options.onProgress({records:[],phase:'search',partial:true});seen.push(f.ui.collectionStatus.textContent);return{records:rows(1,1),providerID:'openalex',page:1,hasMore:false};});
 f.ui.discoveryExpand={checked:true};await f.ui.searchCollection(false,{trigger:'submit'});
 assert.deepEqual(seen,['正在扩展检索词…','正在检索公开 PDF…']);
});
test('a failed easyScholar lookup is named in the status line and the empty state, apart from journals without a record',async()=>{
 const f=fixture(async()=>({records:[],providerID:'openalex',page:1,hasMore:false,scan:{scanned:6,matched:6,total:6,removed:{topUnknown:6},relax:{topUnknown:6,top:6},metricLookup:'failed',metricFailed:2}})),{ui,results,renderDiscovery}=f;
 ui.renderDiscovery=renderDiscovery;ui.discoveryPresentationTools=Presentation;ui.collectionJournalType={value:'top'};await ui.searchCollection();
 assert.equal(results.children[0].children[0].textContent,'easyScholar 查询未成功（2 本期刊），期刊 TOP 未核验的 6 篇论文未显示。请检查设置中的密钥或稍后重试，也可选择“包含未核验期刊”。','some unverified journals may simply have no record, so the failure is not named as the only cause');
 assert.equal(ui.collectionStatus.textContent,'已显示 0 篇 · 已扫描 6 篇：期刊 TOP 未核验 6 篇 · easyScholar 查询未成功（2 本期刊），请检查设置中的密钥或稍后重试');
});

function retryFixture(){
 const f=fixture(),{ui,results,renderDiscovery}=f,calls={pdf:[],metadata:[]};ui.renderDiscovery=renderDiscovery;ui.agentDiscoveryPresentation.discoveryPDFCandidate=()=>true;ui.agentDiscoveryPresentation.discoveryMetricLabel=()=>null;
 const folders={ids:[7],choice:7};ui.E.discoveryCollections=async()=>({libraryID:1,collections:folders.ids.map(id=>({id,libraryID:1}))});
 ui.resolveDiscoveryDestination=async()=>{if(!folders.ids.includes(folders.choice))throw Error('所选文件夹已不存在，请重新选择论文保存位置');return{collectionID:folders.choice,libraryID:1};};ui.refreshDiscoveryProjectScope=async()=>{};ui.E.library={};
 return {...f,calls,folders,list:()=>results.children[1],button:label=>results.children[0].querySelectorAll('button').find(node=>node.textContent===label)};
}
test('retry repeats a failed title-only save for that record and never downloads a PDF',async()=>{
 const f=retryFixture(),{ui,calls}=f,records=[{id:1,title:'Same title',doi:'10.1/a',pdf:'https://example.org/a.pdf'},{id:2,title:'Same title',doi:'10.1/b',pdf:'https://example.org/b.pdf'}];let fail=true;
 ui.E.obtainPaper=async row=>{calls.pdf.push(row.id);return{attachmentID:90+row.id};};ui.E.importAcademic=async(row,options)=>{calls.metadata.push([row.id,options.collectionID]);if(row.id===2&&fail){fail=false;throw Error('HTTP 503');}return{itemID:row.id};};
 ui.renderDiscovery(records,{search:true});const card=f.list().children.find(node=>node._discoveryRecord===records[1]);assert.ok(card);for(const r of records)ui.collectionChosen.add(r);await f.button('只保存题录与摘要').onclick();
 assert.equal(ui.collectionOutcomes.get(records[1]).action,'metadata');const failure=f.list().children.find(node=>node.className==='discovery-download-failure');assert.ok(failure);
 await failure.querySelector('button').onclick();
 assert.deepEqual(calls.pdf,[],'a title-only failure is retried as title-only');assert.deepEqual(calls.metadata.map(row=>row[0]),[1,2,2]);assert.ok(calls.metadata.every(row=>row[1]===7));
 assert.equal(ui.collectionOutcomes.get(records[1]).message,'题录与摘要已保存至所选文件夹');assert.equal(f.list().children.some(node=>node.className==='discovery-download-failure'),false);
 assert.strictEqual(f.list().children.find(node=>node._discoveryRecord===records[1]),card,'the retried record keeps its card');
});
test('retry repeats a failed PDF download for that record only',async()=>{
 const f=retryFixture(),{ui,calls}=f,records=[{id:1,title:'Same title',doi:'10.1/a',pdf:'https://example.org/a.pdf'},{id:2,title:'Same title',doi:'10.1/b',pdf:'https://example.org/b.pdf'}];let fail=true;
 ui.E.obtainPaper=async row=>{calls.pdf.push(row.id);if(row.id===2&&fail){fail=false;throw Error('PDF 无法获取');}return{attachmentID:90+row.id};};ui.E.importAcademic=async row=>{calls.metadata.push([row.id]);return{};};
 ui.renderDiscovery(records,{search:true});for(const r of records)ui.collectionChosen.add(r);await f.button('获取选中附件').onclick();
 const failure=f.list().children.find(node=>node.className==='discovery-download-failure');await failure.querySelector('button').onclick();
 assert.deepEqual(calls.pdf,[1,2,2]);assert.deepEqual(calls.metadata,[]);assert.equal(ui.collectionOutcomes.get(records[1]).result.attachmentID,92);
});
test('retry reuses the failed folder while it exists and asks again once it is deleted',async()=>{
 const f=retryFixture(),{ui,folders}=f,records=[{id:2,title:'Paper',doi:'10.1/b',pdf:'https://example.org/b.pdf'}],folderOf=[];let failures=2;
 ui.E.obtainPaper=async(_row,options)=>{folderOf.push(options.collectionID);if(failures-->0)throw Error('PDF 无法获取');return{attachmentID:92};};ui.E.importAcademic=async()=>({});
 const retry=()=>f.list().children.find(node=>node.className==='discovery-download-failure').querySelector('button').onclick();
 ui.renderDiscovery(records,{search:true});ui.collectionChosen.add(records[0]);await f.button('获取选中附件').onclick();
 folders.ids.push(8);folders.choice=8;await retry();
 assert.deepEqual(folderOf,[7,7],'an existing failed folder is reused, not the newer choice');
 folders.ids=[8];folders.choice=7;await retry();
 assert.deepEqual(folderOf,[7,7],'a deleted folder is not tried again');assert.match(ui.collectionOutcomes.get(records[0]).message,/已不存在/);assert.equal(ui.collectionOutcomes.get(records[0]).destination,null,'a folder that failed the check is not stored');
 folders.choice=8;await retry();
 assert.deepEqual(folderOf,[7,7,8],'the retry uses the folder chosen after the deletion');assert.equal(ui.collectionOutcomes.get(records[0]).result.attachmentID,92);
});
test('a keyword-only retry note stopped by the acronym check does not describe a later search',async()=>{
 const f=fixture(async()=>({records:rows(1,1),providerID:'openalex',page:1,hasMore:false,searchQuery:'CNN modulation'})),{ui}=f;
 ui.discoveryScopeTools={normalizeResearchScope};ui.discoveryDomainPicker={setScope(){},getScope:scope=>scope};ui.discoveryDomain={value:'communications',focus(){}};
 for(const key of ['collectionJournalType','collectionSort','discoveryYears','discoveryYearFrom','discoveryYearTo'])ui[key]={value:''};ui.discoveryExcluded={value:''};
 ui.discoveryPrimary.value='CNN modulation';await ui.resetDiscoveryFilters({keepKeywords:true});await ui.searchCollection();
 assert.match(ui.discoveryScopeNote.textContent,/缩写有多种含义/);
 ui.discoveryDomain.value='communications';await ui.searchCollection();
 assert.doesNotMatch(ui.discoveryScopeNote.textContent,/已取消研究领域/,'the note belonged to the retry that the acronym check stopped');assert.equal(ui.discoveryScopeNote.textContent,'实际检索词：CNN modulation');
 assert.equal(ui.collectionSearchState.scopeReset,'');
});
test('a new search keeps the scope line until its own results replace the cards',async()=>{
 let calls=0,finish;const f=fixture(async(query,options)=>{calls++;if(calls===1)return{records:rows(1,1),providerID:'openalex',page:1,hasMore:false,searchQuery:'first topic',limitations:['当前来源不支持精确期刊筛选']};options.onProgress({records:rows(10+calls,1),query});await new Promise(resolve=>finish=resolve);return{records:rows(10+calls,1),providerID:'openalex',page:1,hasMore:false,searchQuery:query,limitations:calls===2?['当前来源不支持精确期刊筛选']:[]};}),{ui}=f;
 ui.discoveryPrimary.value='first topic';await ui.searchCollection();const first=ui.discoveryScopeNote.textContent;assert.equal(first,'实际检索词：first topic · 当前来源不支持精确期刊筛选');
 ui.discoveryPrimary.value='second topic';let search=ui.searchCollection();for(let n=0;n<5;n++)await new Promise(resolve=>setImmediate(resolve));assert.ok(finish,'the search waits for its provider');
 assert.equal(ui.discoveryScopeNote.textContent,first,'starting a search does not empty the line above the filters');
 f.runFrames();assert.equal(ui.discoveryScopeNote.textContent,'实际检索词：second topic','once new cards replace the old ones the line names their query');
 finish();await search;assert.equal(ui.discoveryScopeNote.textContent,'实际检索词：second topic · 当前来源不支持精确期刊筛选');
 finish=null;search=ui.searchCollection();for(let n=0;n<5;n++)await new Promise(resolve=>setImmediate(resolve));assert.ok(finish,'the search waits for its provider');f.runFrames();
 assert.equal(ui.discoveryScopeNote.textContent,'实际检索词：second topic · 当前来源不支持精确期刊筛选','partial results of the same query leave the line unchanged');
 finish();await search;assert.equal(ui.discoveryScopeNote.textContent,'实际检索词：second topic');
});
test('a domain browse without a query keeps a limitations line and drops a stale query while its results arrive',async()=>{
 let finish;const f=fixture(async(_query,options)=>{options.onProgress({records:rows(5,1),query:''});await new Promise(resolve=>finish=resolve);return{records:rows(5,1),providerID:'openalex',page:1,hasMore:false,searchQuery:'',limitations:['当前来源不支持精确期刊筛选']};}),{ui}=f;
 const browse=async before=>{ui.discoveryScopeNote.textContent=before;finish=null;const search=ui.searchCollection();for(let n=0;n<5;n++)await new Promise(resolve=>setImmediate(resolve));assert.ok(finish,'the search waits for its provider');f.runFrames();const during=ui.discoveryScopeNote.textContent;finish();await search;return during;};
 ui.discoveryPrimary.value='';
 assert.equal(await browse('当前来源不支持精确期刊筛选'),'当前来源不支持精确期刊筛选','no query to name, so the line is not blanked');
 assert.equal(await browse('实际检索词：old topic'),'','a line naming another query is not kept beside the new cards');
 assert.equal(ui.discoveryScopeNote.textContent,'当前来源不支持精确期刊筛选');
});
test('a progress render keeps the live download text of a card that is still saving',()=>{
 const f=retryFixture(),{ui}=f,records=[{id:1,title:'Paper',doi:'10.1/a',pdf:'https://example.org/a.pdf'}];
 ui.renderDiscovery(records,{search:true});const card=f.list().children[0],state=card.children.find(node=>node.role==='status');
 ui.collectionOutcomes.set(records[0],{pending:true});state.textContent='正在下载 PDF…';
 ui.renderDiscovery([...records,{id:2,title:'Next paper',doi:'10.1/b',pdf:'https://example.org/b.pdf'}],{search:true,append:true});
 assert.equal(state.textContent,'正在下载 PDF…');assert.equal(f.list().children.length,2);assert.strictEqual(f.list().children[0],card);
});

test('the empty state names the filter that removed the papers and relaxes it in one click',async()=>{
 const calls=[],f=fixture(async(_query,options)=>{calls.push(options);return{records:[],providerID:'openalex',page:1,hasMore:false,scan:{scanned:12,matched:1,total:12,removed:{keywords:11,topUnknown:1},relax:{topUnknown:1,top:1},metricLookup:'ok'}};}),{ui,results,renderDiscovery}=f;
 ui.renderDiscovery=renderDiscovery;ui.discoveryPresentationTools=Presentation;ui.collectionJournalType={value:'top'};
 await ui.searchCollection();
 const text=results.children[0].children[0].textContent;assert.equal(text,'已扫描 12 篇：题名与摘要缺少关键词 11 篇，期刊 TOP 未核验 1 篇，没有可显示的论文。可减少关键词，或用分号补充同义词。');assert.doesNotMatch(text,/领域与 PDF/,'领域与 PDF did not remove these papers');
 const buttons=results.children[0].children[1].children;assert.deepEqual(buttons.map(button=>button.textContent),['包含未核验期刊 +1','取消顶刊 +1']);
 await buttons[0].onclick();assert.equal(ui.collectionJournalType.value,'top-unverified');assert.equal(calls.length,2);
});
test('without an easyScholar key the empty state says why TOP removed the papers',async()=>{
 const f=fixture(async()=>({records:[],providerID:'openalex',page:1,hasMore:false,scan:{scanned:5,matched:5,total:5,removed:{topUnknown:5},relax:{topUnknown:5,top:5},metricLookup:'no-key'}})),{ui,results,renderDiscovery}=f;
 ui.renderDiscovery=renderDiscovery;ui.discoveryPresentationTools=Presentation;ui.collectionJournalType={value:'top'};await ui.searchCollection();
 assert.match(results.children[0].children[0].textContent,/^未配置 easyScholar 密钥，无法核验期刊 TOP，5 篇论文因此未显示。/);
});
test('only the explicit submit may expand the query; load more keeps those terms and the option can turn it off',async()=>{
 const calls=[],expansion={signature:'sig',source:'model',terms:{primaryKeyword:['spin current']},removed:[]},{ui}=fixture(async(_query,options)=>{calls.push(options);return{records:rows(calls.length*10,1),providerID:'openalex',page:calls.length,nextPage:calls.length+1,nextCursor:'n'+calls.length,hasMore:true,queryExpansion:expansion};});
 ui.discoveryExpand={checked:true};ui.discoveryStrictDomain={checked:false};
 await ui.searchCollection(false,{trigger:'submit'});assert.equal(calls[0].queryExpansion,'auto');assert.equal(calls[0].domainMatch,'rank');assert.equal(JSON.stringify(calls[0].scanBudget),JSON.stringify({batches:10,ms:20000}));
 await ui.searchCollection(true);assert.equal(JSON.stringify(calls[1].queryExpansion),JSON.stringify({terms:{primaryKeyword:['spin current']},removed:[]}),'load more never asks the model');
 await ui.searchCollection();assert.equal(calls[2].queryExpansion,'cache','filter changes and history reuse saved terms');
 ui.discoveryStrictDomain.checked=true;ui.discoveryExpand.checked=false;await ui.searchCollection(false,{trigger:'submit'});assert.equal(calls[3].queryExpansion,'off');assert.equal(calls[3].domainMatch,'strict');
});
test('expanded terms are removable chips and removing one reruns the search without the model',async()=>{
 const removed=[],calls=[],{ui}=fixture(async(_query,options)=>{calls.push(options);return{records:rows(1,1),providerID:'openalex',page:1,hasMore:false,queryExpansion:{signature:'sig',source:'model',terms:{primaryKeyword:['spin current'],secondaryKeyword:['magnon']},removed:[]}};});
 ui.discoveryExpansionHost=ui.el('div');ui.E.removeDiscoveryQueryTerm=async(signature,term)=>removed.push([signature,term]);
 await ui.searchCollection(false,{trigger:'submit'});const chips=ui.discoveryExpansionHost.children.filter(node=>node.className==='discovery-expansion-term');
 assert.deepEqual(chips.map(chip=>chip.textContent),['spin current','magnon']);assert.equal(ui.discoveryExpansionHost.hidden,false);
 await chips[1].children[0].onclick();assert.deepEqual(removed,[['sig','magnon']]);assert.equal(calls[1].queryExpansion,'cache');
});

test('an unchanged, still existing download folder is not rewritten for each download',async()=>{
 const f=fixture(),{ui,state}=f;let writes=0,scans=0;state.settings.discoveryDestination={collectionID:7,libraryID:1};
 ui.E.store={get:(...path)=>path.reduce((value,key)=>value?.[key],state),update:async fn=>{writes++;fn(state);}};ui.E.discoveryCollections=async()=>{scans++;return{collections:[{id:7,libraryID:1}],libraryID:1};};ui.E.manuscripts={all:()=>({})};
 for(let n=0;n<3;n++)assert.deepEqual({...await ui.resolveDiscoveryDestination()},{collectionID:7,libraryID:1});
 assert.equal(writes,0,'no settings commit for an unchanged destination');assert.equal(scans,3,'each acquisition still revalidates the folder');
 await ui.saveDiscoveryDestination({collectionID:7});assert.equal(writes,0);await ui.saveDiscoveryDestination({collectionID:8});assert.equal(writes,1);assert.equal(state.settings.discoveryDestination.collectionID,8);
});
test('leaving for 研究对话 and returning keeps a finished search page as it was and re-arms loading',async()=>{
 const {ui,results,observers}=fixture(async()=>({records:rows(0,20),page:1,nextPage:2,nextCursor:'next',providerID:'openalex',hasMore:true}));
 const label=()=>results.querySelector('.discovery-page-controls').children[0].textContent,current=ui.$;ui.$=id=>current(id)||(id==='discovery-current'?{textContent:''}:undefined);ui.E.library={selection:()=>[]};
 ui.discoveryMode='latest';await ui.searchCollection();const status=ui.collectionStatus.textContent;assert.equal(label(),'加载更多论文');assert.equal(observers.length,1);
 ui.suspendDiscovery();ui.activeView='search';ui.prepareDiscovery();
 assert.equal(ui.collectionPagingError,false,'an idle search is not marked as failed');assert.equal(label(),'加载更多论文');assert.equal(ui.collectionStatus.textContent,status);assert.notEqual(ui.collectionStatus.textContent,'已停止检索');
 assert.equal(observers.length,2,'scrolling to the end loads more again');
});

test('an ambiguous acronym in the second keyword is held back like one in the first',async()=>{
 let calls=0;const {ui}=fixture(async()=>{calls++;return {records:rows(1,1),hasMore:false};});
 ui.discoveryDomain={value:'',focus(){}};ui.$('search-query').value='';ui.discoverySecondary.value='CNN';
 await ui.searchCollection();assert.equal(calls,0);assert.match(ui.discoveryScopeNote.textContent,/缩写有多种含义/);
 ui.discoveryAcronym.value='convolutional neural network';await ui.searchCollection();assert.equal(calls,1,'once the meaning is given the search runs');
});

test('leaving for 研究对话 during 收集参考文献 shows the stopped collection and 重试收集 on return',async()=>{
 const {ui,results}=fixture(async()=>({records:[],hasMore:false})),current=ui.$,requests=[];
 ui.$=id=>current(id)||(id==='discovery-current'?{textContent:''}:undefined);ui.E.library={selection:()=>[]};ui.current={id:5,title:'Current paper'};
 ui.E.discover=(_paper,_kind,{signal,refresh})=>{requests.push(refresh);return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('已取消'),{name:'AbortError'}))));};
 const text=()=>results.children.map(child=>child.textContent).join(' | ');
 const pending=ui.loadDiscovery('references');await new Promise(resolve=>setImmediate(resolve));
 assert.match(text(),/正在读取参考文献并匹配题录/);
 ui.suspendDiscovery();await pending;ui.activeView='search';ui.prepareDiscovery();
 assert.equal(text(),'已停止收集，已匹配的题录缓存保留。 | 重试收集','the stopped collection is shown, not the running one');
 assert.equal(ui.$('collect-references').disabled,false);
 const retry=results.children.find(child=>child.textContent==='重试收集');retry.onclick();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(requests,[false,true],'重试收集 starts the collection again');
 ui.E.discover=async()=>({records:[],references:[],skipped:[]});await ui.loadDiscovery('references');
 const finished=text();ui.suspendDiscovery();ui.prepareDiscovery();
 assert.equal(text(),finished,'a finished collection is left as it was');
});
