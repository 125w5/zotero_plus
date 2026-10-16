/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {referencedAssetsChanged,rememberAssetViewDefaults,assetViewProjectSnapshot} from '../../chrome/content/zotero/research/manuscript/assembly-asset-view.mjs';

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
