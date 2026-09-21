/* SPDX-License-Identifier: AGPL-3.0-or-later */
const normalized=t=>String(t||'').normalize('NFKC').replace(/\s+/g,' ').trim();
export function bindEvidenceBlocks(blocks,excerpts,sources,{allowUnverified=false}={}){
 const warnings=[],known=new Map(sources.map(s=>[s.id,s]));
 for(const b of blocks||[]){
  b.evidenceIDs=Array.isArray(b.evidenceIDs)?b.evidenceIDs.filter(id=>known.has(id)):[];
  const id=String(b.quoteID||'').trim().replace(/^\[(Q\d+)\]$/,'$1');
  const excerpt=excerpts.find(q=>q.quoteID===id);
  if(excerpt){b.quote=excerpt.text;b.evidenceIDs=[excerpt.sourceID];}
  if(!['paper_fact','author_explanation'].includes(b.kind))continue;
  if(normalized(b.quote)&&b.evidenceIDs.some(id=>normalized(known.get(id).text).includes(normalized(b.quote))))continue;
  if(!allowUnverified){b.quote='';continue;}
  b.originalKind=b.kind;b.kind='unverified';b.quote='';b.evidenceIDs=[];
  b.verificationReason='模型未提供可核对的连续原文摘录';
  warnings.push(b.verificationReason);
 }
 return warnings;
}
export function balancedSources(sources,budget=64000){
 const groups=new Map();for(const s of sources){const key=s.attachmentID||'metadata';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(s);}
 const buckets=[...groups.values()],result=[];let used=0;
 while(buckets.some(b=>b.length)&&used<budget)for(const bucket of buckets){const s=bucket.shift();if(!s||used>=budget)continue;const text=s.text.slice(0,Math.min(4000,budget-used));if(text.trim()){result.push({...s,text});used+=text.length;}}
 return result;
}
