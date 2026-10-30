/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {weeklyResearchEntries,weeklyPresentation} from '../../chrome/content/zotero/research/shared/weekly-research.mjs';
import {presentationReadiness} from '../../chrome/content/zotero/research/shared/ppt-readiness.mjs';
import {rapidMenuBounds} from '../../chrome/content/zotero/research/shared/reader-rapid-reading.mjs';
import {discoverySearchTask} from '../../chrome/content/zotero/research/shared/discovery-search-task.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const at='2026-10-26T12:00:00Z';
test('weekly folder scope excludes another project but preserves writing linked to this folder',()=>{
 const state={researchActivity:[{id:'camera',paperItemID:1,text:'仅阅读，还没有采集视频',at},{id:'3dgs',paperItemID:2,text:'另一个项目的阅读',at}],manuscripts:{m:{id:'m',papers:[{id:1}],title:'协议草稿',blocks:[{text:'拟采集车辆视频'}],updatedAt:at},other:{id:'other',papers:[{id:2}],title:'3DGS',blocks:[{text:'其他项目'}],updatedAt:at}}};
 const report=weeklyResearchEntries(state,[],{now:'2026-10-27T12:00:00Z',scope:{label:'Camera IoT',paperIDs:[1]}});
 assert.deepEqual(report.entries.map(row=>row.id),['camera','writing-m']);assert.equal(report.scope.label,'Camera IoT');assert.equal(weeklyResearchEntries(state,[],{now:'2026-10-27T12:00:00Z',scope:{paperIDs:[]}}).entries.length,0,'empty folder must not fall back to the entire library');
});
test('120 full records fit a 15 minute digest and every record remains associated with a page',()=>{
 const entries=Array.from({length:120},(_,i)=>({id:'record-'+i,type:['reading','import','note','annotation','analysis','writing','experiment'][i%7],title:'研究记录 '+i,text:'仅有文献记录，未执行新的性能实验。'.repeat(350),derived:i%7===4}));
 const result=weeklyPresentation({entries,scope:{label:'Camera IoT'}},{minutes:15}),readiness=presentationReadiness({title:'本周进展',minutes:15,...result,assets:[]});
 assert.equal(result.sources.length,120);assert.equal(new Set(result.slides.flatMap(row=>row.weeklySourceIDs)).size,120);assert.equal(result.sources[0].text,entries[0].text);assert.ok(result.slides.length<=10);assert.equal(readiness.suitability.overTime,false);assert.equal(readiness.counts.errors,0);assert.ok(result.slides.every(row=>row.explanation.includes('完整内容见来源')));
});
test('valid 33-page deck is exportable but clearly unsuitable for a 15 minute talk',()=>{
 const slides=Array.from({length:33},(_,i)=>({id:'s'+i,title:'文献记录',layout:'text',explanation:'',blocks:[{kind:'my_interpretation',text:'记'.repeat(160),evidenceIDs:[]}],notes:'讲'.repeat(500),assetIDs:[],status:'user'})),report=presentationReadiness({title:'本周进展',minutes:15,slides});
 assert.equal(report.counts.errors,0);assert.equal(report.suitability.exportable,true);assert.equal(report.suitability.overTime,true);assert.match(report.suitability.title,/超出目标时长/);assert.match(report.suitability.detail,/目标 15 分钟/);
});
test('long evidence popup remains in the viewport including after a narrow resize',()=>{
 for(const [w,h]of [[1440,900],[680,420],[280,180]]){const bounds=rapidMenuBounds({x:w-10,y:h-15,width:320,height:1400,viewportWidth:w,viewportHeight:h});assert.ok(bounds.left>=8);assert.ok(bounds.top>=8);assert.ok(bounds.left+bounds.width<=w-8);assert.ok(bounds.top+Math.min(1400,bounds.maxHeight)<=h-8);}
});
test('a transport that ignores abort still settles at the overall search deadline',async()=>{
 let transport;await assert.rejects(discoverySearchTask(signal=>{transport=signal;return new Promise(()=>{});},{timeout:15}),error=>error.name==='TimeoutError');assert.equal(transport.aborted,true);
});
test('canceling a stalled search settles immediately and aborts the provider signal',async()=>{
 const controller=new AbortController();let transport;const pending=discoverySearchTask(signal=>{transport=signal;return new Promise(()=>{});},{signal:controller.signal});controller.abort();await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(transport.aborted,true);
});
test('canceling weekly creation during asynchronous paper lookup does not create a new draft',async()=>{
 let entered,release,created=0;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve),controller=new AbortController();
 const E={store:{get:()=>({})},studio:{create:async()=>{created++;return{id:'new'};},patch:async()=>{throw Error('must not patch a canceled draft');}},library:{describe:item=>item}};
 const Zotero={Research:E,Items:{getAsync:async()=>{entered();await gate;return{isRegularItem:()=>true};}}};
 vm.runInNewContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/research-resources.js',import.meta.url),'utf8'),{Zotero,ChromeUtils:{importESModule:url=>url.includes('weekly-research')?{weeklyPresentation}:({})}});
 E.weeklyResearch=async()=>({entries:[{id:'r',paperItemID:1,type:'reading',text:'阅读',title:'论文'}]});
 const task=E.studio.createWeekly(()=>{},controller.signal,{scope:null});await started;controller.abort();release();await assert.rejects(task,/已取消/);assert.equal(created,0);
});
