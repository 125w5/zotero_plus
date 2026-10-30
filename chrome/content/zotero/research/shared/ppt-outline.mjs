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
// A template section that matches an existing one (same or contained title) keeps
// that section's ID, wording and sources, so its page and speaker notes stay attached.
export function templateOutlineProposal(outline=[],slides=[],sections=[],{name='',newID=i=>'outline-template-'+i}={}){
 const key=value=>String(value||'').normalize('NFKC').replace(/\s+/g,'').toLocaleLowerCase(),used=new Set();
 const free=row=>!used.has(row.id);
 const match=title=>outline.find(row=>free(row)&&key(row.title)===title)||outline.find(row=>{const own=key(row.title);return free(row)&&title.length>=2&&own.length>=2&&(own.includes(title)||title.includes(own));});
 const proposal=sections.map((row,i)=>{const prior=match(key(row.title));if(!prior)return {...row,id:newID(i),sourceIDs:[]};used.add(prior.id);return {...prior,sourceIDs:[...(prior.sourceIDs||[])]};});
 const paged=new Set(slides.filter(page=>page.outlineID).map(page=>page.outlineID)),archived=outline.filter(row=>free(row)&&paged.has(row.id)),kept=proposal.filter(row=>paged.has(row.id)).length;
 const names=archived.slice(0,3).map(row=>'“'+row.title+'”').join('、')+(archived.length>3?' 等':'');
 const summary='使用“'+name+'”调整内容结构。'+(kept?'保留 '+kept+' 个对应板块及其页面和讲稿。':'')+(archived.length?names+' '+archived.length+' 个板块不在新模板中，确认编排后这些页面移入“已归档页面”，可在逐页编辑中恢复。':'')+'手工新增的页面保留。';
 return {sections:proposal,summary,archived:archived.map(row=>row.id)};
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
