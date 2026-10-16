/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {protectedTokens,protectEdit,safeNumbers} from './writing-protection.mjs';
import {sliceRuns} from './richtext.mjs';
import {writingSnapshotHash} from './writing-source-snapshot.mjs';
import {writingWorkflowContext} from './paper-writing-workflow.mjs';
const clone=value=>JSON.parse(JSON.stringify(value));
const stable=value=>value&&typeof value==='object'?Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
const blockTypes=new Set(['paragraph','heading','list','placeholder']);
const originalText=material=>String(material?.sourceText||material?.anchor?.sourceText||'');
const contentOf=block=>clone(block||null);
const legacySourceOf=material=>({id:material.id,revision:material.revision,assetID:material.assetID||'',kind:material.kind,title:material.title||'',paperTitle:material.paperTitle||'',text:originalText(material),anchor:clone(material.anchor||{}),verification:material.verification||'',aiGenerated:!!material.aiGenerated});
const sourceCache=new WeakMap();
const sourceSnapshot=source=>Object.fromEntries(Object.entries(source).filter(([key])=>!['text','anchor'].includes(key)));
const sourceOf=material=>{
 const text=originalText(material),anchor=stable({anchor:material.anchor||{},anchors:material.anchors||[],sourceItemID:material.sourceItemID||null,sourceRecordID:material.sourceRecordID||'',sourceVersion:material.sourceVersion||'',parseVersion:material.parseVersion||'',latex:material.latex||'',sourceRuns:material.sourceRuns||[],sourceBlocks:material.sourceBlocks||[]}),cached=sourceCache.get(material)||{};
 if(cached.text!==text){cached.text=text;cached.textHash=writingSnapshotHash(text);}if(cached.anchor!==anchor){cached.anchor=anchor;cached.anchorHash=writingSnapshotHash(anchor);}sourceCache.set(material,cached);
 return {id:material.id,revision:material.revision,assetID:material.assetID||'',kind:material.kind,title:material.title||'',paperTitle:material.paperTitle||'',sourceType:material.sourceType||'',coverage:material.coverage||'',text,textLength:text.length,textHash:cached.textHash,anchorHash:cached.anchorHash,verification:material.verification||'',aiGenerated:!!material.aiGenerated};
};
const workflowScope=scope=>scope.writingWorkflow?{writingWorkflow:scope.writingWorkflow}:{};
const scopeFingerprint=scope=>writingSnapshotHash(stable({projectID:scope.projectID,title:scope.title,sectionID:scope.sectionID,blockID:scope.blockID,before:scope.before,outline:scope.outline,sources:scope.sources.map(sourceSnapshot),...workflowScope(scope)}));
const legacyFingerprint=(scope,sources=scope.sources)=>stable({projectID:scope.projectID,title:scope.title,sectionID:scope.sectionID,blockID:scope.blockID,before:scope.before,outline:scope.outline,sources,...workflowScope(scope)});
const numbers=text=>String(text).match(/[-+]?\d+(?:\.\d+)?%?/gu)||[];

/** A preview captures actual author text, structure and source versions. UI and
 * scroll state are not manuscript revisions, and are intentionally excluded. */
export function captureWritingPreview(project,{blockID=project.ui?.blockID||'',sectionID=project.ui?.sectionID||'',instruction=''}={}){
 const block=blockID?project.blocks?.find(row=>row.id===blockID):null;
 if(blockID&&!block)throw Error('当前模块已不存在，请重新选择');
 sectionID=block?.sectionID||sectionID||project.sections?.[0]?.id;
 if(!project.sections?.some(row=>row.id===sectionID))throw Error('请选择要装配的章节');
 if(block?.locked)throw Error('当前模块已锁定，请先解锁');
 if(block&&!blockTypes.has(block.type))throw Error('请选择正文段落；原图、表格和公式由插入工具编辑');
 const links=block?.materials?.length?block.materials:(project.blocks||[]).filter(row=>row.sectionID===sectionID).flatMap(row=>row.materials||[]);
 const ids=[...new Set(links.length?links.map(row=>row.id):project.writingWorkflow?[]:(project.materials||[]).map(row=>row.id))];
 const sources=ids.map(id=>(project.materials||[]).find(row=>row.id===id)).filter(row=>row&&row.kind!=='idea'&&originalText(row).trim()).map(sourceOf);
 if(sources.some(row=>row.verification==='stale'))throw Error('关联素材来源有更新，请核验后再生成候选');
 const before=contentOf(block),outline=clone((project.sections||[]).map(row=>({id:row.id,title:row.title||'',purpose:row.purpose||'',headings:(project.blocks||[]).filter(item=>item.sectionID===row.id&&item.type==='heading').map(item=>({id:item.id,text:item.text||''}))})));
 if(!sources.length&&!String(block?.text||'').trim())throw Error(project.writingWorkflow?'请先为本章关联真实素材，或写入需要改写的正文；不会读取其他章节素材':'请先关联真实素材，或写入需要改写的正文');
 const scope={version:2,projectID:project.id,title:project.title||'',sectionID,blockID:block?.id||'',before,outline,sources,instruction:String(instruction).trim().slice(0,4000),mode:String(block?.text||'').trim()?'rewrite':'assemble'};
 if(project.writingWorkflow)scope.writingWorkflow=writingWorkflowContext(project,sectionID,{materialIDs:sources.map(row=>row.id)});
 scope.fingerprint=scopeFingerprint(scope);
 return scope;
}
export function assertWritingPreviewCurrent(project,capture,{selected=false}={}){
 if(project?.id!==capture?.projectID)throw Error('候选与当前论文不一致，请重新生成');
 if(selected&&(String(project.ui?.blockID||'')!==capture.blockID||project.ui?.sectionID!==capture.sectionID))throw Error('当前模块已切换，请回到候选所属模块');
 const current=captureWritingPreview(project,{blockID:capture.blockID,sectionID:capture.sectionID,instruction:capture.instruction});
 const fingerprint=capture.version===1?legacyFingerprint(current,current.sources.map(source=>legacySourceOf(project.materials.find(row=>row.id===source.id)))):current.fingerprint;
 if(fingerprint!==capture.fingerprint)throw Error('正文、结构或来源已变化，请保留现有内容并重新生成候选');
 const capturedFingerprint=capture.version===1?legacyFingerprint(capture):scopeFingerprint(capture);
 if(capturedFingerprint!==capture.fingerprint||capture.sources.some(source=>typeof source.text==='string'&&current.sources.find(row=>row.id===source.id)?.text!==source.text))throw Error('候选快照与当前原文不一致，请重新生成');
 // Persisted candidates retain only actual excerpts. Recheck every exact range
 // against the live original as well as hashing the full source and anchor.
 for(const excerpt of capture.evidenceExcerpts||[]){const source=excerpt.sourceID==='author:'+capture.blockID?current.before?.text:current.sources.find(row=>row.id===excerpt.sourceID)?.text;if(typeof source!=='string'||source.slice(excerpt.start,excerpt.end)!==excerpt.quote)throw Error('候选依据与原文不一致，请重新生成');}
 return current;
}
const tokens=text=>String(text).match(/\s+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}_]+|[^\s]/gu)||[];
/** A bounded word/character diff; text-only operations never become raw HTML. */
export function writingPreviewDiff(before,after){
 const a=tokens(before),b=tokens(after),operations=[];
 const add=(kind,text,start,end)=>{if(!text)return;const last=operations.at(-1);if(last?.kind===kind&&last.beforeEnd===start){last.text+=text;last.beforeEnd=end;}else operations.push({kind,text,beforeStart:start,beforeEnd:end});};
 if(a.length*b.length>4000000){let prefix=0,suffix=0;while(prefix<Math.min(before.length,after.length)&&before[prefix]===after[prefix])prefix++;while(suffix<Math.min(before.length-prefix,after.length-prefix)&&before[before.length-1-suffix]===after[after.length-1-suffix])suffix++;add('equal',before.slice(0,prefix),0,prefix);add('delete',before.slice(prefix,before.length-suffix),prefix,before.length-suffix);add('insert',after.slice(prefix,after.length-suffix),before.length-suffix,before.length-suffix);add('equal',before.slice(before.length-suffix),before.length-suffix,before.length);return operations;}
 const cols=b.length+1,table=new Uint16Array((a.length+1)*cols);
 for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)table[i*cols+j]=a[i]===b[j]?1+table[(i+1)*cols+j+1]:Math.max(table[(i+1)*cols+j],table[i*cols+j+1]);
 let i=0,j=0,offset=0;while(i<a.length||j<b.length){if(i<a.length&&j<b.length&&a[i]===b[j]){add('equal',a[i],offset,offset+a[i].length);offset+=a[i++].length;j++;}else if(j<b.length&&(i===a.length||table[i*cols+j+1]>=table[(i+1)*cols+j]))add('insert',b[j++],offset,offset);else{add('delete',a[i],offset,offset+a[i].length);offset+=a[i++].length;}}
 return operations;
}
export function writingEvidenceExcerpts(capture){
 if(capture.evidenceExcerpts)return clone(capture.evidenceExcerpts);
 const sources=[...capture.sources];if(capture.before?.text?.trim())sources.unshift({id:'author:'+capture.blockID,title:'当前人工正文',text:capture.before.text,kind:'author'});
 if(capture.version===1){const excerpts=[];for(const source of sources){for(let start=0;start<source.text.length;){let end=Math.min(source.text.length,start+1000);if(end<source.text.length){const boundary=source.text.lastIndexOf(' ',end);if(boundary>start+800)end=boundary;}const quote=source.text.slice(start,end);if(quote.trim())excerpts.push({quoteID:'W'+(excerpts.length+1),sourceID:source.id,title:source.title,kind:source.kind,quote,start,end});start=end;if(excerpts.length>=80)return excerpts;}}return excerpts;}
 if(sources.length>80)throw Error('本次关联来源超过 80 份，请在当前章节关联需要比较的素材后重新生成；没有省略来源生成候选。');
 const excerpts=[],offsets=sources.map(()=>0),protectedRanges=sources.map(source=>{try{let offset=0;return protectedTokens(source.text).map(token=>{const start=source.text.indexOf(token,offset);offset=start+token.length;return {start,end:offset};});}catch{return [];}});let remaining=true;
 // One excerpt per source per round: a large first chapter cannot consume the
 // entire budget before a second selected material has been read.
 while(remaining&&excerpts.length<80){remaining=false;for(const [index,source]of sources.entries()){
  const start=offsets[index];if(start>=source.text.length)continue;remaining=true;let end=Math.min(source.text.length,start+1000);if(end<source.text.length){const boundary=source.text.lastIndexOf(' ',end);if(boundary>start+800)end=boundary;}
  const math=protectedRanges[index].find(range=>range.start<end&&range.end>end);if(math){end=math.start>start?math.start:math.end;if(end-start>4000)throw Error('原式超过本次摘录容量，请单独关联该公式后再准备正文候选；没有截断公式生成候选。');}
  const quote=source.text.slice(start,end);if(quote.trim())excerpts.push({quoteID:'W'+(excerpts.length+1),sourceID:source.id,title:source.title,kind:source.kind,sourceType:source.sourceType||'',coverage:source.coverage||'',quote,start,end});offsets[index]=end;if(excerpts.length>=80)break;
 }}
 return excerpts;
}
export function writingEvidenceCoverage(capture,excerpts=writingEvidenceExcerpts(capture)){
 if(capture.readingCoverage)return clone(capture.readingCoverage);
 const sources=[...capture.sources];if(capture.before?.text?.trim())sources.unshift({id:'author:'+capture.blockID,title:'当前人工正文',text:capture.before.text,kind:'author'});
 return sources.map(source=>{const ranges=excerpts.filter(row=>row.sourceID===source.id).map(row=>({start:row.start,end:row.end})),readCharacters=ranges.reduce((total,row)=>total+row.end-row.start,0),totalCharacters=source.text.length;return {sourceID:source.id,title:source.title,kind:source.kind,totalCharacters,readCharacters,truncated:readCharacters<totalCharacters,ranges};});
}
function storedCapture(capture,excerpts,usedQuoteIDs){
 const result={...capture,version:2,sources:capture.sources.map(source=>source.text===undefined?clone(source):sourceSnapshot(source)),evidenceExcerpts:excerpts.filter(row=>usedQuoteIDs.has(row.quoteID)).map(clone),readingCoverage:writingEvidenceCoverage(capture,excerpts)};
 // Legacy captures can still be adopted with their original strict comparison.
 // Their large literal fingerprint is reduced only after regenerating against
 // the current project; editing an old candidate retains version 1 safely.
 if(capture.version===1){result.version=1;result.sources=clone(capture.sources);}else result.fingerprint=scopeFingerprint(result);
 return result;
}
export function validateWritingPreview(capture,value,{id='writing-'+Date.now(),model='',thinkingLevel='off'}={}){
 if(!Array.isArray(value?.variants)||value.variants.length<2||value.variants.length>4)throw Error('需返回至少两个可比较的候选版本');
 const excerpts=writingEvidenceExcerpts(capture),byID=new Map(excerpts.map(row=>[row.quoteID,row])),seen=new Set(),before=capture.before?.text||'';
 const variants=value.variants.map((variant,index)=>{
  const text=typeof variant?.text==='string'?variant.text.trim():'';if(!text||text.length>16000||seen.has(text))throw Error('候选正文为空、过长或版本重复');seen.add(text);
  if(!Array.isArray(variant.quoteIDs)||!variant.quoteIDs.length)throw Error('候选缺少可以核对的依据');
  const evidence=[...new Set(variant.quoteIDs)].map(quoteID=>{const row=byID.get(quoteID);if(!row)throw Error('候选引用了不存在的原文依据');return {...row};});
  if(capture.mode==='rewrite'){protectEdit(before,text);safeNumbers(before,text);}
  const actual=evidence.map(row=>row.quote).join('\n')+'\n'+before,allowed=new Set(numbers(actual));if(numbers(text).some(number=>!allowed.has(number)))throw Error('候选引入了依据中没有的数字，未保存');
  const commands=protectedTokens(text),known=new Set([...protectedTokens(before),...evidence.flatMap(row=>protectedTokens(row.quote))]);if(commands.some(token=>!known.has(token)))throw Error('候选改变或引入了无法核对的公式，请保留原式');
  return {id:id+'-'+index,label:String(variant.label||'方案 '+(index+1)).slice(0,60),text,evidence,diff:writingPreviewDiff(before,text)};
 });
 const usedQuoteIDs=new Set(variants.flatMap(row=>row.evidence.map(excerpt=>excerpt.quoteID)));
 return {id,kind:'assembly-writing-preview',version:1,blockID:capture.blockID,sectionID:capture.sectionID,capture:storedCapture(capture,excerpts,usedQuoteIDs),variants,status:'pending',selectedVariantID:variants[0].id,model,thinkingLevel,createdAt:new Date().toISOString()};
}
export function latestWritingPreview(project,blockID=project.ui?.blockID||'',sectionID=project.ui?.sectionID||''){
 return [...(project.proposals||[])].reverse().find(row=>row.kind==='assembly-writing-preview'&&(row.blockID===blockID||row.appliedBlockID===blockID)&&row.sectionID===sectionID)||null;
}
/** Keeps formatting on unchanged author text. New words inherit the adjacent
 * text style; protected math and source bindings remain exactly unchanged. */
export function writingPreviewRuns(before,variant){
 if(!before?.runs?.length)return undefined;const runs=[];
 for(const part of writingPreviewDiff(before.text||'',variant.text)){if(part.kind==='delete')continue;if(part.kind==='equal')runs.push(...sliceRuns(before.runs,part.beforeStart,part.beforeEnd));else{const adjacent=sliceRuns(before.runs,Math.max(0,part.beforeStart-1),Math.max(1,part.beforeStart))[0]||{};runs.push({...adjacent,text:part.text});}}
 return runs;
}
/** Only an explicit UI selection may call this. Model services return previews
 * and have no reference to this mutation path. */
export function applyWritingPreview(project,preview,variantID,{confirmed=false,createBlock}={}){
 if(confirmed!==true)throw Error('请先选择候选并确认采用');if(preview.status!=='pending')throw Error('此候选已处理，请重新生成');
 assertWritingPreviewCurrent(project,preview.capture,{selected:true});const variant=preview.variants.find(row=>row.id===variantID);if(!variant)throw Error('请选择要采用的候选版本');
 let block=project.blocks.find(row=>row.id===preview.blockID);preview.beforeApplied=contentOf(block);
 if(!block){if(typeof createBlock!=='function')throw Error('无法创建当前章节的正文模块');block=createBlock('paragraph',preview.sectionID);const end=project.blocks.reduce((last,row,index)=>row.sectionID===preview.sectionID?index+1:last,0);project.blocks.splice(end,0,block);preview.createdBlockID=block.id;project.ui.blockID=block.id;}
 if(block.type==='placeholder')block.type='paragraph';
 block.text=variant.text;const runs=writingPreviewRuns(preview.beforeApplied,variant);if(runs)block.runs=runs;
 if(!block.materials?.length)block.materials=preview.capture.sources.filter(source=>variant.evidence.some(row=>row.sourceID===source.id)).map(source=>({id:source.id,revision:source.revision,role:'support'}));
 const evidence=(block.evidence||[]).map(clone);for(const row of variant.evidence){const source=preview.capture.sources.find(item=>item.id===row.sourceID);if(source&&!evidence.some(item=>item.materialID===source.id&&item.quote===row.quote))evidence.push({materialID:source.id,quote:row.quote,revision:source.revision});}if(evidence.length)block.evidence=evidence;
 block.revision=(block.revision||0)+1;block.review='missing';preview.status='accepted';preview.selectedVariantID=variantID;preview.appliedBlockID=block.id;preview.appliedContent=contentOf(block);preview.appliedAt=new Date().toISOString();return block;
}
export function revertWritingPreview(project,preview,{confirmed=false}={}){
 if(!confirmed||preview.status!=='accepted')throw Error('请选择已采用的候选进行还原');const block=project.blocks.find(row=>row.id===preview.appliedBlockID);
 if(!block||block.locked||stable(contentOf(block))!==stable(preview.appliedContent))throw Error('采用后已有人工修改或模块锁定，不能覆盖；请用编辑器撤销或手动调整');
 if(preview.createdBlockID)project.blocks.splice(project.blocks.indexOf(block),1);else{for(const key of Object.keys(block))delete block[key];Object.assign(block,clone(preview.beforeApplied));}
 project.ui.blockID=preview.beforeApplied?.id||'';project.ui.sectionID=preview.sectionID;preview.status='reverted';return project;
}
export function writingResultContext(project){
 const preview=latestWritingPreview(project);if(!preview)return null;const selected=preview.variants.find(row=>row.id===preview.selectedVariantID)||preview.variants[0];
 return {previewID:preview.id,status:preview.status,blockID:preview.appliedBlockID||preview.blockID,sectionID:preview.sectionID,mode:preview.capture.mode,variantLabels:preview.variants.map(row=>row.label),selectedText:(selected?.text||'').slice(0,8000),sources:[...new Set(selected?.evidence.map(row=>row.sourceID)||[])],instruction:preview.capture.instruction};
}
