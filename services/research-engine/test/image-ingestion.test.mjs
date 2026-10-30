import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {material} from '../../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import * as Reading from '../../../chrome/content/zotero/research/shared/evidence-reading-context.mjs';
import * as Formula from '../../../chrome/content/zotero/research/shared/formula-research.mjs';
import * as Sections from '../../../chrome/content/zotero/research/shared/article-section-materials.mjs';
import * as Language from '../../../chrome/content/zotero/research/shared/material-language.mjs';

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
 const items=new Map();for(const id of [1,2,3]){
  const paper={id:id+10,loadDataType:async type=>assert.equal(type,'itemData'),getField:()=> 'Paper '+id};
  items.set(paper.id,paper);items.set(id,{id,parentItemID:paper.id,parentItem:paper,loadDataType:async type=>assert.equal(type,'itemData'),isPDFAttachment:()=>true,getFilePathAsync:async()=>'/test.pdf'});
 }
 const Zotero={Research:E,Items:{getAsync:async id=>items.get(id),get:id=>items.get(id)},getMainWindow:()=>({AbortController,TextEncoder}),addShutdownListener:fn=>shutdown.push(fn),Notifier:{registerObserver:o=>{notify=o.notify;return 'test';},unregisterObserver(){}},logError(){}};
 const modules={'evidence-reading-context.mjs':Reading,'formula-research.mjs':Formula,'article-section-materials.mjs':Sections,'material-language.mjs':Language};
 const ctx=vm.createContext({Zotero,IOUtils:{stat:async()=>({size:100,lastModified:fileStamp})},ChromeUtils:{importESModule:path=>{const imported=modules[path.split('/').at(-1)];assert.ok(imported,'Provide the actual imported module: '+path);return imported;}}});vm.runInContext(source,ctx);
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

test('evidence material lookup indexes one branch snapshot and returns isolated records',async()=>{
 const f=setup(1);await f.E.assets.queueImages(1);const asset=f.E.assets.active.get(1).assets[0],original=Object.values(f.state.researchMaterials)[0],library=f.E.manuscripts.assetLibrary;let branch=1,reads=0;
 f.E.store.branchRevision=name=>{assert.equal(name,'researchMaterials');return branch;};f.E.store.revision=20;
 f.E.manuscripts.assetLibrary=()=>{reads++;return library();};
 const first=f.E.assets.materialFor(asset);first.summary='外部修改不得污染缓存';first.imageExplanation.result.sections[0].body='外部嵌套修改';
 for(let i=0;i<30;i++)assert.equal(f.E.assets.materialFor(asset).summary,original.summary);
 assert.equal(reads,1,'multiple visible cards reuse the material branch snapshot');
 assert.notEqual(f.E.assets.materialFor(asset).imageExplanation.result.sections[0].body,'外部嵌套修改');
 f.E.store.revision++;f.E.assets.materialFor(asset);assert.equal(reads,1,'unrelated store changes do not rebuild this branch');
 original.summary='新的人工说明';original.revision++;branch++;assert.equal(f.E.assets.materialFor(asset).summary,'新的人工说明');assert.equal(reads,2);
 delete f.state.researchMaterials[original.id];branch++;assert.equal(f.E.assets.materialFor(asset),undefined);assert.equal(reads,3);
});

test('material lookup without store revisions continues reading fresh snapshots',async()=>{
 const f=setup(1);await f.E.assets.queueImages(1);const asset=f.E.assets.active.get(1).assets[0],material=Object.values(f.state.researchMaterials)[0];
 assert.equal(f.E.assets.materialFor(asset).summary,material.summary);material.summary='未提供版本的运行环境仍返回最新说明';assert.equal(f.E.assets.materialFor(asset).summary,material.summary);
});

test('concurrent paper consumers share PDF indexing and one cancellation leaves the other live',async()=>{
 const f=setup(1),engine=f.E.runArtifactEngine,a=new AbortController(),b=new AbortController();let enter,release,engineSignal,requests=0;
 const entered=new Promise(resolve=>{enter=resolve;});f.E.runArtifactEngine=(request,status,signal)=>{if(request.operation!=='assets-index')return engine(request,status,signal);requests++;engineSignal=signal;enter();return new Promise(resolve=>{release=()=>resolve(engine(request,status,signal));});};
 const first=f.E.assets.index(1,()=>{},a.signal),second=f.E.assets.index(1,()=>{},b.signal);await entered;await new Promise(resolve=>setTimeout(resolve,0));a.abort();await assert.rejects(first,{name:'AbortError'});assert.equal(engineSignal.aborted,false);release();const result=await second;assert.equal(requests,1);assert.equal(result.assets.length,1);assert.equal(f.E.assets.active.get(1).assets[0].attachmentID,1);
});

test('shared image preparation reports to each consumer and cancels only when all release',async()=>{
 const f=setup(1),request=f.E.studio.request,a=new AbortController(),b=new AbortController(),messages=[];let ready,release,modelSignal;
 const started=new Promise(resolve=>{ready=resolve;});f.E.studio.request=(...args)=>{modelSignal=args[3];args[2]('已读取中文说明依据');ready();return new Promise(resolve=>{release=()=>resolve(request(...args));});};
 const first=f.E.assets.queueImages(1,()=>{},{signal:a.signal}),second=f.E.assets.queueImages(1,text=>messages.push(text),{signal:b.signal,changed:true});await started;a.abort();await assert.rejects(first,{name:'AbortError'});assert.equal(modelSignal.aborted,false);assert.ok(messages.includes('已读取中文说明依据'));release();assert.equal((await second).status,'complete');assert.equal(f.calls.length,1);assert.equal(f.indexCalls,1);
});

test('closing the last image preparation consumer aborts its model work and keeps partial state',async()=>{
 const f=setup(1),abort=new AbortController();let ready,modelSignal;const started=new Promise(resolve=>{ready=resolve;});
 f.E.studio.request=(_system,_input,_status,signal)=>{modelSignal=signal;ready();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));};
 const work=f.E.assets.queueImages(1,()=>{},{signal:abort.signal});await started;abort.abort();await assert.rejects(work,{name:'AbortError'});assert.equal(modelSignal.aborted,true);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(f.E.assets.imageState(1).status,'partial');assert.equal(Object.keys(f.state.researchMaterials).length,1,'the complete original image material survives cancellation');
});

test('reopening an unchanged PDF preserves finished images across extractor, prompt and model upgrades',async()=>{
 const f=setup(1);await f.E.assets.queueImages(1);f.state.imageIngestion[1].parseVersion='mupdf-assets-16';f.E.assets.active.delete(1);const engine=f.E.runArtifactEngine;
 f.E.runArtifactEngine=async request=>{const value=await engine(request);return request.operation==='assets-index'?{...value,version:f.E.assets.extractorVersion}:value;};
 f.E.settings=()=>({endpoint:'https://new-model.example',model:'new-model'});f.state.imageIngestion[1].analysisVersion='old-prompt';Object.values(f.state.researchMaterials)[0].analysisVersion='old-prompt';
 await f.E.assets.queueImages(1,()=>{},{changed:true});assert.equal(f.indexCalls,1);assert.equal(f.calls.length,1);assert.equal(f.E.assets.imageState(1).parseVersion,'mupdf-assets-16');
 const asset={...Object.values(f.state.researchMaterials)[0],pdfHash:'same-file',pageIndex:0,bbox:[20,30,150,200]};await f.E.assets.saveMaterial(asset);assert.equal(f.calls.length,1,'completed descriptions do not depend on the selected model');
 await f.E.assets.queueImages(1,()=>{},{force:true});assert.equal(f.indexCalls,2,'explicit crop refresh can still reindex');assert.equal(f.calls.length,1,'reindex keeps completed source explanations');
});
test('background asset indexing loads paper metadata before reading its title and DOI',async()=>{
 const f=setup(1);let paperLoaded=false,attachmentLoaded=false;
 const paper={id:11,loadDataType:async type=>{assert.equal(type,'itemData');paperLoaded=true;},getField:field=>{assert.equal(paperLoaded,true);return {title:'Loaded source paper',DOI:'10.fixture/source',firstCreator:'Actual author'}[field]||'';}};
 const attachment={id:1,parentItemID:11,parentItem:paper,getFilePathAsync:async()=>'/test.pdf',loadDataType:async type=>{assert.equal(type,'itemData');attachmentLoaded=true;}};
 f.ctx.Zotero.Items.getAsync=async id=>id===11?paper:attachment;
 const result=await f.E.assets.index(1);assert.equal(attachmentLoaded,true);assert.equal(result.assets[0].paperTitle,'Loaded source paper');assert.equal(result.assets[0].doi,'10.fixture/source');assert.equal(result.assets[0].authors,'Actual author');
 f.ctx.Zotero.Items.getAsync=async()=>false;await assert.rejects(f.E.assets.index(999),/附件不存在/);
});

test('automatic image evidence skips author portraits and unknown uncaptioned regions before requesting AI',async()=>{
 const f=setup(1),original=f.E.runArtifactEngine;
 f.E.runArtifactEngine=async request=>{
  const result=await original(request);if(request.operation!=='assets-index')return result;
  const raw=result.assets[0];return {...result,assets:[raw,
   {...raw,id:'portrait',kind:'image',bbox:[250,400,310,480],caption:'',references:[],evidenceEligible:false,researchRole:'author-portrait'},
   {...raw,id:'unknown',kind:'image',bbox:[300,500,430,700],caption:'',references:[]} ]};
 };
 const indexed=await f.E.assets.index(1);assert.equal(indexed.assets.length,2);assert.equal(indexed.excludedAssets[0].id,'portrait');
 const state=await f.E.assets.queueImages(1);assert.equal(state.total,1);assert.equal(state.excluded,1);assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].input.label,'Fig 1');assert.equal(Object.keys(f.state.researchMaterials).length,1,'irrelevant images never become automatic material cards');
 await f.E.assets.queueImages(1);assert.equal(f.calls.length,1,'finished selection is reused without model requests');
 assert.equal(f.E.assets.isEvidenceAsset({...indexed.excludedAssets[0],userModified:true}),true,'a deliberate user crop remains accessible');
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

test('a newer crop index refreshes completed ingestion without replacing a confirmed old crop',async()=>{
 const f=setup(1);await f.E.assets.queueImages(1);const old=Object.values(f.state.researchMaterials)[0];old.userEdited=true;old.summary='用户保存的原裁切说明';const original=f.E.runArtifactEngine;
 f.E.runArtifactEngine=async request=>{const result=await original(request);return request.operation==='assets-index'?{...result,version:'parse-v7',assets:result.assets.map(a=>({...a,bbox:[20,10,150,300],path:'full-figure.png',assetHash:'corrected-image-hash',extractorVersion:'parse-v7'}))}:result;};
 await f.E.assets.index(1);const refreshed=await f.E.assets.queueImages(1,()=>{},{force:true});
 assert.equal(refreshed.parseVersion,'parse-v7');assert.equal(Object.keys(f.state.researchMaterials).length,2);assert.equal(old.summary,'用户保存的原裁切说明');assert.equal(old.imagePath,'figure0.png');assert.ok(Object.values(f.state.researchMaterials).some(m=>m.imagePath==='full-figure.png'));assert.equal(f.calls.length,2);
});

test('a selection algorithm update does not rewrite completed evidence when the PDF is unchanged',async()=>{
 const f=setup(1);await f.E.assets.queueImages(1);const old=Object.values(f.state.researchMaterials)[0];old.userEdited=true;old.summary='人工校对的说明';f.state.imageIngestion[1].selectionVersion='research-visuals-3';
 await f.E.assets.queueImages(1);assert.equal(f.indexCalls,1);assert.equal(f.calls.length,1);assert.equal(old.summary,'人工校对的说明');assert.equal(f.state.imageIngestion[1].selectionVersion,'research-visuals-3');await f.E.assets.queueImages(1);assert.equal(f.indexCalls,1);
});
test('import notifier automatically starts images, without opening readers or requiring text AI success',async()=>{
 const f=setup(1);vm.runInContext(pipeline,f.ctx);f.E.manuscripts.indexArticle=async()=>{throw Error('text offline');};
 f.E.manuscripts.startArticleIndex();f.notify('add','item',[1]);for(const timer of f.timers.splice(0))timer();
 await f.E.assets.queueImages(1);assert.equal(f.E.assets.imageState(1).status,'complete');assert.equal(Object.keys(f.state.researchMaterials).length,1);assert.equal(f.calls.length,1);
});
test('first semantic import starts from an empty index and safely ignores deleted attachments',async()=>{
 const f=setup(1);vm.runInContext(pipeline,f.ctx);const requests=[];
 f.ctx.Zotero.Prefs={get:()=>''};f.E.manuscripts.queueTranslation=async()=>null;
 f.E.runArtifactEngine=async request=>{requests.push(request);assert.equal(request.operation,'manuscript-index');return {pdfHash:'first-document',paragraphs:[{pageIndex:0,sourceText:'The detector uses complementary scores.'}]};};
 f.E.studio.request=async()=>({value:{summary:'检测器使用互补分数进行检测。',explicitTags:[],inferredTags:[]},model:'vision-test'});
 assert.equal(await f.E.manuscripts.indexArticle(999),undefined,'deleted attachment has no PDF methods');
 const result=await f.E.manuscripts.indexArticle(1);
 assert.equal(result.status,'complete');assert.equal(requests.length,1);assert.equal(requests[0].pdfHash,null,'cold import does not assume an existing fingerprint');
 assert.equal(f.state.manuscriptIndex[1].pdfHash,'first-document');assert.equal(f.state.manuscriptIndex[1].status,'complete');
 assert.equal(result.count,1);assert.equal(Object.values(f.state.researchMaterials)[0].sourceText,'The detector uses complementary scores.');
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
test('application shutdown aborts AI and leaves work resumable',{timeout:2000},async()=>{
 const f=setup(1);f.E.assets.startImageIndex();let entered;
 const ready=new Promise(r=>entered=r);f.E.studio.request=async(_s,_i,_u,signal)=>{entered();return new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled'))));};
 const job=f.E.assets.queueImages(1);await Promise.race([ready,job.then(()=>{throw Error('图片任务未进入 AI 请求就已结束：'+(f.E.assets.imageState(1)?.error||'unknown'));})]);for(const stop of f.shutdown)stop();await job;
 assert.equal(f.E.assets.imageState(1).status,'queued');assert.equal(Object.values(f.state.researchMaterials)[0].generationStatus,'pending');
});
