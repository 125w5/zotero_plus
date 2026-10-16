/* SPDX-License-Identifier: AGPL-3.0-or-later */
export function normalizeEvidenceOrder(value={}) {
 return {direction:value?.direction==='desc'?'desc':'asc',group:value?.group==='type'?'type':'none'};
}
export function evidenceKindLabel(kind) {
 return ({figure:'图片',image:'图片',table:'表格',formula:'公式',manual:'裁切'})[kind]||'其他';
}
export function sortEvidence(assets,options) {
 const {direction,group}=normalizeEvidenceOrder(options),sign=direction==='desc'?-1:1;
 const rank=kind=>({figure:0,image:0,table:1,formula:2,manual:3})[kind]??4;
 const numeric=value=>Number.isFinite(Number(value))?Number(value):0;
 return [...assets].sort((a,b)=>
  (group==='type'?rank(a.kind)-rank(b.kind):0)||sign*(
   numeric(a.pageIndex)-numeric(b.pageIndex)||numeric(a.bbox?.[1])-numeric(b.bbox?.[1])||
   numeric(a.bbox?.[0])-numeric(b.bbox?.[0])||String(a.id).localeCompare(String(b.id))));
}
