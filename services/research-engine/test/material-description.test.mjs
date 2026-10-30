import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import * as sections from '../../../chrome/content/zotero/research/shared/article-section-materials.mjs';
import * as language from '../../../chrome/content/zotero/research/shared/material-language.mjs';
import {filterMaterialExclusions,materialAttachmentIDs} from '../../../chrome/content/zotero/research/shared/material-exclusions.mjs';
const code=await fs.readFile(new URL('../../../chrome/content/zotero/xpcom/research/manuscript-index.js',import.meta.url),'utf8');
function setup(request){const data={},E={manuscripts:{model:{}},assets:{key:values=>values.join('|')},store:{get:(...path)=>path.reduce((v,k)=>v?.[k],data),update:async fn=>fn(data)},studio:{request}};vm.runInNewContext(code,{Zotero:{Research:E,logError:()=>{}},ChromeUtils:{importESModule:uri=>uri.includes('article-section-materials')?sections:language}});return {A:E.manuscripts,data};}
const card=id=>({id,revision:1,title:'English material',sourceText:'A baseline is tested on held-out data.'});
test('waiting for a visible translation does not wait for unrelated background requests',async()=>{
 let release;const held=new Promise(r=>release=r);const {A}=setup(async(_,input)=>{if(input.materials[0].id.startsWith('b|'))await held;return {model:'controlled',value:{summaries:input.materials.map(m=>({id:m.id,title:'基线评估',text:'独立数据用于评估基线。'}))}};});
 const a=card('a'),b=card('b');A.ensureChineseSummaries([a]);const background=A.ensureChineseSummaries([b]);const visible=A.ensureChineseSummaries([a]);
 let timer;try{await Promise.race([visible,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('visible card waited for unrelated work')),200))]);assert.equal(A.summaryFor(a),'独立数据用于评估基线。');}finally{clearTimeout(timer);release();await background;}
});
test('a failed numeric summary does not discard valid cards from the same batch',async()=>{
 const {A}=setup(async(_,input)=>{if(!input.materials)throw Error('controlled retry unavailable');return {model:'controlled',value:{summaries:input.materials.map((m,i)=>({id:m.id,title:'方法',text:i?'准确率为99%。':'独立数据用于评估基线。'}))}};});
 const a=card('a'),b=card('b'),before=JSON.stringify([a,b]);await A.ensureChineseSummaries([a,b]);assert.equal(A.summaryFor(a),'独立数据用于评估基线。');assert.match(A.summaryFor(b),/暂未完成/);assert.equal(JSON.stringify([a,b]),before);
});

test('automatic descriptions use only allowed source text and reuse its cache without reloading native annotations',async()=>{
 const inputs=[],{A}=setup(async(_system,input)=>{inputs.push(input);return {model:'controlled',value:{summaries:input.materials.map(m=>({id:m.id,title:'保留素材',text:'依据保留的原文整理素材。'}))}};}),material={...card('native'),sourceText:'Before OMITTED after.',anchor:{attachmentID:7,pageIndex:0,sourceText:'Before OMITTED after.'}},before=JSON.stringify(material);let loads=0,quote='OMITTED';
 A.materialAttachmentIDs=materialAttachmentIDs;A.prepareMaterialExclusions=async()=>{loads++;};A.filterAutomaticMaterials=(cards,options)=>filterMaterialExclusions(cards,{...options,exclusionsFor:()=>[{annotationKey:'MARK',attachmentID:7,quote,position:{pageIndex:0}}]});
 await A.ensureChineseSummaries([material]);assert.equal(inputs[0].materials[0].text,'Before \n\n after.');assert.equal(JSON.stringify(material),before);assert.equal(loads,1);
 await A.ensureChineseSummaries([material]);assert.equal(inputs.length,1);assert.equal(loads,1,'a cached safe description does not reload the PDF annotation data');
 quote=material.sourceText;await A.ensureChineseSummaries([material]);assert.equal(inputs.length,1,'a completely excluded source is not described again');assert.equal(JSON.stringify(material),before);
});
