/* SPDX-License-Identifier: AGPL-3.0-or-later */
// PPT export gaps: JPEG pages, source-type captions and footers, one notes text per
// page, and an export folder that receives only the named PPTX.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import JSZip from 'jszip';
import {renderStudioDeck} from '../src/studio-render.mjs';
import * as model from '../../../chrome/content/zotero/research/shared/ppt-model.mjs';
import {presentationReadiness} from '../../../chrome/content/zotero/research/shared/ppt-readiness.mjs';

const jpegFixture=new URL('../../../test/tests/data/test.jpg',import.meta.url);
async function folder(t){const value=await fs.mkdtemp(path.join(os.tmpdir(),'ppt-gap-export-'));t.after(()=>fs.rm(value,{recursive:true,force:true}));return value;}
const textPage=(id,extra={})=>({id,title:'测试页面',explanation:'只验证导出文件结构。',layout:'balanced',blocks:[{kind:'my_interpretation',text:'测试正文，不代表研究结论。',evidenceIDs:[]}],assetIDs:[],notes:'测试讲稿。',...extra});
async function slideXML(result,name='ppt/slides/slide1.xml'){const zip=await JSZip.loadAsync(await fs.readFile(result.path));return {zip,xml:await zip.file(name).async('string')};}

test('PPT-03: a JPEG page passes the export check and exports with the image embedded',async t=>{
 const directory=await folder(t),image=path.join(directory,'generated.jpg');await fs.copyFile(jpegFixture,image);
 const asset={id:'generated-1',kind:'user_image',sourceType:'ai-illustration',label:'研究流程构想',path:image,thumbnail:image};
 const slide=textPage('jpeg-page',{assetIDs:[asset.id]}),draft={title:'JPEG 导出',slides:[slide],sources:[],assets:[asset],datasets:[]};
 assert.equal(presentationReadiness(draft).counts.errors,0);
 const result=await renderStudioDeck({plan:{version:3,title:draft.title,slides:[slide]},evidence:[],assets:[asset],directory});
 const {zip,xml}=await slideXML(result),media=Object.keys(zip.files).filter(name=>name.startsWith('ppt/media/')&&!zip.files[name].dir);
 assert.equal(media.length,1,'the picture is embedded');
 const bytes=await zip.file(media[0]).async('uint8array');assert.deepEqual([...bytes.slice(0,3)],[0xff,0xd8,0xff],'JPEG bytes are kept as JPEG');
 assert.match(xml,/AI 构想图/);assert.doesNotMatch(xml,/我的实验/,'PPT-11: an AI illustration is not captioned as my experiment');
});
test('PPT-03: an image the exporter cannot embed or convert is reported before export',()=>{
 const page=textPage('tiff',{assetIDs:['scan']}),draft=format=>({title:'格式检查',slides:[page],sources:[],assets:[{id:'scan',kind:'user_image',label:'扫描件',path:'/images/scan.'+format}],datasets:[]});
 const issue=presentationReadiness(draft('tiff')).issues.find(row=>row.id.endsWith('asset-format'));
 assert.ok(issue,'TIFF is an export error');assert.equal(issue.severity,'error');assert.match(issue.detail,/扫描件/);
 for(const format of ['png','jpg','jpeg','webp'])assert.equal(presentationReadiness(draft(format)).counts.errors,0,format);
});
test('PPT-11: captions name the source type of each image',()=>{
 assert.equal(model.assetSourceLabel({kind:'user_image',sourceType:'ai-illustration'}),'AI 构想图');
 assert.equal(model.assetSourceLabel({kind:'user_image',sourceType:'user'}),'我的图片');
 assert.equal(model.assetSourceLabel({kind:'user_image',paperTitle:'我的实验'}),'我的实验','the 导入图片 path stays an experiment image');
 assert.equal(model.assetSourceLabel({kind:'figure',label:'Figure 2'}),'Figure 2');
});
test('PPT-20: footers name record types, notes skip a missing URI, and diagram notes are a separate paragraph',async t=>{
 const directory=await folder(t),record={id:'read-1',label:'论文A',text:'阅读论文',sourceType:'reading'};
 const diagram={diagramType:'method_pipeline',title:'流程',nodes:[{id:'a',label:'输入',evidenceIDs:['read-1']},{id:'b',label:'分类',evidenceIDs:['read-1']}],edges:[{source:'a',target:'b',relation:'处理'}]};
 const slide=textPage('weekly',{blocks:[{kind:'my_interpretation',text:'本周阅读了论文A。',evidenceIDs:['read-1']}],diagram,notes:'测试讲稿'});
 const result=await renderStudioDeck({plan:{version:3,title:'周报',slides:[slide]},evidence:[record],directory});
 const {zip,xml}=await slideXML(result),notes=await zip.file('ppt/notesSlides/notesSlide1.xml').async('string');
 assert.match(xml,/阅读记录/);assert.doesNotMatch(xml,/题录/,'a weekly record is not a bibliographic entry');
 assert.doesNotMatch(notes,/undefined/);assert.match(notes,/read-1/);
 assert.doesNotMatch(notes,/见正文解释测试讲稿/,'diagram notes do not run into the speaker notes');
 assert.ok(notes.indexOf('测试讲稿')<notes.indexOf('示意图节点解释'),'speaker notes come first');
});
test('PPT-19: an export with a work folder publishes only a PPTX named after the report',async t=>{
 const root=await folder(t),output=path.join(root,'chosen'),work=path.join(root,'work');await fs.mkdir(output);await fs.mkdir(work);
 const slide=textPage('cli-page'),request={operation:'export',directory:output,workRoot:work,plan:{version:3,title:'组会：方法/对比?',slides:[slide]},record:{sources:[]},assets:[],datasets:[]};
 const run=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[fileURLToPath(new URL('../src/cli.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe']});let out='';child.stdout.on('data',chunk=>out+=chunk);child.stderr.resume();child.on('error',reject);child.on('close',()=>resolve(out.trim().split('\n').map(line=>JSON.parse(line)).find(event=>event.type==='result'||event.type==='error')));child.stdin.end(JSON.stringify(request));});
 const first=await run();assert.equal(first.type,'result',first.message);
 assert.deepEqual(await fs.readdir(output),['组会：方法-对比-.pptx'],'only the PPTX reaches the chosen folder');
 assert.equal(first.value.path,path.join(output,'组会：方法-对比-.pptx'));
 const jobs=await fs.readdir(work);assert.equal(jobs.length,1);assert.ok((await fs.readdir(path.join(work,jobs[0]))).includes('evidence.json'),'audit files stay in the work folder');
 const second=await run();assert.equal(second.value.path,path.join(output,'组会：方法-对比- (2).pptx'),'an existing file is not overwritten');
 const {deckFileName}=await import('../src/deck-files.mjs');assert.equal(deckFileName('CON'),'组会汇报');assert.equal(deckFileName('  '),'组会汇报');
});
