import {formatSelection,breakParagraph} from './editor-interactions.mjs';
/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {U,$,el,button,field,modal,status,snapshot,changed,persist,selected,selectBlock,showDiff,renderChat,openMaterial} from './main.mjs';
import {chooseCompletionMaterials} from './material-library.mjs';
import {removeSelection} from './keyboard.mjs';
import {insertBlock} from './editor.mjs';
import {paragraphAction} from './writing-tools.mjs';

export function captureRange(b){
 const node=document.querySelector(`[data-id="${b.id}"] .editable`),selection=window.getSelection();
 if(node&&selection.rangeCount&&node.contains(selection.anchorNode)&&node.contains(selection.focusNode)){
  const r=selection.getRangeAt(0),prefix=r.cloneRange();prefix.selectNodeContents(node);prefix.setEnd(r.startContainer,r.startOffset);const start=prefix.toString().length;
  return {start,end:start+r.toString().length};
 }
 return {start:b.text.length,end:b.text.length};
}
function commitCompletion(d){
 const b=U.p.blocks.find(x=>x.id===d.blockID);if(!b||b.locked||b.text!==d.before||b.revision!==d.baseRevision)throw Error('生成期间段落已改变，候选正文已保留');
 for(const m of d.retrievedMaterials||[]){const current=U.A.assetLibrary()[m.assetID];if(current&&current.revision!==m.revision)throw Error('来源已有新版本，请先核对候选正文');}
 const candidate=U.M.clone(U.p);for(const m of d.retrievedMaterials||[]){if(!candidate.materials.some(x=>x.id===m.id))candidate.materials.push(U.M.clone(m));const cb=candidate.blocks.find(x=>x.id===d.blockID);if(!cb.materials.some(x=>x.id===m.id))cb.materials.push({id:m.id,role:'support',revision:m.revision});}
 U.M.applyProposal(candidate,U.M.clone(d));snapshot();U.p=candidate;const next=U.p.blocks.find(x=>x.id===d.blockID);next.aiInsertions=[{start:d.selection.start,end:d.selection.start+d.insertText.length}];next.proseKind=d.contentKind;d.status='applied';const saved=U.p.proposals.find(x=>x.id===d.id);if(saved)saved.status='applied';U.p.ui.caret=d.selection.start+d.insertText.length;changed({editor:true});
 status(d.unverified?'已写入中文正文 · 通用说明或计划，仍需核验 · Ctrl+Z 撤销':'已写入带来源正文 · Ctrl+Z 撤销');
}
export function showInlineCandidate(d,conflict=false){
 document.getElementById('inline-completion')?.remove();const host=document.querySelector(`[data-id="${d.blockID}"]`)||$('canvas'),box=el('aside',undefined,'inline-completion');box.id='inline-completion';box.append(el('small',conflict?'你已继续编辑，旧响应未覆盖正文。':'选中文字的替换建议'),el('p',d.insertText));
 button(conflict?'插入到当前光标':'接受替换',()=>{if(conflict){const b=selected();if(!b||b.locked)throw Error('请选择可编辑段落');const r=captureRange(b);d.blockID=b.id;d.before=b.text;d.baseRevision=b.revision;d.selection={start:r.start,end:r.start};d.after=b.text.slice(0,r.start)+d.insertText+b.text.slice(r.start);}commitCompletion(d);box.remove();},box);
 button('保留原文',()=>{d.status='rejected';persist();box.remove();},box);host.append(box);
}
export async function completeBlock(prompt){
 const b=selected();if(!b||!['paragraph','heading','list'].includes(b.type))throw Error('请把光标放进正文');if(b.locked)throw Error('此段已锁定');if(U.busy)throw Error('正在补全，Esc 可停止');
 const range=captureRange(b),goal=(typeof prompt==='string'&&prompt.trim())||b.requirements||U.p.memory?.goal||`继续撰写《${U.p.title}》中“${U.p.sections.find(s=>s.id===b.sectionID)?.title||'当前章节'}”的当前段落。`;
 const before=b.text,revision=b.revision;U.busy=true;let approved;try{approved=await chooseCompletionMaterials(b,goal);}finally{U.busy=false;}if(approved===null)return;if(b.text!==before||b.revision!==revision)throw Error('段落已改变，请重新选择补全位置');range.approvedMaterialIDs=approved;range.materialChoice=true;
 range.goal=goal;U.busy=true;U.abort=new AbortController();$('cancel-task').hidden=false;U.p.chat.push({role:'user',text:goal,blockID:b.id});persist();renderChat();
 try{const result=await U.A.coauthor(U.p,b.id,goal,status,U.abort.signal,range);if(U.abort.signal.aborted)throw Error('已停止生成，原文保留');const d=result.proposal;d.retrievedMaterials=result.materials;d.toolTrace=result.trace;U.p.proposals.push(d);U.p.chat.push({role:'assistant',text:d.insertText,blockID:b.id,tools:result.trace});persist();renderChat();
  const now=U.p.blocks.find(x=>x.id===b.id),conflict=!now||now.text!==d.before||now.revision!==d.baseRevision;
  if(conflict||range.start!==range.end)showInlineCandidate(d,conflict);else commitCompletion(d);
 }finally{U.busy=false;$('cancel-task').hidden=true;}
}
let hideTimer;
function reveal(){clearTimeout(hideTimer);$('canvas').classList.add('reveal-materials');}
function conceal(){clearTimeout(hideTimer);hideTimer=setTimeout(()=>{if(!document.querySelector('.material-frame:hover,.material-frame:focus-within'))$('canvas').classList.remove('reveal-materials');},250);}
export function renderAssembly(host,b,index){
 if(!b.assembly||!b.materials.length||b.hideMaterialFrame)return;host.classList.add('material-frame');host.dataset.assembly=b.id;host.style.setProperty('--card-tone',String(index%6));
 const names=el('div',undefined,'material-caption');for(const link of b.materials){const m=U.p.materials.find(m=>m.id===link.id);if(m)button(m.title,()=>openMaterial(m),names);}
 const descriptions=b.materials.map(link=>U.A.summaryFor(U.p.materials.find(m=>m.id===link.id)||{}));
 const note=el('div',descriptions.join('；'),'material-description');note.setAttribute('aria-label','中文素材说明');host.append(names,note);
 host.onpointerenter=reveal;host.onpointerleave=conceal;host.onfocusin=reveal;host.onfocusout=conceal;
}

export function addChapter(afterID,child=false){const box=modal('添加章节'),name=field(box,'章节名称','',()=>{});button('添加章节',()=>{if(!name.value.trim())return;snapshot();const s={id:U.M.id('section'),title:name.value.trim(),conclusion:'',...(child?{parentID:afterID}:{})};const i=U.p.sections.findIndex(x=>x.id===afterID);U.p.sections.splice(i<0?U.p.sections.length:i+1,0,s);U.p.ui.sectionID=s.id;$('popover').close();changed({editor:true});},box);name.focus();}

export function installAssembly(){
 U.handleCompletionKey=e=>{const active=document.activeElement;if(e.defaultPrevented||e.isComposing||U.composing||e.keyCode===229||!e.ctrlKey||e.altKey||e.shiftKey||e.key!=='Tab'||!active?.closest('.editable,.assembly-goal,#ai-prompt'))return false;
  e.preventDefault();e.stopPropagation();const node=active.closest('.block');if(node)selectBlock(node.dataset.id);completeBlock(active.id==='ai-prompt'?active.value:undefined).catch(err=>status(err.message,true));return true;};
 document.addEventListener('contextmenu',e=>{if(e.defaultPrevented)return;if(e.target.closest('input,textarea')||e.target.closest('[contenteditable=true]')&&!e.target.closest('.block'))return;const target=e.target.closest('[data-outline-block],.section-card,.block')||(U.p.ui.left==='structure'&&e.target.closest('#library'));if(!target)return;e.preventDefault();document.getElementById('assembly-context')?.remove();
  const selection=window.getSelection(),savedRange=selection.rangeCount?selection.getRangeAt(0).cloneRange():null;const outline=target.dataset.outlineBlock,section=target.dataset.section;if(outline)selectBlock(outline);else if(target.dataset.id)selectBlock(target.dataset.id);
  const menu=el('div',undefined,'assembly-context');menu.id='assembly-context';menu.setAttribute('role','menu');menu.style.left=Math.min(e.clientX,window.innerWidth-230)+'px';menu.style.top=Math.min(e.clientY,window.innerHeight-180)+'px';document.body.append(menu);
  const item=(name,fn)=>{const n=button(name,()=>{menu.remove();return fn();},menu);n.setAttribute('role','menuitem');};
  const rename=()=>{const object=section?U.p.sections.find(s=>s.id===section):selected(),box=modal('重命名'),name=field(box,'名称',object.title||'',()=>{});button('保存名称',()=>{snapshot();object.title=name.value.trim();$('popover').close();changed({editor:true});},box);};
  if(target.id==='library')item('添加章节',()=>addChapter());
  else if(section){item('添加子章节',()=>addChapter(section,true));item('在此后添加章节',()=>addChapter(section));item('重命名章节',rename);for(const [delta,label] of [[-1,'上移章节'],[1,'下移章节']])item(label,()=>{const i=U.p.sections.findIndex(x=>x.id===section),n=i+delta;if(n<0||n>=U.p.sections.length)return;snapshot();U.p.sections.splice(n,0,U.p.sections.splice(i,1)[0]);changed({editor:true});});item('删除章节及子模块',()=>removeSelection(target));}
  else{const b=selected();if(e.target.closest('[contenteditable=true]')){item('复制选中文字',()=>document.execCommand('copy'));item('粘贴文字',()=>document.execCommand('paste'));}if(['paragraph','heading','list'].includes(b.type)){const point=captureRange(b);if(e.target.closest('.editable')){for(const [cmd,label]of [['bold','加粗 · Ctrl+B'],['italic','斜体 · Ctrl+I'],['underline','下划线 · Ctrl+U']])item(label,()=>formatSelection(cmd,null,savedRange));item('字体与颜色',()=>{const box=modal('所选文字格式');for(const font of ['宋体','黑体','Times New Roman','Arial'])button(font,()=>{$('popover').close();formatSelection('fontName',font,savedRange);},box);const color=field(box,'文字颜色','#222222',()=>{});color.type='color';button('应用颜色',()=>{$('popover').close();formatSelection('foreColor',color.value,savedRange);},box);});item('从光标处分页 · Ctrl+Enter',()=>breakParagraph(b,point));}item(b.pageBreakBefore?'取消段前分页':'本段从新一页开始',()=>{snapshot();b.pageBreakBefore=!b.pageBreakBefore;changed({editor:true});});item('按目标补全',()=>completeBlock().catch(e=>status(e.message,true)));item('润色当前内容',()=>paragraphAction('polish'));item(b.locked?'解锁内容':'锁定内容',()=>{snapshot();b.locked=!b.locked;changed({editor:true});});}else if(b.type==='image'){item('查看图片原件',()=>window.parent.Zotero.launchFile(b.imagePath));item('替换图片',async()=>{const path=await U.A.image();if(path){snapshot();b.imagePath=path;changed({editor:true});}});}else if(b.type==='table'){item('编辑表格与数据绑定',()=>{U.p.ui.rightOpen=true;$('right').hidden=false;selectBlock(b.id);});}else if(b.type==='formula'){item('编辑 LaTeX 公式',()=>{U.p.ui.rightOpen=true;$('right').hidden=false;selectBlock(b.id);});}item('复制模块',()=>{U.blockClipboard=[U.M.clone(selected())];status('已复制模块及引用，可在结构面板 Ctrl+V 粘贴');});item('移动到章节',()=>{const b=selected(),box=modal('移动模块');for(const sec of U.p.sections)button(sec.title,()=>{snapshot();b.sectionID=sec.id;$('popover').close();changed({editor:true});},box);});item('查看来源',()=>{const b=selected(),box=modal('当前模块来源');for(const link of b.materials){const m=U.p.materials.find(x=>x.id===link.id);if(m)button(m.title,()=>openMaterial(m),box);}if(!b.materials.length)box.append(el('p','本段暂无绑定来源；通用说明仍需核验。'));});item('在此后添加正文',()=>insertBlock('paragraph'));item('删除模块 · Delete',()=>removeSelection(target));}
  menu.onkeydown=k=>{const buttons=[...menu.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);if(['ArrowUp','ArrowDown'].includes(k.key)){k.preventDefault();buttons[(i+(k.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();}if(k.key==='Escape'){k.stopPropagation();menu.remove();target.focus();}};
  menu.style.top=Math.max(5,Math.min(e.clientY,innerHeight-menu.offsetHeight-10))+'px';menu.querySelector('button').focus();
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&U.busy){e.preventDefault();U.abort?.abort();}});
 document.addEventListener('pointerdown',e=>{if(!e.target.closest('#assembly-context'))document.getElementById('assembly-context')?.remove();});
}
