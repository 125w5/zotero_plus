/* SPDX-License-Identifier: AGPL-3.0-or-later */
// WA-16: the 影响因子 and 期刊标签 cells describe the metric R.field shows,
// and a metric without a year says so instead of naming another source.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

let root=new URL('../../chrome/content/zotero/xpcom/research/',import.meta.url);
async function fixture({saved=[],regular=true}={}){
	let snapshots={'17452473':{at:new Date().toISOString(),metric:{issn:'17452473',journal:'Nature Physics',impact_factor:19.6,jcr_quartile:'Q1',cas_top:null,metric_year:null,source:'easyScholar 当前返回（年份未标明）',fetched_at:new Date().toISOString()}}};
	let R={store:{get:key=>key==='journalMetricSnapshots'?snapshots:undefined,update:async()=>{}}};
	let context=vm.createContext({Zotero:{Research:R,getMainWindows:()=>[],logError:()=>{}}});
	for(let file of ['database.js','metrics-provider.js','columns.js'])vm.runInContext(await readFile(new URL(file,root),'utf8'),context);
	for(let metric of saved){let list=R.metrics.get(metric.issn)||[];list.push(metric);R.metrics.set(metric.issn,list);}
	let item={id:1,libraryID:1,key:'K',isRegularItem:()=>regular,getField:field=>({ISSN:'1745-2473',publicationTitle:'Nature Physics',date:'2024-05-01'})[field]||'',getTags:()=>[]};
	let element=()=>({style:{},children:[],title:'',className:'',textContent:'',append(...nodes){this.children.push(...nodes);}});
	let doc={createElementNS:()=>element(),createTextNode:text=>({text})},tree={getRow:()=>({ref:item})};
	let render=key=>R.renderColumn(tree,0,R.field(item,key),{dataKey:key,className:'x'},doc);
	return {R,item,render};
}

test('a current easyScholar metric without a year labels its tooltips and shows its badges',async()=>{
	let {R,item,render}=await fixture();
	assert.equal(R.field(item,'research_impact_factor'),19.6);
	let factor=render('research_impact_factor'),tags=render('research_journalTags');
	assert.equal(factor.title,'年份未标明 · easyScholar 当前返回（年份未标明）');
	assert.deepEqual(tags.children.map(node=>node.textContent),['IF 19.6','Q1']);
	assert.match(tags.title,/^年份未标明 · easyScholar/);assert.doesNotMatch(factor.title+tags.title,/null|undefined/);
});

test('the tooltip names the metric whose value is shown, not an older saved one',async()=>{
	let {render}=await fixture({saved:[{issn:'17452473',metric_year:2020,source:'手工录入',impact_factor:15,jcr_quartile:'Q2',fetched_at:'2021-01-01T00:00:00Z'}]});
	let factor=render('research_impact_factor'),tags=render('research_journalTags');
	assert.match(factor.title,/easyScholar/);assert.doesNotMatch(factor.title,/2020|手工录入/);
	assert.deepEqual(tags.children.map(node=>node.textContent),['IF 19.6','Q1']);
});

test('a dated saved metric of the current period still wins, and non-paper rows show no journal badges',async()=>{
	let year=new Date().getFullYear();
	let {render}=await fixture({saved:[{issn:'17452473',metric_year:year,source:'JCR',impact_factor:20.1,jcr_quartile:'Q1',fetched_at:new Date().toISOString()}]});
	assert.match(render('research_impact_factor').title,new RegExp('^'+year+' · JCR$'));
	let attachment=await fixture({regular:false});
	assert.equal(attachment.render('research_journalTags').children.length,0);
});
