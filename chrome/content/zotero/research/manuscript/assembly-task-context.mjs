/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {writingResultContext} from '../shared/assembly-writing-preview.mjs';
const compact = value => String(value || '').replace(/\s+/gu, ' ').trim();
export function assemblyBlockText(block) {
 if (!block) return '';
 if (block.type === 'table') return (block.table?.rows || []).map(row => row.filter(cell => !cell.hidden).map(cell => String(cell.text || '')).join('\t')).join('\n').trim();
 return String(block.text || '').trim();
}
export function assemblyTaskContext(project, prompt = '') {
 const block = project.blocks?.find(row => row.id === project.ui?.blockID), sectionID = block?.sectionID || project.ui?.sectionID || project.sections?.[0]?.id || '';
 const title = compact(project.title), userText = assemblyBlockText(block), validTitle = title && !/^(?:未命名论文|新建论文|我的论文|论文装配|新论文)(?:\s*\d+)?$/u.test(title);
 const materialIDs = [...new Set((block?.materials || []).map(row => row.id).filter(id => project.materials?.some(row => row.id === id)))];
 const stage = userText ? 'block' : materialIDs.length || project.materials?.length || project.materialPaperIDs?.length ? 'materials' : validTitle ? 'structure' : 'direction';
 const label = {direction:'选题方向', structure:'论文结构', materials:'当前位置的引用与证据', block:block?.assembly ? '素材内容讨论' : '当前段落的论证'}[stage];
 const writingResult=writingResultContext(project);
 return {projectID:project.id, title:project.title, stage, sectionID, blockID:block?.id || '', userText:userText.slice(0,8000), materialIDs, currentTask:compact(prompt).slice(0,50) || label,...(writingResult?{writingResult}:{})};
}
export function assemblyTaskRequest(project, input = '') {
 const context = assemblyTaskContext(project,input), section = project.sections?.find(row => row.id === context.sectionID)?.title || '';
 const defaults = {
  direction:'请结合已有论文和素材，和我讨论可以选择的论文研究方向。具体说明问题、可用证据与缺少的信息，不写论文正文。',
  structure:'请结合我的论文标题，讨论章节结构和论证顺序。先读取当前项目素材，具体说明每一部分要回答什么问题，不写论文正文。',
  materials:`请检查${section ? '“'+section+'”中' : ''}当前位置可以引用哪些已有素材。读取实际素材，说明其支持的判断、放置位置和局限，不写论文正文。`,
  block:'请围绕我正在编辑的内容讨论这一段的作用、论证顺序、已有引用和需要补充的证据。逐项依据当前内容说明，不要改写或生成论文正文。'
 };
 return {prompt:String(input).trim() || defaults[context.stage], context};
}
