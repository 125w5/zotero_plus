import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import * as model from '../../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import * as imageAPI from '../../../chrome/content/zotero/research/shared/image-generation.mjs';
import * as Policy from '../../../chrome/content/zotero/research/shared/research-ai-policy.mjs';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WL6fB8AAAAASUVORK5CYII=';
const notebookSource=await readFile(new URL('../../../chrome/content/zotero/xpcom/research/notebook.js',import.meta.url),'utf8');
const workflowSource=await readFile(new URL('../../../chrome/content/zotero/xpcom/research/workflow.js',import.meta.url),'utf8');

test('explicit image request uses one configured image model while existing image bytes remain readable',()=>{
 assert.equal(imageAPI.imageRequest('跨域适配流程',{model:'gpt-image-1'}).model,'gpt-image-1');
 assert.equal(imageAPI.generatedImageBytes({data:[{b64_json:png}]}).extension,'png');
 assert.throws(()=>imageAPI.generatedImageBytes({data:[{url:'https://example.org/fake.png'}]}),/有效的图片数据/);
 assert.throws(()=>imageAPI.generatedImageBytes({data:[{b64_json:Buffer.from('<html>error</html>').toString('base64')}]}),/不是可读取的图片/);
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
 const imports=name=>name.endsWith('/research-ai-policy.mjs')?Policy:name.endsWith('/image-generation.mjs')?imageAPI:name.endsWith('/material-catalog.mjs')?{catalogFor:()=>{}}:name.endsWith('/source-context.mjs')?{computeSourceSelections:()=>({}),applyBulkSourceContext:()=>({})}:{};
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

test('requested image becomes a labeled project material and cannot masquerade as a paper excerpt',async()=>{
 const {E,records,project}=notebookFixture();let finished=0;
 E.generateResearchImage=async(prompt,options)=>{assert.equal(prompt,'跨域适配流程');assert.equal(options.retainImport,true);return {path:'/library/generated.png',fingerprint:'image-hash',width:1024,height:1024,model:'controlled-image',prompt,generatedAt:'controlled-date',finishImport:()=>finished++};};
 E.notebook.project=()=>project;E.notebook.catalog=async(_id,mutate)=>mutate(project);E.notebook.select=async()=>{};
 const saved=await E.notebook.generateIllustration('project-1','跨域适配流程');
 assert.equal(saved.cards[0].sourceType,'ai-illustration');assert.equal(saved.cards[0].sourceText,'');assert.equal(saved.cards[0].generationModel,'controlled-image');
 assert.equal(saved.cards[0].verification,'unverified');assert.equal(project.materials.length,1);assert.equal(Object.keys(records.researchMaterials).length,1);assert.equal(finished,1);
});
test('a current source-question image request uses the same actual generator without inventing source evidence',async()=>{
 const {E,project}=notebookFixture();let messages=[],invoked=0;
 E.notebook.state=()=>({messages});E.notebook.update=async(_id,value)=>{messages=value.messages;};
 E.notebook.generateIllustration=async(id,prompt)=>{invoked++;assert.equal(id,project.id);assert.equal(prompt,'生成一张流程图');return {cards:[{id:'generated-image',generationModel:'gpt-image-2.5-flare',sourceType:'ai-illustration',imagePath:'/library/generated.png'}]};};
 const result=await E.notebook.ask(project.id,'生成一张流程图',()=>{});assert.equal(invoked,1);assert.equal(result.generatedImages[0].sourceType,'ai-illustration');assert.equal(result.model,'gpt-image-2.5-flare');assert.equal(result.sources.length,0);assert.equal(result.evidence.length,0);assert.equal(messages.length,2);
});

test('manual image import still rolls back an uncommitted newly copied file and index',async()=>{
 const fixture=notebookFixture(),target=installRealImageImport(fixture),source=path.join('/tmp','manual.png');
 fixture.files.set(source,Buffer.from(png,'base64'));
 const image=await fixture.E.importWritingImage(source,{signal:new AbortController().signal});assert.equal(fixture.files.has(target),true);
 await image.rollbackImport();assert.equal(fixture.files.has(target),false);assert.equal(Object.keys(fixture.records.writingImages||{}).length,0);
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
