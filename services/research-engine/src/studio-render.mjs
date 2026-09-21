/* SPDX-License-Identifier: AGPL-3.0-or-later */
import pptxgen from 'pptxgenjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import {validateStudioPlan,themeFor,TYPE_COLORS,BLOCK_TYPES,meetingText} from '../../../chrome/content/zotero/research/shared/ppt-model.mjs';
import {layoutDiagram,diagramSVG,diagramDrawio} from './studio-diagram.mjs';
import {renderDataChart} from './data-charts.mjs';
import {validateDataset} from './plan.mjs';
export async function renderStudioDeck({plan,evidence,assets=[],datasets=[],directory}) {
 validateStudioPlan(plan,evidence,assets);
 const theme=themeFor(plan),ppt=new pptxgen(),warnings=[],byID=new Map(assets.map(a=>[a.id,a]));
 ppt.layout='LAYOUT_WIDE';ppt.author='EasySch';ppt.title=plan.title;ppt.theme={headFontFace:theme.font,bodyFontFace:theme.font,lang:'zh-CN'};
 ppt.defineSlideMaster({title:'ACADEMIC',background:{color:theme.bg},objects:[{line:{x:.55,y:1.35,w:12.2,h:0,line:{color:theme.accent,width:1}}}]});
 for(const [index,s] of plan.slides.entries()){
  const slide=ppt.addSlide({masterName:'ACADEMIC'});slide.background={color:theme.bg};
  const titleSlot=theme.slots?.find(p=>['title','ctrTitle'].includes(p.type)&&p.x>=0&&p.y>=0&&p.w>5&&p.x+p.w<=13.34&&p.y+p.h<=1.4);
  slide.addText(meetingText(s.title),{x:titleSlot?.x??.6,y:titleSlot?.y??.4,w:titleSlot?.w??12.1,h:Math.min(titleSlot?.h||.8,.85),fontSize:27,bold:true,color:theme.text,margin:0,breakLine:false});
  const hasVisual=!!(s.diagram||s.assetIDs?.length||s.datasetID),wideDiagram=!!s.diagram&&s.diagram.nodes.length>4,left=wideDiagram?{x:.6,y:2,w:12.1,h:2.4}:{x:.6,y:2,w:6.4,h:4.3};
  if(s.layout==='visual'&&!s.diagram&&!s.datasetID)left.w=7.8;
  slide.addText(meetingText(s.explanation),{x:.65,y:1.48,w:12,h:.48,fontSize:18,color:theme.accent,margin:0,bold:true});
  let bodyX=hasVisual&&s.layout!=='text'?7.35:.8,bodyW=hasVisual&&s.layout!=='text'?5.2:11.6;
  if(s.layout==='visual'&&!s.diagram&&!s.datasetID){bodyX=8.7;bodyW=3.95;}
  const count=s.blocks.length,h=Math.min(1.02,4.65/Math.max(1,count));
  for(const [i,b] of s.blocks.entries()){
   const y=wideDiagram?4.6+Math.floor(i/2)*.65:2.02+i*h,x=wideDiagram?.7+(i%2)*6.2:bodyX,w=wideDiagram?5.85:bodyW;
   // Provenance labels remain in speaker notes, not repeated over every paragraph.
   if(b.kind==='unverified')slide.addText('待验证',{x,y,w,h:.2,fontSize:10,color:TYPE_COLORS[b.kind],bold:true,margin:0});
   slide.addText(meetingText(b.text),{x,y:y+(b.kind==='unverified'?.22:0),w,h:wideDiagram?.44:h-(b.kind==='unverified'?.28:.06),fontSize:wideDiagram?13:s.layout==='visual'?14:hasVisual?16:19,color:theme.text,margin:0,breakLine:false});
  }
  if(s.diagram&&s.layout!=='text'){
   const g=await layoutDiagram(s.diagram),scale=Math.min(left.w/g.width,left.h/g.height),dx=left.x+(left.w-g.width*scale)/2,dy=left.y+(left.h-g.height*scale)/2;
   for(const e of g.edges){for(let i=1;i<e.points.length;i++){let a=e.points[i-1],b=e.points[i];slide.addShape(ppt.ShapeType.line,{x:dx+Math.min(a.x,b.x)*scale,y:dy+Math.min(a.y,b.y)*scale,w:Math.abs(b.x-a.x)*scale,h:Math.abs(b.y-a.y)*scale,flipH:b.x<a.x,flipV:b.y<a.y,line:{color:theme.accent,width:1.3,endArrowType:i===e.points.length-1?'triangle':'none'}});}
    if(e.relation){const segments=e.points.slice(1).map((b,i)=>({a:e.points[i],b,length:Math.abs(b.x-e.points[i].x)+Math.abs(b.y-e.points[i].y)})),segment=segments.sort((a,b)=>b.length-a.length)[0],p={x:(segment.a.x+segment.b.x)/2,y:(segment.a.y+segment.b.y)/2},w=Math.min(1.2,Math.max(.45,segment.length*scale-.03));slide.addText(e.relation,{x:dx+p.x*scale-w/2,y:dy+p.y*scale-.19,w,h:.18,fontSize:8.5,color:theme.muted,align:'center',margin:0,fill:{color:theme.bg}});}
   }
   for(const n of g.nodes){slide.addText(n.label,{x:dx+n.x*scale,y:dy+n.y*scale,w:n.width*scale,h:n.height*scale,shape:ppt.ShapeType.roundRect,fill:{color:theme.soft},line:{color:theme.accent,width:1},fontSize:Math.max(10,Math.min(15,n.width*scale*6.5)),color:theme.text,align:'center',valign:'mid',margin:.06,breakLine:false});}
   slide.addNotes('示意图节点解释：\n'+g.nodes.map(n=>n.label+'：'+(n.detail||'见正文解释')).join('\n'));
   slide.addText('AI 辅助示意图 · 可编辑 · 请结合原文核对关系',{x:left.x,y:6.45,w:left.w,h:.2,fontSize:9,color:theme.muted,margin:0});
   await fs.writeFile(path.join(directory,`diagram-${index+1}.svg`),diagramSVG(s.diagram,g));
   await fs.writeFile(path.join(directory,`diagram-${index+1}.drawio`),diagramDrawio(s.diagram,g));
  }else if(s.datasetID&&s.layout!=='text'){
   const d=datasets.find(d=>d.id===s.datasetID);if(!d)throw Error('用户实验数据不存在');validateDataset(d);renderDataChart(slide,d,s.chartType||'bar',left);
  }else if(s.assetIDs?.length&&s.layout!=='text'){
   const chosen=s.assetIDs.slice(0,s.layout==='comparison'?2:1);
   for(const [j,id] of chosen.entries()){
    const a=byID.get(id),buffer=await fs.readFile(a.path);if(buffer.length>20_000_000||buffer.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('素材必须是经过解析器验证的 PNG');
    const image=PNG.sync.read(buffer);if(image.width*image.height>25_000_000)throw Error('素材分辨率过大');
    const box={...left,h:left.h/chosen.length-.15,y:left.y+j*left.h/chosen.length};
    const scale=Math.min(box.w/image.width,box.h/image.height),w=image.width*scale,h=image.height*scale;
    slide.addImage({data:'image/png;base64,'+buffer.toString('base64'),x:box.x+(box.w-w)/2,y:box.y+(box.h-h)/2,w,h});
    if(image.width/w<120)warnings.push(`第 ${index+1} 页 ${a.label} 可能模糊`);
    slide.addText(`${a.kind==='user_image'?'我的实验':a.label}${a.page?' · PDF '+a.page+' 页':''}`,{x:box.x,y:box.y+box.h,w:box.w,h:.2,fontSize:9,color:theme.muted,margin:0});
   }
  }
  const ids=[...new Set(s.blocks.flatMap(b=>b.evidenceIDs))],sources=ids.map(id=>evidence.find(e=>e.id===id));
  const paperLabel=byID.get(s.assetIDs?.[0])?.paperTitle||sources[0]?.label.split(' · ')[0]||'我的内容';
  const runs=[{text:paperLabel.slice(0,55)+'  '}];
  runs.push(...sources.slice(0,3).map(e=>({text:`${Number.isInteger(e.pageIndex)?'原文 p.'+(e.pageIndex+1):'题录'}  `,options:/^(zotero:\/\/|https:\/\/)/.test(e.uri||'')?{hyperlink:{url:e.uri}}:{}})));
  if(s.assetIDs?.length)for(const id of s.assetIDs.slice(0,2)){const a=byID.get(id);runs.push({text:`${a.label}${a.page?' · p.'+a.page:''}  `,options:a.uri?{hyperlink:{url:a.uri}}:{}});}
  slide.addText(runs.length?runs:'我的内容 / 待验证观点',{x:.65,y:6.88,w:11.6,h:.35,fontSize:9,color:theme.muted,margin:0});
  slide.addText(`${index+1} / ${plan.slides.length}`,{x:12.3,y:7.02,w:.6,h:.2,fontSize:9,color:theme.muted,margin:0});
  slide.addNotes([meetingText(s.notes),...s.blocks.map(b=>`${BLOCK_TYPES[b.kind]}：${meetingText(b.text)}\n原文：${b.quote||'未引用原文'}`),...sources.map(e=>e.id+' '+e.uri+'\n'+e.text)].join('\n\n'));
 }
 const output=path.join(directory,'presentation.pptx');await ppt.writeFile({fileName:output});
 return {path:output,slides:plan.slides.length,editable:true,visualReview:'human_review_required',warnings,visualAssets:[]};
}
