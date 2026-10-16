/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {researchPromptIssue,assertWritingPreviewPrompt} from '../shared/research-ai-policy.mjs';
import {captureWritingPreview,writingResultContext} from '../shared/assembly-writing-preview.mjs';
import {requestAssemblyWritingPreview} from './assembly-writing-result.mjs';
export function assemblyWritingIntent(prompt){
 const text=String(prompt||'').trim();if(researchPromptIssue(text)?.code==='AI_AUTHORSHIP_DISABLED')return true;
 return /(?:请|帮我|给我|为我)?\s*(?:准备|生成|重写|重新生成|改写|润色|精简|装配)\s*(?:这段|当前|两个|多个|正文|段落|候选|版本)/u.test(text)&&!/(?:如何|怎么|为什么|是否|能否)[^。]*[?？]?$/u.test(text);
}
export function captureAssemblyWritingRequest(project,prompt){
 if(!assemblyWritingIntent(prompt))return null;assertWritingPreviewPrompt(prompt);return captureWritingPreview(project,{instruction:prompt});
}
export async function runAssemblyWritingRequest(U,{prompt,capture,...options},{persist,status,changed=U.changed}){
 const preview=await requestAssemblyWritingPreview(U,{...options,instruction:prompt,capture,fromChat:true},{persist,status,changed});
 const variant=preview.variants.find(row=>row.id===preview.selectedVariantID)||preview.variants[0],ids=new Set(variant.evidence.map(row=>row.sourceID));
 const sources=U.p.materials.filter(row=>ids.has(row.id)).map(row=>({id:row.id,materialID:row.id,stableID:'material:'+row.id,title:row.title,sourceText:row.sourceText,anchor:row.anchor}));
 return {text:'已准备 '+preview.variants.length+' 个'+(preview.capture.mode==='rewrite'?'改写':'装配正文')+'候选：'+preview.variants.map(row=>row.label).join('、')+'。右侧“装配结果”可比较新增和删除文字、调整要求或重新生成。选择“采用此版”后才会修改正文；也可保留原文。',sources,writingPreviewID:preview.id,writingResult:writingResultContext(U.p),steps:[{tool:'preview_assembly_writing',label:'正文候选已准备',status:'complete'}],model:preview.model};
}
