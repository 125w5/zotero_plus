/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {captureWritingPreview,assertWritingPreviewCurrent,latestWritingPreview,validateWritingPreview,writingPreviewDiff,applyWritingPreview,revertWritingPreview} from '../shared/assembly-writing-preview.mjs';
import {renderAssemblyFramework} from './assembly-framework.mjs';

export async function requestAssemblyWritingPreview(U,{instruction='',capture,sessionID=U.conversationSession?.id,modelID,thinkingLevel,executionMode,signal,onProgress=()=>{},fresh=false,fromChat=false,onToolPermission}={}, {persist=U.persist,changed=U.changed,status=()=>{}}={}){
 if(U.writingPreviewBusy||U.busy&&!fromChat)throw Error('当前任务尚未结束，请等待或停止');
 const p=U.p,session=U.conversations?.get(sessionID)||U.conversationSession||{};
 capture=capture||captureWritingPreview(p,{instruction});assertWritingPreviewCurrent(p,capture,{selected:true});
 modelID=modelID??session.modelID??'';thinkingLevel=thinkingLevel??session.thinkingLevel??'off';executionMode=executionMode??session.executionMode??'auto';
 if(executionMode!=='auto'){
  const permission=onToolPermission||U.requestToolPermission;
  if(!permission||await permission({toolName:'preview_assembly_writing',label:'生成装配正文候选',description:'对照当前正文与真实素材生成可比较的候选，只在右栏预览；采用需手动确认。',materialIDs:capture.sources.map(row=>row.id),sessionID,signal})!==true)throw Error('已保留原文，本次候选生成未执行');
 }
 assertWritingPreviewCurrent(U.p,capture,{selected:true});U.writingPreviewBusy=true;
 try{
  await persist({flush:true});if(U.saveError)throw U.saveError;assertWritingPreviewCurrent(U.p,capture,{selected:true});
  if(!U.A.previewWriting)throw Error('候选服务尚未加载，请重启新版');
  const preview=await U.A.previewWriting(p.id,{capture,instruction,modelID,thinkingLevel,fresh,signal,onProgress});
  if(signal?.aborted)throw Error('已停止，正文保留');if(U.p!==p)throw Error('论文已切换，本次候选未写入');assertWritingPreviewCurrent(p,capture,{selected:true});
  p.proposals||=[];for(const row of p.proposals)if(row.kind==='assembly-writing-preview'&&row.blockID===capture.blockID&&row.sectionID===capture.sectionID&&row.status==='pending')row.status='superseded';
  p.proposals.push(preview);p.proposals=p.proposals.slice(-80);p.ui.rightOpen=true;U.closeChatRail?.('right');U.applyPanels?.();changed();await persist({flush:true});if(U.saveError)throw U.saveError;
  const stored=U.A.get(p.id)?.proposals?.find(row=>row.id===preview.id);if(!stored)throw Error('候选尚未保存，请检查本机存储后重试');
  status('候选已准备，请在装配结果中比较并选择。');return preview;
 }finally{U.writingPreviewBusy=false;if(U.p===p)changed();}
}

export function renderAssemblyWritingResult(U,host,b,{el,button,snapshot,changed,persist,status,isCurrent=()=>true,materialDetails}){
 const p=U.p,doc=host.ownerDocument;
 if(!doc.getElementById('assembly-writing-result-styles')){const style=el('link');style.id='assembly-writing-result-styles';style.rel='stylesheet';style.href=new URL('./assembly-writing-result.css',import.meta.url).href;doc.head.append(style);}
 const root=el('section',undefined,'assembly-writing-result');root.dataset.blockId=b.id;host.append(root);
 const preview=latestWritingPreview(p,b.id,b.sectionID),supported=['paragraph','heading','list','placeholder'].includes(b.type);
 if(supported&&!(p.ui.assemblyFlowVersion>=2))renderAssemblyFramework(U,root,b,{el,button,persist,status,isCurrent,materialDetails});
 // Empty modules are writing plans. They are never expanded into prose just
 // because the user enters the assembly stage or selects a material.
 if(supported&&!b.text?.trim()&&!preview)return {root};
 if(supported)root.append(el('h4','局部改写'));
 const controls=el('div',undefined,'writing-result-controls'),instruction=el('textarea');instruction.rows=2;instruction.className='writing-result-instruction';instruction.placeholder=b.text?.trim()?'说明希望怎样调整这一段…':'说明这一段要表达的判断…';instruction.setAttribute('aria-label','候选正文调整要求');instruction.value=p.ui.writingInstruction?.[b.id]||'';instruction.disabled=!!b.locked;
 instruction.oninput=()=>{if(!isCurrent())return;p.ui.writingInstruction||={};p.ui.writingInstruction[b.id]=instruction.value;};
 const generate=button(preview?'重新生成':'准备两个候选',async()=>{
  if(!isCurrent())return;generate.disabled=true;root.dataset.state='running';const controller=new doc.defaultView.AbortController();U.writingPreviewAbort=controller;
  try{await requestAssemblyWritingPreview(U,{instruction:instruction.value,fresh:!!preview,signal:controller.signal,onProgress:value=>{if(root.isConnected)notice.textContent=value;}},{persist,changed,status});}
  catch(error){if(root.isConnected)notice.textContent=error.message;throw error;}
  finally{if(U.writingPreviewAbort===controller)delete U.writingPreviewAbort;if(root.isConnected){delete root.dataset.state;generate.disabled=!!b.locked||!supported;}}
 },controls,'writing-result-generate');generate.dataset.action='generate-writing-preview';generate.disabled=!!b.locked||!supported||!!U.writingPreviewBusy;generate.title=b.text?.trim()?'根据原文准备改写候选，采用前正文保留':'根据真实素材准备正文候选，采用前正文保留';
 const notice=el('p',undefined,'writing-result-notice');notice.setAttribute('role','status');root.append(instruction,controls,notice);
 if(!supported){notice.textContent='图表与公式使用上方插入和编辑工具，原始内容保留。';return {root};}
 if(!preview){notice.textContent=b.text?.trim()?'保留原段落，比较表达与论证顺序。':'依据本模块来源准备正文，缺少证据的判断不会补写。';return {root};}
 root.dataset.previewId=preview.id;root.dataset.state=preview.status;
 let stale='';if(preview.status==='pending')try{assertWritingPreviewCurrent(p,preview.capture);}catch(error){stale=error.message;}
 if(stale)notice.textContent=stale;else notice.textContent=({pending:'红色为删去的文字，绿色为新增的文字。',accepted:'已采用此版本，可继续在正文中编辑。',reverted:'已还原原段落。',rejected:'保留原文。'})[preview.status]||'此版本已由新候选替代。';
 if(preview.capture.readingCoverage?.some(row=>row.truncated)){const coverage=el('details',undefined,'writing-reading-coverage');coverage.append(el('summary','本次读取范围'));for(const row of preview.capture.readingCoverage){const line=el('p',undefined,'muted');line.textContent=(row.title||'关联素材')+' · '+row.readCharacters+' / '+row.totalCharacters+' 字符'+(row.truncated?'，仅依据所读摘录':'');coverage.append(line);}root.append(coverage);}
 const tabs=el('div',undefined,'writing-variant-tabs');tabs.setAttribute('role','tablist');root.append(tabs);
 const content=el('div',undefined,'writing-variant-content'),evidence=el('div',undefined,'writing-result-evidence'),footer=el('div',undefined,'writing-result-footer');root.append(content,evidence,footer);
 const currentVariant=()=>preview.variants.find(row=>row.id===preview.selectedVariantID)||preview.variants[0];
 const renderVariant=()=>{
  const variant=currentVariant();content.replaceChildren();evidence.replaceChildren();footer.replaceChildren();
  for(const tab of tabs.children){const active=tab.dataset.variantId===variant.id;tab.setAttribute('aria-selected',String(active));tab.classList.toggle('active',active);}
  const diff=el('div',undefined,'writing-result-diff');diff.dataset.action='writing-preview-diff';
  for(const part of writingPreviewDiff(preview.capture.before?.text||'',variant.text)){const node=el(part.kind==='delete'?'del':part.kind==='insert'?'ins':'span',undefined,'writing-diff-'+part.kind);U.E.renderContent(node,part.text);diff.append(node);}content.append(diff);
  const explanation=el('div',undefined,'writing-result-evidence-heading');explanation.append(el('span','依据'),el('small',String(variant.evidence.length)));evidence.append(explanation);
  for(const row of variant.evidence){const source=p.materials.find(material=>material.id===row.sourceID);if(source){const control=button(source.title||row.title,()=>{if(isCurrent())materialDetails(source);},evidence,'writing-result-source');control.dataset.materialId=source.id;control.title=row.quote;}else{const text=el('span','当前人工正文','writing-result-author-source');text.title=row.quote;evidence.append(text);}}
  if(preview.status==='pending'){
   const edit=button('调整候选',()=>{if(!isCurrent())return;const input=el('textarea');input.className='writing-candidate-editor';input.value=variant.text;input.setAttribute('aria-label','编辑所选候选正文');content.replaceChildren(input);const done=button('完成调整',()=>{if(!isCurrent())return;const value={variants:preview.variants.map(row=>({label:row.label,text:row.id===variant.id?input.value:row.text,quoteIDs:row.evidence.map(item=>item.quoteID)}))};const checked=validateWritingPreview(preview.capture,value,{id:preview.id,model:preview.model,thinkingLevel:preview.thinkingLevel});preview.variants=checked.variants;persist();renderVariant();},content,'writing-candidate-done');done.dataset.action='finish-candidate-edit';input.focus();},footer,'writing-result-secondary');edit.dataset.action='edit-writing-candidate';edit.disabled=!!stale||!!b.locked;
   const keep=button('保留原文',async()=>{if(!isCurrent())return;snapshot();preview.status='rejected';changed();await persist({flush:true});if(U.saveError)throw U.saveError;},footer,'writing-result-secondary');keep.dataset.action='keep-writing-original';
   const accept=button('采用此版',async()=>{if(!isCurrent())return;snapshot();const adopted=applyWritingPreview(p,preview,currentVariant().id,{confirmed:true,createBlock:U.M.block});changed({editor:true});await persist({flush:true});if(U.saveError)throw U.saveError;if(U.A.get(p.id)?.blocks.find(row=>row.id===adopted.id)?.text!==adopted.text)throw Error('正文尚未保存，请检查本机存储');status('已采用所选版本，来源保留；可撤销。');},footer,'writing-result-accept');accept.dataset.action='accept-writing-candidate';accept.disabled=!!stale||!!b.locked;
  }else if(preview.status==='accepted'){
   const revert=button('还原原段落',async()=>{if(!isCurrent())return;snapshot();revertWritingPreview(p,preview,{confirmed:true});changed({editor:true});await persist({flush:true});if(U.saveError)throw U.saveError;status('已还原原段落和原有格式。');},footer,'writing-result-secondary');revert.dataset.action='revert-writing-candidate';revert.disabled=!!b.locked;
  }
 };
 for(const variant of preview.variants){const tab=button(variant.label,()=>{if(!isCurrent())return;preview.selectedVariantID=variant.id;persist();renderVariant();},tabs,'writing-variant-tab');tab.setAttribute('role','tab');tab.dataset.variantId=variant.id;}
 renderVariant();return {root};
}
