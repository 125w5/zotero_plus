/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {validateStudioSlide} from './ppt-model.mjs';

// Planning estimate only: one Han character or one other-language word is a unit.
// Use the longer of visible copy and speaker notes, at 180 units/minute, plus
// 15 seconds per page and 15 for a visible figure/chart. Each page gets >=45s.
// Questions, pauses, demonstrations and speaking style require a timed rehearsal.
export const PRESENTATION_TIMING_ESTIMATE = Object.freeze({
 unitsPerMinute:180,
 minimumPageSeconds:45,
 transitionSeconds:15,
 visualSeconds:15,
 description:'按每分钟 180 个汉字或外文词，取正文与讲稿较长者；每页另留 15 秒，有图表再留 15 秒，每页至少 45 秒。仅供排期，实际时长请以试讲为准。'
});

const rows = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value : '';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function spokenUnits(value){
 const body=text(value),han=body.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g)||[];
 return han.length+(body.replace(/[\u3400-\u4dbf\u4e00-\u9fff]/g,' ').match(/[\p{L}\p{N}]+/gu)||[]).length;
}

// Match the data shape consumed by research-engine/src/plan.mjs without loading
// the artifact engine or its filesystem/image dependencies into this local check.
function datasetProblem(data){
 const bounded=(value,max)=>typeof value==='string'&&!!value.trim()&&value.length<=max;
 if(!bounded(data.id,80)||!bounded(data.provenance,1000))return '数据集缺少有效编号或来源说明';
 if(!Array.isArray(data.labels)||!data.labels.length||data.labels.length>30||data.labels.some(label=>!bounded(label,40)))return '数据分类为空、过多或名称无效';
 if(!Array.isArray(data.series)||!data.series.length||data.series.length>5)return '数据系列为空或超过五组';
 if(data.series.some(series=>!object(series)||!bounded(series.name,50)||!Array.isArray(series.values)||series.values.length!==data.labels.length||series.values.some(value=>typeof value!=='number'||!Number.isFinite(value))))return '数据系列的名称、数值或分类数量不匹配';
 return '';
}

function validationProblem(slide,error){
 if(!object(slide))return {code:'invalid-page',title:'页面数据不完整',detail:'这页不是有效的页面记录，请重新生成或删除后重建。',action:'generate'};
 if(!slide.id)return {code:'missing-id',title:'页面编号缺失',detail:'这页没有用于编辑、预览和导出的编号，请重新生成或删除后重建。',action:'generate'};
 if(typeof slide.title!=='string'||!slide.title.trim()||slide.title.length>80)return {code:'title',title:'修改页面标题',detail:'每页需要 1–80 字的文字标题。',action:'edit'};
 if(!Array.isArray(slide.blocks)||!slide.blocks.length)return {code:'empty-page',title:'页面尚未完成',detail:'本页没有论证内容，请生成本页或补充正文后再导出。',action:'generate'};
 if(rows(slide.blocks).some(block=>object(block)&&Array.isArray(block.evidenceIDs)&&block.evidenceIDs.length)&&/不存在的证据|节点来源不存在/.test(error.message))return {code:'missing-evidence',title:'引用资料已失效',detail:'本页引用了已经移除的证据，请重新关联资料后核对。',action:'materials'};
 if(/所选图片已不存在/.test(error.message))return {code:'missing-asset',title:'配图已失效',detail:'本页选用的图片已不在汇报资料中，请重新选择配图。',action:'materials'};
 if(/缺少可核对的原文/.test(error.message))return {code:'unbound-fact',title:'论文事实缺少原文依据',detail:error.message,action:'edit'};
 return {code:'invalid-content',title:'修正页面内容',detail:error instanceof TypeError?'页面字段或引用格式不完整，请在编辑器中补齐，或重新生成本页。':error.message,action:'edit'};
}

/**
 * Synchronous, read-only report. Errors identify export blockers; warnings never
 * block export. pageIndex is zero-based and remains usable for duplicate IDs.
 * readyPages counts nonempty pages without page errors, including manual pages.
 * No model call, file read, clock, saved-state mutation or automatic regeneration.
 */
export function presentationReadiness(draft={}){
 const d=object(draft)?draft:{},slides=rows(d.slides),sources=rows(d.sources).filter(object),assets=rows(d.assets).filter(object),datasets=rows(d.datasets).filter(object);
 const issues=[],seenIssues=new Set(),counts={errors:0,warnings:0,pendingPages:0,unverifiedPages:0,missingNotesPages:0};
 const add=(code,severity,title,detail,action,pageIndex)=>{
  const id=pageIndex===undefined?code:'page-'+pageIndex+'-'+code;if(seenIssues.has(id))return;seenIssues.add(id);
  const issue={id,severity,title,detail,action};
  if(pageIndex!==undefined){issue.pageIndex=pageIndex;const slideID=slides[pageIndex]?.id;if(typeof slideID==='string'||typeof slideID==='number')issue.slideID=slideID;}
  issues.push(issue);
 };
 if(!text(d.title).trim())add('presentation-title','error','补充汇报名称','导出前请填写这次汇报的名称。','materials');
 if(!slides.length)add('empty-deck','error','还没有汇报页面','先确认大纲并编排页面，也可以加入自己的研究内容页。','outline');
 if(slides.length>50)add('too-many-pages','error','汇报超过 50 页','当前导出支持 1–50 页，请整理大纲并减少页面。','outline');
 const frequencies=new Map(),sourceIDs=new Set(sources.map(row=>row.id)),byAsset=new Map(assets.map(row=>[row.id,row])),byDataset=new Map(datasets.map(row=>[row.id,row]));
 for(const slide of slides)if(slide?.id)frequencies.set(slide.id,(frequencies.get(slide.id)||0)+1);
 let seconds=0;
 for(const [pageIndex,value]of slides.entries()){
  const slide=object(value)?value:{},blocks=rows(slide.blocks),hasContent=blocks.some(block=>text(block?.text).trim()),assetIDs=rows(slide.assetIDs),visible=[text(slide.explanation),...blocks.map(block=>text(block?.text))].join('\n');
  const page=(code,severity,title,detail,action='edit')=>add(code,severity,title,detail,action,pageIndex);
  if(!hasContent)counts.pendingPages++;
  // Use the same required-content validation as the real exporter for EVERY
  // page. A generated status never excuses an empty or otherwise invalid page.
  try{validateStudioSlide(value,sources,assets);}
  catch(error){const problem=validationProblem(value,error);page(problem.code,'error',problem.title,problem.detail,problem.action);}
  if(slide.id&&frequencies.get(slide.id)>1)page('duplicate-id','error','页面编号重复','多个页面使用了相同编号，可能覆盖预览或编辑错页；请删除重复页后重新创建。');
  const missingEvidence=[...new Set([...blocks.flatMap(block=>rows(block?.evidenceIDs)),...rows(slide.diagram?.nodes).flatMap(node=>rows(node?.evidenceIDs))])].filter(id=>!sourceIDs.has(id));
  if(missingEvidence.length)page('missing-evidence','error','引用资料已失效','本页找不到证据 '+missingEvidence.map(String).join('、')+'，请重新关联资料后核对。','materials');
  const missingAssets=assetIDs.filter(id=>!byAsset.has(id));
  if(missingAssets.length)page('missing-asset','error','配图已失效','本页找不到图片 '+missingAssets.map(String).join('、')+'，请重新选择配图。','materials');
  if(assetIDs.some(id=>byAsset.has(id)&&!text(byAsset.get(id).path).trim()))page('asset-path','error','配图缺少文件位置','已选图片没有可供导出的文件位置，请重新导入图片。','materials');
  const dataset=byDataset.get(slide.datasetID);
  if(slide.datasetID){
   if(!dataset)page('missing-dataset','error','图表数据已失效','本页引用的数据集“'+String(slide.datasetID)+'”已不存在，请重新导入数据或移除图表引用。','materials');
   else {const problem=datasetProblem(dataset);if(problem)page('invalid-dataset','error','修正图表数据',problem+'，请在原始数据中补齐后重新导入。','materials');}
  }
  const hasVisual=!!(slide.diagram||assetIDs.some(id=>byAsset.has(id))||dataset),visibleVisual=slide.layout!=='text'&&hasVisual;
  if(hasContent){
   if(slide.layout==='visual'&&!hasVisual)page('missing-visual','warning','补充本页配图','本页选择了原图讲解布局，但还没有图片、示意图或数据图；可选择配图或改为文字布局。');
   if(slide.layout==='comparison'&&!slide.diagram&&!dataset&&new Set(assetIDs.filter(id=>byAsset.has(id))).size<2)page('comparison-visual','warning','补齐对比图片','双图对比布局尚未选齐两张不同的图片，可补图或改用其他布局。');
   const limit=visibleVisual?480:700;
   if(visible.length>limit)page('dense-content','warning','本页内容偏密','可见正文约 '+visible.replace(/\s/g,'').length+' 字，'+(visibleVisual?'还需为图表留出空间':'建议拆分论点')+'；可缩短说明或拆为两页。');
   if(blocks.some(block=>block?.kind==='synthesis'&&!rows(block.evidenceIDs).length))page('unbound-synthesis','warning','归纳尚未关联资料','系统归纳没有关联来源；若是自己的判断，可改为“我的理解”，否则请补充支持材料。');
   if(blocks.some(block=>block?.kind==='unverified')||rows(slide.evidenceWarnings).length){counts.unverifiedPages++;page('unverified','warning','仍有待核验观点','请核对待验证观点及其来源，汇报时区分已知结果与尚待检验的判断。');}
   if(!text(slide.notes).trim()){counts.missingNotesPages++;page('speaker-notes','warning','补充讲述要点','尚未写讲稿，可补充过渡、读图顺序和待讨论问题；这不会阻止导出。');}
  }
  if(slide.status==='failed'&&hasContent)page('generation-failed','warning','上次生成没有完成',text(slide.error)||'已有内容仍保留，请检查本页后决定是否重新生成。','generate');
  const timing=PRESENTATION_TIMING_ESTIMATE,units=Math.max(spokenUnits(visible),spokenUnits(slide.notes));
  seconds+=Math.max(timing.minimumPageSeconds,units/timing.unitsPerMinute*60+timing.transitionSeconds+(visibleVisual?timing.visualSeconds:0));
 }
 const target=Number(d.minutes??d.targetMinutes),targetMinutes=Number.isFinite(target)&&target>0?target:null,estimatedMinutes=Math.round(seconds/6)/10;
 if(targetMinutes!==null&&estimatedMinutes>targetMinutes*1.15)add('over-time','warning','预留时长可能不足','按公开的排期算法估算约 '+estimatedMinutes+' 分钟，高于目标 '+targetMinutes+' 分钟；可合并页面或减少讲述内容，实际以试讲为准。','outline');
 const blockedPages=new Set(issues.filter(issue=>issue.severity==='error'&&issue.pageIndex!==undefined).map(issue=>issue.pageIndex));
 counts.errors=issues.filter(issue=>issue.severity==='error').length;counts.warnings=issues.length-counts.errors;
 issues.sort((a,b)=>(a.severity==='error'?0:1)-(b.severity==='error'?0:1));
 return {totalPages:slides.length,readyPages:slides.filter((slide,index)=>!blockedPages.has(index)&&rows(slide?.blocks).some(block=>text(block?.text).trim())).length,estimatedMinutes,targetMinutes,issues,counts};
}
