import {formatSelection,breakParagraph} from './editor-interactions.mjs';
/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {U,$,el,button,field,modal,status,snapshot,changed,persist,selected,selectBlock,renderChat,openMaterial,materialDetails,saveMaterialHighlights,applyPanels,renderNavigation} from './main.mjs';
import {removeSelection} from './keyboard.mjs';
import {insertBlock,editFormula} from './editor.mjs';
import {allMaterials} from './material-library.mjs';
import {catalogFor} from '../shared/material-catalog.mjs';
import {canvasDisplayMode,installCanvasDisplay,renderBlockPlaceholder} from './canvas-display.mjs';
import {placeholderBlock} from './assembly-placement.mjs';
import {installInlineMaterialDetail} from './material-inline-detail.mjs';

export function captureRange(b){
 const node=document.querySelector(`[data-id="${b.id}"] .editable`),selection=window.getSelection();
 if(node&&selection.rangeCount&&node.contains(selection.anchorNode)&&node.contains(selection.focusNode)){
  const r=selection.getRangeAt(0),prefix=r.cloneRange();prefix.selectNodeContents(node);prefix.setEnd(r.startContainer,r.startOffset);const start=prefix.toString().length;
  return {start,end:start+r.toString().length};
 }
 return {start:b.text.length,end:b.text.length};
}
export async function findEvidence(query){
 const b=selected(),range=b?captureRange(b):null,selectedText=range&&range.end>range.start?b.text.slice(range.start,range.end):'';
 const goal=String(query||selectedText||b?.text||b?.requirements||U.p.memory?.goal||'').trim();
 U.p.ui.left='materials';U.p.ui.leftOpen=true;U.p.ui.catalog={...U.p.ui.catalog,topic:'',type:'',categoryID:null,facets:{},sort:'relevance',selection:[]};
 U.materialQuery=goal;await U.E.notebook.update(U.p.id,{query:goal});applyPanels();renderNavigation();await persist();
 const input=$('material-search');input?.focus({preventScroll:true});
 status(goal?'已查找相关素材；单击预览来源，正文保持原样。':'输入研究问题或方法名，查找相关素材。');
}
export function showLayoutProposal(proposal,{reveal=true}={}){
 if(proposal.kind!=='layout')throw Error('只支持整理顺序与布局，不接受正文修改。');
 if(reveal){U.p.ui.aiOpen=true;applyPanels();}const box=$('diff');box.replaceChildren(el('h3','顺序建议'));
 const list=el('ol',undefined,'layout-preview');
 for(const sectionID of proposal.sectionOrder){const section=U.p.sections.find(s=>s.id===sectionID);if(!section)continue;const row=el('li'),name=el('strong',section.title);row.append(name);const blocks=el('ol');for(const blockID of proposal.blockOrder){const block=U.p.blocks.find(b=>b.id===blockID&&b.sectionID===sectionID);if(block)blocks.append(el('li',(block.title||block.text||block.table?.caption||({table:'表格',formula:'公式',image:'图片'})[block.type]||'空白段落').slice(0,70)));}row.append(blocks);list.append(row);}box.append(list);
 const materialsChanged=JSON.stringify(proposal.materialOrder)!==JSON.stringify(U.p.materials.map(m=>m.id));
 if(materialsChanged){const details=el('details');details.open=true;details.append(el('summary','素材顺序'));const materials=el('ol');for(const id of proposal.materialOrder){const m=U.p.materials.find(m=>m.id===id);if(m)materials.append(el('li',U.A.titleFor(m)));}details.append(materials);box.append(details);}
 for(const item of proposal.reasons||[])box.append(el('p',item.reason,'muted'));
 const expected=JSON.stringify({sections:U.p.sections,blocks:U.p.blocks,materials:U.p.materials});
 button('应用顺序',()=>{
  if(JSON.stringify({sections:U.p.sections,blocks:U.p.blocks,materials:U.p.materials})!==expected)throw Error('资料或正文已改变，请重新整理顺序。');
  const candidate=U.A.applyLayout(U.p,proposal);
  if(materialsChanged){const catalog=catalogFor(candidate,allMaterials()),key=candidate.id+'|',visible=allMaterials().filter(m=>catalog.entries[m.id].topics.includes(candidate.id)).map(m=>m.id),available=new Set(visible),moving=proposal.materialOrder.filter(id=>available.has(id)),selected=new Set(moving),queue=moving.slice(),baseline=[...new Set([...(catalog.orders[key]||[]),...visible])].filter(id=>available.has(id));catalog.orders[key]=baseline.map(id=>selected.has(id)?queue.shift():id);candidate.ui.catalog={...candidate.ui.catalog,topic:candidate.id,type:'',categoryID:null,facets:{},sort:'manual',selection:[]};candidate.ui.left='materials';candidate.ui.leftOpen=true;}
  snapshot();U.p=candidate;const saved=U.p.proposals.find(d=>d.id===proposal.id);if(saved)saved.status='applied';if(materialsChanged){U.materialQuery='';applyPanels();}changed({editor:true});if(materialsChanged)U.E.notebook.update(U.p.id,{query:''}).catch(e=>status(e.message,true));box.replaceChildren(el('p','顺序已更新 · Ctrl+Z 撤销'));status('已调整顺序，正文和来源保留 · Ctrl+Z 撤销');
 },box,'primary');
 button('保持当前顺序',()=>{const saved=U.p.proposals.find(d=>d.id===proposal.id);if(saved)saved.status='rejected';persist();box.replaceChildren();},box);
}
export async function organizeLayout(prompt='检查章节、段落和素材的顺序，提出更清晰的论证布局。'){
 if(U.busy)throw Error('当前任务仍在执行');await persist();if(U.saveError)throw U.saveError;
 U.busy=true;U.abort=new AbortController();$('cancel-task').hidden=false;U.p.ui.aiOpen=true;applyPanels();
 try{const sessionID=U.conversationSession.id;await U.conversations.append(sessionID,{role:'user',text:prompt},{origin:'assembly'});const proposal=await U.A.organize(U.p,prompt,status,U.abort.signal);if(U.abort.signal.aborted)return;U.p.proposals.push(proposal);await persist();await U.conversations.append(sessionID,{role:'assistant',text:(proposal.reasons||[]).map(x=>x.reason).join('\n\n')||'已检查当前顺序。',layoutProposalID:proposal.id},{origin:'assembly'});renderChat();showLayoutProposal(proposal);}
 finally{U.busy=false;$('cancel-task').hidden=true;}
}
let hideTimer;
function reveal(){clearTimeout(hideTimer);$('canvas').classList.add('reveal-materials');}
function conceal(){clearTimeout(hideTimer);hideTimer=setTimeout(()=>{if(!document.querySelector('.material-frame:hover,.material-frame:focus-within'))$('canvas').classList.remove('reveal-materials');},250);}
export function renderAssembly(host,b,index){
 // The article view shows the user's text; a linked card without text is drawn
 // as a placeholder so that nothing listed in the outline is hidden.
 if(canvasDisplayMode(U.p)==='article'){if(placeholderBlock(b)&&b.materials?.length)renderBlockPlaceholder(host,b);return;}
 if(!b.assembly||!b.materials.length||b.hideMaterialFrame)return;host.classList.add('material-frame');host.dataset.assembly=b.id;host.style.setProperty('--card-tone',String(index%6));
 U.expandedMaterialCards||=new Set();U.inlineMaterialDisposers||=[];
 for(const link of b.materials){const m=U.p.materials.find(m=>m.id===link.id);if(!m)continue;const card=el('div',undefined,'material-card-source'),summary=el('div',undefined,'material-card-summary'),names=el('div',undefined,'material-caption'),note=el('div',undefined,'material-description'),key=b.id+'|'+m.id;card.dataset.materialId=m.id;const title=el('strong',U.A.titleFor(m));title.dataset.action='preview-material';title.dataset.materialId=m.id;names.append(title);note.setAttribute('aria-label','中文素材说明');const description=U.A.summaryFor(m);if(U.E.renderContent)U.E.renderContent(note,description);else note.textContent=description;summary.append(names,note);card.append(summary);host.append(card);
  U.inlineMaterialDisposers.push(installInlineMaterialDetail(card,m,{E:U.E,summary,expanded:U.expandedMaterialCards.has(key),onExpanded:open=>open?U.expandedMaterialCards.add(key):U.expandedMaterialCards.delete(key),onOpen:()=>{if(U.p.ui.blockID!==b.id)selectBlock(b.id);materialDetails(m);},onSave:highlights=>saveMaterialHighlights(m,highlights),onLocate:anchor=>openMaterial(m,undefined,anchor),onError:error=>status(error.message,true)}));
 }
 host.onpointerenter=reveal;host.onpointerleave=conceal;host.onfocusin=reveal;host.onfocusout=conceal;
}

export function addChapter(afterID,child=false){const box=modal('添加章节'),name=field(box,'章节名称','',()=>{});button('添加章节',()=>{if(!name.value.trim())return;snapshot();const s={id:U.M.id('section'),title:name.value.trim(),conclusion:'',...(child?{parentID:afterID}:{})};const i=U.p.sections.findIndex(x=>x.id===afterID);U.p.sections.splice(i<0?U.p.sections.length:i+1,0,s);U.p.ui.sectionID=s.id;$('popover').close();changed({editor:true});},box);name.focus();}

export function installAssembly(){
 installCanvasDisplay();
 U.handleEvidenceKey=e=>{const target=e.target,active=target?.isConnected&&target.closest?.('.editable,.assembly-goal,#ai-prompt')?target:document.activeElement;if(e.defaultPrevented||e.isComposing||U.composing||e.keyCode===229||!e.ctrlKey||e.altKey||e.shiftKey||e.key!=='Tab'||!active?.closest('.editable,.assembly-goal,#ai-prompt'))return false;
  e.preventDefault();e.stopPropagation();const node=active.closest('.block');if(node)selectBlock(node.dataset.id);findEvidence(active.id==='ai-prompt'?active.value:undefined).catch(err=>status(err.message,true));return true;};
 document.addEventListener('contextmenu',e=>{if(e.defaultPrevented)return;if(e.target.closest('input,textarea')||e.target.closest('[contenteditable=true]')&&!e.target.closest('.block'))return;const target=e.target.closest('[data-outline-block],.section-card,.block')||(U.p.ui.left==='structure'&&e.target.closest('#library'));if(!target)return;e.preventDefault();document.getElementById('assembly-context')?.remove();
  const selection=window.getSelection(),savedRange=selection.rangeCount?selection.getRangeAt(0).cloneRange():null;const outline=target.dataset.outlineBlock,section=target.dataset.section;if(outline)selectBlock(outline);else if(target.dataset.id)selectBlock(target.dataset.id);
  const menu=el('div',undefined,'assembly-context');menu.id='assembly-context';menu.setAttribute('role','menu');menu.style.left=Math.min(e.clientX,window.innerWidth-230)+'px';menu.style.top=Math.min(e.clientY,window.innerHeight-180)+'px';document.body.append(menu);
  const item=(name,fn)=>{const n=button(name,()=>{menu.remove();return fn();},menu);n.setAttribute('role','menuitem');};
  const rename=()=>{const object=section?U.p.sections.find(s=>s.id===section):selected(),box=modal('重命名'),name=field(box,'名称',object.title||'',()=>{});button('保存名称',()=>{snapshot();object.title=name.value.trim();$('popover').close();changed({editor:true});},box);};
  if(target.id==='library')item('添加章节',()=>addChapter());
  else if(section){item('添加子章节',()=>addChapter(section,true));item('在此后添加章节',()=>addChapter(section));item('重命名章节',rename);for(const [delta,label] of [[-1,'上移章节'],[1,'下移章节']])item(label,()=>{const i=U.p.sections.findIndex(x=>x.id===section),n=i+delta;if(n<0||n>=U.p.sections.length)return;snapshot();U.p.sections.splice(n,0,U.p.sections.splice(i,1)[0]);changed({editor:true});});item('删除章节及子模块',()=>removeSelection(target));}
  else{const b=selected();if(e.target.closest('[contenteditable=true]')){item('复制选中文字',()=>document.execCommand('copy'));item('粘贴文字',()=>document.execCommand('paste'));}if(['paragraph','heading','list'].includes(b.type)){const point=captureRange(b);if(e.target.closest('.editable')){for(const [cmd,label]of [['bold','加粗 · Ctrl+B'],['italic','斜体 · Ctrl+I'],['underline','下划线 · Ctrl+U']])item(label,()=>formatSelection(cmd,null,savedRange));item('字体与颜色',()=>{const box=modal('所选文字格式');for(const font of ['宋体','黑体','Times New Roman','Arial'])button(font,()=>{$('popover').close();formatSelection('fontName',font,savedRange);},box);const color=field(box,'文字颜色','#222222',()=>{});color.type='color';button('应用颜色',()=>{$('popover').close();formatSelection('foreColor',color.value,savedRange);},box);});item('从光标处分页 · Ctrl+Enter',()=>breakParagraph(b,point));}item(b.pageBreakBefore?'取消段前分页':'本段从新一页开始',()=>{snapshot();b.pageBreakBefore=!b.pageBreakBefore;changed({editor:true});});item('查找相关证据 · Ctrl+Tab',()=>findEvidence());item('整理章节与段落顺序',()=>organizeLayout());item(b.locked?'解锁内容':'锁定内容',()=>{snapshot();b.locked=!b.locked;changed({editor:true});});}else if(b.type==='image'){item('查看图片原件',()=>window.parent.Zotero.launchFile(b.imagePath));item('替换图片',async()=>{const path=await U.A.image();if(path){snapshot();b.imagePath=path;changed({editor:true});}});}else if(b.type==='table'){item('编辑表格与数据绑定',()=>{U.p.ui.rightOpen=true;$('right').hidden=false;selectBlock(b.id);});}else if(b.type==='formula'){item('编辑 LaTeX 公式',()=>editFormula(b.id));}item('复制模块',()=>{U.blockClipboard=[U.M.clone(selected())];status('已复制模块及引用，可在结构面板 Ctrl+V 粘贴');});item('移动到章节',()=>{const b=selected(),box=modal('移动模块');for(const sec of U.p.sections)button(sec.title,()=>{snapshot();b.sectionID=sec.id;$('popover').close();changed({editor:true});},box);});item('查看来源',()=>{const b=selected(),box=modal('当前模块来源');for(const link of b.materials){const m=U.p.materials.find(x=>x.id===link.id);if(m)button(m.title,()=>openMaterial(m),box);}if(!b.materials.length)box.append(el('p','本段暂无绑定来源；通用说明仍需核验。'));});item('在此后添加正文',()=>insertBlock('paragraph'));item('删除模块 · Delete',()=>removeSelection(target));}
  menu.onkeydown=k=>{const buttons=[...menu.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);if(['ArrowUp','ArrowDown'].includes(k.key)){k.preventDefault();buttons[(i+(k.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();}if(k.key==='Escape'){k.stopPropagation();menu.remove();target.focus();}};
  menu.style.top=Math.max(5,Math.min(e.clientY,innerHeight-menu.offsetHeight-10))+'px';menu.querySelector('button').focus();
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&U.busy){e.preventDefault();U.abort?.abort();}});
 document.addEventListener('pointerdown',e=>{if(!e.target.closest('#assembly-context'))document.getElementById('assembly-context')?.remove();});
}
