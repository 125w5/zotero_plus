// SPDX-License-Identifier: AGPL-3.0-or-later
import { validateAssetSlide } from './asset-slides.mjs';
import { validateStudioPlan } from '../../../chrome/content/zotero/research/shared/ppt-model.mjs';
const text = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${label}`);
  return value;
};
export function validatePlan(plan, evidence) {
  if(plan.version===3)return validateStudioPlan(plan,evidence,plan.assets||[]);
  text(plan.title, 100, 'title');
  if (!Array.isArray(plan.slides) || !plan.slides.length || plan.slides.length > 40) throw new Error('Expected 1–40 slides');
  const ids = new Set(evidence.map(s => s.id));
  for (const slide of plan.slides) {
    text(slide.title, 70, 'slide title');
    if (!Array.isArray(slide.sources) || slide.sources.some(id => !ids.has(id))) throw new Error('Unknown evidence');
    if (!['text', 'diagram', 'chart', 'table', 'asset'].includes(slide.kind)) throw new Error('Unknown slide kind');
    if (slide.kind === 'asset') validateAssetSlide(slide);
    if (slide.role && !['title','research_question','conclusions','method','comparison','data','limitations','next_steps'].includes(slide.role)) throw new Error('Unknown page role');
    if (slide.kind === 'table') {
      if (!Array.isArray(slide.rows) || !slide.rows.length || slide.rows.length > 5) throw new Error('Expected 1–5 comparison rows');
      let columns = slide.rows[0]?.length;
      if (columns < 2 || columns > 4) throw new Error('Expected 2–4 comparison columns');
      for (const row of slide.rows) {
        if (!Array.isArray(row) || row.length !== columns) throw new Error('Inconsistent table columns');
        row.forEach(cell => text(cell, 50, 'table cell'));
      }
    }
    if (slide.kind === 'text') {
      if (!Array.isArray(slide.bullets) || !slide.bullets.length || slide.bullets.length > 4) throw new Error('Expected 1–4 points');
      slide.bullets.forEach(v => text(v, 100, 'point'));
    }
    if (slide.kind === 'diagram') {
      const { nodes, edges } = slide;
      if (!Array.isArray(nodes) || !nodes.length || nodes.length > 6 || !Array.isArray(edges) || edges.length > 12) throw new Error('Invalid diagram');
      const keys = new Set();
      for (const n of nodes) {
        text(n.id, 30, 'node id'); text(n.label, 35, 'node label');
        if (keys.has(n.id)) throw new Error('Duplicate node'); keys.add(n.id);
      }
      for (const e of edges) {
        if (!keys.has(e.from) || !keys.has(e.to) || e.from === e.to) throw new Error('Invalid diagram edge');
      }
      if (!slide.sources.length) throw new Error('Diagram needs evidence');
    }
    if (slide.kind === 'chart') {
      // The planner may select a dataset, never supply numerical observations.
      text(slide.datasetID, 80, 'dataset ID');
      if (!['bar', 'line', 'scatter', 'heatmap'].includes(slide.chartType)) throw new Error('Unsupported chart type');
      if ('values' in slide || 'series' in slide) throw new Error('Model-generated data is forbidden');
    }
  }
  if (plan.version >= 2) {
    const content=plan.slides.filter(s=>s.role!=='title');
    if(content.filter(s=>['asset','chart'].includes(s.kind)).length / Math.max(1,content.length) < .6) throw new Error('论文视觉证据不足 60%；请补选原图或真实数据，不能用装饰图补数');
    for(let i=2;i<plan.slides.length;i++) if(new Set(plan.slides.slice(i-2,i+1).map(s=>s.layoutType||s.kind)).size===1) throw new Error('连续三页布局相同，请调整讲述方式');
  }
  return plan;
}
export function validateDataset(data) {
  text(data.id, 80, 'dataset id'); text(data.provenance, 1000, 'data provenance');
  if (!Array.isArray(data.labels) || !data.labels.length || data.labels.length > 30) throw new Error('Invalid categories');
  data.labels.forEach(v => text(v, 40, 'category'));
  if (!Array.isArray(data.series) || !data.series.length || data.series.length > 5) throw new Error('Invalid series');
  for (const s of data.series) {
    text(s.name, 50, 'series');
    if (!Array.isArray(s.values) || s.values.length !== data.labels.length || s.values.some(v => typeof v !== 'number' || !Number.isFinite(v))) throw new Error('Invalid numerical observations');
  }
  return data;
}
export function outlinePlan(title, record) {
  const slides = [];
  for (const s of record.result.sections) {
    const pieces = s.body.match(/[\s\S]{1,90}/gu) || [];
    for (let i = 0; i < pieces.length; i += 4) slides.push({ kind: 'text', title: s.heading.slice(0, 65) + (i ? '（续）' : ''), bullets: pieces.slice(i, i + 4), sources: s.sources, notes: JSON.stringify({ claim_type: s.claim_type, quotes: s.quotes }) });
  }
  return validatePlan({ version: 1, title, slides }, record.sources);
}
