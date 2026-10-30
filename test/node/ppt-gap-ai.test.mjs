/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Tests for the X/ppt-studio-ai.js parts of PPT-02, PPT-06 (with reviews R8 and R8-REV-2),
// PPT-08, PPT-09 (with review R8-REV-1) and PPT-23. The page model is stubbed; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as model from '../../chrome/content/zotero/research/shared/ppt-model.mjs';
import * as scope from '../../chrome/content/zotero/research/shared/ppt-scope.mjs';
import * as outline from '../../chrome/content/zotero/research/shared/ppt-outline.mjs';
import * as policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as outputs from '../../chrome/content/zotero/research/shared/workspace-outputs.mjs';

const root=new URL('../../chrome/content/zotero/xpcom/research/',import.meta.url);
async function service(){
 let state={pptDrafts:{}},counter=0;
 const E={store:{get:(...path)=>structuredClone(path.reduce((value,key)=>value?.[key],state)),peek:(...path)=>path.reduce((value,key)=>value?.[key],state),update:async fn=>{const next=structuredClone(state);fn(next);state=next;}},library:{selection:()=>[],describe:value=>({id:value.id,title:'Paper '+value.id}),uri:()=>''},assets:{key:value=>JSON.stringify(value),index:async()=>({assets:[]})}};
 const context=vm.createContext({structuredClone,console,URL,ChromeUtils:{importESModule:path=>path.includes('workspace-outputs')?outputs:path.includes('ppt-model')?model:path.includes('ppt-scope')?scope:path.includes('ppt-outline')?outline:policy},IOUtils:{},PathUtils:{join:(...parts)=>parts.join('/')},Zotero:{Research:E,Utilities:{randomString:()=>'r'+(++counter)},Items:{getAsync:async()=>null},getMainWindow:()=>({AbortController})}});
 for(const name of ['ppt-studio.js','ppt-studio-ai.js'])vm.runInContext(await readFile(new URL(name,root),'utf8'),context,{filename:name});
 return E.studio;
}
const rows=['甲','乙','丙'].map((t,i)=>({id:'o'+i,title:'板块'+t,purpose:'讲述'+t+'的问题与证据',diagram:false,sourceIDs:[]}));
const valid=title=>({title:title+'的关键结论与证据边界',explanation:'本页说明该板块的核心问题、证据来源与讨论边界，供组会现场交流。',blocks:[1,2,3].map(n=>({kind:'synthesis',text:'第'+n+'条：系统归纳本板块的论证步骤、证据强度与仍需核对的条件，避免夸大结论。',evidenceIDs:[]})),notes:'讲述顺序说明。',assetIDs:[]});
async function deck(){const S=await service(),d=await S.create([]);await S.patch(d.id,x=>{x.outline=structuredClone(rows);x.materialsReady=true;x.sources=[{id:'s1',label:'Paper 1 · PDF 第 1 页',text:'source text'}];});await S.prepareSlides(d.id);return {S,id:d.id};}

test('PPT-06: one page that keeps failing no longer stops the pages after it',async()=>{
 const {S,id}=await deck(),calls=[];
 S.request=async(system,input)=>{calls.push(input.outline.title);return {value:input.outline.title==='板块甲'?{...valid('甲'),blocks:[{kind:'synthesis',text:'太短',evidenceIDs:[]}]}:valid(input.outline.title),model:'stub',at:'t',cacheHit:false};};
 await assert.rejects(S.generateRemaining(id,()=>{},undefined),/1 页未生成/);
 assert.deepEqual(S.get(id).slides.map(page=>page.status),['failed','generated','generated']);assert.ok(calls.includes('板块乙')&&calls.includes('板块丙'));
});
test('PPT-23: a page regenerated after a failure drops the old error',async()=>{
 const {S,id}=await deck(),pageID=S.get(id).slides[1].id;await S.patch(id,x=>{const page=x.slides[1];page.status='failed';page.error='AI 请求超时，已有内容已保留';});
 S.request=async(system,input)=>({value:valid(input.outline.title),model:'stub',at:'t',cacheHit:false});
 await S.generatePage(id,pageID,()=>{},undefined);const page=S.get(id).slides[1];assert.equal(page.status,'generated');assert.equal(page.error,undefined);
});
test('PPT-09: manual pages keep their place when the structure is confirmed again',async()=>{
 const {S,id}=await deck();await S.patch(id,x=>{x.slides.unshift({id:'manual-1',title:'我的开场',blocks:[],assetIDs:[],status:'user'});x.slides.splice(2,0,{id:'copy-1',title:'复制页',blocks:[],assetIDs:[],status:'user'});});
 const before=S.get(id).slides.map(page=>page.id);await S.editOutline(id,{type:'update',id:'o1',patch:{purpose:'改写后的任务'}});await S.prepareSlides(id);
 assert.deepEqual(S.get(id).slides.map(page=>page.id),before);
});
test('PPT-08: confirming the structure after a scope change waits for the material',async()=>{
 const {S,id}=await deck();await S.patch(id,x=>{x.materialsReady=false;x.outlineApproved=false;});
 await assert.rejects(S.prepareSlides(id),/重新读取材料/);assert.equal(S.get(id).outlineApproved,false);
});
test('PPT-02: a page archived twice is kept once in the archive',async()=>{
 const {S,id}=await deck();await S.editOutline(id,{type:'remove',id:'o2'});await S.prepareSlides(id);await S.history(id);await S.history(id);await S.editOutline(id,{type:'remove',id:'o2'});await S.prepareSlides(id);
 const ids=S.get(id).archivedSlides.map(page=>page.id);assert.equal(ids.length,new Set(ids).size);
});
test('PPT-02: undo to a version saved before the archive was recorded does not archive the page twice',async()=>{
 // Versions saved before capture() carried archivedSlides restore the page but keep the archive.
 let {S,id}=await deck(),pageID=S.get(id).slides[2].id;await S.editOutline(id,{type:'remove',id:'o2'});await S.prepareSlides(id);
 await S.patch(id,x=>{for(let entry of x.history)delete entry.archivedSlides;});await S.history(id);await S.history(id);
 assert.ok(S.get(id).slides.some(page=>page.id===pageID)&&S.get(id).archivedSlides.some(page=>page.id===pageID),'the restored page is also still in the archive');
 await S.editOutline(id,{type:'remove',id:'o2'});await S.prepareSlides(id);
 assert.equal(S.get(id).archivedSlides.filter(page=>page.id===pageID).length,1);
});
test('R8: a draft-wide failure stops the run after one call and leaves the other pages pending',async()=>{
 for(const reason of ['请先在设置中保存当前模型接口的 API 密钥','AI 请求超时，已有内容已保留']){
  const {S,id}=await deck();let calls=0;S.request=async()=>{calls++;throw Error(reason);};
  await assert.rejects(S.generateRemaining(id,()=>{},undefined),error=>error.message===reason);
  assert.equal(calls,1,reason);assert.deepEqual(S.get(id).slides.map(page=>page.status),['failed','pending','pending']);
 }
});
test('R8: when every page fails its own checks, the message does not claim saved pages',async()=>{
 const {S,id}=await deck();S.request=async(system,input)=>({value:{...valid(input.outline.title),blocks:[{kind:'synthesis',text:'太短',evidenceIDs:[]}]},model:'stub',at:'t',cacheHit:false});
 await assert.rejects(S.generateRemaining(id,()=>{},undefined),error=>/3 页未生成/.test(error.message)&&/没有页面生成/.test(error.message)&&!/其余/.test(error.message));
 assert.deepEqual(S.get(id).slides.map(page=>page.status),['failed','failed','failed']);
});
// R8-REV-1: a template switch as the 选择模板 screen makes it (R/ui/ppt-flow.js): propose, accept, confirm.
async function templateSwitch(S,id,templateID,name){
 let d=S.get(id),proposal=outline.templateOutlineProposal(d.outline,d.slides,model.initialOutline(templateID),{name});
 await S.patch(id,x=>{x.outlineProposal={base:outline.outlineFingerprint(x.outline),sections:proposal.sections,templateID,summary:proposal.summary,model:'template'};});
 await S.acceptOutline(id);await S.prepareSlides(id);return proposal;
}
test('R8-REV-1: after a template switch, a page that followed removed sections stays at the end',async()=>{
 // cover=false: no section title matches the template; cover=true: only 封面 matches.
 for(let cover of [false,true]){
  let {S,id}=await deck(),coverPage=S.get(id).slides[0].id;
  await S.patch(id,x=>{if(cover)x.outline[0].title='封面';x.slides.unshift({id:'opening',title:'我的开场',blocks:[],assetIDs:[],status:'user'});x.slides.push({id:'my-experiment',title:'我的复现实验',blocks:[],assetIDs:[],status:'user'});});
  let proposal=await templateSwitch(S,id,'progress','个人研究进展'),d=S.get(id),ids=d.slides.map(page=>page.id);
  assert.match(proposal.summary,/手工新增的页面保留/);
  assert.equal(ids[0],'opening','a page ahead of every outline page stays first');assert.equal(ids[1]===coverPage,cover,'the kept cover page follows it');
  assert.equal(ids.at(-1),'my-experiment','cover='+cover);assert.equal(ids.length,d.outline.length+2);
 }
});
test('R8-REV-1: after an AI restructure that replaces every section, a manual page stays at the end',async()=>{
 let {S,id}=await deck();await S.patch(id,x=>{x.slides.push({id:'my-experiment',title:'我的复现实验',blocks:[],assetIDs:[],status:'user'});});
 S.request=async()=>({value:{summary:'重写结构',sections:[{title:'封面',purpose:'新的封面与汇报范围'},{title:'新的问题定义',purpose:'重新定义问题'},{title:'新的结论',purpose:'给出新的结论'}]},model:'stub',at:'t',cacheHit:false});
 await S.proposeOutline(id,'完全重写结构',()=>{},undefined);await S.acceptOutline(id);await S.prepareSlides(id);
 let d=S.get(id);assert.equal(d.archivedSlides.length,3);assert.deepEqual(d.slides.map(page=>page.outlineID||page.id),[...d.outline.map(row=>row.id),'my-experiment']);
});
test('R8-REV-1: a page whose section was removed goes before the next kept section, and stays there',async()=>{
 let {S,id}=await deck();await S.patch(id,x=>{x.slides.splice(2,0,{id:'after-removed',title:'补充材料',blocks:[],assetIDs:[],status:'user'});});
 await S.editOutline(id,{type:'remove',id:'o1'});await S.editOutline(id,{type:'add',afterID:'o0',row:{id:'added',title:'新增板块',purpose:'新增的讲述任务',sourceIDs:[],diagram:false}});await S.prepareSlides(id);
 let expected=['o0','added','after-removed','o2'];assert.deepEqual(S.get(id).slides.map(page=>page.outlineID||page.id),expected);
 await S.editOutline(id,{type:'update',id:'o2',patch:{purpose:'再改一次'}});await S.prepareSlides(id);
 assert.deepEqual(S.get(id).slides.map(page=>page.outlineID||page.id),expected,'confirming again keeps the order');
});
test('R8-REV-1: a contribution added before the structure is first confirmed follows the outline pages',async()=>{
 let S=await service(),{id}=await S.create([]);
 await S.patch(id,x=>{x.outline=structuredClone(rows);x.materialsReady=true;});
 await S.addContribution(id,{title:'我的实验',text:'实验设置与观察结果。',kind:'my_experiment'});await S.prepareSlides(id);
 let slides=S.get(id).slides;assert.deepEqual(slides.slice(0,3).map(page=>page.outlineID),['o0','o1','o2']);assert.equal(slides[3].title,'我的实验');assert.equal(slides.length,4);
});
test('R8-REV-2: a reply of the wrong shape fails only its own page, with the page check message',async()=>{
 let shapes=[[{blocks:{a:1}},'内容页需要论证内容'],[{blocks:'一段文字'},'内容页需要论证内容'],[{blocks:['一段文字','第二段']},'正文类型无效'],[{blocks:[null]},'正文类型无效'],[null,'内容页需要论证内容'],['一段文字','内容页需要论证内容']];
 for(let [bad,reason] of shapes){
  let {S,id}=await deck(),calls=[],label=JSON.stringify(bad);
  S.request=async(system,input)=>{calls.push(input.outline.title);return {value:input.outline.title!=='板块甲'?valid(input.outline.title):bad&&typeof bad==='object'?{...valid('甲'),...bad}:bad,model:'stub',at:'t',cacheHit:false};};
  let error=await S.generateRemaining(id,()=>{},undefined).then(()=>null,e=>e);
  assert.match(error?.message||'',new RegExp('^1 页未生成（'+reason+'.*）；其余 2 页已生成并保存'),label);
  let slides=S.get(id).slides;assert.deepEqual(slides.map(page=>page.status),['failed','generated','generated'],label);assert.match(slides[0].error,new RegExp('^'+reason),label);
  assert.deepEqual(calls,['板块甲','板块甲','板块乙','板块丙'],label+': the page is retried once, then the run continues');
 }
});
test('R8-REV-2: after a reply of the wrong shape, the retry gets the page check hint and can still succeed',async()=>{
 let {S,id}=await deck(),hints=[];
 S.request=async(system,input)=>{if(input.outline.title==='板块甲'){if(!input.validationError)return {value:{...valid('甲'),blocks:{a:1}},model:'stub',at:'t',cacheHit:false};hints.push(input.validationError);}return {value:valid(input.outline.title),model:'stub',at:'t',cacheHit:false};};
 await S.generateRemaining(id,()=>{},undefined);
 assert.equal(hints.length,1);assert.match(hints[0],/内容页需要论证内容/);assert.deepEqual(S.get(id).slides.map(page=>page.status),['generated','generated','generated']);
});
test('R8-REV-2: assetIDs that are not a list count as no image',async()=>{
 let {S,id}=await deck();S.request=async(system,input)=>({value:{...valid(input.outline.title),assetIDs:'fig-1'},model:'stub',at:'t',cacheHit:false});
 await S.generateRemaining(id,()=>{},undefined);
 let slides=S.get(id).slides;assert.deepEqual(slides.map(page=>page.status),['generated','generated','generated']);assert.equal(slides[0].assetIDs.length,0);
});
test('R8-REV-2: chart content of any shape is refused for its own page only',async()=>{
 for(let diagram of [{diagramType:'data_flow',nodes:5},{diagramType:'data_flow',nodes:[null]},{diagramType:'data_flow',nodes:[{id:'a',label:'甲',evidenceIDs:[]}]}]){
  let {S,id}=await deck(),calls=[],label=JSON.stringify(diagram);
  S.request=async(system,input)=>{calls.push(input.outline.title);return {value:input.outline.title==='板块甲'?{...valid('甲'),diagram}:valid(input.outline.title),model:'stub',at:'t',cacheHit:false};};
  let error=await S.generateRemaining(id,()=>{},undefined).then(()=>null,e=>e);
  assert.match(error?.message||'',/^1 页未生成（AI 返回了图表生成内容/,label);assert.deepEqual(S.get(id).slides.map(page=>page.status),['failed','generated','generated'],label);assert.deepEqual(calls,['板块甲','板块乙','板块丙'],label);
 }
});
test('R8-REV-2: regenerating a page with a reply that has no blocks keeps the old page',async()=>{
 // Before, the new title and notes were saved over the old points, which no longer matched them.
 let {S,id}=await deck();S.request=async(system,input)=>({value:valid(input.outline.title),model:'stub',at:'t',cacheHit:false});await S.generateRemaining(id,()=>{},undefined);
 let before=S.get(id).slides[0],calls=0;S.request=async()=>{calls++;let value=valid('新');delete value.blocks;return {value,model:'stub',at:'t',cacheHit:false};};
 await assert.rejects(S.generatePage(id,before.id,()=>{},undefined,{fresh:true}),error=>/^内容页需要论证内容/.test(error.message)&&error.pageLevel===true);
 assert.equal(calls,2,'retried once with the page check hint');assert.deepEqual(S.get(id).slides[0],before);
});
