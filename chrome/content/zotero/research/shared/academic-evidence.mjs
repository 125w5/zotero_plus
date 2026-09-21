/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The model selects excerpts. Original PDF characters are never retyped by it.
export function academicExcerpts(sources,budget=60000){
 const buckets=sources.map(s=>Array.from({length:Math.ceil(s.text.length/700)},(_,i)=>({source_id:s.id,text:s.text.slice(i*700,(i+1)*700)}))),result=[];
 let used=0;while(buckets.some(b=>b.length)&&used<budget)for(const bucket of buckets){const q=bucket.shift();if(!q?.text.trim()||used>=budget)continue;result.push({...q,id:'Q'+(result.length+1)});used+=q.text.length;}return result;
}
export function bindAcademicQuotes(raw,excerpts){
 let result;try{result=JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{throw Error('模型未返回有效学术回答，请重试');}
 if(!Array.isArray(result.sections))throw Error('回答缺少正文');
 for(const section of result.sections){
  if(!Array.isArray(section.quoteIDs))throw Error('回答缺少原文摘录编号，请重试');
  section.quotes=[...new Set(section.quoteIDs)].map(id=>{const quote=excerpts.find(q=>q.id===id);if(!quote)throw Error('回答选择了不存在的摘录；未保存');return {source_id:quote.source_id,text:quote.text};});
  section.sources=[...new Set(section.quotes.map(q=>q.source_id))];
 }
 return JSON.stringify(result);
}
