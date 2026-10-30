/* SPDX-License-Identifier: AGPL-3.0-or-later */
export function sourceAliases(source){if(!source||typeof source!=='object')return [];const keys=[source.id,source.stableID,source.materialID,source.sourceRecordID].filter(Boolean).map(String);return [...new Set(keys.flatMap(key=>[key,key.startsWith('evidence:')?key.slice(9):'evidence:'+key]))];}
// Older replies sometimes put PDF extractor IDs on a line of their own. Only
// turn an exact, unambiguous saved source into a citation; ordinary prose, code,
// mathematics and unknown/duplicate paper-local IDs remain untouched.
export function evidenceCitationText(text,sources=[]){
 const aliases=new Map();for(const source of Array.isArray(sources)?sources:[]){for(const id of sourceAliases(source)){if(/^\d+$/u.test(id))continue;const prior=aliases.get(id),key=source.stableID||source.id;aliases.set(id,prior&&(prior.ambiguous||prior.key!==key)?{ambiguous:true}:{source,key});}}
 const resolve=id=>aliases.get(id)?.ambiguous?null:aliases.get(id)?.key;
 // Chinese models may use fullwidth brackets or several exact IDs in one
 // bracket. Normalize those saved identities, never arbitrary bare IDs.
 const normalized=String(text||'').replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|\$\$[\s\S]*?\$\$|(?<!\\)\$(?:\\.|[^$\\])*?(?<!\\)\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|`[^`\n]+`|\[([^\]\n]+)\]|［([^］\n]+)］/gu,(full,ascii,wide)=>{
  const id=ascii??wide;if(id===undefined)return full;const parts=id.split(/[,，;；]\s*/u).map(value=>value.trim());return parts.every(resolve)?parts.map(value=>'['+resolve(value)+']').join(' '):full;
 });
 let fenced=false,math=false;return normalized.split('\n').map(line=>{if(/^\s*(?:```|~~~)/u.test(line)){fenced=!fenced;return line;}if(!fenced&&/^\s*(?:\$\$|\\\[|\\\])\s*$/u.test(line)){math=!math;return line;}if(fenced||math||!/^\s*P\d+-[A-Z]\d+(?:[\s,，;；、]+P\d+-[A-Z]\d+)*\s*$/u.test(line))return line;
  const ids=line.match(/P\d+-[A-Z]\d+/gu);if(ids.some(id=>!aliases.get(id)?.key||aliases.get(id).ambiguous))return line;
  return ids.map(id=>'['+aliases.get(id).key+']').join(' ');
 }).join('\n');
}
export function citedSources(message){
 const text=evidenceCitationText(message?.text,message?.sources),ids=new Set(message?.citedSourceIDs||[]),seen=new Set();
 return (Array.isArray(message?.sources)?message.sources:[]).filter(source=>{if(!source||typeof source!=='object')return false;const keys=sourceAliases(source),key=source.stableID||source.id||source.materialID;if(!key||seen.has(key)||!keys.some(id=>ids.has(id)||text.includes('['+id+']')))return false;seen.add(key);return true;});
}

// Saving an answer carries the actual preceding question, never its source
// excerpt. Resolve from the shared transcript so all conversation surfaces agree.
export function questionForAnswer(messages,message){
 const rows=Array.isArray(messages)?messages:[],index=rows.findIndex(row=>row.id===message?.id);
 if(index>=0)for(let i=index-1;i>=0;i--)if(rows[i].role==='user')return String(rows[i].text||'').trim();
 return String(message?.question||'').trim();
}
export function answerWithQuestion(messages,message){return {...message,question:questionForAnswer(messages,message)};}
export function numberedCitationText(message){
 const aliases=new Map();citedSources(message).forEach((source,index)=>{for(const id of sourceAliases(source))aliases.set(id,index+1);});
 return evidenceCitationText(message?.text,message?.sources).replace(/\[([^\]\n]+)\]/g,(full,id)=>aliases.has(id)?'['+aliases.get(id)+']':full);
}

// A paper can provide hundreds of excerpt anchors. They remain separate for
// navigation, but are not hundreds of different papers in the conversation UI.
export function sourceGroups(sources){
 const groups=new Map();for(const source of sources||[]){if(!source||typeof source!=='object')continue;
  const paperID=source.paperItemID||source.anchor?.paperItemID,attachmentID=source.attachmentID||source.anchor?.attachmentID,key=paperID?'paper:'+paperID:attachmentID?'attachment:'+attachmentID:source.doi?'doi:'+source.doi:source.paperTitle?'title:'+source.paperTitle:source.stableID||source.id;
  if(!key)continue;if(!groups.has(key))groups.set(key,{key,title:source.paperTitle||source.title||source.label||'来源',sources:[]});groups.get(key).sources.push(source);
 }return [...groups.values()];
}

// PDF pageIndex is zero-based physical location. Printed labels are independent
// metadata and must never be inferred from parser IDs, hashes or an offset.
export function sourcePageMetadata(source={}){
 const pageIndex=Number.isInteger(source.pageIndex)?source.pageIndex:source.anchor?.pageIndex;
 if(!Number.isInteger(pageIndex)||pageIndex<0)return {};
 const label=source.pageLabel??source.anchor?.pageLabel;
 return {pageIndex,pageNumber:pageIndex+1,pageNumbering:'physical',...(typeof label==='string'&&label.trim()?{pageLabel:label.trim()}:{} )};
}
export function sourceLocationLabel(source={}){const page=sourcePageMetadata(source);return page.pageNumber?'PDF 第 '+page.pageNumber+' 页'+(page.pageLabel?' · 页标签 '+page.pageLabel:''):'';}

// Only identities that the retained answer actually cited enter a follow-up
// request. The complete saved sources remain in the transcript for navigation.
export function historySourceContext(messages,{limit=64,budget=12000}={}){
 const selected=new Map();let used=0;
 for(const message of [...(messages||[])].reverse())for(const row of citedSources(message)){
  const id=row.stableID||row.id;if(!id||selected.has(id)||selected.size>=limit)continue;
  const value={id,title:String(row.paperTitle||row.title||row.label||'').slice(0,180),coverage:String(row.coverage||'此前读取的来源，保留原有核验范围').slice(0,180)},size=JSON.stringify(value).length;
  if(used+size>budget)continue;selected.set(id,value);used+=size;
 }return [...selected.values()].reverse();
}

export function selectPaperContext(rows,prompt,{limit=24,budget=48000,maxCharacters=2400}={}){
 const normalize=text=>String(text||'').normalize('NFKC').toLowerCase(),query=normalize(prompt),terms=new Set(query.match(/[a-z][a-z0-9_-]{1,}|[\u3400-\u9fff]{2}/gu)||[]);
 for(const run of query.match(/[\u3400-\u9fff]{2,}/gu)||[])for(let i=0;i<run.length-1;i++)terms.add(run.slice(i,i+2));
 const available=(rows||[]).filter(row=>String(row.text||row.sourceText||'').trim()),ranked=available.map((row,index)=>({row,index,score:[...terms].reduce((sum,term)=>sum+(normalize(row.text||row.sourceText).includes(term)?term.length:0),0)})).sort((a,b)=>b.score-a.score||a.index-b.index),chosen=new Set();
 // Keep the opening evidence and distributed page coverage when a broad
 // question has no literal match. Prefer relevant passages for a narrow question.
 for(let i=0;i<Math.min(4,available.length,limit);i++)chosen.add(i);
 for(const hit of ranked.filter(row=>row.score>0).slice(0,Math.floor(limit*2/3)))if(chosen.size<limit)chosen.add(hit.index);
 const remaining=limit-chosen.size;for(let i=0;i<remaining;i++)chosen.add(Math.min(available.length-1,Math.floor(i*(available.length-1)/Math.max(1,remaining-1))));
 for(const hit of ranked)if(chosen.size<limit)chosen.add(hit.index);
 let used=0;const selected=[],perRowBudget=Math.min(maxCharacters,Math.floor(budget/Math.max(1,chosen.size)));
 for(const index of [...chosen].filter(index=>index>=0).sort((a,b)=>a-b)){
  const row=available[index],raw=String(row.text||row.sourceText),room=Math.min(perRowBudget,budget-used);if(room<120)break;
  let text=raw.slice(0,room);if(raw.length>room){const end=Math.max(text.lastIndexOf('\n'),text.lastIndexOf('. '),text.lastIndexOf('。'));if(end>room*.6)text=text.slice(0,end+1);}
  selected.push({...row,text,contextTruncated:text.length<raw.length});used+=text.length;
 }return {sources:selected,total:available.length,selected:selected.length,truncated:selected.some(row=>row.contextTruncated)||selected.length<available.length};
}
