/* SPDX-License-Identifier: AGPL-3.0-or-later */
export function materialExcerpts(materials,budget=60000){
 const queues=materials.filter(m=>m.kind!=='idea'&&m.verification!=='stale').map(m=>{
  if(m.data?.rows)return m.data.rows.flatMap((row,r)=>row.map((text,c)=>({materialID:m.id,quote:String(text??''),cell:{row:r,col:c}})));
  const text=m.sourceText||'';return Array.from({length:Math.ceil(text.length/650)},(_,i)=>({materialID:m.id,quote:text.slice(i*650,(i+1)*650)}));
 });
 const result=[];let size=0;
 while(queues.some(q=>q.length)&&size<budget)for(const queue of queues){const q=queue.shift();if(!q?.quote.trim()||size>=budget)continue;result.push({...q,quoteID:'Q'+(result.length+1)});size+=q.quote.length;}
 return result;
}
export function bindMaterialEvidence(value,excerpts){
 if(!Array.isArray(value.evidence))return value;
 return {...value,evidence:value.evidence.map(e=>{
  if(!e.quoteID)return e; // Legacy exact quotes still pass the strict source validator.
  const q=excerpts.find(q=>q.quoteID===e.quoteID);if(!q)throw Error('AI 选择了不存在的素材摘录，未应用');
  return {materialID:q.materialID,quote:q.quote,...(q.cell?{cell:{...q.cell}}:{})};
 })};
}
