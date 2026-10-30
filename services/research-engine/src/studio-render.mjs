/* SPDX-License-Identifier: AGPL-3.0-or-later */
import pptxgen from 'pptxgenjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import {validateStudioPlan,themeFor,TYPE_COLORS,BLOCK_TYPES,meetingText,assetSourceLabel} from '../../../chrome/content/zotero/research/shared/ppt-model.mjs';
import {layoutDiagram,diagramSVG,diagramDrawio} from './studio-diagram.mjs';
import {renderDataChart} from './data-charts.mjs';
import {validateDataset} from './plan.mjs';
import {finalizePresentation} from './presentation-package.mjs';
// PowerPoint and LibreOffice embed PNG and JPEG directly. Other formats are
// converted to PNG by the caller before export; the signature decides, not the name.
const imageType=buffer=>buffer.subarray(0,8).toString('hex')==='89504e470d0a1a0a'?'png':buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff?'jpeg':null;
function jpegSize(buffer){
 for(let i=2;i+9<buffer.length;){
  if(buffer[i]!==0xff){i++;continue;}
  const marker=buffer[i+1];if(marker===0xff){i++;continue;}
  if(marker===0xd8||marker===0x01||marker>=0xd0&&marker<=0xd7){i+=2;continue;}
  if(marker===0xd9||marker===0xda)break;
  const length=buffer.readUInt16BE(i+2);
  if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker))return {height:buffer.readUInt16BE(i+5),width:buffer.readUInt16BE(i+7)};
  i+=2+length;
 }
 return null;
}
const SOURCE_TAGS={reading:'阅读记录',import:'新增文献',note:'笔记',annotation:'批注',analysis:'阅读整理',writing:'写作进展',experiment:'实验记录',interpretation:'我的理解',plan:'计划',discussion:'研究讨论'};
const sourceTag=e=>Number.isInteger(e.pageIndex)?'原文 p.'+(e.pageIndex+1):String(e.id||'').startsWith('meta-')?'题录':SOURCE_TAGS[e.sourceType]||(e.conversationFileID?'研究文件':'资料');
export async function renderStudioDeck({plan,evidence,assets=[],datasets=[],directory}) {
 validateStudioPlan(plan,evidence,assets);
 const theme=themeFor(plan),ppt=new pptxgen(),warnings=[],byID=new Map(assets.map(a=>[a.id,a]));
 ppt.layout='LAYOUT_WIDE';ppt.author='EasySch';ppt.title=plan.title;ppt.theme={headFontFace:theme.font,bodyFontFace:theme.font,lang:'zh-CN'};
 ppt.defineSlideMaster({title:'ACADEMIC',background:{color:theme.bg},objects:[{line:{x:.55,y:1.35,w:12.2,h:0,line:{color:theme.accent,width:1}}}]});
 for(const [index,s] of plan.slides.entries()){
  const slide=ppt.addSlide({masterName:'ACADEMIC'});slide.background={color:theme.bg};let diagramNotes='';
  const titleSlot=theme.slots?.find(p=>['title','ctrTitle'].includes(p.type)&&p.x>=0&&p.y>=0&&p.w>5&&p.x+p.w<=13.34&&p.y+p.h<=1.4);
  slide.addText(meetingText(s.title),{x:titleSlot?.x??.6,y:titleSlot?.y??.4,w:titleSlot?.w??12.1,h:Math.min(titleSlot?.h||.8,.85),fontSize:27,bold:true,color:theme.text,margin:0,breakLine:false});
  const hasVisual=!!(s.diagram||s.assetIDs?.length||s.datasetID),wideDiagram=!!s.diagram&&s.diagram.nodes.length>4,comparisonVisual=s.layout==='comparison'&&s.assetIDs?.length>1&&!s.diagram&&!s.datasetID,left=wideDiagram?{x:.6,y:2,w:12.1,h:2.4}:comparisonVisual?{x:.6,y:2,w:12.1,h:2.8}:{x:.6,y:2,w:6.4,h:4.3};
  const compared=(s.assetIDs||[]).slice(0,2).map(id=>byID.get(id)),tallComparison=comparisonVisual&&s.blocks.length<=4&&compared[0]?.width/compared[0]?.height>1.7&&compared[1]?.width/compared[1]?.height<1.5;
  if(s.layout==='visual'&&!s.diagram&&!s.datasetID)left.w=7.8;
  slide.addText(meetingText(s.explanation),{x:.65,y:1.48,w:12,h:.48,fontSize:18,color:theme.accent,margin:0,bold:true});
  let bodyX=hasVisual&&s.layout!=='text'?7.35:.8,bodyW=hasVisual&&s.layout!=='text'?5.2:11.6;
  if(s.layout==='visual'&&!s.diagram&&!s.datasetID){bodyX=8.7;bodyW=3.95;}
  const count=s.blocks.length,h=Math.min(1.02,4.65/Math.max(1,count));
  for(const [i,b] of s.blocks.entries()){
   const columns=wideDiagram||comparisonVisual,y=tallComparison?4.85+i*.46:comparisonVisual?5.12+Math.floor(i/2)*.56:wideDiagram?4.6+Math.floor(i/2)*.65:2.02+i*h,x=tallComparison?.7:columns?.7+(i%2)*6.2:bodyX,w=columns?5.85:bodyW;
   // Provenance labels remain in speaker notes, not repeated over every paragraph.
   const separateLabel=b.kind==='unverified'&&!columns;
   if(separateLabel)slide.addText('待验证',{x,y,w,h:.2,fontSize:10,color:TYPE_COLORS[b.kind],bold:true,margin:0});
   slide.addText((columns&&b.kind==='unverified'?'待验证：':'')+meetingText(b.text),{x,y:y+(separateLabel?.22:0),w,h:tallComparison?.44:columns?.48:h-(separateLabel?.28:.06),fontSize:comparisonVisual?13.5:wideDiagram?13:s.layout==='visual'?14:hasVisual?16:19,color:theme.text,margin:0,breakLine:false});
  }
  if(s.diagram&&s.layout!=='text'){
   const g=await layoutDiagram(s.diagram),scale=Math.min(left.w/g.width,left.h/g.height),dx=left.x+(left.w-g.width*scale)/2,dy=left.y+(left.h-g.height*scale)/2;
   for(const e of g.edges){for(let i=1;i<e.points.length;i++){let a=e.points[i-1],b=e.points[i];slide.addShape(ppt.ShapeType.line,{x:dx+Math.min(a.x,b.x)*scale,y:dy+Math.min(a.y,b.y)*scale,w:Math.abs(b.x-a.x)*scale,h:Math.abs(b.y-a.y)*scale,flipH:b.x<a.x,flipV:b.y<a.y,line:{color:theme.accent,width:1.3,endArrowType:i===e.points.length-1?'triangle':'none'}});}
    if(e.relation){const segments=e.points.slice(1).map((b,i)=>({a:e.points[i],b,length:Math.abs(b.x-e.points[i].x)+Math.abs(b.y-e.points[i].y)})),segment=segments.sort((a,b)=>b.length-a.length)[0],p={x:(segment.a.x+segment.b.x)/2,y:(segment.a.y+segment.b.y)/2},w=Math.min(1.2,Math.max(.45,segment.length*scale-.03));slide.addText(e.relation,{x:dx+p.x*scale-w/2,y:dy+p.y*scale-.19,w,h:.18,fontSize:8.5,color:theme.muted,align:'center',margin:0,fill:{color:theme.bg}});}
   }
   for(const n of g.nodes){slide.addText(n.label,{x:dx+n.x*scale,y:dy+n.y*scale,w:n.width*scale,h:n.height*scale,shape:ppt.ShapeType.roundRect,fill:{color:theme.soft},line:{color:theme.accent,width:1},fontSize:Math.max(10,Math.min(15,n.width*scale*6.5)),color:theme.text,align:'center',valign:'mid',margin:.06,breakLine:false});}
   diagramNotes='示意图节点解释：\n'+g.nodes.map(n=>n.label+'：'+(n.detail||'见正文解释')).join('\n');
   slide.addText('AI 辅助示意图 · 可编辑 · 请结合原文核对关系',{x:left.x,y:6.45,w:left.w,h:.2,fontSize:9,color:theme.muted,margin:0});
   await fs.writeFile(path.join(directory,`diagram-${index+1}.svg`),diagramSVG(s.diagram,g));
   await fs.writeFile(path.join(directory,`diagram-${index+1}.drawio`),diagramDrawio(s.diagram,g));
  }else if(s.datasetID&&s.layout!=='text'){
   const d=datasets.find(d=>d.id===s.datasetID);if(!d)throw Error('用户实验数据不存在');validateDataset(d);renderDataChart(slide,d,s.chartType||'bar',left);
  }else if(s.assetIDs?.length&&s.layout!=='text'){
   const chosen=s.assetIDs.slice(0,s.layout==='comparison'?2:1);
   for(const [j,id] of chosen.entries()){
    const a=byID.get(id),buffer=await fs.readFile(a.path),type=imageType(buffer);
    if(buffer.length>20_000_000)throw Error(`第 ${index+1} 页的图片“${a.label}”超过 20 MB，未导出；页面已保留，请压缩图片后重新导入`);
    if(!type)throw Error(`第 ${index+1} 页的图片“${a.label}”不是 PNG 或 JPG，未导出；页面已保留，请换用 PNG 或 JPG 图片`);
    const image=type==='png'?PNG.sync.read(buffer):jpegSize(buffer);if(!image?.width||!image?.height)throw Error(`第 ${index+1} 页的图片“${a.label}”无法读取尺寸，未导出；请重新导入这张图片`);
    if(image.width*image.height>25_000_000)throw Error('素材分辨率过大');
    const box=tallComparison?{x:j?6.8:.6,y:2,w:5.85,h:j?4.55:2.45}:comparisonVisual?{...left,w:(left.w-.25)/2,x:left.x+j*(left.w+.25)/2}: {...left,h:left.h/chosen.length-.15,y:left.y+j*left.h/chosen.length};
    const scale=Math.min(box.w/image.width,box.h/image.height),w=image.width*scale,h=image.height*scale;
    slide.addImage({data:'image/'+type+';base64,'+buffer.toString('base64'),x:box.x+(box.w-w)/2,y:box.y+(box.h-h)/2,w,h});
    if(image.width/w<120)warnings.push(`第 ${index+1} 页 ${a.label} 可能模糊`);
    slide.addText(`${assetSourceLabel(a)}${a.page?' · PDF '+a.page+' 页':''}`,{x:box.x,y:box.y+box.h,w:box.w,h:.2,fontSize:9,color:theme.muted,margin:0});
   }
  }
  const ids=[...new Set(s.blocks.flatMap(b=>b.evidenceIDs))],sources=ids.map(id=>evidence.find(e=>e.id===id));
  const paperLabel=byID.get(s.assetIDs?.[0])?.paperTitle||sources[0]?.label.split(' · ')[0]||'我的内容';
  const paperCharacters=Array.from(paperLabel),runs=[{text:paperCharacters.slice(0,55).join('')+(paperCharacters.length>55?'…':'')+'  '}];
  runs.push(...sources.slice(0,3).map(e=>({text:`${sourceTag(e)}  `,options:/^(zotero:\/\/|https:\/\/)/.test(e.uri||'')?{hyperlink:{url:e.uri}}:{}})));
  if(s.assetIDs?.length)for(const id of s.assetIDs.slice(0,2)){const a=byID.get(id);runs.push({text:`${a.label}${a.page?' · p.'+a.page:''}  `,options:a.uri?{hyperlink:{url:a.uri}}:{}});}
  slide.addText(runs.length?runs:'我的内容 / 待验证观点',{x:.65,y:6.88,w:11.6,h:.35,fontSize:9,color:theme.muted,margin:0});
  slide.addText(`${index+1} / ${plan.slides.length}`,{x:12.3,y:7.02,w:.6,h:.2,fontSize:9,color:theme.muted,margin:0});
  // pptxgenjs joins separate addNotes calls without a separator, so the page has one notes text.
  slide.addNotes([meetingText(s.notes),diagramNotes,...s.blocks.map(b=>`${BLOCK_TYPES[b.kind]}：${meetingText(b.text)}\n原文：${b.quote||'未引用原文'}`),...sources.map(e=>[e.id,e.uri].filter(Boolean).join(' ')+'\n'+e.text)].filter(Boolean).join('\n\n'));
 }
 const output=path.join(directory,'presentation.pptx');await ppt.writeFile({fileName:output});
 const checked=await finalizePresentation(output);warnings.push(...checked.warnings);
 return {path:output,slides:plan.slides.length,editable:true,visualReview:'human_review_required',warnings,packageValidation:checked.report,visualAssets:[]};
}
