/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {referencedAssetsChanged,rememberAssetViewDefaults,assetViewProjectSnapshot} from '../../chrome/content/zotero/research/manuscript/assembly-asset-view.mjs';
import {mergeMaterialAsset} from '../../chrome/content/zotero/research/shared/material-project-annotations.mjs';
import {descriptionOnlyChange,refreshMaterialDescriptions} from '../../chrome/content/zotero/research/shared/material-description-refresh.mjs';

const fixture=()=>({id:'paper',revision:8,updatedAt:'unchanged',materials:[{id:'linked',assetID:'linked',revision:2,sourceText:'Original human note.'}],blocks:[{id:'body',text:'Human manuscript prose.',materials:[{id:'linked',revision:2}],review:'verified'}],materialCatalog:{entries:{linked:{type:'用户笔记',topics:['paper'],tags:['original'],inferred:false}},orders:{'paper|':['linked']},topics:[{id:'paper',name:'Human topic'}],aliases:[{name:'kept',aliases:['alias']}],collapsed:['kept']}});

test('a global screenshot refresh preserves the entire saved manuscript and every original catalog entry',()=>{
 const project=fixture(),before=structuredClone(project),defaults=new Map(),ids=new Set(Object.keys(project.materialCatalog.entries));
 project.materialCatalog.entries.capture={type:'图片',topics:['paper'],tags:['图片'],inferred:true};
 rememberAssetViewDefaults(project,ids,defaults);
 assert.deepEqual(assetViewProjectSnapshot(project,defaults),before);
 assert.ok(project.materialCatalog.entries.capture,'global screenshot stays selectable in the live library view');
 assert.equal(project.blocks[0].text,before.blocks[0].text);
});

test('explicit catalog changes and material insertion are retained while untouched view defaults are omitted',()=>{
 const project=fixture(),defaults=new Map(),ids=new Set(Object.keys(project.materialCatalog.entries));
 for(const id of ['edited','inserted','ordered','untouched'])project.materialCatalog.entries[id]={type:'图片',topics:['paper'],tags:['图片'],inferred:true};
 rememberAssetViewDefaults(project,ids,defaults);
 project.materialCatalog.entries.edited.type='方法';project.materialCatalog.entries.edited.inferred=false;
 project.materials.push({id:'inserted',assetID:'inserted',revision:1,imagePath:'original.png'});
 project.materialCatalog.orders['paper|'].push('ordered');
 const saved=assetViewProjectSnapshot(project,defaults);
 assert.deepEqual(saved.materialCatalog.entries.edited,project.materialCatalog.entries.edited);
 assert.deepEqual(saved.materialCatalog.entries.inserted,project.materialCatalog.entries.inserted);
 assert.deepEqual(saved.materialCatalog.entries.ordered,project.materialCatalog.entries.ordered);
 assert.equal(saved.materialCatalog.entries.untouched,undefined);
 assert.deepEqual(saved.materialCatalog.entries.linked,fixture().materialCatalog.entries.linked);
 assert.deepEqual(saved.materialCatalog.orders,project.materialCatalog.orders);
 assert.deepEqual(saved.blocks,fixture().blocks);
});

test('only an updated asset already used by the manuscript requires its source synchronization',()=>{
 const project=fixture();
 assert.equal(referencedAssetsChanged(project,{linked:{revision:2},capture:{revision:1}}),false);
 assert.equal(referencedAssetsChanged(project,{linked:{revision:3},capture:{revision:1}}),true);
 assert.equal(referencedAssetsChanged(project,{}),false);
 assert.deepEqual(project,fixture(),'comparison never rewrites source records or body text');
});

test('source notifications redraw the current project annotation layer and notice comment-only changes',async()=>{
 const source=await readFile(new URL('../../chrome/content/zotero/research/manuscript/main.mjs',import.meta.url),'utf8'),start=source.indexOf('function assetDetailSignature('),end=source.indexOf('\nexport function insertMaterial(',start),project=fixture(),material=project.materials[0];
 Object.assign(material,{summary:'已有说明',projectAnnotationProjectID:project.id,annotationRevision:1,projectHighlights:[{id:'h',comment:'本项目用途'}],highlights:[{id:'h',comment:'本项目用途'}]});
 const assets={linked:{id:'linked',assetID:'linked',revision:3,summary:'更新后的原文说明',sourceText:material.sourceText,highlights:[]}},details={dataset:{materialId:'linked',assetViewSignature:'old'}},rendered=[],U={p:project,previewMaterialID:'linked',E:{assets:{key:value=>JSON.stringify(value)}},A:{assetLibrary:()=>assets,titleFor:m=>m.title||'',summaryFor:m=>m.summary||'',syncAssets:p=>{for(const row of p.materials)if(assets[row.assetID])mergeMaterialAsset(row,assets[row.assetID]);}}};
 project.ui={rightOpen:true};let scope;scope=vm.createContext({U,$:()=>details,referencedAssetsChanged,rememberAssetViewDefaults,descriptionOnlyChange,refreshMaterialDescriptions,assetViewDefaults:new Map(),renderLibrary:()=>{},renderEditor:()=>{},persist:()=>{},materialDetails:m=>{rendered.push(m);details.dataset.assetViewSignature=scope.assetDetailSignature(m);}});
 vm.runInContext(source.slice(start,end),scope);scope.refreshAssetViews();assert.strictEqual(rendered[0],material);assert.equal(rendered[0].summary,'更新后的原文说明');assert.equal(rendered[0].highlights[0].comment,'本项目用途');assert.equal(assets.linked.highlights.length,0);
 // Reader edits can update only project comments while the shared asset and
 // source revision remain unchanged. The open details must still redraw.
 material.highlights[0].comment='已核查的项目用途';material.annotationRevision++;scope.refreshAssetViews();assert.equal(rendered.length,2);assert.strictEqual(rendered[1],material);scope.refreshAssetViews();assert.equal(rendered.length,2,'unchanged notifications do not recreate the details');
});
