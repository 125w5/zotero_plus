/* SPDX-License-Identifier: AGPL-3.0-or-later */
export function evidenceSummary(material,{limit=100}={}){
 if(!material)return '';
 if(!material.imageExplanation&&!material.userEdited&&!['verified','confirmed'].includes(material.verification)&&['pending','running','failed'].includes(material.generationStatus))return '';
 const raw=material.summary||material.imageExplanation?.result?.sections?.find(section=>section.body)?.body||'';
 const value=String(raw).replace(/^#{1,6}\s+/gm,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/\[\d+(?:[,，\s-]+\d+)*\]/g,'').replace(/\*\*|`/g,'').replace(/\s+/g,' ').trim();
 if(value.length<=limit)return value;
 const chunk=value.slice(0,limit),sentence=Math.max(chunk.lastIndexOf('。'),chunk.lastIndexOf('；'),chunk.lastIndexOf('. '));
 return (sentence>=limit*.5?chunk.slice(0,sentence+1):chunk.replace(/[，,、;；:\s]+$/u,''))+'…';
}
