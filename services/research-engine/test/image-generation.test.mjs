import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import * as model from '../../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import * as imageAPI from '../../../chrome/content/zotero/research/shared/image-generation.mjs';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WL6fB8AAAAASUVORK5CYII=';
const notebookSource=await readFile(new URL('../../../chrome/content/zotero/xpcom/research/notebook.js',import.meta.url),'utf8');
const workflowSource=await readFile(new URL('../../../chrome/content/zotero/xpcom/research/workflow.js',import.meta.url),'utf8');

test('OpenAI-compatible request asks for one conceptual image and rejects non-image replies',()=>{
 const body=imageAPI.imageRequest('跨域适配流程');
 assert.deepEqual({model:body.model,size:body.size,n:body.n,output_format:body.output_format},{model:'gpt-image-2.5',size:'1024x1024',n:1,output_format:'png'});
 assert.match(body.prompt,/不要绘制虚构的实验数据/);
 assert.equal(imageAPI.generatedImageBytes({data:[{b64_json:png}]}).extension,'png');
 assert.throws(()=>imageAPI.generatedImageBytes({data:[{url:'https://example.org/fake.png'}]}),/有效的图片数据/);
 assert.throws(()=>imageAPI.generatedImageBytes({data:[{b64_json:Buffer.from('<html>error</html>').toString('base64')}]}),/不是可读取的图片/);
 assert.throws(()=>imageAPI.imageRequest(' '),/请描述/);
});

function notebookFixture(fetchReply){
 const records={researchMaterials:{},researchNotebooks:{}},project={id:'project-1',title:'测试课题',materials:[],ui:{}},requests=[],files=new Map(),key='test-only-secret';
 const E={settings:()=>({imageEndpoint:'https://images.example.test/v1'}),core:{endpoint:x=>x.replace(/\/$/,'')},credentials:{get:async scope=>{assert.equal(scope,'https://images.example.test/v1/images');return key;}},
  manuscripts:{model,assetLibrary:()=>records.researchMaterials,get:()=>project,save:async p=>Object.assign(project,p),onAssetsChanged:()=>{},notifyAssetsChanged:()=>{},publishMaterials:async cards=>{const m={...cards[0],id:'asset-illustration',assetID:'asset-illustration'};records.researchMaterials[m.id]=m;return {cards:[m],added:1,reused:0};}},
  importWritingImage:async file=>{assert.ok(files.has(file));return {path:'/library/generated.png',fingerprint:'image-hash',width:1024,height:1024};},
  store:{get:(...keys)=>keys.reduce((value,k)=>value?.[k],records),update:async fn=>fn(records)},dataDir:'/library'};
 const window={AbortController,setTimeout,clearTimeout,document:{getElementById:()=>null},fetch:async(url,options)=>{requests.push({url,options});return fetchReply?fetchReply(url,options):{ok:true,json:async()=>({data:[{b64_json:png}]})};}};
 const Zotero={Research:E,getMainWindow:()=>window,getTempDirectory:()=>({path:'/tmp'}),Utilities:{randomString:()=> 'mock'},logError(){}};
 const IOUtils={write:async(file,bytes)=>files.set(file,bytes),remove:async file=>files.delete(file)};
 const imports=name=>name.endsWith('/image-generation.mjs')?imageAPI:name.endsWith('/material-catalog.mjs')?{catalogFor:()=>{}}:name.endsWith('/source-context.mjs')?{computeSourceSelections:()=>({}),applyBulkSourceContext:()=>({})}:{};
 const restart=()=>vm.runInNewContext(notebookSource,{Zotero,ChromeUtils:{importESModule:imports},PathUtils:{join:path.join},IOUtils,Services:{}});
 restart();return {E,records,project,requests,files,key,restart,window,Zotero,IOUtils};
}

function installRealImageImport(fixture,{copy}={}){
 const {E,window,Zotero,IOUtils,files}=fixture;
 E.previewImage=async()=> 'data:image/png;base64,'+png;
 window.Image=class {naturalWidth=1;naturalHeight=1;async decode(){}};
 Zotero.Utilities.Internal={md5Async:async()=> 'image-hash'};
 Zotero.File={pathToFileURI:file=>'file://'+file};
 IOUtils.stat=async file=>({size:files.get(file)?.length||0});
 IOUtils.exists=async file=>files.has(file);
 IOUtils.copy=copy|| (async(source,target)=>files.set(target,files.get(source)));
 IOUtils.makeDirectory=async()=>{};
 vm.runInNewContext(workflowSource,{Zotero,IOUtils,PathUtils:{join:path.join,filename:path.basename},Services:{}});
 return path.join('/library','writing-images','image-hash.png');
}

test('explicit generation uses image-only credential and persists a non-evidence research asset',async()=>{
 const {E,records,project,requests,files,key,restart}=notebookFixture();
 const saved=await E.notebook.generateIllustration('project-1','跨域适配流程');
 assert.equal(requests.length,1);assert.equal(requests[0].url,'https://images.example.test/v1/images/generations');
 assert.equal(requests[0].options.headers.Authorization,'Bearer '+key);
 assert.equal(JSON.parse(requests[0].options.body).model,'gpt-image-2.5');
 assert.equal(files.size,0);
 assert.equal(saved.cards[0].kind,'idea');assert.equal(saved.cards[0].sourceType,'ai-illustration');assert.equal(saved.cards[0].aiGenerated,true);
 assert.equal(saved.cards[0].sourceText,'');assert.equal(saved.cards[0].paperItemID,null);assert.equal(saved.cards[0].anchor.attachmentID,null);
 assert.match(saved.cards[0].summary,/不能用作论文实验图或来源证据/);
 assert.equal(project.materials[0].id,saved.cards[0].id);
 assert.equal(records.researchNotebooks['project-1'].selectedMaterial,saved.cards[0].id);
 assert.ok(!JSON.stringify(saved.cards[0]).includes(key));
 restart();
 const restored=E.notebook.materials('project-1').find(m=>m.id===saved.cards[0].id);
 assert.equal(restored.sourceType,'ai-illustration');assert.equal(E.notebook.state('project-1').selectedMaterial,restored.id);
 let consulted;
 E.notebook.results=()=>[];E.previewImage=async()=> 'data:image/png;base64,'+png;
 E.studio={request:async(_rules,input,_status,_signal,options)=>{consulted={input,options};return {value:{text:'该图片仅展示研究设想，尚无论文证据。',evidence:[]},model:'test-chat'};}};
 const discussion=await E.notebook.ask('project-1','请解释这个示意图',()=>{});
 assert.equal(consulted.input.illustrationContext.evidence,false);
 assert.equal(consulted.input.sources.length,0);assert.equal(consulted.input.excerpts.length,0);
 assert.equal(consulted.options.images.length,1);assert.equal(discussion.evidence.length,0);
});

test('failed or cancelled requests never create a material or leave a temporary image',async()=>{
 const failure=notebookFixture(async()=>({ok:false,status:503}));
 await assert.rejects(failure.E.notebook.generateIllustration('project-1','研究示意'),/HTTP 503/);
 assert.equal(Object.keys(failure.records.researchMaterials).length,0);assert.equal(failure.project.materials.length,0);assert.equal(failure.files.size,0);
 const aborted=notebookFixture((_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true})));
 const controller=new AbortController(),pending=aborted.E.notebook.generateIllustration('project-1','研究示意',()=>{},controller.signal);
 while(!aborted.requests.length)await new Promise(resolve=>setTimeout(resolve,1));
 controller.abort();await assert.rejects(pending,/已取消/);
 assert.equal(Object.keys(aborted.records.researchMaterials).length,0);assert.equal(aborted.project.materials.length,0);assert.equal(aborted.files.size,0);
});

test('cancelling while the generated image is importing never publishes a material',async()=>{
 const fixture=notebookFixture();let finishImport,started;
 const importing=new Promise(resolve=>{started=resolve;});
 fixture.E.importWritingImage=async file=>{assert.ok(fixture.files.has(file));started();await new Promise(resolve=>{finishImport=resolve;});return {path:'/library/generated.png',fingerprint:'image-hash',width:1024,height:1024};};
 const controller=new AbortController(),pending=fixture.E.notebook.generateIllustration('project-1','研究流程示意',()=>{},controller.signal);
 await importing;controller.abort();finishImport();
 await assert.rejects(pending,/已取消/);
 assert.equal(Object.keys(fixture.records.researchMaterials).length,0);
 assert.equal(fixture.project.materials.length,0);
 assert.equal(fixture.files.size,0);
});

test('cancelling immediately before publish leaves no material; cancellation after commit reports success',async()=>{
 const before=notebookFixture(),early=new AbortController();let published=false;
 const publish=before.E.manuscripts.publishMaterials;
 before.E.manuscripts.publishMaterials=async cards=>{published=true;return publish(cards);};
 await assert.rejects(before.E.notebook.generateIllustration('project-1','研究流程示意',message=>{if(message==='正在保存示意图素材…')early.abort();},early.signal),/已取消/);
 assert.equal(published,false);
 assert.equal(Object.keys(before.records.researchMaterials).length,0);
 assert.equal(before.project.materials.length,0);
 assert.equal(before.files.size,0);
 const after=notebookFixture(),late=new AbortController(),realPublish=after.E.manuscripts.publishMaterials;
 after.E.manuscripts.publishMaterials=async cards=>{const result=await realPublish(cards);late.abort();return result;};
 const saved=await after.E.notebook.generateIllustration('project-1','研究流程示意',()=>{},late.signal);
 assert.equal(saved.cards[0].id,after.project.materials[0].id);
 assert.equal(after.records.researchNotebooks['project-1'].selectedMaterial,saved.cards[0].id);
});

test('real image import rolls back a newly copied long-term file and index when cancelled during copy',async()=>{
 const fixture=notebookFixture();let releaseCopy,copyStarted;
 const started=new Promise(resolve=>{copyStarted=resolve;});
 const target=installRealImageImport(fixture,{copy:async(source,destination)=>{fixture.files.set(destination,fixture.files.get(source));copyStarted();await new Promise(resolve=>{releaseCopy=resolve;});}});
 const controller=new AbortController(),pending=fixture.E.notebook.generateIllustration('project-1','研究流程示意',()=>{},controller.signal);
 await started;assert.ok(fixture.files.has(target));controller.abort();releaseCopy();
 await assert.rejects(pending,/已取消/);
 assert.equal(fixture.files.has(target),false);
 assert.equal(fixture.files.size,0);
 assert.equal(Object.keys(fixture.records.writingImages||{}).length,0);
 assert.equal(Object.keys(fixture.records.researchMaterials).length,0);
});

test('real image import rollback removes an uncommitted index but preserves pre-existing or referenced images',async()=>{
 const fresh=notebookFixture(),freshTarget=installRealImageImport(fresh),early=new AbortController();
 await assert.rejects(fresh.E.notebook.generateIllustration('project-1','研究流程示意',message=>{if(message==='正在保存示意图素材…')early.abort();},early.signal),/已取消/);
 assert.equal(fresh.files.has(freshTarget),false);
 assert.equal(Object.keys(fresh.records.writingImages||{}).length,0);
 assert.equal(Object.keys(fresh.records.researchMaterials).length,0);
 const shared=notebookFixture(),sharedTarget=installRealImageImport(shared),old={uri:'file://'+sharedTarget,at:'old',fingerprint:'image-hash'};
 shared.files.set(sharedTarget,Buffer.from(png,'base64'));
 shared.records.writingImages={[sharedTarget.replace(/\\/g,'/')]:old};
 const stop=new AbortController();
 await assert.rejects(shared.E.notebook.generateIllustration('project-1','研究流程示意',message=>{if(message==='正在保存示意图素材…')stop.abort();},stop.signal),/已取消/);
 assert.equal(shared.files.has(sharedTarget),true);
 assert.deepEqual(shared.records.writingImages[sharedTarget.replace(/\\/g,'/')],old);
 assert.equal(Object.keys(shared.records.researchMaterials).length,0);
 const referenced=notebookFixture(),referenceTarget=installRealImageImport(referenced),another=new AbortController();
 await assert.rejects(referenced.E.notebook.generateIllustration('project-1','研究流程示意',message=>{if(message==='正在保存示意图素材…'){referenced.records.researchMaterials.existing={id:'existing',imagePath:referenceTarget};another.abort();}},another.signal),/已取消/);
 assert.equal(referenced.files.has(referenceTarget),true);
 assert.ok(referenced.records.writingImages[referenceTarget.replace(/\\/g,'/')]);
 assert.equal(Object.keys(referenced.records.researchMaterials).length,1);
});

test('a second import of the same fingerprint protects the shared long-term file from rollback',async()=>{
 const fixture=notebookFixture(),target=installRealImageImport(fixture),source=path.join('/tmp','same.png');
 fixture.files.set(source,Buffer.from(png,'base64'));
 const controller=new AbortController();
 const first=await fixture.E.importWritingImage(source,{signal:controller.signal});
 const second=await fixture.E.importWritingImage(source);
 assert.equal(first.path,second.path);
 controller.abort();await first.rollbackImport();
 assert.equal(fixture.files.has(target),true);
 assert.ok(fixture.records.writingImages[target.replace(/\\/g,'/')]);
});
