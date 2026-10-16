/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Policy from '../../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Layout from '../../../chrome/content/zotero/research/shared/manuscript-layout.mjs';
import * as M from '../../../chrome/content/zotero/research/shared/manuscript-model.mjs';
const code=await readFile(new URL('../../../chrome/content/zotero/xpcom/research/manuscript-automation.js',import.meta.url),'utf8');
function setup(){const p=M.createProject('研究'),b=M.block('paragraph',p.sections[0].id,{text:'只保留用户写作',materials:[]});p.blocks.push(b);const inputs=[],E={manuscripts:{model:M},studio:{request:async(_,input)=>{inputs.push(input);return {value:{sectionOrder:p.sections.map(s=>s.id),blockOrder:[b.id],materialOrder:[],reasons:[]},model:'fixture'};}}};vm.runInNewContext(code,{Zotero:{Research:E},ChromeUtils:{importESModule:uri=>uri.endsWith('/research-ai-policy.mjs')?Policy:Layout}});return {E,p,b,inputs};}
test('legacy coauthor is disabled before search/read/tool or provider execution',async()=>{const {E,p,b,inputs}=setup();await assert.rejects(E.manuscripts.coauthor(p,b.id,'说明方法',()=>{}),/AI 不代写/);assert.equal(inputs.length,0);assert.equal(b.text,'只保留用户写作');});
test('cancelled layout requests stop before provider and preserve the draft',async()=>{const {E,p,inputs}=setup(),before=JSON.stringify(p);await assert.rejects(E.manuscripts.organize(p,'整理布局',()=>{},{aborted:true}),/取消/);assert.equal(inputs.length,0);assert.equal(JSON.stringify(p),before);});
test('layout mode rejects requested authorship or illustration before provider',async()=>{const {E,p,inputs}=setup();await assert.rejects(E.manuscripts.organize(p,'帮我写论文'),/AI 不代写/);await assert.rejects(E.manuscripts.organize(p,'生成一张流程图'),/AI 不生成/);assert.equal(inputs.length,0);});
test('partial layout gets one exact-ID repair and keeps every authored object untouched',async()=>{
 const {E,p,b}=setup(),before=JSON.stringify(p),calls=[],progress=[];
 E.studio.request=async(system,input,_status,_signal,options)=>{
  calls.push({system,input,options});
  if(calls.length===1)return {value:{sectionOrder:[p.sections[0].id],blockOrder:[b.id,b.id,'fabricated prose'],materialOrder:[],reasons:[]},model:'configured'};
  return {value:{sectionOrder:p.sections.map(row=>row.id).reverse(),blockOrder:[b.id],materialOrder:[],reasons:[]},model:'configured'};
 };
 const proposal=await E.manuscripts.organize(p,'整理布局',value=>progress.push(value));
 assert.equal(calls.length,2);assert.equal(proposal.model,'configured');assert.equal(JSON.stringify(p),before);assert.deepEqual(proposal.blockOrder,[b.id]);
 assert.deepEqual(calls[0].input.outputContract,Layout.layoutResponseContract(p));assert.ok(calls[1].input.repair.issues.find(row=>row.field==='sectionOrder').missing.length>0);
 assert.deepEqual(calls[1].input.repair.issues.find(row=>row.field==='blockOrder').duplicate,[b.id]);assert.ok(!JSON.stringify(calls[1].input.repair).includes('fabricated prose'));
 assert.match(progress.at(-1),/校正一次/);assert.equal(calls[1].options.fresh,true);
});
test('repeated incomplete layout has an actionable failure without accepting invented content or retrying indefinitely',async()=>{
 const {E,p}=setup(),before=JSON.stringify(p);let count=0;
 E.studio.request=async()=>{count++;return {value:{sectionOrder:[],blockOrder:[],materialOrder:[],text:'invented manuscript'},model:'configured'};};
 await assert.rejects(E.manuscripts.organize(p,'整理布局'),error=>error.code==='LAYOUT_INCOMPLETE'&&/现有正文、素材和顺序已保留/.test(error.message)&&/具体章节/.test(error.message));
 assert.equal(count,2);assert.equal(JSON.stringify(p),before);
});
test('network failure and cancellation during layout are not mistaken for repairable identity output',async()=>{
 const {E,p}=setup();let count=0;
 E.studio.request=async()=>{count++;throw Error('controlled network failure');};
 await assert.rejects(E.manuscripts.organize(p),/controlled network failure/);assert.equal(count,1);
 const controller=new AbortController();count=0;E.studio.request=async()=>{count++;controller.abort();return {value:{},model:'configured'};};
 await assert.rejects(E.manuscripts.organize(p,'',()=>{},controller.signal),/取消/);assert.equal(count,1);
});
