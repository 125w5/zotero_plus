import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {material} from '../../../chrome/content/zotero/research/shared/manuscript-model.mjs';

const source=await readFile(new URL('../../../chrome/content/zotero/xpcom/research/assets.js',import.meta.url),'utf8');
const pipeline=await readFile(new URL('../../../chrome/content/zotero/xpcom/research/manuscript-index.js',import.meta.url),'utf8');
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
function setup(count=2){
 const state={researchMaterials:{}},cache=new Map(),calls=[],shutdown=[],timers=[];
 let queue=Promise.resolve(),notify,fileStamp=1,indexCalls=0;
 const E={settings:()=>({endpoint:'https://api.example.org',model:'vision-test'}),resolveModel:async c=>c,previewImage:async p=>'data:image/png;base64,'+p,
  store:{get:(...keys)=>clone(keys.reduce((v,k)=>v?.[k],state)),update:fn=>queue=queue.then(()=>fn(state))},
  manuscripts:{model:{material},assetLibrary:()=>clone(state.researchMaterials),notifyAssetsChanged(){}},
  studio:{request:async(_system,input,_status,_signal,options)=>{calls.push({input,options});return {value:{summary:'该图比较不同方法的性能，具体结论须结合实验条件核验。',sections:[{heading:'阅读要点',body:'先确认坐标、图例与实验设置。'}]},model:'vision-test',at:'now'};}},
  library:{uri:(_item,page)=>'zotero://open-pdf/test?page='+(page+1)},setTimeout:fn=>timers.push(fn),clearTimeout(){},
  runArtifactEngine:async r=>{
   if(r.operation==='assets-cache-get')return clone(cache.get(r.key)||{miss:true});
   if(r.operation==='assets-cache-put'){cache.set(r.key,clone(r.value));return {};}
   if(r.operation==='assets-index'){indexCalls++;return {pdfHash:'same-file',version:'parse-v6',assets:Array.from({length:count},(_,i)=>({id:'fig-'+i,kind:'figure',label:'Fig '+(i+1),pageIndex:i,page:i+1,pageHeight:800,bbox:[20,30,150,200],pdfHash:'same-file',caption:'A comparison of methods.',references:['The model was evaluated.'],assetHash:'hash-'+i,path:'figure'+i+'.png',extractorVersion:'parse-v6'}))};}
   throw Error(r.operation);
  }};
 const items=new Map([1,2,3].map(id=>[id,{id,parentItem:{id:id+10,getField:()=> 'Paper '+id},isPDFAttachment:()=>true,getFilePathAsync:async()=>'/test.pdf'}]));
 const Zotero={Research:E,Items:{getAsync:async id=>items.get(id),get:id=>items.get(id)},getMainWindow:()=>({AbortController,TextEncoder}),addShutdownListener:fn=>shutdown.push(fn),Notifier:{registerObserver:o=>{notify=o.notify;return 'test';},unregisterObserver(){}},logError(){}};
 const ctx=vm.createContext({Zotero,IOUtils:{stat:async()=>({size:100,lastModified:fileStamp})},ChromeUtils:{importESModule:()=>({})}});vm.runInContext(source,ctx);
 E.assets.key=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
 return {E,state,calls,cache,ctx,shutdown,timers,get indexCalls(){return indexCalls;},changeFile:()=>fileStamp++,notify:(...args)=>notify(...args)};
}
test('historical IDs for one PDF region collapse, but a distinct crop remains',async()=>{
 const f=setup(1),original=f.E.runArtifactEngine;
 f.E.runArtifactEngine=async request=>{
  const result=await original(request);if(request.operation!=='assets-index')return result;
  const raw=result.assets[0];return {...result,assets:[raw,{...raw,id:'manual-fig',userModified:true,path:'manual.png'},
   {...raw,bbox:[30,300,180,450],path:'second-crop.png',assetHash:'other-crop'}]};
 };
 const indexed=await f.E.assets.index(1);assert.equal(indexed.assets.length,2);assert.equal(indexed.assets[0].id,'manual-fig');
 assert.deepEqual(clone(indexed.assets[1].bbox),[30,300,180,450]);
 const state=await f.E.assets.queueImages(1);assert.equal(state.total,2);assert.equal(new Set(state.assetIDs).size,2);
 assert.equal(Object.keys(f.state.researchMaterials).length,2);assert.equal(f.calls.length,2);
});
test('a later manual rendering of the same region retains the corrected explanation',async()=>{
 const f=setup(1);await f.E.assets.queueImages(1);
 const existing=Object.values(f.state.researchMaterials)[0];existing.userEdited=true;existing.summary='用户确认的图像说明';existing.revision++;
 const original=f.E.runArtifactEngine;
 f.E.runArtifactEngine=async request=>{
  const result=await original(request);if(request.operation!=='assets-index')return result;
  return {...result,assets:result.assets.map(a=>({...a,id:'manual-'+a.id,path:'manual-region.png',thumbnail:'manual-thumb.png',userModified:true}))};
 };
 f.changeFile();await f.E.assets.queueImages(1,()=>{},{changed:true});
 const material=Object.values(f.state.researchMaterials)[0];
 assert.equal(material.imagePath,'manual-region.png');assert.equal(material.thumbnail,'manual-thumb.png');
 assert.equal(material.summary,'用户确认的图像说明');assert.equal(material.userEdited,true);
 assert.equal(f.calls.length,1);assert.equal(Object.keys(f.state.researchMaterials).length,1);
});
test('unchanged PDF metadata notifications reuse image work; a changed file rechecks source',async()=>{
 const f=setup(1);await f.E.assets.queueImages(1);assert.equal(f.indexCalls,1);
 const second=await f.E.assets.queueImages(1,()=>{},{changed:true});assert.equal(second.status,'complete');assert.equal(f.indexCalls,1);assert.equal(f.calls.length,1);
 f.changeFile();await f.E.assets.queueImages(1,()=>{},{changed:true});assert.equal(f.indexCalls,2);assert.equal(f.calls.length,1);
});
test('import notifier automatically starts images, without opening readers or requiring text AI success',async()=>{
 const f=setup(1);vm.runInContext(pipeline,f.ctx);f.E.manuscripts.indexArticle=async()=>{throw Error('text offline');};
 f.E.manuscripts.startArticleIndex();f.notify('add','item',[1]);for(const timer of f.timers.splice(0))timer();
 await f.E.assets.queueImages(1);assert.equal(f.E.assets.imageState(1).status,'complete');assert.equal(Object.keys(f.state.researchMaterials).length,1);assert.equal(f.calls.length,1);
});
test('all images survive a partial analysis failure; retry only unfinished captions',async()=>{
 const f=setup(),request=f.E.studio.request;let failed=true;
 f.E.studio.request=async(...args)=>{if(args[1].label==='Fig 2'&&failed){failed=false;throw Error('service unavailable');}return request(...args);};
 const first=await f.E.assets.queueImages(1);assert.equal(first.status,'partial');assert.equal(Object.keys(f.state.researchMaterials).length,2);assert.equal(first.completed,1);
 const second=await f.E.assets.queueImages(1);assert.equal(second.status,'complete');assert.equal(second.reused,1);assert.equal(f.calls.length,2);assert.equal(f.state.assetTray,undefined);
});
test('concurrent imports share a job; identical PDFs share stable cards and preserve both source anchors',async()=>{
 const f=setup();const a=f.E.assets.queueImages(1),b=f.E.assets.queueImages(1);assert.strictEqual(a,b);await a;await f.E.assets.queueImages(2);
 assert.equal(f.calls.length,2);assert.equal(Object.keys(f.state.researchMaterials).length,2);
 const m=Object.values(f.state.researchMaterials)[0];assert.deepEqual(clone(m.sourceAnchors.map(a=>a.attachmentID)),[1,2]);assert.deepEqual(clone(m.anchor.position.rects),[[20,600,150,770]]);assert.equal(m.coverage,'依据原图、图注与附近正文 · AI 解读，待核验');
 assert.equal(f.calls[0].options.images[0],'data:image/png;base64,figure0.png');
});
test('editing a material while AI is pending wins; retries do not overwrite confirmed research assets',async()=>{
 const f=setup(1),request=f.E.studio.request;
 f.E.studio.request=async(...args)=>{await f.E.store.update(s=>{const m=Object.values(s.researchMaterials)[0];m.userEdited=true;m.summary='用户校正的中文说明';m.revision++;});return request(...args);};
 await f.E.assets.queueImages(1);await f.E.assets.queueImages(1);
 assert.equal(Object.values(f.state.researchMaterials)[0].summary,'用户校正的中文说明');assert.equal(f.calls.length,1);
});
test('unsupported vision falls back explicitly once per provider and retains caption-only provenance',async()=>{
 const f=setup(),request=f.E.studio.request;let attempts=0;
 f.E.studio.request=async(...args)=>{if(args[4].images){attempts++;throw Object.assign(Error('not supported'),{imageUnsupported:true});}return request(...args);};
 await f.E.assets.queueImages(1);assert.equal(attempts,1);assert.equal(f.calls.length,2);
 for(const m of Object.values(f.state.researchMaterials)){assert.equal(m.imageExplanation.readMode,'caption');assert.match(m.coverage,/未读取图片像素/);}
});
test('authentication errors do not silently downgrade to caption mode',async()=>{
 const f=setup(1);f.E.studio.request=async()=>{throw Object.assign(Error('HTTP 401'),{status:401});};
 await f.E.assets.queueImages(1);assert.equal(f.E.assets.imageState(1).status,'partial');assert.equal(Object.values(f.state.researchMaterials)[0].generationStatus,'failed');assert.equal(f.state.imageCapabilities,undefined);
});
test('application shutdown aborts AI and leaves work resumable',async()=>{
 const f=setup(1);f.E.assets.startImageIndex();let entered;
 const ready=new Promise(r=>entered=r);f.E.studio.request=async(_s,_i,_u,signal)=>{entered();return new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled'))));};
 const job=f.E.assets.queueImages(1);await ready;for(const stop of f.shutdown)stop();await job;
 assert.equal(f.E.assets.imageState(1).status,'queued');assert.equal(Object.values(f.state.researchMaterials)[0].generationStatus,'pending');
});
