/* SPDX-License-Identifier: AGPL-3.0-or-later */
export function marginCommentLayout(entries,{viewportWidth,viewportHeight,width=178,padding=8,gap=6,top=38}={}){
 const ordered=entries.filter(entry=>Number.isFinite(entry.anchorY)&&Number.isFinite(entry.pageRight)).sort((a,b)=>a.anchorY-b.anchorY||a.pageIndex-b.pageIndex||String(a.id).localeCompare(String(b.id)));
 const right=Math.max(padding,viewportWidth-width-padding),bottom=Math.max(top,viewportHeight-padding);let next=top;
 const result=ordered.map(entry=>{const height=Math.min(180,Math.max(28,Number(entry.height)||28)),y=Math.max(top,entry.anchorY);const placed={...entry,width,height,left:Math.max(padding,Math.min(entry.pageRight+4,right)),top:Math.max(y,next)};next=placed.top+height+gap;return placed;});
 // Keep small groups fully visible without changing their source order. Large
 // groups retain their anchored positions; scrolling reveals the remainder.
 if(result.length&&result.reduce((sum,entry)=>sum+entry.height,0)+gap*(result.length-1)<=bottom-top){let edge=bottom;for(let i=result.length-1;i>=0;i--){const entry=result[i];entry.top=Math.min(entry.top,edge-entry.height);edge=entry.top-gap;}next=top;for(const entry of result){entry.top=Math.max(next,entry.top);next=entry.top+entry.height+gap;}}
 return result;
}
