/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {sourceQuote} from './source-quote.mjs';
import {annotationPresentation} from './annotation-presentation.mjs';
export const RAPID_VERSION='source-reading-5';
// Reading language can change without reparsing the same local PDF.
export const RAPID_SOURCE_VERSION='source-reading-3';
export const RAPID_SOURCE_LIMITS=Object.freeze({maxChars:160000,maxSources:512,chunkChars:2000});
export const READING_ROLES=['summary','problem','method','results','limitations'];
export const READING_LABELS={summary:'核心概览',problem:'研究问题',method:'方法与原理',results:'结果与证据',limitations:'边界与要点'};
const normalize=value=>String(value||'').replace(/\s+/g,' ').trim();
const bound=(value,fallback)=>Number.isFinite(value)?Math.max(0,Math.floor(value)):fallback;
const pageKey=source=>Number.isInteger(source.pageIndex)&&source.pageIndex>=0?`${source.attachmentID??''}:${source.pageIndex}`:null;
// Sample real, contiguous passages. A fragment never joins distant PDF text.
// Give every available page a slot before adding a second or third passage.
export function selectRapidSources(input,{attachmentID,maxChars=RAPID_SOURCE_LIMITS.maxChars,maxSources=RAPID_SOURCE_LIMITS.maxSources,chunkChars=RAPID_SOURCE_LIMITS.chunkChars}={}){
 maxChars=bound(maxChars,RAPID_SOURCE_LIMITS.maxChars);maxSources=bound(maxSources,RAPID_SOURCE_LIMITS.maxSources);chunkChars=bound(chunkChars,RAPID_SOURCE_LIMITS.chunkChars);
 const seen=new Set(),sources=(Array.isArray(input)?input:[]).filter(source=>{
  if(!source||typeof source.id!=='string'||!source.id.trim()||typeof source.text!=='string'||!source.text.trim()||source.annotationKey||source.annotationID||source.kind==='annotation')return false;
  if(attachmentID!==undefined&&source.attachmentID!=null&&source.attachmentID!==attachmentID||seen.has(source.id))return false;
  seen.add(source.id);return true;
 });
 const totalChars=sources.reduce((sum,source)=>sum+source.text.length,0),pages=new Set(sources.map(pageKey).filter(key=>key!==null));
 const finish=selected=>({sources:selected,coverage:{selectionVersion:RAPID_SOURCE_VERSION,sampled:selected.reduce((sum,source)=>sum+source.text.length,0)<totalChars,availableSources:sources.length,selectedSources:selected.length,totalChars,selectedChars:selected.reduce((sum,source)=>sum+source.text.length,0),availablePages:pages.size,selectedPages:new Set(selected.map(pageKey).filter(key=>key!==null)).size,maxChars,maxSources}});
 if(!maxChars||!maxSources||!chunkChars)return finish([]);
 if(totalChars<=maxChars&&sources.length<=maxSources)return finish(sources.map(source=>({...source})));
 const grouped=new Map();for(const source of sources){const key=pageKey(source)??'source:'+source.id;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(source);}
 // Page order makes the distributed first/middle/last choices reproducible.
 let groups=[...grouped.values()].sort((a,b)=>(pageKey(a[0])===null)-(pageKey(b[0])===null)||(a[0].pageIndex??0)-(b[0].pageIndex??0));
 const capacity=Math.min(maxSources,Math.floor(maxChars/8));if(!capacity||!groups.length)return finish([]);
 if(groups.length>capacity)groups=Array.from({length:capacity},(_,index)=>groups[Math.floor(index*(groups.length-1)/Math.max(1,capacity-1))]);
 const slots=Math.min(capacity,groups.length*3),size=Math.min(chunkChars,Math.floor(maxChars/slots)),selected=[],ranges=new Set(),ids=new Set(sources.map(source=>source.id));let used=0;
 const passage=(group,mode)=>{
  let source,start;
  if(mode===0){source=group[0];start=0;}
  else if(mode===2){source=group.at(-1);start=Math.max(0,source.text.length-size);}
  else{let middle=group.reduce((sum,item)=>sum+item.text.length,0)/2;for(const item of group){source=item;if(middle<=item.text.length)break;middle-=item.text.length;}start=Math.max(0,Math.min(source.text.length-size,Math.floor(middle-size/2)));}
  let end=Math.min(source.text.length,start+size);
  // Avoid cutting words when a nearby whitespace boundary fits the budget.
  if(start>0&&!/\s/u.test(source.text[start-1])){const next=source.text.slice(start,Math.min(end,start+80)).search(/\s/u);if(next>=0)start+=next+1;}
  if(end<source.text.length&&!/\s/u.test(source.text[end])){const previous=source.text.slice(start,end).search(/\s+\S*$/u);if(previous>=Math.floor(size*.8))end=start+previous;}
  const key=JSON.stringify([source.id,start,end]),text=source.text.slice(start,end);if(ranges.has(key)||normalize(text).length<8||selected.length>=maxSources||used+text.length>maxChars)return;
  ranges.add(key);used+=text.length;
  if(start===0&&end===source.text.length){selected.push({...source});return;}
  const base=`${source.id}~rapid-${start}-${end}`;let id=base,suffix=0;while(ids.has(id))id=base+'-'+(++suffix);ids.add(id);
  selected.push({...source,id,text,originSourceID:source.originSourceID||source.id,sourceTextRange:[start,end]});
 };
 for(let round=0;round<3&&selected.length<maxSources;round++)for(const [index,group]of groups.entries())passage(group,(index+round)%3);
 return finish(selected);
}
// Old sampled records remain available for restoring manual edits, but cannot
// silently become the source of a new full-length reading.
export function rapidSourceCacheValid(value){
 const sources=value?.sources,coverage=value?.coverage;
 return Array.isArray(sources)&&sources.length>0&&sources.every(source=>typeof source?.id==='string'&&typeof source.text==='string'&&source.text.trim())&&coverage?.selectionVersion===RAPID_SOURCE_VERSION&&coverage.maxChars===RAPID_SOURCE_LIMITS.maxChars&&coverage.maxSources===RAPID_SOURCE_LIMITS.maxSources&&coverage.selectedSources===sources.length&&coverage.selectedChars===sources.reduce((sum,source)=>sum+source.text.length,0);
}
// Only the client assigns excerpt IDs; the model does not retype PDF quotes.
export function rapidEvidenceExcerpts(sources){
 const excerpts=[];for(const source of sources){if(typeof source?.id!=='string'||typeof source.text!=='string')continue;for(let start=0;start<source.text.length;){let end=Math.min(start+650,source.text.length);if(end<source.text.length){const space=source.text.lastIndexOf(' ',end);if(space>start+520)end=space;}const text=source.text.slice(start,end);if(normalize(text).length>=8)excerpts.push({quoteID:'Q'+(excerpts.length+1),sourceID:source.id,text});start=end;}}
 return excerpts;
}
export function bindRapidReadingEvidence(value,excerpts,sources){
 const known=new Map(sources.map(source=>[source.id,source])),byID=new Map(excerpts.map(excerpt=>[excerpt.quoteID,excerpt]));
 const bind=point=>{
  let references;if(Object.hasOwn(point||{},'quoteIDs'))references=point.quoteIDs;else if(Array.isArray(point?.evidence)&&point.evidence.some(evidence=>Object.hasOwn(evidence||{},'quoteID')))references=point.evidence.map(evidence=>evidence?.quoteID);else return point;
  if(!Array.isArray(references)||!references.length)throw Error('速读说明缺少原文摘录编号');
  const evidence=[...new Set(references)].map(id=>{const excerpt=byID.get(id),source=known.get(excerpt?.sourceID);if(typeof id!=='string'||!excerpt||!source||typeof excerpt.text!=='string'||!source.text.includes(excerpt.text))throw Error('速读选择了不存在或无法核对的原文摘录');return {sourceID:source.id,quote:excerpt.text};});
  return {...point,evidence};
 };
 const sections=Array.isArray(value?.sections)?value.sections.map(section=>({...section,...(section?.brief?{brief:bind(section.brief)}:{}),points:Array.isArray(section?.points)?section.points.map(bind):section?.points})):value?.sections;
 return validateRapidReading({...value,sections},sources);
}
export function rapidModelIdentity(config={}){
 return {endpoint:String(config.endpoint||'').trim().replace(/\/+$/u,''),model:String(config.model||'').trim(),thinkingLevel:String(config.thinkingLevel||'off'),reasoningParameter:String(config.reasoningParameter||'')};
}
// Locations come from evidence sources and extracted assets, never model labels.
export function rapidReadingFlow(record,sources,assets,{attachmentID}={}){
 const matches=item=>attachmentID===undefined||item?.attachmentID==null||item.attachmentID===attachmentID;
 const actualPage=item=>Number.isInteger(item?.pageIndex)&&item.pageIndex>=0?item.pageIndex:null;
 const byID=new Map((Array.isArray(sources)?sources:[]).filter(matches).map(source=>[source?.id,source]));
 const entries=(Array.isArray(record?.sections)?record.sections:[]).map((section,index)=>{
  const pages=(Array.isArray(section?.points)?section.points:[]).flatMap(point=>(Array.isArray(point?.evidence)?point.evidence:[]).map(evidence=>actualPage(byID.get(evidence?.sourceID)))).filter(page=>page!==null);
  return {kind:'section',section,index,pageIndex:pages.length?Math.min(...pages):null};
 });
 const seenObjects=new Set(),seenIDs=new Set();
 for(const [index,asset]of (Array.isArray(assets)?assets:[]).entries()){
  if(!asset||!matches(asset)||seenObjects.has(asset))continue;
  const key=asset.id==null?null:JSON.stringify([asset.attachmentID??null,asset.id]);
  if(key!==null&&seenIDs.has(key))continue;
  seenObjects.add(asset);if(key!==null)seenIDs.add(key);
  entries.push({kind:'asset',asset,index,pageIndex:actualPage(asset)});
 }
 const coordinate=(entry,index)=>Number.isFinite(entry.asset?.bbox?.[index])?entry.asset.bbox[index]:Infinity;
 return entries.sort((a,b)=>{
  if(a.pageIndex===null||b.pageIndex===null)return (a.pageIndex===null)-(b.pageIndex===null);
  if(a.pageIndex!==b.pageIndex)return a.pageIndex-b.pageIndex;
  if(a.kind!==b.kind)return a.kind==='section'?-1:1;
  return a.kind==='asset'?coordinate(a,1)-coordinate(b,1)||coordinate(a,0)-coordinate(b,0):0;
 });
}
// Article layout is derived from verified point evidence, never saved back over
// the model record or the user's local edits. A multi-page topic is split into
// its individual points so it cannot push all later figures to the chapter end.
export function rapidReadingArticleFlow(record,sources,assets,{attachmentID}={}){
 const matches=item=>attachmentID===undefined||item?.attachmentID==null||item.attachmentID===attachmentID;
 const page=item=>Number.isInteger(item?.pageIndex)&&item.pageIndex>=0?item.pageIndex:null;
 const originalSources=(Array.isArray(sources)?sources:[]).filter(matches),originOrder=new Map();
 const byID=new Map(originalSources.map((source,index)=>{const origin=source.originSourceID||source.id;if(!originOrder.has(origin))originOrder.set(origin,index);const offset=Number.isInteger(source.sourceTextRange?.[0])&&source.sourceTextRange[0]>=0?source.sourceTextRange[0]:0;return [source.id,{source,index:originOrder.get(origin),offset}];}));
 const visuals=rapidReadingFlow({sections:[]},sources,assets,{attachmentID}),pageHeights=new Map();for(const entry of visuals)if(entry.pageIndex!==null&&Number.isFinite(entry.asset.pageHeight)&&!pageHeights.has(entry.pageIndex))pageHeights.set(entry.pageIndex,entry.asset.pageHeight);
 const top=source=>{
  if(Number.isFinite(source?.bbox?.[1]))return source.bbox[1];
  const rects=source?.position?.rects,height=source?.pageHeight||pageHeights.get(page(source));
  return Number.isFinite(height)&&rects?.length?height-Math.max(...rects.filter(rect=>Array.isArray(rect)&&Number.isFinite(rect[3])).map(rect=>rect[3])):null;
 };
 const reference=asset=>{
  const match=String(asset.label||'').match(/^(?:图|表|式|公式|figure|fig\.?|table|tab\.?|equation|eq\.?)\s*[(（]?\s*((?:[a-z]{1,2}[.\-]?)?\d+[a-z]?|[ivxlc]+)\s*[)）]?/iu);if(!match)return null;
  const terms=asset.kind==='table'?'表|table|tab\\.?':asset.kind==='formula'?'式|公式|equation|eq\\.?':'图|figure|fig\\.?';
  return new RegExp('(?:'+terms+')\\s*[(（]?\\s*'+match[1].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*[)）]?(?![a-z0-9])','iu');
 };
 const references=new Map(visuals.map(entry=>[entry.asset,reference(entry.asset)]));
 const mentions=(entry,asset)=>{const pattern=references.get(asset);return !!pattern&&pattern.test([entry.point.text,...(entry.point.evidence||[]).map(item=>item.quote)].join('\n'));};
 const points=(Array.isArray(record?.sections)?record.sections:[]).flatMap((section,index)=>(section.points||[]).map((point,pointIndex)=>{
  const evidence=(point.evidence||[]).map(item=>byID.get(item.sourceID)).filter(Boolean),pages=[...new Set(evidence.map(item=>page(item.source)).filter(value=>value!==null))],entry={kind:'point',section,index,point,pointIndex,assets:[],pageIndex:pages.length?Math.min(...pages):null};
  // An explicit figure reference may use several excerpts. Its actual figure
  // page is a stronger location than an introductory excerpt on an earlier page.
  const referenced=visuals.find(item=>pages.includes(item.pageIndex)&&mentions(entry,item.asset));if(referenced)entry.pageIndex=referenced.pageIndex;
  const anchors=evidence.filter(item=>page(item.source)===entry.pageIndex).sort((a,b)=>a.index-b.index||a.offset-b.offset);entry.sourceOrder=anchors[0]?.index??Infinity;entry.sourceOffset=anchors[0]?.offset??0;
  const coordinates=anchors.map(item=>top(item.source)).filter(Number.isFinite);entry.top=coordinates.length?Math.min(...coordinates):null;return entry;
 }));
 const loose=[];
 for(const visual of visuals){
  const candidates=points.filter(entry=>entry.pageIndex!==null&&entry.pageIndex===visual.pageIndex),named=candidates.filter(entry=>mentions(entry,visual.asset)),position=Number.isFinite(visual.asset.bbox?.[1])?visual.asset.bbox[1]:null;
  const near=[...(named.length?named:candidates)].sort((a,b)=>{
   if(position!==null&&a.top!==null&&b.top!==null)return Math.abs(a.top-position)-Math.abs(b.top-position)||a.sourceOrder-b.sourceOrder;
   return a.sourceOrder-b.sourceOrder||a.sourceOffset-b.sourceOffset||a.index-b.index||a.pointIndex-b.pointIndex;
  })[0];
  if(near)near.assets.push(visual.asset);else loose.push({...visual,top:position,sourceOrder:Infinity});
 }
 return [...points,...loose].sort((a,b)=>{
  if(a.pageIndex===null||b.pageIndex===null)return (a.pageIndex===null)-(b.pageIndex===null);
  if(a.pageIndex!==b.pageIndex)return a.pageIndex-b.pageIndex;
  if(a.top!==null&&b.top!==null&&a.top!==b.top)return a.top-b.top;
  if(a.kind!==b.kind)return a.kind==='point'?-1:1;
  return a.sourceOrder-b.sourceOrder||(a.sourceOffset??0)-(b.sourceOffset??0)||a.index-b.index||(a.pointIndex??0)-(b.pointIndex??0);
 });
}
// Briefs are independently authored, evidence-bound orientation notes. They do
// not replace the detailed article. Old manual records get a complete-sentence
// preview, without cutting a number/LaTeX expression or changing their text.
export function rapidReadingBrief(record,role,{textForPoint=point=>point.text,maxPoints=3}={}){
 const rows=[],seen=new Set();for(const [index,section]of (record?.sections||[]).entries()){
  if(section.role!==role)continue;
  if(typeof section.brief?.text==='string'&&section.brief.text.trim()&&section.brief.evidence?.length){
   const text=section.brief.text;if(!seen.has(text)){seen.add(text);rows.push({section,index,point:section.brief,pointIndex:-1,text});if(rows.length>=maxPoints)return rows;}continue;
  }
  for(const [pointIndex,point]of (section.points||[]).entries()){
   if(!point.evidence?.length)continue;const text=textForPoint(point,section,index,pointIndex);if(typeof text!=='string'||!text.trim()||seen.has(text))continue;
   const firstSentence=text.match(/^.*?[。！？](?=\s|[^”’」』）\])]|$)/su)?.[0]||text.split(/\r?\n[\t ]*\r?\n/u)[0];
   // An intact short legacy note is safer than inventing a new summary.
   const preview=text.length>220&&firstSentence?.trim()?firstSentence.trim():text;
   seen.add(preview);rows.push({section,index,point,pointIndex,text:preview});if(rows.length>=maxPoints)return rows;
   break;
  }
 }return rows;
}
// Creator order and supplied names are preserved, including incomplete metadata.
export function rapidAuthorNames(creators,sourceInfoAuthors){
 const text=value=>typeof value==='string'?value.trim():'';
 const author=person=>{
  const type=text(person?.creatorType);if(type)return type.toLowerCase()==='author';
  const id=Number(person?.creatorTypeID);return !Number.isInteger(id)||id<=0||id===1;
 };
 const name=person=>{
  if(typeof person==='string')return text(person);if(!person||typeof person!=='object')return '';
  if(person.fieldMode===1)return text(person.lastName)||text(person.name)||text(person.institution);
  const personal=[text(person.firstName)||text(person.given),text(person.lastName)||text(person.family)].filter(Boolean).join(' ');
  return personal||text(person.name)||text(person.institution);
 };
 const names=(Array.isArray(creators)?creators:[]).filter(author).map(name).filter(Boolean);
 return names.length?names:(Array.isArray(sourceInfoAuthors)?sourceInfoAuthors:[sourceInfoAuthors]).filter(author).map(name).filter(Boolean);
}
// Content identity survives reordering, but changes whenever original evidence does.
export function rapidReadingEditKey(section,_index,point,_pointIndex){
 const evidence=(Array.isArray(point?.evidence)?point.evidence:[]).map(item=>JSON.stringify([item?.sourceID??null,item?.quote??null])).sort();
 return JSON.stringify(['rapid-point-1',section?.role??'',section?.heading??'',point?.text??'',evidence]);
}
export function rapidReadingEditedText(point,edit){
 return typeof edit?.text==='string'&&edit.originalText===point?.text?edit.text:point?.text??'';
}
// Every reading claim must carry a supplied source and an exact source excerpt.
export function validateRapidReading(value,sources){
 const byID=new Map(sources.map(s=>[s.id,s]));
 const pointValue=(point,{brief=false}={})=>{
  if(!point||typeof point.text!=='string'||!normalize(point.text)||point.text.length>(brief?700:5000)||!Array.isArray(point.evidence)||!point.evidence.length)throw Error(brief?'速读概览缺少简要内容或原文依据':'速读说明缺少原文依据');
  const evidence=point.evidence.map(e=>{const source=byID.get(e?.sourceID),quote=sourceQuote(source?.text,e?.quote);if(!source||!quote||normalize(quote).length<8)throw Error('速读依据不能在提供的原文中核对');return {sourceID:source.id,quote};});
  return {text:point.text,evidence};
 };
 if(!Array.isArray(value?.sections)||!value.sections.length||value.sections.length>12)throw Error('速读内容缺少可核对的章节');
 const sections=value.sections.map(section=>{
  if(!section||!READING_ROLES.includes(section.role)||typeof section.heading!=='string'||!normalize(section.heading)||!Array.isArray(section.points)||!section.points.length||section.points.length>12)throw Error('速读章节格式无效');
  const points=section.points.map(point=>pointValue(point));
  return {role:section.role,heading:section.heading,points,...(section.brief?{brief:pointValue(section.brief,{brief:true})}:{})};
 });
 return {sections};
}
export function assetAtPoint(assets,position,toPosition){
 const r=position?.rects?.[0];if(!r)return null;
 return assets.filter(a=>a.pageIndex===position.pageIndex).map(a=>({a,r:toPosition(a)?.rects?.[0]})).filter(({r:box})=>box&&r[0]>=box[0]&&r[0]<=box[2]&&r[1]>=box[1]&&r[1]<=box[3]).sort((a,b)=>(a.r[2]-a.r[0])*(a.r[3]-a.r[1])-(b.r[2]-b.r[0])*(b.r[3]-b.r[1]))[0]?.a||null;
}
export function visibleComments(annotations,linkFor){
 return annotations.filter(a=>a.comment?.trim()).map(a=>({annotation:a,link:linkFor(a.id)})).filter(({annotation:a,link})=>{
  const view=annotationPresentation(a,link);if(view.translation)return !!view.text.trim();
  return !link||a.comment!==link.generatedComment&&!(link.translation&&a.comment.endsWith(link.translation));
 });
}
