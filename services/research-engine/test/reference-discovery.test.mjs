import * as WorkspaceOutputs from '../../../chrome/content/zotero/research/shared/workspace-outputs.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Ref from '../../../chrome/content/zotero/research/shared/reference-matcher.mjs';
import * as ReferenceMetadata from '../../../chrome/content/zotero/research/shared/reference-metadata.mjs';
import * as Feed from '../../../chrome/content/zotero/research/shared/discovery-feed.mjs';

const source=await readFile(new URL('../../../chrome/content/zotero/xpcom/research/discovery.js',import.meta.url),'utf8');
function setup({fail=false,noBibliography=false,holdNetwork=false,pdfText}={}){
 const state={},requests=[],pdfReads=[],shutdownListeners=[],writes=[];
 const attachment={id:2,isPDFAttachment:()=>true,getFilePathAsync:async()=>'/controlled/reference.pdf'};
 const item={id:1,isPDFAttachment:()=>false,getBestAttachment:async()=>attachment};
 const E={library:{uri:()=> 'zotero://open-pdf/library/items/CONTROLLED'},assets:{key:value=>JSON.stringify(value)},store:{get:(...path)=>path.reduce((value,key)=>value?.[key],state),update:async fn=>{writes.push(true);fn(state);},flush:async()=>{}},requestProvider:async(url,options)=>{requests.push(url);if(holdNetwork)await new Promise((_,reject)=>{const abort=()=>reject(Error('受控网络已中止'));options.signal.addEventListener('abort',abort,{once:true});if(options.signal.aborted)abort();});await Promise.resolve();if(fail)throw Error('受控网络中断');const doi=decodeURIComponent(url.split('/works/')[1]);return JSON.stringify({message:{DOI:doi,title:['Real controlled metadata'],abstract:'<p>Actual abstract.</p>',subject:['Signal Processing']}});}};
 const Zotero={Research:E,Items:{getAsync:async()=>item},PDFWorker:{getFullText:async()=>{pdfReads.push(2);return {text:pdfText??(noBibliography?'Introduction without any reference section.':'REFERENCES\n[1] Smith, "First source with real title", 2018. DOI:10.1234/one\n[2] Lee, "Second source with real title", 2019. DOI:10.1234/two')};}},Promise:{delay:async()=>{}},getMainWindow:()=>({AbortController,DOMParser:class{parseFromString(text){return {body:{textContent:text.replace(/<[^>]+>/g,'')}};}}}),addShutdownListener:listener=>shutdownListeners.push(listener),logError:()=>{}};
 vm.runInNewContext(source,{Zotero,ChromeUtils:{importESModule:url=>{if(url.endsWith('/workspace-outputs.mjs'))return WorkspaceOutputs;if(url.endsWith('/reference-matcher.mjs'))return Ref;if(url.endsWith('/reference-metadata.mjs'))return ReferenceMetadata;if(url.endsWith('/discovery-feed.mjs'))return Feed;throw Error('Unexpected fixture module: '+url);}},IOUtils:{stat:async()=>({size:123,lastModified:1})},AbortController,Promise,Date,Map,Set});
 return {E,state,requests,pdfReads,writes,shutdown:async()=>{for(const fn of shutdownListeners)await fn();},setFailure:value=>{fail=value;},setNoBibliography:value=>{noBibliography=value;}};
}
test('reference panes share automatic metadata requests and read local bibliography first',async()=>{
 const {E,requests,pdfReads}=setup(),a=[],b=[];
 const [first,second]=await Promise.all([E.collectReferences({id:1},{onProgress:s=>a.push(s)}),E.collectReferences({id:1},{onProgress:s=>b.push(s)})]);
 assert.equal(requests.length,2);assert.equal(pdfReads.length,1);assert.equal(first,second);
 assert.equal(a[0].references.length,2);assert.equal(a[0].done,0);assert.equal(a[0].records.length,0);assert.equal(b[0].references.length,2);
 assert.equal(first.records.length,2);assert.deepEqual([...first.records[0].tags],['Signal Processing']);assert.equal(first.records[0].abstract,'Actual abstract.');
 const cached=await E.collectReferences({id:1});assert.equal(cached.cacheHit,true);assert.equal(requests.length,2);
});
test('one detached pane cannot cancel another pane sharing the background collection',async()=>{
 const {E,requests}=setup(),controller=new AbortController();
 const detached=E.collectReferences({id:1},{signal:controller.signal,onProgress:s=>{if(s.references)controller.abort();}});
 const live=E.collectReferences({id:1});await assert.rejects(detached,/已取消/);const result=await live;
 assert.equal(result.records.length,2);assert.equal(requests.length,2);
});
test('failed lookups retain all original references and only an explicit retry bypasses negative cache',async()=>{
 const {E,requests,setFailure}=setup({fail:true});const first=await E.collectReferences({id:1});
 assert.equal(first.references.length,2);assert.equal(first.records.length,0);assert.equal(first.skipped.length,2);
 assert.equal(requests.length,6,'每条引用在首选来源失败后尝试两个独立备用来源');await E.collectReferences({id:1});assert.equal(requests.length,6);
 setFailure(false);const retry=await E.collectReferences({id:1},{refresh:true});assert.equal(requests.length,8);assert.equal(retry.records.length,2);
});
test('merged references from an older parser cache cannot bypass the new local bibliography',async()=>{
 const {E,state,pdfReads}=setup();state.discovery={'resolved-refs-v4:1:':{sourceVersion:'2:123:1',at:new Date().toISOString(),total:1,records:[],references:[{id:'1',quote:'An older merged bibliography'}]}};
 const result=await E.collectReferences({id:1});assert.equal(result.references.length,2);assert.equal(result.referenceParseVersion,Ref.REFERENCE_PARSE_VERSION);assert.equal(pdfReads.length,1);assert.equal(result.cacheHit,false);
 assert.equal((await E.collectReferences({id:1})).cacheHit,true);assert.equal(pdfReads.length,1);
});
test('the actual fourteen PDF labels are shown before metadata lookup and remain visible when every lookup fails',async()=>{
 const pdfText=await readFile(new URL('./fixtures/world-model-pdfworker-bibliography.txt',import.meta.url),'utf8'),{E}=setup({pdfText,fail:true}),progress=[];
 const result=await E.collectReferences({id:1},{onProgress:value=>progress.push(value)});
 assert.equal(progress[0].references.length,14);assert.equal(progress[0].done,0);assert.equal(result.references.length,14);assert.equal(result.records.length,0);assert.equal(result.skipped.length,14);
});
test('failed bibliography tasks are removed so a later retry can genuinely recover',async()=>{
 const {E,pdfReads,setNoBibliography}=setup({noBibliography:true});await assert.rejects(E.collectReferences({id:1}),/暂未读取到参考文献/);
 setNoBibliography(false);const result=await E.collectReferences({id:1},{refresh:true});assert.equal(result.references.length,2);assert.equal(result.records.length,2);assert.equal(pdfReads.length,2);
});
test('application shutdown aborts shared network jobs without writing failures or starting more requests',async()=>{
 const {E,requests,writes,shutdown}=setup({holdNetwork:true});
 const first=E.collectReferences({id:1}),second=E.collectReferences({id:1});const outcomes=Promise.allSettled([first,second]);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(requests.length,2);await shutdown();const result=await outcomes;
 assert.equal(result[0].status,'rejected');assert.equal(result[1].status,'rejected');assert.match(result[0].reason.message,/已取消/);assert.equal(writes.length,0);
 await assert.rejects(E.collectReferences({id:1}),/已取消/);assert.equal(requests.length,2,'已退出后不继续建立网络请求');
});

test('leaving the final reference pane stops active metadata lookups and does not cache a cancelled failure',async()=>{
 const {E,requests,writes,shutdown}=setup({holdNetwork:true}),controller=new AbortController(),task=E.collectReferences({id:1},{signal:controller.signal}),outcome=assert.rejects(task,/已取消/);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(requests.length,2);controller.abort();await outcome;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests.length,2,'离开后不继续建立两个备用来源请求');assert.equal(writes.length,0);await shutdown();
});
test('arXiv reference metadata propagates cancellation to its actual XHR without retrying',async()=>{
 const arxivSource=await readFile(new URL('../../../chrome/content/zotero/xpcom/research/arxiv.js',import.meta.url),'utf8');
 const E={},controller=new AbortController();let requests=0,aborts=0;
 const Zotero={Research:E,Promise:{delay:async()=>{}},HTTP:{request:async(method,url,options)=>{requests++;return await new Promise((_,reject)=>{options.requestObserver({abort:()=>{aborts++;reject(Error('XHR aborted'));}});});}},logError:()=>{},getMainWindow:()=>({})};
 vm.runInNewContext(arxivSource,{Zotero,ChromeUtils:{importESModule:()=>({arxivID:value=>value})}});
 const task=E.arxivMetadata('2401.12345v2',{signal:controller.signal});await new Promise(resolve=>setImmediate(resolve));assert.equal(requests,1);
 controller.abort();await assert.rejects(task,/已取消/);assert.equal(aborts,1);assert.equal(requests,1);
});
