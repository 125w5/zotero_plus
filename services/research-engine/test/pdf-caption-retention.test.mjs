import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {material} from '../../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import * as Formula from '../../../chrome/content/zotero/research/shared/formula-research.mjs';
import * as Reading from '../../../chrome/content/zotero/research/shared/evidence-reading-context.mjs';

const source=await readFile(new URL('../../../chrome/content/zotero/xpcom/research/assets.js',import.meta.url),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
function setup(){
 const state={researchMaterials:{}};
 const E={store:{update:async fn=>fn(state)},runArtifactEngine:async()=>({}),
  manuscripts:{model:{material},assetLibrary:()=>state.researchMaterials,notifyAssetsChanged(){}}};
 const ctx=vm.createContext({Zotero:{Research:E},ChromeUtils:{importESModule:path=>path.endsWith('formula-research.mjs')?Formula:Reading}});vm.runInContext(source,ctx);
 E.assets.key=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 return {E,state};
}
const asset={id:'original',pdfHash:'source-pdf',pageIndex:0,pageHeight:800,bbox:[10,20,200,120],
 kind:'figure',label:'Fig. 1',path:'source.png',attachmentID:10,paperItemID:1,caption:'Fig. 1. Av2',
 captionLayoutVersion:'pdf-baseline-1',captionRuns:[{text:'Fig. 1. A',script:null},
  {text:'v',script:'sub'},{text:'2',script:'super'}],extractorVersion:'mupdf-assets-9'};

test('source caption scripts survive material storage with stable source ID',async()=>{
 const {E,state}=setup(),first=await E.assets.retainMaterial(asset),second=await E.assets.retainMaterial({...asset,id:'next-cache-id'});
 assert.equal(first.id,second.id);assert.equal(Object.keys(state.researchMaterials).length,1);
 assert.deepEqual(clone(second.captionRuns),asset.captionRuns);
 assert.equal(second.captionLayoutVersion,'pdf-baseline-1');
 assert.equal(second.sourceText,'Fig. 1. Av2');
});

test('a caption metadata upgrade preserves confirmed explanations and a user source crop',async()=>{
 const {E,state}=setup();
 const first=await E.assets.retainMaterial({...asset,captionRuns:undefined,captionLayoutVersion:undefined});
 const stored=state.researchMaterials[first.id];stored.summary='用户确认的中文说明';stored.userEdited=true;stored.verification='confirmed';
 const upgraded=await E.assets.retainMaterial(asset);
 assert.deepEqual(clone(upgraded.captionRuns),asset.captionRuns);
 assert.equal(upgraded.summary,'用户确认的中文说明');assert.equal(upgraded.imagePath,'source.png');
 const next=await E.assets.retainMaterial({...asset,path:'new-cache-render.png',captionLayoutVersion:'pdf-baseline-2'});
 assert.equal(next.id,first.id);assert.equal(next.imagePath,'source.png');
 assert.equal(next.summary,'用户确认的中文说明');assert.equal(Object.keys(state.researchMaterials).length,1);
});
