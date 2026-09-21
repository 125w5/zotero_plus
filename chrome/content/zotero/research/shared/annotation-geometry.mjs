/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Merge adjacent glyph boxes on the same line, including superscripts. Never
// bridge distant columns or the full bounding box of a multi-line selection.
export function lineRects(rects) {
 const lines=[];
 for(const r of rects.filter(r=>r?.length===4&&r.every(Number.isFinite)).map(r=>r.slice()).sort((a,b)=>b[3]-a[3]||a[0]-b[0])) {
  const h=r[3]-r[1];let line=lines.find(l=>Math.min(l[3],r[3])-Math.max(l[1],r[1])>Math.min(h,l[3]-l[1])*.3 && Math.max(0,r[0]-l[2],l[0]-r[2])<Math.max(h,l[3]-l[1])*2.5);
  if(line){line[0]=Math.min(line[0],r[0]);line[1]=Math.min(line[1],r[1]);line[2]=Math.max(line[2],r[2]);line[3]=Math.max(line[3],r[3]);}else lines.push(r);
 }
 return lines;
}
export function strikePositions(position) {
 return [[position.pageIndex,position.rects],[position.pageIndex+1,position.nextPageRects]].filter(([,r])=>r?.length).map(([pageIndex,rects])=>({pageIndex,width:1.1,paths:lineRects(rects).map(r=>[r[0],(r[1]+r[3])/2,r[2],(r[1]+r[3])/2])}));
}
