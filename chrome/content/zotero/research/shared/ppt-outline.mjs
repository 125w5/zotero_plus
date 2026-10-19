/* SPDX-License-Identifier: AGPL-3.0-or-later */
// A proposal is separate from the editable outline. It can only be accepted
// against the exact outline that was sent, so a late answer cannot erase edits.
export function outlineFingerprint(rows=[]){return JSON.stringify(rows.map(row=>({id:row.id,title:row.title,purpose:row.purpose,diagram:!!row.diagram,sourceIDs:row.sourceIDs||[]})));}
export function normalizeOutline(rows,{previous=[],sources=[],newID=i=>'outline-new-'+i}={}){
 if(!Array.isArray(rows)||!rows.length||rows.length>50)throw Error('结构需要 1–50 个板块');
 const prior=new Set(previous.map(row=>row.id)),known=new Set(sources.map(row=>row.id)),seen=new Set();
 return rows.map((row,i)=>{
  const title=String(row.title||'').trim(),purpose=String(row.purpose||'').trim();
  if(!title||title.length>80||!purpose||purpose.length>1200)throw Error('每个板块需要标题与讲述任务（标题最多 80 字，任务最多 1200 字）');
  const id=prior.has(row.id)&&!seen.has(row.id)?row.id:newID(i);if(seen.has(id))throw Error('板块编号重复');seen.add(id);
  return {id,title,purpose,diagram:!!row.diagram,sourceIDs:[...new Set((Array.isArray(row.sourceIDs)?row.sourceIDs:[]).filter(id=>known.has(id)))]};
 });
}
export function outlineDiff(before=[],after=[]){
 const old=new Map(before.map((row,index)=>[row.id,{row,index}])),next=new Set(after.map(row=>row.id)),changes=[];
 for(const [index,row]of after.entries()){
  const previous=old.get(row.id);if(!previous){changes.push({kind:'added',after:row,index});continue;}
  if(outlineFingerprint([row])!==outlineFingerprint([previous.row]))changes.push({kind:'changed',before:previous.row,after:row,index});
  else if(previous.index!==index)changes.push({kind:'moved',before:previous.row,after:row,index,from:previous.index});
 }
 for(const row of before)if(!next.has(row.id))changes.push({kind:'removed',before:row});
 return changes;
}
export function applyOutlineEdit(rows,operation){
 const next=structuredClone(rows),index=next.findIndex(row=>row.id===operation.id);
 if(operation.type==='add'){
  if(next.length>=50)throw Error('最多保留 50 个板块');if(!operation.row?.id)throw Error('新板块缺少编号');
  next.splice(operation.afterID?Math.max(0,next.findIndex(row=>row.id===operation.afterID)+1):next.length,0,operation.row);
 }else{
  if(index<0)throw Error('板块已移除，请刷新后重试');
  if(operation.type==='remove'){if(next.length===1)throw Error('至少保留一个板块');next.splice(index,1);}
  else if(operation.type==='update')next[index]={...next[index],...operation.patch,id:next[index].id};
  else if(operation.type==='move'){const target=Math.max(0,Math.min(next.length-1,index+operation.delta));next.splice(target,0,next.splice(index,1)[0]);}
  else throw Error('未知结构操作');
 }
 return next;
}
