/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as M from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import * as Policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';

async function fixture(){
 const p=M.createProject('未完成的真实稿件');p.blocks=[M.block('paragraph',p.sections[0].id,{text:'已记录测量条件，独立验证尚未完成。'})];const requests=[];
 const E={store:{get:()=>({})},settings:()=>({pandoc:'/runtime/pandoc'}),runArtifactEngine:async request=>{requests.push(request);return {path:'/output/manuscript.docx'};}};
 const context=vm.createContext({Zotero:{Research:E,Prefs:{get:()=>'/runtime/python'},Items:{getAsync:async()=>null}},ChromeUtils:{importESModule:url=>url.includes('manuscript-model')?M:Policy},IOUtils:{exists:async path=>path!=='/missing/image.png'}});
 vm.runInContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/manuscript.js',import.meta.url),'utf8'),context);
 return {p,A:E.manuscripts,requests};
}

test('partial manuscript export omits only blank writing cards and preserves the editable project and authored text',async()=>{
 const f=await fixture();f.p.blocks.push(M.block('paragraph',f.p.sections[0].id,{materials:[]}),M.block('placeholder',f.p.sections[1].id,{requirements:'以后补充独立验证'}));const before=JSON.stringify(f.p);
 const exported=await f.A.export(f.p,'/output');assert.equal(exported.path,'/output/manuscript.docx');assert.equal(exported.exportWarnings.length,2);assert.equal(f.requests.length,1);
 assert.equal(f.requests[0].operation,'manuscript-export');assert.equal(f.requests[0].project.blocks.length,1);assert.equal(f.requests[0].project.blocks[0].text,f.p.blocks[0].text);assert.equal(JSON.stringify(f.p),before);
});

test('a project with only blank cards remains non-exportable',async()=>{
 const f=await fixture();f.p.blocks=[M.block('placeholder',f.p.sections[0].id)];await assert.rejects(f.A.export(f.p,'/output'),/尚未装配内容/);assert.equal(f.requests.length,0);
});

test('partial-draft export retains source-conflict, missing-image and invalid-citation protection',async()=>{
 for(const setup of [p=>{p.blocks[0].review='conflict';},p=>{p.blocks.push(M.block('image',p.sections[0].id,{imagePath:'/missing/image.png'}));},p=>{p.blocks.push(M.block('citation',p.sections[0].id,{citationItemID:123}));}]){
  const f=await fixture();setup(f.p);await assert.rejects(f.A.export(f.p,'/output'),/检查项/);assert.equal(f.requests.length,0);
 }
});

test('a populated pending task card is not silently published as manuscript prose',async()=>{
 const f=await fixture();f.p.blocks.push(M.block('placeholder',f.p.sections[0].id,{text:'待补的具体写作要求'}));await assert.rejects(f.A.export(f.p,'/output'),/有待填写/);assert.equal(f.requests.length,0);
});

async function exportUI({current=false,issues=[]}={}){
 const p=M.createProject('已有初稿');p.blocks=[M.block('paragraph',p.sections[0].id,{text:'这是一段已写正文。'})];const calls=[],messages=[],controls=new Map(['cancel-ai','cancel-task'].map(id=>[id,{}]));
 const U={p,A:{check:async()=>issues,assessment:()=>({}),export:async()=>{calls.push('manuscript');return {path:'/output/manuscript.docx'};},exportBundle:async()=>{calls.push('bundle');return {path:'/output/manuscript.docx',planPath:'/output/plan.docx',directory:'/output'};}},E:{pick:async()=>{calls.push('folder');return '/output';}},workflow:{setStep:async value=>calls.push('stage-'+value),render:()=>{}}};
 const source=await readFile(new URL('../../chrome/content/zotero/research/manuscript/main.mjs',import.meta.url),'utf8'),start=source.indexOf('export async function exportDoc('),end=source.indexOf('\nasync function aiSubmit(',start);
 const context=vm.createContext({U,persist:async()=>{},status:(text,error)=>messages.push({text,error}),$:id=>controls.get(id),isCurrentAssessment:()=>current,AbortController,window:{}});
 vm.runInContext(source.slice(start,end).replace('export async function','async function')+';globalThis.runExport=exportDoc;',context);
 return {run:context.runExport,U,calls,messages};
}

test('the main export action saves unassessed prose and reports unfinished cards instead of demanding AI evaluation',async()=>{
 const f=await exportUI({issues:[{message:'有待填写的内容',severity:'warning'}]});await f.run(false);assert.deepEqual(f.calls,['folder','manuscript']);assert.ok(f.messages.some(row=>row.text.includes('未写入文档')));assert.equal(f.U.lastExport.path,'/output/manuscript.docx');
});

test('explicit prose-only export does not attach a plan while stale-plan requests give an actionable route',async()=>{
 const f=await exportUI({current:true});await f.run(false,{includePlan:false});assert.deepEqual(f.calls,['folder','manuscript']);
 const stale=await exportUI();await stale.run(false,{includePlan:true});assert.deepEqual(stale.calls,['stage-3']);assert.ok(stale.messages.some(row=>row.text.includes('直接导出当前正文')));
});
