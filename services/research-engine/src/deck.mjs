// SPDX-License-Identifier: AGPL-3.0-or-later
import pptxgen from 'pptxgenjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { geometry, endpoints, diagramSVG, diagramDrawio } from './diagram.mjs';
import { validatePlan, validateDataset } from './plan.mjs';
export async function renderDeck({ plan, evidence, datasets = [], directory }) {
  validatePlan(plan, evidence);
  const data = new Map(datasets.map(d => [validateDataset(d).id, d]));
  for (const s of plan.slides) if (s.kind === 'chart' && !data.has(s.datasetID)) throw new Error('Chart dataset was not supplied by user');
  const ppt = new pptxgen(); ppt.layout = 'LAYOUT_WIDE'; ppt.author = 'EasySch'; ppt.subject = 'Evidence-linked research presentation'; ppt.title = plan.title;
  ppt.theme = { headFontFace: 'Microsoft YaHei', bodyFontFace: 'Microsoft YaHei', lang: 'zh-CN' };
  for (const [index, spec] of plan.slides.entries()) {
    const slide = ppt.addSlide(); slide.background = { color: 'FFFFFF' };
    slide.addText(spec.title, { x:.6, y:.45, w:12.1, h:1, fontSize:28, bold:true, color:'17364A', breakLine:false, margin:0 });
    if (spec.kind === 'text') spec.bullets.forEach((point,i) => slide.addText(point, { x:.8, y:1.7+i*1.1, w:11.7, h:1, fontSize:18, color:'243B4A', margin:0, breakLine:false }));
    if (spec.kind === 'diagram') {
      const nodes = geometry(spec.nodes), lookup = new Map(nodes.map(n => [n.id,n]));
      for (const edge of spec.edges) {
        const a = lookup.get(edge.from), b = lookup.get(edge.to);
        const [x1,y1,x2,y2] = endpoints(a,b);
        slide.addShape(ppt.ShapeType.line, { x:Math.min(x1,x2), y:Math.min(y1,y2), w:Math.abs(x2-x1), h:Math.abs(y2-y1), flipH:x2<x1, flipV:y2<y1, line:{color:'287B89',width:2,beginArrowType:'none',endArrowType:'triangle'} });
      }
      for (const n of nodes) slide.addText(n.label, { x:n.x,y:n.y,w:n.w,h:n.h,shape:ppt.ShapeType.roundRect,fill:{color:'E8F3F4'},line:{color:'287B89'},fontSize:20,align:'center',valign:'mid',margin:.1 });
      await fs.writeFile(path.join(directory,`figure-${index+1}.svg`),diagramSVG(spec));
      await fs.writeFile(path.join(directory,`figure-${index+1}.drawio`),diagramDrawio(spec));
    }
    if (spec.kind === 'chart') {
      const d = data.get(spec.datasetID);
      slide.addChart(spec.chartType, d.series.map(s => ({name:s.name,labels:d.labels,values:s.values})), {x:.8,y:1.65,w:11.7,h:4.7,showLegend:d.series.length>1,catAxisLabelFontFace:'Microsoft YaHei',valAxisLabelFontFace:'Microsoft YaHei',catAxisLabelFontSize:14,valAxisLabelFontSize:14,showTitle:false,showValue:false,chartColors:['287B89','DB8753','725D9F']});
      slide.addNotes(`Data provenance: ${d.provenance}`);
    }
    const sources = spec.sources.map(id => evidence.find(s => s.id === id));
    const runs = sources.slice(0,10).map(s => ({text:`[${s.id}] `,options: /^(zotero:\/\/|https:\/\/)/.test(s.uri || '') ? {hyperlink:{url:s.uri}} : {}}));
    slide.addText(runs.length ? runs : '无直接证据 · 请人工核对', {x:.65,y:6.55,w:11.8,h:.42,fontSize:10,color:'446674',margin:0});
    slide.addText(`${index+1} / ${plan.slides.length}`, {x:12,y:7,w:.7,h:.2,fontSize:9,margin:0});
    slide.addNotes([spec.notes || '', ...sources.map(s => `[${s.id}] ${s.label}\n${s.uri || ''}\n${s.text || ''}`)].join('\n\n'));
  }
  const output = path.join(directory,'presentation.pptx');
  await ppt.writeFile({fileName:output});
  return {path:output,slides:plan.slides.length,editable:true,visualReview:'pending',warnings:['已生成原生可编辑元素；尚未完成逐页视觉验收。']};
}
