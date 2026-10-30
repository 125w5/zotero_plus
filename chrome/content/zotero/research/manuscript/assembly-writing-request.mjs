/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {researchPromptIssue,assertWritingPreviewPrompt} from '../shared/research-ai-policy.mjs';
import {captureWritingPreview,writingResultContext} from '../shared/assembly-writing-preview.mjs';
import {requestAssemblyWritingPreview} from './assembly-writing-result.mjs';
export function assemblyWritingIntent(prompt){
 const text=String(prompt||'').trim();if(researchPromptIssue(text)?.code==='AI_AUTHORSHIP_DISABLED')return true;
 return /(?:请|帮我|给我|为我)?\s*(?:准备|生成|重写|重新生成|改写|润色|精简|装配)\s*(?:这段|当前|两个|多个|正文|段落|候选|版本)/u.test(text)&&!/(?:如何|怎么|为什么|是否|能否)[^。]*[?？]?$/u.test(text);
}
// Requests to draft a part of the paper (请生成这篇论文的摘要, 帮我写一下这篇论文的
// 研究问题) pass the authorship gate by design. On the assembly page they get the
// read or task route: the matching chapter's read, the plan, or the task plan.
const PAPER_PARTS=[['摘要',/摘要|abstract/i],['研究问题',/引言|绪论|introduction|研究问题|背景/i],['引言',/引言|绪论|introduction/i],['研究背景',/引言|绪论|introduction|背景/i],['研究意义',/引言|绪论|introduction|意义/i],['方法',/方法|method/i],['实验',/实验|experiment/i],['结果',/结果|result/i],['讨论',/讨论|discussion/i],['结论',/结论|总结|conclusion/i],['贡献',/引言|绪论|introduction|结论|conclusion/i],['创新点',/引言|绪论|introduction|结论|conclusion/i],['标题',null],['关键词',null]];
export function assemblyDraftPartRoute(project,prompt){
 const text=String(prompt||'').trim();if(!text||researchPromptIssue(text))return null;
 if(/(?:是什么|是否|怎么样|如何|为什么|哪些|吗)[?？]?$|[?？]$/u.test(text))return null;
 const match=text.match(/(?:请|帮我|给我|为我|替我)?\s*(?:生成|写|撰写|起草|拟写|拟定|编写|写一下|写出|写个|写一个)[^。\n]{0,12}?(摘要|研究问题|引言|研究背景|研究意义|方法|实验|结果|讨论|结论|贡献|创新点|标题|关键词)/u);
 if(!match)return null;
 const part=match[1],pattern=PAPER_PARTS.find(row=>row[0]===part)?.[1],section=pattern?(project.sections||[]).find(row=>pattern.test(row.title||'')):null,plan=part==='研究问题'||part==='创新点'||part==='贡献';
 const actions=[...(section?[{type:'refresh-read',sectionID:section.id,label:'更新《'+section.title+'》速读'}]:[{type:'view-read'}]),...(plan?[{type:'open-plan',label:'查看可行性方案'}]:[]),{type:'prepare-task-plan'}];
 return {text:'装配阶段不生成论文正文，'+part+'由你自己写。'+(plan?part+'来自可行性方案；':'')+(section?'《'+section.title+'》的装配速读把相关证据和缺口逐条列出，每条都对应原文依据，可以据此写作；':'可以从各章装配速读找到相关证据和缺口；')+'也可以整理任务计划，把这项写作排进任务。',sources:[],assemblyActions:actions,steps:[{tool:'assembly_read_route',label:'已转为速读与任务计划',status:'complete'}]};
}
export function captureAssemblyWritingRequest(project,prompt){
 if(!assemblyWritingIntent(prompt))return null;assertWritingPreviewPrompt(prompt);return captureWritingPreview(project,{instruction:prompt});
}
export async function runAssemblyWritingRequest(U,{prompt,capture,...options},{persist,status,changed=U.changed}){
 const preview=await requestAssemblyWritingPreview(U,{...options,instruction:prompt,capture,fromChat:true},{persist,status,changed});
 const variant=preview.variants.find(row=>row.id===preview.selectedVariantID)||preview.variants[0],ids=new Set(variant.evidence.map(row=>row.sourceID));
 const sources=U.p.materials.filter(row=>ids.has(row.id)).map(row=>({id:row.id,materialID:row.id,stableID:'material:'+row.id,title:row.title,sourceText:row.sourceText,anchor:row.anchor}));
 return {text:'已准备 '+preview.variants.length+' 个'+(preview.capture.mode==='rewrite'?'改写':'装配正文')+'候选：'+preview.variants.map(row=>row.label).join('、')+'。'+(preview.incomplete?'回复达到输出长度上限，只保留了完整的候选。':'')+'右侧“装配结果”可比较新增和删除文字、调整要求或重新生成。选择“采用此版”后才会修改正文；也可保留原文。',sources,writingPreviewID:preview.id,writingResult:writingResultContext(U.p),steps:[{tool:'preview_assembly_writing',label:'正文候选已准备',status:'complete'}],model:preview.model};
}
