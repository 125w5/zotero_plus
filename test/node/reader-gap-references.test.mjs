/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let root=new URL('../../chrome/content/zotero/',import.meta.url);
let shared=async name=>import(new URL('research/shared/'+name,root));
let Matcher=await shared('reference-matcher.mjs'),Metadata=await shared('reference-metadata.mjs'),Arxiv=await shared('arxiv.mjs'),Detail=await shared('reader-reference-detail.mjs'),Geometry=await shared('annotation-geometry.mjs'),ActiveReader=await shared('active-reader.mjs');
let tick=async(n=6)=>{for(let i=0;i<n;i++)await new Promise(resolve=>setImmediate(resolve));};
// The application loads discovery.js before reader-panes.js; the pane words a failed PDF
// check with discovery.js's own discoveryPDFUnavailable, taken here from the real file.
let discoveryWording=(()=>{let E={};vm.runInNewContext(fs.readFileSync(new URL('xpcom/research/discovery.js',root),'utf8'),{Zotero:{Research:E,addShutdownListener(){},getMainWindow:()=>({AbortController})},ChromeUtils:{importESModule:url=>url.includes('reference-matcher')?Matcher:url.includes('workspace-outputs')?{installWorkspaceOutputs(){}}:url.includes('discovery-feed')?{installDiscoveryFeed(){},installJournalSubscriptionTimer(){}}:{}}});return E.discoveryPDFUnavailable;})();

// Just enough DOM for the reference pane: tags, classes, ids, closest and events.
class FakeNode{
 constructor(doc,tag){this.ownerDocument=doc;this.tagName=tag;this.children=[];this.parentNode=null;this.attributes=new Map();this.dataset={};this.listeners=new Map();this.className='';this.hidden=false;this.style={setProperty(){}};this.text='';let node=this;this.classList={add(...names){node.className=[...new Set([...node.className.split(/\s+/).filter(Boolean),...names])].join(' ');},remove(...names){node.className=node.className.split(/\s+/).filter(name=>name&&!names.includes(name)).join(' ');},contains:name=>node.className.split(/\s+/).includes(name),toggle(){}};}
 get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
 set textContent(value){this.children=[];this.text=String(value??'');}
 get id(){return this.attributes.get('id')||'';}set id(value){this.attributes.set('id',value);}
 get isConnected(){let node=this;while(node.parentNode)node=node.parentNode;return node===this.ownerDocument.documentElement;}
 append(...nodes){for(let node of nodes){if(typeof node==='string'){this.text+=node;continue;}node.parentNode?.children.splice(node.parentNode.children.indexOf(node),1);node.parentNode=this;this.children.push(node);}}
 replaceChildren(...nodes){for(let node of this.children)node.parentNode=null;this.children=[];this.text='';this.append(...nodes);}
 remove(){if(this.parentNode){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}}
 setAttribute(name,value){this.attributes.set(name,String(value));}getAttribute(name){return this.attributes.has(name)?this.attributes.get(name):null;}removeAttribute(name){this.attributes.delete(name);}hasAttribute(name){return this.attributes.has(name);}
 addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);}removeEventListener(){}
 async dispatch(type){await Promise.all((this.listeners.get(type)||[]).map(fn=>fn({type,target:this})));}
 matches(selector){return selector.split(',').some(part=>{part=part.trim();if(part.startsWith('.'))return part.slice(1).split('.').every(name=>this.className.split(/\s+/).includes(name));if(part.startsWith('#'))return this.id===part.slice(1);return this.tagName===part;});}
 closest(selector){for(let node=this;node;node=node.parentNode)if(node.matches?.(selector))return node;return null;}
 all(predicate,found=[]){for(let child of this.children){if(predicate(child))found.push(child);child.all(predicate,found);}return found;}
 querySelectorAll(selector){return this.all(node=>node.matches(selector));}querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 focus(){}getBoundingClientRect(){return {left:0,top:0,right:0,bottom:0,width:0,height:0};}openPopupAtScreen(){}
}
function fakeDocument(win){
 let doc={defaultView:win};doc.createElementNS=(_ns,tag)=>new FakeNode(doc,tag);doc.createXULElement=tag=>new FakeNode(doc,tag);doc.createElement=tag=>new FakeNode(doc,tag);
 doc.documentElement=new FakeNode(doc,'html');doc.querySelector=selector=>doc.documentElement.matches(selector)?doc.documentElement:doc.documentElement.querySelector(selector);doc.getElementById=id=>doc.documentElement.querySelector('#'+id);return doc;
}

// One PDF page whose text cites reference [3] in the body.
function fixture({readers:makeReaders,collect}={}){
 let events=[],selected={value:'zotero-pane'};
 let win={closed:false,AbortController,setTimeout,clearTimeout,innerWidth:900,innerHeight:700,getSelection:()=>({toString:()=>''}),Zotero_Tabs:{get selectedID(){return selected.value;},select:id=>{events.push('select:'+id);selected.value=id;}}};
 let doc=fakeDocument(win);win.document=doc;
 let page={getTextContent:async()=>({items:[{str:'as reported in [3] for the controlled baseline',height:10,width:160,transform:[1,0,0,10,72,500]}]})};
 let view={initializedPromise:Promise.resolve(),_iframeWindow:{PDFViewerApplication:{pdfDocument:{numPages:1,getPage:async()=>page}}}};
 let makeReader=(extra={})=>({itemID:7,_window:win,_isTabClosed:false,_isUninitialized:false,_initPromise:Promise.resolve(),_internalReader:{_primaryView:view},navigate:async location=>{events.push('navigate:'+location.position.pageIndex);},...extra});
 let readers=makeReaders?makeReaders({makeReader,win}):[makeReader({tabID:'reader-tab'})];
 let attachment={id:7,parentID:null,libraryID:1,isPDFAttachment:()=>true};
 let E={library:{localPDF:async()=>attachment,describe:item=>({id:item.id,title:'Current paper'})},referencesFromPDF:async()=>({records:[]}),collectReferences:collect||(async()=>({references:[],records:[]})),discoveryPDFUnavailable:discoveryWording};
 let modules={'reference-matcher.mjs':Matcher,'reference-metadata.mjs':Metadata,'arxiv.mjs':Arxiv,'reader-reference-detail.mjs':{...Detail,prepareReferenceDetailStyles:async()=>{}},'paper-overview-data.mjs':{},'annotation-geometry.mjs':Geometry,'active-reader.mjs':ActiveReader,'reader-rapid-reading.mjs':{installRapidReading(){}}};
 let Zotero={Research:E,Reader:{_readers:readers,getByTabID:()=>null,open:async()=>{throw Error('a live reader must be reused');}},Items:{get:id=>id===7?attachment:null,getAsync:async id=>id===7?attachment:null},getMainWindow:()=>win,Promise:{delay:ms=>new Promise(resolve=>setTimeout(resolve,ms))},logError(){},Utilities:{Internal:{copyTextToClipboard(){}}}};
 let context={Zotero,Cu:{cloneInto:value=>value,waiveXrays:value=>value,unwaiveXrays:value=>value},ChromeUtils:{importESModule:url=>{let name=url.split('/').pop();if(!modules[name])throw Error('unexpected module '+url);return modules[name];}}};
 for(let file of ['xpcom/research/reader-tools.js','xpcom/research/reader-panes.js'])vm.runInNewContext(fs.readFileSync(new URL(file,root),'utf8'),context);
 return {E,Zotero,win,doc,events,selected,attachment,readers};
}
async function renderPane(f,refs,records){
 f.E.referencesFromPDF=async()=>({records:refs});f.E.collectReferences=async()=>({references:refs,records});
 let details=new FakeNode(f.doc,'item-details');details.item={id:7};f.doc.documentElement.append(details);let body=new FakeNode(f.doc,'div');details.append(body);
 await f.E.renderReferencePane(body,f.attachment);await tick();return body;
}
let menuCommand=async(f,row,label)=>{row.oncontextmenu({preventDefault(){},screenX:0,screenY:0});let item=f.doc.documentElement.all(node=>node.tagName==='menuitem'&&node.getAttribute('label')===label)[0];assert.ok(item,'menu item '+label);await item.dispatch('command');await tick();};

test('定位本文引用 brings the reader tab that holds this PDF forward before it navigates',async()=>{
 let f=fixture();assert.equal(f.selected.value,'zotero-pane');
 let position=await f.E.locateReference(7,{id:'3',title:'Controlled baseline'});
 assert.equal(position.pageIndex,0);assert.deepEqual(f.events,['select:reader-tab','navigate:0'],'the hidden tab is selected, then moved to the citation');
});

test('a failed locate leaves the user where they clicked, and a separate reader window is focused',async()=>{
 let f=fixture();await assert.rejects(f.E.locateReference(7,{id:'9',title:'Nothing like this in the page'}),/未定位到引用位置/);
 assert.deepEqual(f.events,[],'no tab switch or navigation hides the failure');
 let focused=0,g=fixture({readers:({makeReader})=>[makeReader({_window:{closed:false,focus:()=>{focused++;}}})]});
 await g.E.locateReference(7,{id:'3',title:'Controlled baseline'});assert.equal(focused,1);assert.deepEqual(g.events,['navigate:0']);
});

test('a locate that has to open the PDF reports its failure inside that reader',async()=>{
 let f=fixture({readers:()=>[]}),notices=[],text='unrelated text only';
 let page={getTextContent:async()=>({items:[{str:text,height:10,width:100,transform:[1,0,0,10,72,500]}]})},doc={notice:null,getElementById:id=>id==='easysch-reader-notice'?doc.notice:null};
 f.E.readerNotice=(reader,message,options)=>{let notice={dataset:{},remove(){doc.notice=null;}};notices.push({reader,message,options});doc.notice=notice;return notice;};
 // Native Reader.open selects the tab it creates (ReaderTab: select = !options.background).
 f.Zotero.Reader.open=async id=>{let reader={itemID:id,tabID:'new-reader-tab',_window:f.win,_iframeWindow:{document:doc},_isTabClosed:false,_isUninitialized:false,_initPromise:Promise.resolve(),_internalReader:{_primaryView:{initializedPromise:Promise.resolve(),_iframeWindow:{PDFViewerApplication:{pdfDocument:{numPages:1,getPage:async()=>page}}}}},navigate:async location=>{f.events.push('navigate:'+location.position.pageIndex);}};f.readers.push(reader);f.win.Zotero_Tabs.select(reader.tabID);return reader;};
 await assert.rejects(f.E.locateReference(7,{id:'9',title:'Nothing like this in the page'}),/未定位到引用位置/);
 assert.equal(f.selected.value,'new-reader-tab','the native open has moved the user to the PDF');
 assert.equal(notices.length,1,'the reason is shown where the user now is');assert.equal(notices[0].reader,f.readers[0]);assert.equal(notices[0].options?.error,true);
 assert.equal(notices[0].message,'定位本文引用未完成：未定位到引用位置；可使用阅读器查找原始题录');
 text='as reported in [9] for the controlled baseline';let position=await f.E.locateReference(7,{id:'9',title:'Nothing like this in the page'});
 assert.equal(position.pageIndex,0);assert.equal(doc.notice,null,'a later successful locate clears the earlier locate failure');assert.equal(notices.length,1);
 text='unrelated text only';await assert.rejects(f.E.locateReference(7,{id:'9',title:'Nothing like this in the page'}),/未定位到引用位置/);
 assert.equal(notices.length,1,'with the reader already open the failure stays on the row that asked');
});

test('a locate failure is shown on the row, including rows without a matched record',async()=>{
 let f=fixture(),refs=[{id:'1',doi:'10.1234/matched',title:'Matched reference'},{id:'2',title:'Unmatched reference',quote:'Wang, Unmatched reference, 2023.'}];
 let body=await renderPane(f,refs,[{title:'Matched reference',doi:'10.1234/matched',citationOrigins:[refs[0]]}]);
 let [matched,unmatched]=body.querySelectorAll('.reference-row');assert.ok(unmatched.querySelector('.reference-download').hidden,'an unmatched row has no download control');
 f.E.locateReference=async()=>{throw Error('未定位到引用位置；可使用阅读器查找原始题录');};
 await menuCommand(f,unmatched,'定位本文引用');
 let note=unmatched.querySelector('.reference-row-status');assert.ok(note,'the row has a visible status line');assert.equal(note.textContent,'未定位到引用位置；可使用阅读器查找原始题录');assert.equal(note.getAttribute('role'),'status');
 await menuCommand(f,matched,'定位本文引用');let download=matched.querySelector('.reference-download');
 assert.equal(download.getAttribute('aria-label'),'获取公开全文','the download control keeps its own label');assert.equal(download.title,'获取公开全文');assert.equal(matched.dataset.state,undefined);
 f.E.locateReference=async()=>({pageIndex:0});await menuCommand(f,matched,'定位本文引用');assert.equal(matched.querySelector('.reference-row-status').textContent,'','a later success clears the old reason');
});

test('获取公开全文 without a public PDF adds nothing to the library',async()=>{
 let f=fixture(),refs=[{id:'1',doi:'10.1234/closed',title:'Closed reference'}],obtained=[];
 f.E.obtainPaper=async record=>{obtained.push(record);return {itemID:1,attachmentID:2};};f.E.findAcademicItem=async()=>null;f.E.requestProvider=async url=>{assert.match(url,/api\.openalex\.org\/works\/https:\/\/doi\.org\/10\.1234%2Fclosed/);return JSON.stringify({best_oa_location:null,locations:[{is_oa:false}]});};
 let body=await renderPane(f,refs,[{title:'Closed reference',doi:'10.1234/closed',citationOrigins:[refs[0]]}]);let row=body.querySelector('.reference-row'),download=row.querySelector('.reference-download');
 await download.onclick();await tick();
 assert.equal(obtained.length,0,'no library item is created when no public PDF exists');assert.equal(row.dataset.state,'unavailable');assert.equal(download.title,'暂无公开 PDF');assert.match(download.getAttribute('aria-label'),/重试/);
});

test('获取公开全文 hands a resolved open PDF, an arXiv record or an existing local copy to obtainPaper',async()=>{
 let f=fixture(),obtained=[];f.E.obtainPaper=async record=>{obtained.push(record);return {itemID:1,attachmentID:2};};f.E.findAcademicItem=async()=>null;
 f.E.requestProvider=async()=>JSON.stringify({best_oa_location:{is_oa:true,pdf_url:'https://example.org/open.pdf'}});
 await f.E.obtainReferencePaper({doi:'10.1234/open',title:'Open'},{open:false});assert.equal(obtained.at(-1).pdf,'https://example.org/open.pdf');
 f.E.requestProvider=async()=>{throw Error('arXiv needs no lookup');};await f.E.obtainReferencePaper({id:'2401.12345',title:'Preprint'},{open:false});assert.equal(obtained.at(-1).id,'2401.12345');
 f.E.findAcademicItem=async()=>({id:5});f.E.library.localPDF=async item=>item?.id===5?{id:6}:null;await f.E.obtainReferencePaper({doi:'10.1234/local',title:'Local'},{open:false});assert.equal(obtained.at(-1).doi,'10.1234/local');
 f.E.findAcademicItem=async()=>null;f.E.requestProvider=async()=>JSON.stringify({is_retracted:true});await assert.rejects(f.E.obtainReferencePaper({doi:'10.1234/retracted'},{}),/撤稿/);assert.equal(obtained.length,3);
});

test('a failed abstract read says so in the detail and its retry asks the sources again',async()=>{
 let f=fixture(),refs=[{id:'1',doi:'10.1234/outage',title:'Outage reference'}],fail=true,requests=0;
 f.E.requestProvider=async()=>{requests++;if(fail)throw Error('服务请求超时，请重试');return JSON.stringify({title:'Outage reference',abstract:'Original provider abstract.',externalIds:{DOI:'10.1234/outage'}});};
 let body=await renderPane(f,refs,[{title:'Outage reference',doi:'10.1234/outage',citationOrigins:[refs[0]]}]);
 body.querySelector('.reference-title').onclick();await tick(12);
 let detail=body.querySelector('.reader-reference-detail'),status=detail.querySelector('.reader-reference-detail-status'),retry=detail.querySelector('.reader-reference-retry');
 assert.equal(status.textContent,'摘要读取未完成：服务请求超时，请重试；题录与来源链接仍可用','a failed lookup is not shown as a missing abstract');assert.equal(retry.hidden,false,'the failure offers its retry');
 assert.equal(requests,3);fail=false;retry.onclick();await tick(12);
 assert.equal(requests,4,'the retry bypasses the failure');assert.equal(retry.hidden,true);assert.equal(detail.querySelector('.reader-reference-abstract').textContent,'Original provider abstract.');
});

test('a closed-access pdf_url or a landing page is not taken for a public PDF',async()=>{
 let f=fixture(),obtained=[],lookups=[],probes=[];f.E.obtainPaper=async record=>{obtained.push(record);return {itemID:1,attachmentID:2};};f.E.findAcademicItem=async()=>null;
 // An OpenAlex record cached by an earlier lookup can still carry a closed location's pdf_url.
 let closed={id:'https://openalex.org/W1',source:'OpenAlex',title:'A closed access cited method',pdf:'https://publisher.example/pdfdirect/closed.pdf'};
 f.E.requestProvider=async url=>{lookups.push(url);return JSON.stringify({best_oa_location:null,locations:[{is_oa:false,pdf_url:closed.pdf}]});};
 await assert.rejects(f.E.obtainReferencePaper(closed,{open:false}),/未找到公开 PDF；文库没有变化/);
 assert.deepEqual(lookups,['https://api.openalex.org/works/W1'],'the work is checked for an open-access location');assert.equal(obtained.length,0,'nothing is filed');
 f.E.verifyDiscoveryPDF=async url=>{probes.push(url);return {available:false,error:'来源返回非 PDF 内容，未保存附件'};};
 f.E.requestProvider=async()=>JSON.stringify({best_oa_location:{is_oa:true,pdf_url:'https://repository.example/landing'}});
 // A landing page that returns no PDF does so on every attempt: no retry is offered.
 await assert.rejects(f.E.obtainReferencePaper({doi:'10.1234/landing',title:'Landing'},{open:false}),/^Error: 来源返回非 PDF 内容；文库没有变化$/);
 assert.deepEqual(probes,['https://repository.example/landing']);assert.equal(obtained.length,0,'a URL that does not return a PDF files nothing');
 f.E.verifyDiscoveryPDF=async()=>({available:true});f.E.requestProvider=async()=>{throw Error('an open-access Semantic Scholar PDF needs no lookup');};
 await f.E.obtainReferencePaper({source:'Semantic Scholar',doi:'10.1234/s2',title:'S2',pdf:'https://s2.example/open.pdf'},{open:false});assert.equal(obtained.at(-1).pdf,'https://s2.example/open.pdf');
});

test('获取公开全文 failures say what happened to the library',async()=>{
 let f=fixture(),library=[];f.E.findAcademicItem=async()=>library[0]||null;f.E.library.localPDF=async()=>null;f.E.obtainPaper=async()=>{throw Error('obtainPaper is not reached without a PDF');};
 f.E.requestProvider=async()=>JSON.stringify({best_oa_location:null,locations:[]});
 library.push({id:5});await assert.rejects(f.E.obtainReferencePaper({doi:'10.1234/kept',title:'Kept'},{open:false}),/^Error: 未找到公开 PDF；文库中的这条题录没有改动，可稍后重试$/);
 library=[];await assert.rejects(f.E.obtainReferencePaper({doi:'10.1234/new',title:'New'},{open:false}),/^Error: 未找到公开 PDF；文库没有变化，可稍后重试$/);
 f.E.requestProvider=async()=>{throw Object.assign(Error('无法连接服务，请检查网络或代理'),{name:'ProviderTransportError'});};
 await assert.rejects(f.E.obtainReferencePaper({doi:'10.1234/offline',title:'Offline'},{open:false}),/^Error: 公开全文查询未完成：无法连接服务，请检查网络或代理；文库没有变化，可稍后重试$/,'a failed lookup is not reported as a missing PDF');
 f.E.requestProvider=async()=>{throw Object.assign(Error('服务返回 HTTP 404'),{providerStatus:404});};
 await assert.rejects(f.E.obtainReferencePaper({doi:'10.1234/unindexed',title:'Unindexed'},{open:false}),/^Error: 未找到公开 PDF；/,'an unindexed DOI has no public PDF');
 f.E.requestProvider=async()=>JSON.stringify({best_oa_location:{is_oa:true,pdf_url:'https://repository.example/broken.pdf'}});f.E.verifyDiscoveryPDF=async()=>({available:true});
 f.E.obtainPaper=async()=>{library.push({id:9});throw Error('来源返回非 PDF 或空文件，未保存附件');};
 await assert.rejects(f.E.obtainReferencePaper({doi:'10.1234/broken',title:'Broken'},{open:false}),/^Error: 来源返回非 PDF 或空文件；题录已加入文库，尚无 PDF 附件$/,'a download that fails after filing says the record was added');
});
