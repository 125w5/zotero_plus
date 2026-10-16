/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {paperOverviewMetadata,abstractFromExtractedDocument,abstractExcerpt,abstractKeywordSegments,boundedMapSet} from '../../chrome/content/zotero/research/shared/paper-overview-data.mjs';
import {installPaperOverview} from '../../chrome/content/zotero/research/shared/paper-overview.mjs';
import {prepareReaderPaneStyles} from '../../chrome/content/zotero/research/shared/reader-pane-styles.mjs';
const storeFor=state=>({get:(...path)=>path.reduce((branch,key)=>branch?.[key],state)});

test('parent metadata supplies paper fields without turning missing IF into zero',()=>{const fields={title:'Research paper',publicationTitle:'Verified journal',date:'2026-04-15',DOI:'10.1000/actual',abstractNote:'Parent abstract wins'};const item={getField:key=>fields[key]||'',getCreators:()=>[{firstName:'Ada',lastName:'Lovelace'}]};const result=paperOverviewMetadata(item,{sourceInfo:{metric:{impact_factor:null}}});assert.equal(result.title,fields.title);assert.equal(result.authors,'Ada Lovelace');assert.equal(result.year,'2026');assert.equal(result.abstract,fields.abstractNote);assert.equal(result.metric,null);});
test('verified impact factor retains its actual value, year and provenance',()=>{const info={metric:{impact_factor:0,metric_year:2025,source:'Saved JCR record'},journalContext:{journal:'Journal',kind:'published'}};const result=paperOverviewMetadata({getField:()=>''},{sourceInfo:info});assert.deepEqual(result.metric,{value:0,year:2025,source:'Saved JCR record',submitted:false});assert.equal(result.journal,'Journal');});
test('unavailable, blank and invalid impact factors are omitted',()=>{for(const impact_factor of [undefined,null,'','  ','unknown',NaN,-1]){assert.equal(paperOverviewMetadata({getField:()=>''},{sourceInfo:{metric:{impact_factor}}}).metric,null);}});
test('preserves populated native publication fields and full creator roles instead of a shortened description',()=>{
 const values={title:'User-edited paper title',publicationTitle:'Actual Journal',conferenceName:'Actual Conference',publisher:'Actual Publisher',volume:'12',issue:'3',pages:'45–60',date:'2025-10-09',DOI:'10.1000/real',ISSN:'1234-5678',url:'https://example.invalid/source',reportNumber:'R-27'};
 const item={getField:key=>values[key]||'',getCreators:()=>[{firstName:'Ada',lastName:'Lovelace',creatorTypeID:1},{lastName:'Research Group',fieldMode:1,creatorTypeID:2},{firstName:'Grace',lastName:'Hopper',creatorTypeID:3}]};
 const result=paperOverviewMetadata(item,{describe:{authors:'Ada et al.'},sourceInfo:{journalContext:{paperTitle:'Parsed title must not overwrite user title'}},fieldNames:['reportNumber','volume','abstractNote','title'],creatorRole:id=>({1:'作者',2:'编者',3:'译者'})[id],localizeField:key=>key==='reportNumber'?'报告编号':''});
 assert.equal(result.title,values.title);assert.equal(result.authors,'Ada Lovelace, Research Group, Grace Hopper');assert.deepEqual(result.creators,[{role:'作者',names:['Ada Lovelace']},{role:'编者',names:['Research Group']},{role:'译者',names:['Grace Hopper']}]);
 for(const [key,value]of Object.entries(values).filter(([key])=>key!=='title'))assert.equal(result.fields.find(row=>row.key===key)?.value,value);
 assert.equal(result.fields.find(row=>row.key==='reportNumber').label,'报告编号');assert.equal(result.fields.filter(row=>row.key==='volume').length,1);assert.equal(result.fields.some(row=>row.key==='edition'),false);assert.equal(result.fields.some(row=>row.key==='abstractNote'),false);
});
test('abstract excerpt selects actual problem and result sentences without generating conclusions or damaging decimal values',()=>{
 const first='Domain adaptation with CNN addresses the device shift problem.',method='The controlled evaluation uses independent recordings and fixed data partitions. '.repeat(5),result='Experiments show 95.6% accuracy on the held-out recordings.';
 const source=first+' '+method+result,excerpt=abstractExcerpt(source);assert.equal(excerpt.shortened,true);assert.equal(excerpt.full,source.trim());assert.equal(excerpt.text,first+' '+method.trim().split('. ')[0]+'. '+result);assert.match(excerpt.text,/95\.6%/);
 const short='CNN 在独立设备上进行验证。';assert.deepEqual(abstractExcerpt(short),{text:short,full:short,shortened:false,sourceSentences:[{text:short,start:0,end:short.length}]});
});
test('a real survey brief selects actual review scope rather than generic field praise',async()=>{
 const source=await readFile(new URL('./fixtures/deep-learning-review-frontmatter.txt',import.meta.url),'utf8'),abstract=abstractFromExtractedDocument({paragraphs:[{sourceText:source}]}),excerpt=abstractExcerpt(abstract.text);
 assert.match(excerpt.text,/CNNs|architectures/);assert.doesNotMatch(excerpt.text,/Gold Standard/);assert.ok(abstract.text.includes(excerpt.text.split(' ').slice(0,8).join(' ')));assert.equal(abstract.keywords.length,11);
});
test('typographic Abstract and Keywords whitespace preserves actual labelled content',()=>{
 const result=abstractFromExtractedDocument({pages:[{pageIndex:0,text:'Title\nAbstract\u2003\nA controlled experiment verifies CNN transfer across independent devices.\nKeywords:\u2002CNN, transfer learning\nIntroduction\nBody'}]});
 assert.match(result.text,/independent devices/);assert.deepEqual(result.keywords,['CNN','transfer learning']);
});
test('keyword marks preserve the exact text, match saved terms and real acronyms, and ignore absent terms and substrings',()=>{
 const source='CNN and SCNN use domain adaptation. 域适应包含 O₂ 信号。<script>alert(1)</script>',segments=abstractKeywordSegments(source,['CNN','domain adaptation','域适应','O₂','未出现的方法']);assert.equal(segments.map(segment=>segment.text).join(''),source);
 const marked=segments.filter(segment=>segment.keyword).map(segment=>segment.text);assert.deepEqual(marked,['CNN','SCNN','domain adaptation','域适应','O₂']);assert.equal(marked.includes('未出现的方法'),false);
});
test('a brief keeps the entire result sentence and its uncertainty instead of truncating a numerical claim',()=>{
 const first='Independent devices validate the shift problem under a controlled evaluation protocol with comparable preprocessing and a prespecified test partition.';
 const method='The method estimates feature distributions without training on held-out examples.';
 const result='Results report 95.6% accuracy with a 95% confidence interval of 93.2–97.1% on held-out devices.';
 const excerpt=abstractExcerpt(first+' '+method+' '+result,{limit:100});
 assert.equal(excerpt.text,method+' '+result);assert.ok(excerpt.text.endsWith('on held-out devices.'));assert.match(excerpt.text,/93\.2–97\.1%/);
});
test('a research brief omits generic field praise and preserves its actual policy, quantitative conditions and traceable source sentences',()=>{
 const background='Satellite communication is crucial for global connectivity.',generic='In recent years these systems have become widely used.',method='This paper proposes a queue-aware scheduling policy for age-of-information minimization in vehicular networks.',result='Simulation results report a 35.0% reduction compared with the fixed policy when the upload rate is 5–100 kbps, under the stated channel assumptions.';
 const source=[background,generic,method,result].join(' '),excerpt=abstractExcerpt(source,{limit:100});
 assert.equal(excerpt.text,method+' '+result);assert.doesNotMatch(excerpt.text,/crucial|In recent years/);assert.match(excerpt.text,/5–100 kbps/);
 assert.equal(excerpt.sourceSentences.length,2);for(const sentence of excerpt.sourceSentences)assert.equal(excerpt.full.slice(sentence.start,sentence.end),sentence.text);
});
test('Chinese research briefs preserve the stated method and measured comparison without inventing missing results',()=>{
 const source='卫星通信系统是全球连接的重要组成部分。近年来这些系统得到广泛应用。本文提出基于队列状态的时隙分配策略以降低信息年龄。实验结果显示，在5至100 kbps上传速率下，该策略相比固定分配将感知保真度提高了35%。';
 const excerpt=abstractExcerpt(source,{limit:40});assert.equal(excerpt.text,'本文提出基于队列状态的时隙分配策略以降低信息年龄。 实验结果显示，在5至100 kbps上传速率下，该策略相比固定分配将感知保真度提高了35%。');
 const onlyMethod='Global connectivity is crucial. This paper proposes a queue-aware scheduling policy for vehicular networks. No quantitative evaluation is reported.';
 const methodBrief=abstractExcerpt(onlyMethod,{limit:30});assert.equal(methodBrief.text,'This paper proposes a queue-aware scheduling policy for vehicular networks.');assert.doesNotMatch(methodBrief.text,/\d|outperform/);
});
test('recovers only literal keywords following the Abstract section',()=>{const result=abstractFromExtractedDocument({paragraphs:[{pageIndex:0,sourceText:'Abstract-Independent devices validate CNN domain adaptation without shared test records.\nIndex Terms—CNN, domain adaptation; modulation classification\nI. INTRODUCTION\nBody'}]});assert.deepEqual(result.keywords,['CNN','domain adaptation','modulation classification']);assert.doesNotMatch(result.text,/Index Terms|INTRODUCTION/);});
test('extracts a real labelled Abstract with source position and stops before keywords',()=>{const result=abstractFromExtractedDocument({paragraphs:[{pageIndex:0,sourceText:'Paper title\nAuthors'},{pageIndex:1,position:{pageIndex:1,rects:[[1,2,3,4]]},sourceText:'Abstract—We evaluate domain adaptation with independent devices.\nThe test uses held-out recordings and reports uncertainty.\nIndex Terms—domain adaptation\nI. INTRODUCTION\nThis body must not enter the abstract.'}]});assert.equal(result.pageIndex,1);assert.equal(result.kind,'pdf');assert.match(result.text,/held-out recordings/);assert.doesNotMatch(result.text,/body must not/);assert.equal(result.position.pageIndex,1);});
test('accepts labelled Chinese abstracts and never uses mentions of abstract as a fabricated summary',()=>{const result=abstractFromExtractedDocument({pages:[{pageIndex:0,text:'摘要：本研究在独立采集批次上验证跨域调制识别方法，并报告实验控制条件。\n关键词：调制识别\n引言\n正文'}]});assert.match(result.text,/独立采集/);assert.equal(abstractFromExtractedDocument({pages:[{pageIndex:0,text:'We use abstract representations of features in the experiments.\nIntroduction\nOther prose.'}]}),null);assert.equal(abstractFromExtractedDocument({pages:[{pageIndex:0,text:'Abstract—A section without any boundary should remain unresolved.'}]}),null);});
test('rebuildable cache has a hard capacity and repeated access replaces an entry',()=>{const map=new Map();for(let i=0;i<1000;i++)boundedMapSet(map,String(i),{text:'x'.repeat(5000)},32);assert.equal(map.size,32);assert.equal(map.has('0'),false);boundedMapSet(map,'968','updated',32);boundedMapSet(map,'1000','new',32);assert.equal(map.size,32);assert.equal(map.get('968'),'updated');assert.equal(map.has('969'),false);});
test('uses parent abstracts or already extracted text with zero PDFWorker/model/network calls',async()=>{let workers=0,translation=0;const attachment={id:17,getFilePathAsync:async()=>'/paper.pdf'},parent={getField:()=>''};const E={store:storeFor({manuscriptIndex:{17:{documentKey:'known'}},manuscriptDocuments:{known:{paragraphs:[{pageIndex:0,sourceText:'Abstract—Independent devices are used to prevent data leakage.\nKeywords—devices\nIntroduction\nBody'}]}}}),quickTranslate:()=>{translation++;throw Error('Must not translate during abstract extraction');}};installPaperOverview(E,{Zotero:{PDFWorker:{getFullText:()=>{workers++;throw Error('Already extracted');}}},IOUtils:{stat:()=>{throw Error('Already extracted');}}});const result=await E.paperAbstract(attachment,parent);assert.match(result.text,/data leakage/);assert.equal(workers,0);assert.equal(translation,0);assert.deepEqual(await E.paperAbstract(attachment,{getField:()=> 'User-edited abstract'}),{text:'User-edited abstract',kind:'metadata'});});
test('concurrent local Abstract fallback shares one worker task without inventing a page coordinate',async()=>{let workers=0;const attachment={id:18,getFilePathAsync:async()=>'/paper.pdf'},E={store:storeFor({})};installPaperOverview(E,{Zotero:{PDFWorker:{getFullText:async()=>{workers++;await new Promise(resolve=>setTimeout(resolve,15));return {text:'Abstract—Independent held-out devices validate the method without leakage.\nIndex Terms—validation\nI. INTRODUCTION\nBody'};}}},IOUtils:{stat:async()=>({size:200,lastModified:10})}});const [a,b]=await Promise.all([E.paperAbstract(attachment,{getField:()=>''}),E.paperAbstract(attachment,{getField:()=>''})]);assert.equal(workers,1);assert.strictEqual(a,b);assert.equal(a.pageIndex,undefined);assert.equal(a.position,null);});
test('reads the existing local fulltext cache before starting a PDF worker',async()=>{let workers=0,reads=0;const E={store:storeFor({})},attachment={id:19,getFilePathAsync:async()=>'/paper.pdf'};installPaperOverview(E,{Zotero:{Fulltext:{getItemCacheFile:()=>({path:'/cache'})},PDFWorker:{getFullText:()=>{workers++;throw Error('Local cache already exists');}}},IOUtils:{stat:async()=>({size:200,lastModified:10}),exists:async()=>true,readUTF8:async()=>{reads++;return 'Abstract—The held-out datasets and evaluation protocol are specified.\nKeywords—validation\nIntroduction\nBody';}}});assert.match((await E.paperAbstract(attachment,{getField:()=>''})).text,/evaluation protocol/);assert.match((await E.paperAbstract(attachment,{getField:()=>''})).text,/evaluation protocol/);assert.equal(workers,0);assert.equal(reads,1);});

function abstractHost(){
 class Node{
  constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.isConnected=false;this.attributes={};this.dataset={};this.style={};}
  get childElementCount(){return this.children.length;}
  get textContent(){return (this._text||'')+this.children.map(child=>child.textContent||'').join('');}
  set textContent(value){this._text=value;this.children=[];}
  append(...nodes){for(const node of nodes){node.parentNode=this;node.isConnected=this.isConnected;this.children.push(node);}}
  replaceChildren(...nodes){this._text='';this.children=[];this.append(...nodes);}
  setAttribute(key,value){this.attributes[key]=value;}
  querySelector(selector){const name=selector.slice(1),attribute=/^\[data-([a-z-]+)="([^"]+)"\]$/.exec(selector),key=attribute?.[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());for(const child of this.children){if(attribute?child.dataset?.[key]===attribute[2]:child.className?.split(' ').includes(name))return child;const nested=child.querySelector?.(selector);if(nested)return nested;}return null;}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.isConnected=false;}
 }
 const view=new EventTarget();view.closed=false;
 const doc={defaultView:view,createElementNS:(_ns,tag)=>new Node(tag,doc),createTextNode:value=>({textContent:value})};
 doc.head=new Node('head',doc);doc.head.isConnected=true;doc.documentElement=doc.head;doc.querySelector=selector=>doc.head.querySelector(selector);
 const host=new Node('host',doc);host.isConnected=true;return host;
}
const uiZotero={debug(){},HTTP:{request:async(method,url)=>{assert.equal(method,'GET');assert.equal(url,'chrome://zotero/content/research/shared/paper-overview.css');return {responseText:'.paper-overview{font-family:system-ui}'};}}};
test('shared pane styles coalesce local CSS reads and install one style in every live content document',async()=>{
 const a=abstractHost().ownerDocument,b=abstractHost().ownerDocument,url='chrome://zotero/content/research/shared/test-shared-pane.css';let reads=0,finish;
 const Zotero={HTTP:{request:(method,requested)=>{reads++;assert.equal(method,'GET');assert.equal(requested,url);return new Promise(resolve=>{finish=resolve;});}}};
 const options={Zotero,name:'shared-test',url},first=prepareReaderPaneStyles(a,options),repeat=prepareReaderPaneStyles(a,options),other=prepareReaderPaneStyles(b,options);
 assert.strictEqual(repeat,first);assert.equal(reads,1);assert.equal(a.head.children.length,0);finish({responseText:'.shared-test{display:grid}'});
 const [one,two]=await Promise.all([first,other]);assert.notStrictEqual(one,two);assert.equal(one.textContent,'.shared-test{display:grid}');assert.equal(two.textContent,one.textContent);assert.equal(a.head.children.length,1);assert.equal(b.head.children.length,1);
 assert.strictEqual(await prepareReaderPaneStyles(a,options),one);assert.equal(reads,1);
});
test('a failed local style read remains retryable instead of permanently leaving a pane unstyled',async()=>{
 const doc=abstractHost().ownerDocument,url='chrome://zotero/content/research/shared/test-retry-pane.css';let reads=0;
 const Zotero={HTTP:{request:async()=>{reads++;if(reads===1)throw Error('controlled local resource failure');return {responseText:'.retry-pane{display:grid}'};}}},options={Zotero,name:'retry-test',url};
 await assert.rejects(prepareReaderPaneStyles(doc,options),/controlled local resource failure/);assert.equal(doc.head.children.length,0);
 const style=await prepareReaderPaneStyles(doc,options);assert.equal(reads,2);assert.equal(style.textContent,'.retry-pane{display:grid}');assert.equal(doc.head.children.length,1);
});
test('closing a content page during its local style read prevents late DOM writes while a new page reuses the loaded CSS',async()=>{
 const old=abstractHost().ownerDocument,next=abstractHost().ownerDocument,url='chrome://zotero/content/research/shared/test-closed-pane.css';let reads=0,finish;
 const Zotero={HTTP:{request:()=>{reads++;return new Promise(resolve=>{finish=resolve;});}}},options={Zotero,name:'closed-test',url};
 const pending=prepareReaderPaneStyles(old,options);old.defaultView.dispatchEvent(new Event('unload'));finish({responseText:'.closed-pane{display:grid}'});
 await assert.rejects(pending,/来源页面已关闭/);assert.equal(old.head.children.length,0);assert.equal((await prepareReaderPaneStyles(next,options)).textContent,'.closed-pane{display:grid}');assert.equal(reads,1);assert.equal(next.head.children.length,1);
});
test('Chinese brief translations are shared and never generate unsupported summary claims',async()=>{
 const original='Controlled CNN evaluation prevents data leakage.',translated='受控 CNN 评估防止数据泄漏。';let calls=0;
 const E={quickTranslate:async text=>{calls++;assert.equal(text,original);return {text:translated};}};installPaperOverview(E,{Zotero:{},IOUtils:{}});
 const [a,b]=await Promise.all([E.paperAbstractBrief(original),E.paperAbstractBrief(original)]);assert.equal(a.text,translated);assert.equal(a.full,original);assert.deepEqual(a,b);assert.equal(calls,1);
 assert.equal((await E.paperAbstractBrief('独立设备的评估避免训练集与测试集之间的数据泄漏。')).text,'独立设备的评估避免训练集与测试集之间的数据泄漏。');assert.equal(calls,1);
});
test('overview retains title and native metadata before Chinese brief and uses a completed PDF parent',async()=>{
 const parent={id:58,isRegularItem:()=>true,getField:key=>({title:'Real paper title',publicationTitle:'Actual journal',date:'2021',abstractNote:'独立设备的评估避免训练集与测试集之间的数据泄漏。'})[key]||'',getCreators:()=>[{firstName:'Ada',lastName:'Lovelace'}]},item={id:57,isRegularItem:()=>false,getField:key=>key==='title'?'original.pdf':'',getCreators:()=>[]};let metricsParent;
 const E={store:storeFor({}),library:{localPDF:async()=>null,describe:()=>({})},materialSourceInfo:()=>({}),completePaperMetadata:async()=>parent,ensurePaperMetrics:async item=>{metricsParent=item;}};
 installPaperOverview(E,{Zotero:uiZotero,IOUtils:{}});const host=abstractHost();await E.renderPaperOverview(host,item);await new Promise(resolve=>setImmediate(resolve));
 assert.strictEqual(metricsParent,parent);const box=host.querySelector('.paper-overview'),info=host.querySelector('.paper-overview-info'),brief=host.querySelector('.overview-abstract');assert.ok(box.children.indexOf(info)<box.children.indexOf(brief));assert.match(info.textContent,/Real paper title/);assert.match(info.textContent,/Actual journal/);assert.match(info.textContent,/Ada Lovelace/);assert.equal(brief.querySelector('.overview-abstract-content').textContent,parent.getField('abstractNote'));
});
test('a late Chinese brief cannot replace a newly selected paper',async()=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;}),E={store:storeFor({}),library:{localPDF:async()=>null,describe:()=>({})},materialSourceInfo:()=>({}),quickTranslate:async()=>pending};installPaperOverview(E,{Zotero:uiZotero,IOUtils:{}});
 const host=abstractHost(),item=(id,text)=>({id,isRegularItem:()=>true,getField:key=>key==='abstractNote'?text:key==='title'?'Paper '+id:'',getCreators:()=>[]});
 const first=E.renderPaperOverview(host,item(1,'Independent held-out devices validate the method.'));await new Promise(resolve=>setImmediate(resolve));await E.renderPaperOverview(host,item(2,'新论文明确报告独立设备的评估条件和实验限制。'));finish({text:'旧论文译文'});await first;
 assert.equal(host.querySelector('.overview-abstract-content').textContent,'新论文明确报告独立设备的评估条件和实验限制。');
});
test('full abstracts keep original English above Chinese and share one translation across columns and reopening',async()=>{
 const english='Independent CNN validation reports 95.6% accuracy without shared recordings.',chinese='独立 CNN 验证报告 95.6% 准确率，未共享录音。';let calls=0,finish;
 const pending=new Promise(resolve=>{finish=resolve;}),E={library:{localPDF:async()=>null},quickTranslate:async source=>{calls++;assert.equal(source,english);return pending;}};
 installPaperOverview(E,{Zotero:uiZotero,IOUtils:{}});
 const item={id:27,getField:key=>key==='abstractNote'?english:'',getTags:()=>[{tag:'CNN'}]},a=abstractHost(),b=abstractHost();
 const tasks=[E.renderPaperAbstract(a,item),E.renderPaperAbstract(b,item)];await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls,1);assert.equal(a.querySelector('.paper-abstract-original').textContent,'英文原文'+english);
 assert.match(a.querySelector('.paper-abstract-chinese').textContent,/正在翻译/);finish({text:chinese});await Promise.all(tasks);
 for(const host of [a,b]){const sections=host.querySelector('.paper-abstract').children;assert.equal(sections[1].className,'paper-abstract-original');assert.equal(sections[2].className,'paper-abstract-chinese');assert.equal(sections[1].textContent,'英文原文'+english);assert.equal(sections[2].textContent,'中文译文'+chinese);}
 const original=a.querySelector('.paper-abstract-original');await E.renderPaperAbstract(a,item);assert.strictEqual(a.querySelector('.paper-abstract-original'),original);assert.equal(calls,1);
});
test('a failed abstract translation offers an explicit retry and late translations never replace a newer paper',async()=>{
 let calls=0,finish;const pending=new Promise(resolve=>{finish=resolve;}),E={library:{localPDF:async()=>null},quickTranslate:async()=>{calls++;if(calls===1)throw Error('controlled service unavailable');return pending;}};
 installPaperOverview(E,{Zotero:uiZotero,IOUtils:{}});const host=abstractHost(),item=text=>({id:text,getField:key=>key==='abstractNote'?text:''});
 await E.renderPaperAbstract(host,item('Original English abstract.'));assert.match(host.querySelector('.paper-abstract-status').textContent,/暂不可用/);
 const retry=host.querySelector('.paper-abstract-retry');assert.ok(retry);retry.onclick();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);
 const oldTask=host._abstractTask;await E.renderPaperAbstract(host,item('这里保留新论文的真实中文摘要。'));const newest=host.querySelector('.paper-abstract-original');assert.equal(host._abstractTask,null,'新的中文原文不继续等待旧论文译文');await E.renderPaperAbstract(host,item('这里保留新论文的真实中文摘要。'));finish({text:'Older translated abstract'});await oldTask;
 assert.strictEqual(host.querySelector('.paper-abstract-original'),newest);assert.match(newest.textContent,/新论文/);assert.equal(host.querySelector('.paper-abstract-chinese'),null);
});
