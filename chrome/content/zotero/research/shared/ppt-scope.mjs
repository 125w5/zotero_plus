/* SPDX-License-Identifier: AGPL-3.0-or-later */
export function parsePageRange(value, count) {
 const pages=new Set();
 if(!String(value||'').trim())throw Error('请填写 PDF 页码，例如 2–5, 8（从文件第一页开始计数）');
 for(const part of String(value).replace(/[，、]/g,',').split(',')){
  const m=part.trim().match(/^(\d+)\s*(?:[-–—]\s*(\d+))?$/);
  if(!m)throw Error('页码格式不正确，请使用 2–5, 8');
  const a=Number(m[1]),b=Number(m[2]||m[1]);
  if(a<1||b<a||b>count)throw Error(`页码超出范围：${part}；当前 PDF 共 ${count} 页`);
  for(let p=a;p<=b;p++)pages.add(p-1);
 }
 return pages;
}
export function scopedPages(scope,pages,paperID){
 if(!scope||scope.mode==='all')return pages;
 if(scope.mode==='pages'){
  const allowed=parsePageRange(scope.ranges?.[paperID]||scope.range,pages.length);
  return pages.filter(p=>allowed.has(p.pageIndex));
 }
 if(['selection','annotations'].includes(scope.mode))return [];
 throw Error('未知取材范围，请重新选择');
}
