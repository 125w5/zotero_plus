/* SPDX-License-Identifier: AGPL-3.0-or-later */
export const layoutSnapshot = p => JSON.stringify({sections:p.sections,blocks:p.blocks,materials:p.materials});
const clone = value => JSON.parse(JSON.stringify(value));
// Send the exact existing identities as a compact output contract. Empty
// collections still require an empty array; returning a partial order never
// authorizes dropping the remaining document objects.
export function layoutResponseContract(p) {
 return {sectionOrder:p.sections.map(row=>row.id),blockOrder:p.blocks.map(row=>row.id),materialOrder:p.materials.map(row=>row.id),reasons:[]};
}
export function layoutRepairDiagnostics(p,value) {
 const expected=layoutResponseContract(p),issues=[];
 if(!value||typeof value!=='object'||Array.isArray(value))return [{field:'response',problem:'必须返回完整 JSON 对象'}];
 if(Object.keys(value).some(key=>!['sectionOrder','blockOrder','materialOrder','reasons'].includes(key)))issues.push({field:'response',problem:'只能返回顺序和理由，禁止正文、公式或新素材字段'});
 for(const field of ['sectionOrder','blockOrder','materialOrder']){
  const actual=value[field];
  if(!Array.isArray(actual)){issues.push({field,problem:'缺少完整顺序数组',missing:expected[field]});continue;}
  const ids=new Set(actual);
  const missing=expected[field].filter(id=>!ids.has(id)),duplicate=expected[field].filter(id=>actual.filter(value=>value===id).length>1);
  // Do not echo fabricated model identities or text into the repair prompt.
  const unknownCount=actual.filter(id=>typeof id!=='string'||!expected[field].includes(id)).length;
  if(missing.length||duplicate.length||unknownCount||actual.length!==expected[field].length)issues.push({field,missing,duplicate,unknownCount,expectedCount:expected[field].length});
 }
 if(!issues.length)issues.push({field:'hierarchyOrReasons',problem:'保持父子章节连续，理由只能关联现有 ID，最多30条且每条不超过200字'});
 return issues;
}
function permutation(value, expected, label) {
 if (!Array.isArray(value)||value.length!==expected.length||new Set(value).size!==value.length||value.some(id=>typeof id!=='string'||!expected.includes(id))) throw Error(label+'必须包含全部现有 ID，不能新增、删除或重复');
 return [...value];
}
function sectionHierarchy(p,order) {
 const sections=new Map(p.sections.map(s=>[s.id,s])),ancestors=new Map();
 for(const section of p.sections){const chain=new Set([section.id]);let parent=section.parentID;
  while(parent){if(!sections.has(parent)||chain.has(parent))throw Error('现有章节的父子关系无效，请先检查大纲');chain.add(parent);parent=sections.get(parent).parentID;}
  ancestors.set(section.id,chain);
 }
 for(const id of order){const positions=order.map((child,i)=>ancestors.get(child).has(id)?i:-1).filter(i=>i>=0);
  if(positions[0]!==order.indexOf(id)||positions.at(-1)-positions[0]+1!==positions.length)throw Error('父章节必须位于子章节之前，子章节必须保持在连续的所属章节范围内');
 }
}
export function validateLayoutProposal(p,value) {
 if(!value||Object.keys(value).some(key=>!['sectionOrder','blockOrder','materialOrder','reasons'].includes(key)))throw Error('布局建议只能包含顺序和理由，不能包含正文或新素材');
 const sectionOrder=permutation(value.sectionOrder,p.sections.map(s=>s.id),'章节顺序'),blockOrder=permutation(value.blockOrder,p.blocks.map(b=>b.id),'模块顺序'),materialOrder=permutation(value.materialOrder,p.materials.map(m=>m.id),'素材顺序');
 sectionHierarchy(p,sectionOrder);
 const allowed=new Set([...sectionOrder,...blockOrder,...materialOrder]);
 if(value.reasons!==undefined&&(!Array.isArray(value.reasons)||value.reasons.length>30||value.reasons.some(r=>!r||Object.keys(r).some(k=>!['targetID','reason'].includes(k))||!allowed.has(r.targetID)||typeof r.reason!=='string'||!r.reason.trim()||r.reason.length>200)))throw Error('布局理由必须关联现有章节、模块或素材');
 return {kind:'layout',projectID:p.id,baseRevision:p.revision,documentSnapshot:layoutSnapshot(p),sectionOrder,blockOrder,materialOrder,reasons:clone(value.reasons||[]),status:'pending'};
}
export function applyLayoutProposal(p,proposal) {
 if(proposal?.kind!=='layout'||proposal.projectID!==p.id||proposal.status!=='pending')throw Error('布局建议已处理或不属于当前项目');
 if(proposal.documentSnapshot!==layoutSnapshot(p))throw Error('正文、来源或顺序已变化，请重新整理布局');
 const checked=validateLayoutProposal(p,{sectionOrder:proposal.sectionOrder,blockOrder:proposal.blockOrder,materialOrder:proposal.materialOrder,reasons:proposal.reasons});
 const next=clone(p),bySection=new Map(next.sections.map(s=>[s.id,s])),byBlock=new Map(next.blocks.map(b=>[b.id,b])),byMaterial=new Map(next.materials.map(m=>[m.id,m]));
 next.sections=checked.sectionOrder.map(id=>bySection.get(id));
 // Section membership, source relationships and every content byte remain untouched.
 next.blocks=next.sections.flatMap(s=>checked.blockOrder.map(id=>byBlock.get(id)).filter(b=>b.sectionID===s.id));
 next.materials=checked.materialOrder.map(id=>byMaterial.get(id));
 return next;
}
